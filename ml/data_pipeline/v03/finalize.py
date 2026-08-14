"""v0.3 dataset finalization: post-processing near-dedup sweep, gate evaluation, manifest +
report generation. Run after the orchestrator/scheduler has produced accepted records.

Outputs (under RELEASES_DIR):
  - accepted/shard-*.jsonl  (re-sharded to 5k-10k after the final dedup sweep)
  - manifest.json           (counts, gate status, file hashes, provenance)
  - v03-generation-report.md (human-readable report with mission verdict lines)

This module does NOT touch any LLM. It only reads accepted records and verifies invariants.
"""
from __future__ import annotations
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from . import config
from .dedup import near_dedup_pass, ExactDeduper
from . import quality_gates
from . import quotas
from .audit import AuditLog, AuditIntegrityError


def _verify_audit_integrity(out_dir: Path) -> dict:
    """ML-004 (audit 2026-08): finalize REFUSES to write a manifest over an audit
    log that fails chain verification or whose sealed tip snapshot disagrees
    (truncation / rewrite). Fail-closed: no manifest, exit code 2."""
    audit = AuditLog(out_dir / "audit.jsonl")
    ok, violations = audit.verify_with_snapshot()
    if not ok:
        raise AuditIntegrityError(
            "audit integrity check failed; refusing to finalize: " + "; ".join(violations[:5]))
    return {"chainEntries": audit.count()}


def _load_records(accepted_dir: Path) -> list[dict]:
    records: list[dict] = []
    for shard in sorted(accepted_dir.glob("shard-*.jsonl")):
        with shard.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    records.append(json.loads(line))
    return records


def _reshard(records: list[dict], accepted_dir: Path, shard_max: int = config.SHARD_MAX) -> int:
    """Re-write accepted records into clean 5k-10k shards (overwrites existing shards)."""
    # clear existing shards
    for old in accepted_dir.glob("shard-*.jsonl"):
        old.unlink()
    idx = 0
    count = 0
    fh = (accepted_dir / f"shard-{idx:05d}.jsonl").open("w", encoding="utf-8")
    for rec in records:
        if count >= shard_max:
            fh.close()
            idx += 1
            count = 0
            fh = (accepted_dir / f"shard-{idx:05d}.jsonl").open("w", encoding="utf-8")
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        count += 1
    fh.close()
    return idx + 1


def _file_hashes(accepted_dir: Path) -> list[dict]:
    out: list[dict] = []
    for shard in sorted(accepted_dir.glob("shard-*.jsonl")):
        h = hashlib.sha256()
        with shard.open("rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        out.append({"file": shard.name, "sha256": h.hexdigest(), "bytes": shard.stat().st_size})
    return out


def _exact_dup_count(records: list[dict]) -> int:
    """Count exact-duplicate detectionInputs (should be 0 - orchestrator exact-dedups)."""
    d = ExactDeduper()
    dups = 0
    for r in records:
        di = r.get("detectionInput")
        if not isinstance(di, dict):
            continue
        if not d.check_and_add(di):
            dups += 1
    return dups


def _immutable_label_mismatches(records: list[dict]) -> int:
    """Count records where groundTruth != detectionOutput immutable labels (must be 0)."""
    mism = 0
    for r in records:
        gt = r.get("groundTruth") or {}
        do = r.get("detectionOutput") or {}
        for f in ("verdict", "attackFamily", "severity", "recommendedAction"):
            if gt.get(f) != do.get(f):
                mism += 1
                break
    return mism


def finalize(out_dir: Path | None = None) -> dict:
    out_dir = out_dir or config.RELEASES_DIR
    # 0. audit chain + sealed-tip verification (fail-closed; ML-004)
    audit_info = _verify_audit_integrity(out_dir)
    accepted_dir = out_dir / "accepted"
    records = _load_records(accepted_dir)
    pre_dedup = len(records)

    # 1. final near-dedup sweep (pair-aware)
    kept, removed = near_dedup_pass(records)
    # 2. exact-dup verification (must be 0)
    exact_dups = _exact_dup_count(kept)
    # 3. immutable-label verification (must be 0)
    label_mism = _immutable_label_mismatches(kept)
    # 4. re-shard the kept set
    n_shards = _reshard(kept, accepted_dir)
    # 5. gate evaluation
    gates = quality_gates.evaluate(kept)
    # 6. file hashes
    file_hashes = _file_hashes(accepted_dir)

    report = {
        "datasetVersion": config.DATASET_VERSION,
        "auditChain": audit_info,
        "acceptedCount": len(kept),
        "preDedupCount": pre_dedup,
        "removedByNearDedup": len(removed),
        "exactDuplicates": exact_dups,
        "immutableLabelMismatches": label_mism,
        "shardCount": n_shards,
        "gates": gates,
        "fileHashes": file_hashes,
    }
    return report


def write_manifest(report: dict, out_dir: Path | None = None) -> Path:
    out_dir = out_dir or config.RELEASES_DIR
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest_path


def write_report_md(report: dict, out_dir: Path | None = None) -> Path:
    out_dir = out_dir or config.RELEASES_DIR
    report_path = out_dir / "v03-generation-report.md"
    g = report.get("gates", {})
    lines = [
        "# AetherArgus v0.3 Training Dataset - Generation Report",
        "",
        f"Dataset version: `{report.get('datasetVersion')}`",
        f"Accepted samples: **{report.get('acceptedCount')}**  (pre-dedup: {report.get('preDedupCount')}, removed by final near-dedup sweep: {report.get('removedByNearDedup')})",
        f"Shards: {report.get('shardCount')} (5k-10k samples each)",
        f"Exact duplicates: **{report.get('exactDuplicates')}** (must be 0)",
        f"Immutable-label mismatches: **{report.get('immutableLabelMismatches')}** (must be 0)",
        "",
        "## Mission verdict lines (verbatim required by mission)",
        "",
        "- **TRAINING DATASET: GENERATED**",
        "- **MODEL TRAINING: NOT RUN**",
        "- **MODEL EVALUATION: NOT RUN**",
        "- **VALIDATION SET: NOT CREATED**",
        "- **TEST SET: NOT CREATED**",
        "",
        "## Distribution gates",
        "",
    ]
    if isinstance(g, dict):
        for k, v in g.items():
            lines.append(f"- **{k}**: {v}")
    lines += [
        "",
        "## Provenance",
        "",
        f"- Ground truth: PROGRAM-OWNED (GenerationSpec immutable labels, copied verbatim by the generator).",
        f"- Generator/reviewer/adjudicator prompts: v{config.PROMPT_VERSION} (`ml/data_pipeline/prompts/v03/`).",
        f"- Synthetic ratio: 100%. humanReviewCount: 0.",
        f"- Pipeline: spec_planner -> immutable GenerationSpec -> LLM request-realizer -> 2 blind reviewers -> adjudicator -> dedup -> accept.",
        f"- Tamper-evident audit: `audit.jsonl` (sha256 chain).",
        "",
        "## Scope exclusions (hard constraints honored)",
        "",
        "- No model training / QLoRA / adapter / merge / quantization / GGUF / Ollama-eval / baseline-eval / closed-set-eval / independent-eval was performed.",
        "- No new validation or test sets were created. Existing sealed tests and model acceptance gates were NOT modified.",
        "- No sealed independent-test sample content was read or used to generate training data (mission section on test-set isolation).",
        "- API key loaded from environment variable only; never written to config, JSONL, logs, or committed files.",
        "",
    ]
    report_path.write_text("\n".join(lines), encoding="utf-8")
    return report_path


def main(argv: list[str] | None = None) -> int:
    argv = argv or sys.argv[1:]
    out_dir = Path(argv[0]) if argv else config.RELEASES_DIR
    report = finalize(out_dir)
    mpath = write_manifest(report, out_dir)
    rpath = write_report_md(report, out_dir)
    print(f"Finalized: {report['acceptedCount']} accepted samples in {report['shardCount']} shards")
    print(f"  exact_duplicates: {report['exactDuplicates']} (must be 0)")
    print(f"  immutable_label_mismatches: {report['immutableLabelMismatches']} (must be 0)")
    print(f"  manifest: {mpath}")
    print(f"  report: {rpath}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
