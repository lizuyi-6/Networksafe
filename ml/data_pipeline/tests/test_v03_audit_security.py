"""Regression tests for audit 2026-08 ML fixes.

Covers:
- ML-004: audit chain truncation / rewrite detection (sealed tip snapshot +
  HMAC), torn-tail repair, fail-closed resume.
- ML-002: bounded env ints in config.
- ML-005: specHash keyed-chain binding at finalize.
- ML-008: fetch_public_sources containment check.
- ML-009: v0.2 redaction provider-key value shapes.
- ML-012: provider token budget gate.

Run: py -3 -m pytest ml/data_pipeline/tests/test_v03_audit_security.py -q
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))
sys.path.insert(0, str(PIPELINE_DIR / "v03"))

from v03.audit import AuditLog, AuditIntegrityError  # noqa: E402
from v03.generation_spec import GenerationSpec  # noqa: E402
import fetch_public_sources  # noqa: E402
from common import redact_text  # noqa: E402


def _new_log(tmp: Path) -> AuditLog:
    log = AuditLog(tmp / "audit.jsonl")
    log.append(event="accept", sampleId="s1")
    log.append(event="accept", sampleId="s2")
    log.append(event="reject", sampleId="s3")
    return log


# ---- ML-004: chain + snapshot integrity ------------------------------------


def test_chain_and_snapshot_verify_ok():
    with tempfile.TemporaryDirectory() as d:
        log = _new_log(Path(d))
        ok, violations = log.verify_with_snapshot()
        assert ok, violations


def test_truncation_is_detected():
    with tempfile.TemporaryDirectory() as d:
        log = _new_log(Path(d))
        path = Path(d) / "audit.jsonl"
        lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
        # cut the tail -> chain still self-consistent, snapshot must catch it.
        # Fail-closed happens at load (constructor) already.
        path.write_text("".join(lines[:-1]), encoding="utf-8")
        try:
            AuditLog(path)
        except AuditIntegrityError as e:
            assert "truncat" in str(e).lower()
        else:
            raise AssertionError("tail truncation must be fail-closed at load")


def test_full_rewrite_is_detected():
    with tempfile.TemporaryDirectory() as d:
        log = _new_log(Path(d))
        path = Path(d) / "audit.jsonl"
        # rewrite a fresh self-consistent chain (drop the middle entry)
        lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
        del lines[1]
        prev = "GENESIS"
        import hashlib
        rewritten = []
        for ln in lines:
            obj = json.loads(ln)
            obj.pop("entryHash", None)
            obj["prev"] = prev
            canon = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
            h = hashlib.sha256(canon.encode("utf-8")).hexdigest()
            obj["entryHash"] = h
            prev = h
            rewritten.append(json.dumps(obj, ensure_ascii=False) + "\n")
        path.write_text("".join(rewritten), encoding="utf-8")
        # the sealed snapshot still remembers count=3 / old tip -> refuse
        try:
            AuditLog(path)
        except AuditIntegrityError:
            pass
        else:
            raise AssertionError("full rewrite must be fail-closed at load")


def test_forged_snapshot_with_wrong_seal_is_rejected():
    with tempfile.TemporaryDirectory() as d:
        log = _new_log(Path(d))
        snap_path = Path(d) / "audit.tip.json"
        snap = json.loads(snap_path.read_text(encoding="utf-8"))
        snap["seal"] = "0" * 64  # forged seal
        snap_path.write_text(json.dumps(snap), encoding="utf-8")
        try:
            AuditLog(Path(d) / "audit.jsonl")
        except AuditIntegrityError as e:
            assert "seal" in str(e)
        else:
            raise AssertionError("forged seal must be fail-closed at load")


def test_truncated_to_empty_with_snapshot_is_rejected():
    with tempfile.TemporaryDirectory() as d:
        log = _new_log(Path(d))
        (Path(d) / "audit.jsonl").write_text("", encoding="utf-8")
        try:
            AuditLog(Path(d) / "audit.jsonl")
        except AuditIntegrityError as e:
            assert "truncated" in str(e)
        else:
            raise AssertionError("truncation to empty must be fail-closed")


def test_torn_final_line_is_repaired():
    with tempfile.TemporaryDirectory() as d:
        log = _new_log(Path(d))
        path = Path(d) / "audit.jsonl"
        with path.open("a", encoding="utf-8") as f:
            f.write('{"event":"accept","sampleId":"s4","prev":"to')  # torn tail
        reloaded = AuditLog(path)  # must not raise
        assert reloaded.count() == 3
        ok, _ = reloaded.verify_with_snapshot()
        assert ok


def test_mid_file_corruption_is_fail_closed():
    with tempfile.TemporaryDirectory() as d:
        log = _new_log(Path(d))
        path = Path(d) / "audit.jsonl"
        lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
        lines[0] = lines[0].replace('"s1"', '"tampered"')  # hash chain breaks
        path.write_text("".join(lines), encoding="utf-8")
        try:
            AuditLog(path)
        except AuditIntegrityError:
            pass
        else:
            raise AssertionError("mid-file corruption must be fail-closed")


# ---- ML-002: bounded env ints -----------------------------------------------


def test_env_bounded_int_clamps_and_rejects(monkeypatch):
    sys.path.insert(0, str(PIPELINE_DIR.parent))  # ml/ package root parent
    from ml.data_pipeline.v03 import config as v03_config

    assert v03_config._env_bounded_int("ARK_TEST_X", 7, 1, 10) == 7
    monkeypatch.setenv("ARK_TEST_X", "5")
    assert v03_config._env_bounded_int("ARK_TEST_X", 7, 1, 10) == 5
    monkeypatch.setenv("ARK_TEST_X", "999")
    assert v03_config._env_bounded_int("ARK_TEST_X", 7, 1, 10) == 10  # clamp hi
    monkeypatch.setenv("ARK_TEST_X", "0")
    assert v03_config._env_bounded_int("ARK_TEST_X", 7, 1, 10) == 1  # clamp lo
    monkeypatch.setenv("ARK_TEST_X", "not-an-int")
    try:
        v03_config._env_bounded_int("ARK_TEST_X", 7, 1, 10)
    except SystemExit as e:
        assert e.code == 2
    else:
        raise AssertionError("invalid int must be a hard error")


# ---- ML-008: containment ------------------------------------------------------


def test_containment_accepts_inside_and_rejects_escape(tmp_path):
    cache_root = tmp_path / "cache"
    cache_root.mkdir()
    inside = cache_root / "owasp" / "crs.tar.gz"
    ok = fetch_public_sources.ensure_within(cache_root, inside)
    assert ok == inside.resolve()

    try:
        fetch_public_sources.ensure_within(cache_root, cache_root / "../escape.tar.gz")
    except ValueError as e:
        assert "escapes" in str(e)
    else:
        raise AssertionError("sibling escape must be rejected")

    # prefix trick: cache-evil must NOT prefix-match cache
    evil = tmp_path / "cache-evil" / "x.tar.gz"
    evil.parent.mkdir()
    try:
        fetch_public_sources.ensure_within(cache_root, evil)
    except ValueError:
        pass
    else:
        raise AssertionError("prefix sibling must be rejected")


# ---- ML-012: token budget gate -------------------------------------------------


def test_token_budget_gate(monkeypatch):
    sys.path.insert(0, str(PIPELINE_DIR.parent))
    import importlib
    monkeypatch.setenv("ARK_TOTAL_TOKEN_BUDGET", "100")
    import ml.data_pipeline.v03.provider as provider
    importlib.reload(provider)

    assert provider._budget_total == 100
    assert not provider.budget_exhausted()

    class FakeResult:
        prompt_tokens = 60
        completion_tokens = 30
    provider._budget_account(FakeResult())  # 90 used
    assert not provider.budget_exhausted()
    provider._budget_account(FakeResult())  # 180 used -> exhausted
    assert provider.budget_exhausted()
    try:
        provider._budget_check()
    except provider.TokenBudgetExceeded:
        pass
    else:
        raise AssertionError("budget check must raise once exhausted")

    del os.environ["ARK_TOTAL_TOKEN_BUDGET"]
    importlib.reload(provider)
    assert provider._budget_total is None  # unset -> unlimited (legacy)


# ---- ML-005: specHash keyed-chain binding --------------------------------------


def _make_accepted_record(sid: str):
    spec = GenerationSpec(sampleId=sid)
    return spec, {
        "sampleId": sid,
        "specHash": spec.specHash,
        "spec": spec.to_dict(),
    }


def test_spechash_binding_happy_path():
    with tempfile.TemporaryDirectory() as d:
        log = AuditLog(Path(d) / "audit.jsonl")
        spec_a, rec_a = _make_accepted_record("sa1")
        spec_b, rec_b = _make_accepted_record("sa2")
        log.append(event="accept", sampleId="sa1", specHash=spec_a.specHash)
        log.append(event="accept", sampleId="sa2", specHash=spec_b.specHash)

        from v03 import finalize as fin
        out = fin._spechash_binding_violations([rec_a, rec_b], log)
        assert out["spechashViolations"] == 0
        assert out["spechashChainBound"] == 2


def test_spechash_rewrite_with_recomputed_unkeyed_hash_is_caught():
    """The ML-005 core: rewriting a spec AND recomputing its (unkeyed) hash
    stays self-consistent but cannot match the keyed, sealed chain."""
    with tempfile.TemporaryDirectory() as d:
        log = AuditLog(Path(d) / "audit.jsonl")
        spec, rec = _make_accepted_record("sa1")
        log.append(event="accept", sampleId="sa1", specHash=spec.specHash)

        tampered_spec = GenerationSpec.from_dict(rec["spec"])
        tampered_spec.targetHost = "evil.example.net"  # attacker edit
        tampered_spec.specHash = tampered_spec.compute_hash()  # recompute unkeyed hash
        rec["spec"] = tampered_spec.to_dict()
        rec["specHash"] = tampered_spec.specHash

        from v03 import finalize as fin
        out = fin._spechash_binding_violations([rec], log)
        assert out["spechashSelfConsistent"] == 1      # unkeyed hash matches...
        assert out["spechashChainBound"] == 0          # ...but the chain disagrees
        assert out["spechashViolations"] == 1


def test_spechash_plain_payload_edit_without_recompute_is_caught():
    with tempfile.TemporaryDirectory() as d:
        log = AuditLog(Path(d) / "audit.jsonl")
        spec, rec = _make_accepted_record("sa1")
        log.append(event="accept", sampleId="sa1", specHash=spec.specHash)
        rec["spec"]["targetHost"] = "evil.example.net"  # hash NOT recomputed

        from v03 import finalize as fin
        out = fin._spechash_binding_violations([rec], log)
        assert out["spechashSelfConsistent"] == 0
        assert out["spechashViolations"] == 1


def test_spechash_ancient_accept_events_without_hash_do_not_bind():
    with tempfile.TemporaryDirectory() as d:
        log = AuditLog(Path(d) / "audit.jsonl")
        spec, rec = _make_accepted_record("old1")
        log.append(event="accept", sampleId="old1")  # no specHash field

        from v03 import finalize as fin
        out = fin._spechash_binding_violations([rec], log)
        assert out["spechashViolations"] == 0  # backward compatible: unbound, not failed
        assert out["spechashChainBound"] == 0


# ---- ML-009: v0.2 redaction provider-key coverage -------------------------------


def test_redact_covers_provider_key_value_shapes():
    cases = [
        ("AKIAIOSFODNN7EXAMPLE", "aws_access_key"),
        ("ghp_" + "a" * 36, "github_pat"),
        ("glpat-" + "x" * 24, "gitlab_pat"),
        ("xoxb-" + "1234567890abcdef", "slack_token"),
        ("sk_live_" + "a" * 24, "stripe_live"),
        ("sk-ant-" + "b" * 50, "anthropic_key"),
        ("sk-" + "c" * 40, "openai_key"),
        ("AIza" + "d" * 35, "google_api"),
        ("ya29." + "e" * 20, "google_oauth"),
    ]
    for secret, name in cases:
        redacted, count = redact_text(f"leak: {secret} end")
        assert f"[REDACTED:{name}]" in redacted, f"{name} not redacted: {redacted}"
        assert count >= 1


def test_redact_covers_private_key_block_and_legacy_shapes():
    pk = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----"
    redacted, count = redact_text(pk)
    assert "[REDACTED:private_key]" in redacted and "MIIEow" not in redacted
    # legacy generic shapes still work (no regression)
    redacted, count = redact_text("password=hunter2")
    assert redacted == "password=[REDACTED]" and count == 1
    redacted, count = redact_text('{"apiKey": "abc"}')
    assert redacted == '{"apiKey": "[REDACTED]"}' and count == 1
