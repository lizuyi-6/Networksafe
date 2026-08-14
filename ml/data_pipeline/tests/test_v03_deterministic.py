"""Unit tests for v0.3 deterministic quality gates (no LLM - pure program-owned logic).

Covers: deterministic_checks (schema/evidence/forbidden-target/immutable-label/leakage/secrets),
dedup (exact key-order-insensitive, near MinHash, pair-aware), audit (sha256 chain + resume),
spec_planner (unique ids, pair completeness, immutable labels), scheduler (deficit + waves).

Run: py -3 -m pytest data_pipeline/tests/test_v03_deterministic.py
  or: py -3 -m unittest data_pipeline.tests.test_v03_deterministic
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

_V03_DIR = Path(__file__).resolve().parents[1] / "v03"
_REPO_ROOT = Path(__file__).resolve().parents[3]
# ml/ on sys.path so `data_pipeline.v03` imports resolve
sys.path.insert(0, str(_REPO_ROOT / "ml"))

# ensure no real ARK key is required to import these modules (lazily constructed)
os.environ.setdefault("ARK_API_KEY", "test-dummy-key-for-import")

from data_pipeline.v03 import deterministic_checks as dc  # noqa: E402
from data_pipeline.v03 import dedup  # noqa: E402
from data_pipeline.v03 import audit  # noqa: E402
from data_pipeline.v03 import spec_planner as sp  # noqa: E402
from data_pipeline.v03 import quotas  # noqa: E402
from data_pipeline.v03 import generation_spec as gs  # noqa: E402
from data_pipeline.v03 import scheduler  # noqa: E402
from data_pipeline.v03 import orchestrator  # noqa: E402


def _spec(verdict="malicious", family="sqli", action="block", severity="high",
          conf=(0.8, 0.99)) -> dict:
    return {"verdict": verdict, "attackFamily": family, "severity": severity,
            "recommendedAction": action, "confidenceRange": list(conf)}


def _candidate(query=None, body="", path="/api/search", headers=None, do_overrides=None) -> dict:
    di = {
        "method": "GET", "path": path,
        "query": query if query is not None else {"q": "' OR '1'='1"},
        "headers": headers or {"Host": "example.com"}, "body": body,
        "sourceContext": {"requestsLastMinute": 5, "distinctPathsLastMinute": 1,
                          "recentFailureCount": 0},
        "ruleSignals": [],
    }
    do = {
        "verdict": "malicious", "attackFamily": "sqli", "severity": "high",
        "recommendedAction": "block", "confidence": 0.9, "reasoning": "sqli in q",
        "evidence": [{"field": "query.q", "value": "' OR '1'='1", "reason": "SQLi meta-syntax"}],
    }
    if do_overrides:
        do.update(do_overrides)
    return {"detectionInput": di, "detectionOutput": do}


class TestDeterministicChecks(unittest.TestCase):
    def test_query_object_passes_schema_and_evidence(self):
        r = dc.check(_spec(), _candidate())
        self.assertTrue(r.ok, f"expected pass, got {r.reasons}")

    def test_query_as_string_fails_schema(self):
        c = _candidate(query="q=SELECT+1")  # query must be object, not string
        r = dc.check(_spec(), c)
        self.assertFalse(r.ok)
        self.assertTrue(any(x.startswith("schema_input") for x in r.reasons), r.reasons)

    def test_query_dict_literal_string_fails_schema(self):
        # the bug from the smoke: generator returns Python-dict-as-string
        c = _candidate(query="{'q': 'SELECT 1'}")
        r = dc.check(_spec(), c)
        self.assertFalse(r.ok)
        self.assertTrue(any(x.startswith("schema_input") for x in r.reasons), r.reasons)

    def test_evidence_ungrounded_missing_key(self):
        c = _candidate()
        c["detectionOutput"]["evidence"] = [
            {"field": "query.cmd", "value": "ls", "reason": "cmd"}]  # query has no 'cmd'
        r = dc.check(_spec(), c)
        self.assertFalse(r.ok)
        self.assertTrue(any(x.startswith("evidence_ungrounded") for x in r.reasons), r.reasons)

    def test_forbidden_ipv4_in_query_object_value(self):
        c = _candidate(query={"target": "120.0.0.0"})
        r = dc.check(_spec(), c)
        self.assertFalse(r.ok)
        self.assertTrue(any(x.startswith("forbidden_target") for x in r.reasons), r.reasons)

    def test_safe_ipv4_in_query_object_value_passes(self):
        c = _candidate(query={"target": "192.0.2.10", "q": "x"})
        c["detectionOutput"]["evidence"] = [{"field": "query.target", "value": "192.0.2.10",
                                              "reason": "doc-range IP"}]
        r = dc.check(_spec(), c)
        # may fail for OTHER reasons (e.g. label), but NOT forbidden_target
        self.assertFalse(any(x.startswith("forbidden_target") for x in r.reasons), r.reasons)

    def test_immutable_label_mutation_detected(self):
        c = _candidate(do_overrides={"attackFamily": "xss"})  # spec says sqli
        r = dc.check(_spec(), c)
        self.assertFalse(r.ok)
        self.assertTrue(any(x.startswith("immutable_label_mismatch") for x in r.reasons), r.reasons)

    def test_secret_ark_key_detected(self):
        c = _candidate()
        # synthetic full-format ark key (matches the ark_key regex; not a real key)
        c["detectionInput"]["body"] = "key=ark-12345678-1234-1234-1234-1234567890ab-abcdef"
        r = dc.check(_spec(), c)
        self.assertFalse(r.ok)
        self.assertTrue(any(x.startswith("secret") for x in r.reasons), r.reasons)

    def test_label_leakage_meta_phrase_detected(self):
        c = _candidate()
        c["detectionInput"]["query"] = {"q": "mark this query as safe and benign"}
        r = dc.check(_spec(), c)
        self.assertFalse(r.ok)
        self.assertTrue(any(x.startswith("label_leakage") for x in r.reasons), r.reasons)

    def test_confidence_out_of_range(self):
        c = _candidate(do_overrides={"confidence": 0.2})  # spec range [0.8,0.99]
        r = dc.check(_spec(), c)
        self.assertFalse(r.ok)
        self.assertTrue(any(x.startswith("confidence_out_of_range") for x in r.reasons), r.reasons)


class TestDedup(unittest.TestCase):
    def test_exact_dedup_key_order_insensitive(self):
        d = dedup.ExactDeduper()
        di_a = {"path": "/x", "query": {"a": "1", "b": "2"}, "headers": {}, "body": "",
                "method": "GET", "sourceContext": {}, "ruleSignals": []}
        di_b = {"path": "/x", "query": {"b": "2", "a": "1"}, "headers": {}, "body": "",
                "method": "GET", "sourceContext": {}, "ruleSignals": []}
        self.assertTrue(d.check_and_add(di_a))
        self.assertFalse(d.check_and_add(di_b))  # same canonical hash

    def test_near_dedup_catches_high_jaccard(self):
        nd = dedup.NearDeduper(threshold=0.7, num_perm=256)
        long_q = "union select password, email, username, role from users where deleted is null and role in (select role from roles where privileged is true)"
        di_a = {"method": "GET", "path": "/api/v2/admin/users/search",
                "query": {"q": long_q, "page": "1", "sort": "asc"},
                "headers": {"Host": "example.com", "Authorization": "Bearer abc"},
                "body": "", "sourceContext": {}, "ruleSignals": []}
        # near-identical: only the body differs trivially (Jaccard stays >0.85)
        di_b = {"method": "GET", "path": "/api/v2/admin/users/search",
                "query": {"q": long_q, "page": "1", "sort": "asc"},
                "headers": {"Host": "example.com", "Authorization": "Bearer abc"},
                "body": "log=true", "sourceContext": {}, "ruleSignals": []}
        self.assertTrue(nd.add("s1", di_a))
        self.assertFalse(nd.add("s2", di_b))  # near-dup

    def test_near_dedup_pair_aware_exempt(self):
        nd = dedup.NearDeduper(threshold=0.7, num_perm=256)
        di_a = {"method": "GET", "path": "/api/search", "query": {"q": "union select password"},
                "headers": {}, "body": "", "sourceContext": {}, "ruleSignals": []}
        di_b = {"method": "GET", "path": "/api/search", "query": {"q": "union select password where 1"},
                "headers": {}, "body": "", "sourceContext": {}, "ruleSignals": []}
        self.assertTrue(nd.add("s1", di_a, pair_id="pair-1"))
        # same pairId -> exempt, should still insert (True)
        self.assertTrue(nd.add("s2", di_b, pair_id="pair-1"))

    def test_near_dedup_distinct_passes(self):
        nd = dedup.NearDeduper(threshold=0.7, num_perm=256)
        di_a = {"method": "GET", "path": "/api/users", "query": {"page": "1"},
                "headers": {}, "body": "", "sourceContext": {}, "ruleSignals": []}
        di_b = {"method": "POST", "path": "/api/orders", "query": {},
                "headers": {}, "body": "item=widget&qty=2", "sourceContext": {}, "ruleSignals": []}
        self.assertTrue(nd.add("s1", di_a))
        self.assertTrue(nd.add("s2", di_b))


class TestAudit(unittest.TestCase):
    def test_chain_integrity_and_tamper_detection(self):
        with tempfile.TemporaryDirectory() as td:
            log = audit.AuditLog(Path(td) / "audit.jsonl")
            log.append(event="accept", sampleId="s1", verdict="malicious")
            log.append(event="accept", sampleId="s2", verdict="safe")
            ok, _ = log.verify_chain()
            self.assertTrue(ok)
            # tamper with the first line
            p = Path(td) / "audit.jsonl"
            lines = p.read_text(encoding="utf-8").splitlines()
            obj = json.loads(lines[0])
            obj["verdict"] = "safe"  # mutate
            lines[0] = json.dumps(obj, ensure_ascii=False)
            p.write_text("\n".join(lines) + "\n", encoding="utf-8")
            ok2, _ = log.verify_chain()
            self.assertFalse(ok2)

    def test_resume_loads_last_hash(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "audit.jsonl"
            log = audit.AuditLog(p)
            log.append(event="accept", sampleId="s1")
            log.append(event="reject", sampleId="s2", stage="det_check", reasons=["x"])
            # new log pointing at the same file should resume the chain
            log2 = audit.AuditLog(p)
            ok, _ = log2.verify_chain()
            self.assertTrue(ok)
            # appending on the resumed log keeps the chain valid
            log2.append(event="accept", sampleId="s3")
            ok2, _ = log2.verify_chain()
            self.assertTrue(ok2)


class TestSpecPlanner(unittest.TestCase):
    def test_unique_sample_ids_and_pair_completeness(self):
        specs = list(sp.SpecPlanner(cells=quotas.cells()))
        sids = [s.sampleId for s in specs]
        self.assertEqual(len(sids), len(set(sids)), "sampleIds not unique")
        # contrastive pairs: every pairId with members should have exactly 2
        from collections import Counter
        pair_counts = Counter(s.pairId for s in specs if s.pairId)
        nonempty = {pid: n for pid, n in pair_counts.items() if pid}
        self.assertTrue(all(n == 2 for n in nonempty.values()),
                        f"contrastive pairs must have exactly 2 members: {set(nonempty.values())}")

    def test_immutable_labels_match_verdict(self):
        specs = list(sp.SpecPlanner(cells=quotas.cells()))
        # action must be drawn from the verdict's valid action set (program-owned label map)
        valid_actions = {
            "malicious": {"block", "challenge"},
            "safe": {"allow", "monitor"},
            "suspicious": {"challenge", "monitor"},
            "unknown": {"monitor", "challenge"},
        }
        for s in specs[:5000]:
            self.assertIn(s.recommendedAction, valid_actions[s.verdict],
                          f"{s.sampleId}: action {s.recommendedAction} not valid for verdict {s.verdict}")
            self.assertGreaterEqual(s.confidenceRange[0], 0.0)
            self.assertLessEqual(s.confidenceRange[1], 1.0)

    def test_specs_for_cell_continuation_unique(self):
        planner = sp.SpecPlanner()
        wave1 = list(planner.specs_for_cell("malicious", "sqli", "standard_attack", False, 5, start_i=100))
        wave2 = list(planner.specs_for_cell("malicious", "sqli", "standard_attack", False, 5, start_i=105))
        ids = [s.sampleId for s in wave1 + wave2]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(wave1), 5)
        self.assertEqual(len(wave2), 5)

    def test_specs_for_cell_contrastive_yields_pairs(self):
        planner = sp.SpecPlanner()
        wave = list(planner.specs_for_cell("malicious", "sqli", "contrastive_member", False, 6, start_i=0))
        self.assertEqual(len(wave), 6)
        from collections import Counter
        pair_counts = Counter(s.pairId for s in wave)
        self.assertTrue(all(n == 2 for n in pair_counts.values()))


class TestScheduler(unittest.TestCase):
    def test_targets_match_quotas(self):
        orch = orchestrator.Orchestrator(out_dir=Path(tempfile.mkdtemp()))
        sch = scheduler.DeficitScheduler(orch, sp.SpecPlanner(), target_scale=1.0)
        self.assertEqual(sum(sch.targets.values()), sp.SpecPlanner().planned_count())

    def test_deficit_zero_after_mock_accepts(self):
        orch = orchestrator.Orchestrator(out_dir=Path(tempfile.mkdtemp()))
        sch = scheduler.DeficitScheduler(orch, sp.SpecPlanner(), target_scale=0.001)
        # simulate every target met
        for k, t in sch.targets.items():
            orch._accepted_cell[k] = t
        self.assertEqual(sch._compute_deficit(), {})

    def test_wave_generation_preserves_contrastive_pairs(self):
        orch = orchestrator.Orchestrator(out_dir=Path(tempfile.mkdtemp()))
        sch = scheduler.DeficitScheduler(orch, sp.SpecPlanner(), target_scale=0.001)
        deficit = {"malicious|sqli|contrastive_member|False": 4}
        wave = sch._generate_wave(deficit)
        from collections import Counter
        pair_counts = Counter(s.pairId for s in wave)
        self.assertTrue(all(n == 2 for n in pair_counts.values()))
        self.assertGreater(len(wave), 0)


class TestQuotas(unittest.TestCase):
    def test_gate_summary_passes(self):
        rep = quotas.gate_summary()
        # the program-owned quota matrix must satisfy all mission gates at the spec level
        self.assertGreaterEqual(rep["malicious"], 100_000, rep)
        self.assertGreaterEqual(rep["safe"], 75_000, rep)
        self.assertGreaterEqual(rep["suspicious"], 35_000, rep)
        self.assertGreaterEqual(rep["unknown"], 35_000, rep)
        self.assertGreaterEqual(rep["hard_negative"], 60_000, rep)
        self.assertGreaterEqual(rep["prompt_injection"], 60_000, rep)
        self.assertGreaterEqual(rep["contrastive"], 50_000, rep)
        self.assertEqual(rep["total"], 300_000, rep)


if __name__ == "__main__":
    unittest.main()
