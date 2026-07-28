#!/usr/bin/env python3
"""Build the reproducible AetherArgus v0.2 data-only release."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from assign_groups import assign_group_ids
from audit_dataset import build_quality_report, render_quality_markdown
from common import (
    count_distribution,
    common_parser,
    emit_log,
    grouped_split,
    leakage_report,
    load_config,
    repository_root,
    resolve_path,
    source_registry,
    stable_hash,
    stable_json,
    write_json,
    write_jsonl,
)
from deduplicate import deduplicate_records
from generate_candidates import CORE_FAMILIES, generate_development, generate_independent
from public_source_adapters import generate_public_candidates, render_public_source_audit
from redact_sensitive_data import redact_records
from review_candidates import review_records
from semantic_deduplicate import semantic_cluster_records


def process_records(
    records: list[dict[str, Any]],
    config: dict[str, Any],
    seed: int,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    redacted, redactions = redact_records(records)
    reviewed, decisions, queue = review_records(redacted)
    deduplicated, duplicates = deduplicate_records(reviewed)
    quality = config["quality"]
    clustered, similar_pairs = semantic_cluster_records(
        deduplicated,
        jaccard_threshold=float(quality["near_duplicate_jaccard"]),
        simhash_max_distance=int(quality["simhash_max_distance"]),
        minhash_threshold=float(quality["minhash_similarity"]),
    )
    grouped = assign_group_ids(clustered, seed)
    return grouped, {
        "generated": len(records),
        "redactions": redactions,
        "rulesAccepted": len(reviewed),
        "reviewRejected": len(queue),
        "reviewDecisions": decisions,
        "reviewQueue": queue,
        "duplicatesRemoved": len(duplicates),
        "duplicateDetails": duplicates,
        "semanticPairsClustered": len(similar_pairs),
        "semanticPairDetails": similar_pairs,
        "output": len(grouped),
    }


def records_digest(records: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for record in records:
        digest.update(stable_json(record).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def artifact_metadata(path: str, records: list[dict[str, Any]]) -> dict[str, Any]:
    content = "".join(stable_json(record) + "\n" for record in records)
    return {
        "path": path,
        "records": len(records),
        "bytes": len(content.encode("utf-8")),
        "sha256": stable_hash(content),
    }


def reject_public_cross_corpus_duplicates(
    public_records: list[dict[str, Any]],
    protected_records: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Keep public-derived training data from duplicating sealed or existing development data."""

    protected_hashes = {
        (record["metadata"]["attackFamily"], record["metadata"]["normalizedHash"])
        for record in protected_records
    }
    protected_templates = {
        record["metadata"]["templateFingerprint"] for record in protected_records
    }
    accepted = []
    rejected = []
    for record in public_records:
        metadata = record["metadata"]
        problems = []
        if (metadata["attackFamily"], metadata["normalizedHash"]) in protected_hashes:
            problems.append("normalized_duplicate_of_protected_corpus")
        if metadata["templateFingerprint"] in protected_templates:
            problems.append("template_duplicate_of_protected_corpus")
        if problems:
            rejected.append(
                {
                    "sampleId": record["sampleId"],
                    "accepted": False,
                    "problems": problems,
                    "suggestedLabel": None,
                    "needsManualReview": False,
                }
            )
            continue
        accepted.append(record)
    return accepted, rejected


def make_gap_analysis(config: dict[str, Any], root: Path) -> dict[str, Any]:
    current_manifest_path = root / "ml/data/manifests/dataset-manifest.json"
    current_manifest = json.loads(current_manifest_path.read_text(encoding="utf-8"))
    current_family = current_manifest["counts"]["byAttackFamily"]
    targets = {name: int(count) for name, count in config["minimum_family_targets"].items()}
    families = {
        family: {
            "current": int(current_family.get(family, 0)),
            "targetMinimum": target,
            "gap": max(0, target - int(current_family.get(family, 0))),
        }
        for family, target in targets.items()
    }
    statistically_thin = {
        family: count
        for family, count in current_family.items()
        if family != "benign" and int(count) < 25
    }
    return {
        "schemaVersion": 1,
        "baselineManifest": "ml/data/manifests/dataset-manifest.json",
        "baselineActualSamples": current_manifest["actualSamples"],
        "baselineSourceCorpusIsSynthetic": current_manifest["sourceCorpusIsSynthetic"],
        "families": families,
        "normalScenarioGaps": [
            "registration",
            "password_change",
            "payment_status_query",
            "oauth_callback",
            "file_download",
            "bulk_import",
            "security_report_upload",
            "websocket_message",
            "waf_rule_edit",
            "repository_commit",
            "ticket_system",
            "markdown_editor",
        ],
        "hardNegativeScenarioGaps": [
            "waf_rule_editor_with_attack_regex",
            "ticket_discussing_ssrf",
            "administrator_reviewed_deployment_script",
            "security_report_with_request_evidence",
            "database_tool_legitimate_sql",
            "log_poisoning_literal_as_read_only_data",
        ],
        "unknownScenarioGaps": [
            "missing_identity_and_permission",
            "body_vs_execution_argument_ambiguity",
            "multiple_weak_attack_families",
            "partially_decoded_input",
        ],
        "promptInjectionSamplesCurrent": 0,
        "contextualAttackSamplesCurrentExplicitlyEngineered": 0,
        "statisticallyThinFamilies": statistically_thin,
        "baselineLimitations": [
            "The 120-sample test split validates mechanics, not production capability.",
            "The source corpus and generated auxiliary data are synthetic.",
            "No real normal traffic or independent authorized-range capture is present.",
            "The baseline uses normalized hashes but no neural semantic embedding audit.",
        ],
    }


def render_gap_markdown(report: dict[str, Any]) -> str:
    family_rows = "\n".join(
        f"| `{family}` | {values['current']} | {values['targetMinimum']} | {values['gap']} |"
        for family, values in report["families"].items()
    )
    return f"""# AetherArgus dataset v0.2 gap analysis

The current tracked release contains **{report['baselineActualSamples']} samples** and its
manifest explicitly marks the source corpus as synthetic.

## Attack-family counts and minimum targets

| attackFamily | Current | v0.2 minimum | Gap |
| --- | ---: | ---: | ---: |
{family_rows}

## Missing or weak coverage

- Normal business gaps: {", ".join(report['normalScenarioGaps'])}.
- Hard-negative gaps: {", ".join(report['hardNegativeScenarioGaps'])}.
- Unknown gaps: {", ".join(report['unknownScenarioGaps'])}.
- Explicit prompt-injection samples: `0`.
- Explicitly engineered contextual-attack samples: `0`.
- Statistically thin families (<25 total records): `{stable_json(report['statisticallyThinFamilies'])}`.

## Evidence boundary

The existing 120-record test split is suitable for pipeline verification only. It cannot
support production-grade detection, family-level recall, or false-positive claims.
No real traffic is claimed.
"""


def render_leakage_markdown(report: dict[str, Any]) -> str:
    pair_rows = "\n".join(
        f"| `{pair}` | {value['sharedGroupIds']} | {value['sharedNormalizedHashes']} | "
        f"{value['sharedTemplateFingerprints']} | {'YES' if value['detected'] else 'NO'} |"
        for pair, value in report["pairwise"].items()
    )
    limitations = "\n".join(f"- {item}" for item in report["limitations"])
    return f"""# AetherArgus dataset v0.2 leakage report

Known leakage detected: `{'YES' if report['detected'] else 'NO'}`.

| Pair | Shared groups | Shared normalized hashes | Shared templates | Detected |
| --- | ---: | ---: | ---: | --- |
{pair_rows}

## Checks

{chr(10).join(f"- {item}" for item in report['checks'])}

## Limitations

{limitations}
"""


def render_final_report(
    manifest: dict[str, Any],
    quality: dict[str, Any],
    process_stats: dict[str, Any],
    public_audit: dict[str, Any],
) -> str:
    family_lines = "\n".join(
        f"- `{family}`: {count}" for family, count in manifest["counts"]["byAttackFamily"].items()
    )
    source_lines = "\n".join(
        f"- `{source}`: {count}" for source, count in manifest["counts"]["byProvenance"].items()
    )
    source_dataset_lines = "\n".join(
        f"- `{source}`: {count}" for source, count in manifest["counts"]["bySourceDataset"].items()
    )
    public_filter_lines = "\n".join(
        f"   - `{adapter['sourceId']}`: `{stable_json(adapter.get('rejected', {}))}`"
        for adapter in public_audit.get("adapters", [])
    )
    return f"""# AetherArgus Preview 0.2 data-only delivery report

1. **Actual data counts**: train `{manifest['counts']['bySplit']['train']}`, validation
   `{manifest['counts']['bySplit']['validation']}`, closed test
   `{manifest['counts']['bySplit']['test_closed']}`, independent test
   `{manifest['counts']['bySplit']['test_independent']}`.
2. **Source distribution**:
{source_lines}
   Source datasets:
{source_dataset_lines}
3. **Attack-family counts**:
{family_lines}
4. **Synthetic ratio**: `{quality['synthetic']['ratio']:.2%}`.
5. **Human-reviewed count**: `0`; no human review is claimed.
6. **Rejected samples**: deterministic review `{process_stats['reviewRejected']}`;
   public-source filter/cap decisions:
{public_filter_lines}
   Exact details are recorded in the public-source audit; caps are selection decisions,
   not label-review failures.
7. **Duplicates removed**: `{process_stats['duplicatesRemoved']}`.
8. **Leakage result**: known group/hash/template leakage detected =
   `{manifest['leakage']['detected']}`. Neural embedding was not available; lexical
   SimHash/MinHash/n-gram controls were run and the limitation is explicit.
9. **Actual trained model**: `N/A` — model training was intentionally out of scope.
10. **Best training configuration**: `N/A`.
11. **HF LoRA metrics**: `N/A`.
12. **GGUF metrics**: `N/A`.
13. **Best deployment version**: `N/A`.
14. **Remaining weak categories**: real normal traffic, real authorized attack capture,
    and human-reviewed ambiguous cases.
15. **Unobtained real data**: all real-normal and authorized real-attack suites.
16. **Preview 0.2 acceptance**: `NOT PASSED / NOT EVALUATED`; inference quality,
    recall, FPR, prompt-injection obedience, JSON success and quantization were not run.

The dataset-only acceptance gate is
`{'PASS' if quality['datasetAcceptance']['passed'] else 'FAIL'}`.
"""


def build_release(
    root: Path,
    config: dict[str, Any],
    *,
    seed: int,
    smoke: bool,
    dry_run: bool,
    resume: bool,
) -> dict[str, Any]:
    suffix = "-smoke" if smoke else ""
    release_dir = resolve_path(
        root,
        config["paths"]["smoke_release_dir"] if smoke else config["paths"]["release_dir"],
    )
    candidates_dir = resolve_path(root, config["paths"]["candidates_dir"] + suffix)
    review_dir = resolve_path(root, config["paths"]["review_queue"] + suffix)
    reports_dir = resolve_path(root, config["paths"]["reports_dir"])

    # 1. Seal independent data before development generation.
    independent = generate_independent(config)
    if smoke:
        independent = independent[:100]
    independent_processed, independent_stats = process_records(independent, config, seed)
    if smoke:
        independent_stats["selectionDropped"] = max(0, len(independent_processed) - 25)
        independent_processed = independent_processed[:25]
        independent_stats["output"] = len(independent_processed)
    else:
        independent_stats["selectionDropped"] = 0
    independent_seal = {
        "schemaVersion": 1,
        "datasetVersion": config["version"],
        "sealedBeforeDevelopmentGeneration": True,
        "recordCount": len(independent_processed),
        "recordsSha256": records_digest(independent_processed),
        "templateFingerprintsSha256": stable_hash(
            "\n".join(sorted({record["metadata"]["templateFingerprint"] for record in independent_processed}))
        ),
        "sourceSampleIdsSha256": stable_hash(
            "\n".join(sorted({record["metadata"]["sourceSampleId"] for record in independent_processed}))
        ),
    }
    write_jsonl(
        candidates_dir / "independent-sealed.jsonl",
        independent_processed,
        dry_run=dry_run,
        resume=resume,
    )
    write_json(
        release_dir / "independent-seal.json",
        independent_seal,
        dry_run=dry_run,
        resume=resume,
    )
    emit_log("independent_test_sealed", records=len(independent_processed), sha256=independent_seal["recordsSha256"])

    # 2. Generate development data without access to independent records.
    development = generate_development(root, config, seed)
    if smoke:
        development = development[:200]
    development_processed, development_stats = process_records(development, config, seed)
    if smoke:
        development_target = 50 if config.get("public_sources", {}).get("enabled") else 75
        development_stats["selectionDropped"] = max(0, len(development_processed) - development_target)
        development_processed = development_processed[:development_target]
        development_stats["output"] = len(development_processed)
    else:
        development_stats["selectionDropped"] = 0
    write_jsonl(
        candidates_dir / "development-reviewed-grouped.jsonl",
        development_processed,
        dry_run=dry_run,
        resume=resume,
    )
    write_jsonl(
        review_dir / "development-review-decisions.jsonl",
        development_stats["reviewDecisions"],
        dry_run=dry_run,
        resume=resume,
    )
    write_jsonl(
        review_dir / "development-review-queue.jsonl",
        development_stats["reviewQueue"],
        dry_run=dry_run,
        resume=resume,
    )

    # 3. Import approved public sources into development-only partitions. The
    # independent seal and closed-test pool are never passed to these adapters.
    public_processed: list[dict[str, Any]] = []
    public_audit: dict[str, Any] = {
        "acceptedSources": [],
        "excludedSources": [],
        "adapters": [],
        "selected": 0,
        "byCategory": {},
        "byAttackFamily": {},
        "bySourceDataset": {},
    }
    public_stats = {
        "generated": 0,
        "redactions": 0,
        "rulesAccepted": 0,
        "reviewRejected": 0,
        "duplicatesRemoved": 0,
        "semanticPairsClustered": 0,
        "selectionDropped": 0,
        "output": 0,
        "crossCorpusDuplicatesRemoved": 0,
        "reviewDecisions": [],
        "reviewQueue": [],
    }
    public_cross_rejected: list[dict[str, Any]] = []
    if config.get("public_sources", {}).get("enabled"):
        public_candidates, public_audit = generate_public_candidates(
            root,
            config,
            seed,
            smoke=smoke,
        )
        public_processed, public_stats = process_records(public_candidates, config, seed + 101)
        if smoke:
            public_stats["selectionDropped"] = max(0, len(public_processed) - 25)
            public_processed = public_processed[:25]
        else:
            public_stats["selectionDropped"] = 0
        public_processed, public_cross_rejected = reject_public_cross_corpus_duplicates(
            public_processed,
            independent_processed + development_processed,
        )
        public_stats["crossCorpusDuplicatesRemoved"] = len(public_cross_rejected)
        public_stats["output"] = len(public_processed)
        public_audit["postPipelineAccepted"] = len(public_processed)
        public_audit["crossCorpusDuplicatesRemoved"] = len(public_cross_rejected)
        write_jsonl(
            candidates_dir / "public-source-reviewed-grouped.jsonl",
            public_processed,
            dry_run=dry_run,
            resume=resume,
        )
        write_jsonl(
            review_dir / "public-source-review-decisions.jsonl",
            public_stats["reviewDecisions"],
            dry_run=dry_run,
            resume=resume,
        )
        write_jsonl(
            review_dir / "public-source-review-queue.jsonl",
            public_stats["reviewQueue"],
            dry_run=dry_run,
            resume=resume,
        )
        write_jsonl(
            review_dir / "public-source-cross-corpus-rejections.jsonl",
            public_cross_rejected,
            dry_run=dry_run,
            resume=resume,
        )

    splits = grouped_split(development_processed, config["split_ratios"], seed)
    public_splits: dict[str, list[dict[str, Any]]] = {}
    if public_processed:
        public_splits = grouped_split(
            public_processed,
            config["public_sources"]["split_ratios"],
            seed + 101,
        )
        for split_name in ("train", "validation"):
            splits[split_name].extend(public_splits.get(split_name, []))
            splits[split_name].sort(key=lambda record: stable_hash(f"{seed}|{record['sampleId']}"))
    for record in independent_processed:
        record["metadata"]["split"] = "test_independent"
    split_records = {**splits, "test_independent": independent_processed}
    leakage = leakage_report(split_records)

    filenames = {
        "train": "train.jsonl",
        "validation": "validation.jsonl",
        "test_closed": "test-closed.jsonl",
        "test_independent": "test-independent.jsonl",
    }
    for split_name, records in split_records.items():
        write_jsonl(
            release_dir / filenames[split_name],
            records,
            dry_run=dry_run,
            resume=resume,
        )

    all_records = [record for records in split_records.values() for record in records]
    quality = build_quality_report(split_records, config)
    registry = source_registry(all_records)
    combined_stats = {
        key: (
            independent_stats.get(key, 0)
            + development_stats.get(key, 0)
            + public_stats.get(key, 0)
        )
        for key in (
            "generated",
            "redactions",
            "rulesAccepted",
            "reviewRejected",
            "duplicatesRemoved",
            "semanticPairsClustered",
            "selectionDropped",
            "output",
        )
    }
    combined_stats["crossCorpusDuplicatesRemoved"] = public_stats.get(
        "crossCorpusDuplicatesRemoved",
        0,
    )
    public_audit["postPipelineBySplit"] = {
        name: len(records) for name, records in public_splits.items()
    }
    manifest = {
        "schemaVersion": 2,
        "datasetVersion": config["version"],
        "seed": seed,
        "smoke": smoke,
        "generation": {
            "generatorModel": config["generation"]["generator_model"],
            "generatorPromptVersion": config["generation"]["prompt_version"],
            "generatedAt": config["generation"]["generated_at"],
            "independentSealedFirst": True,
        },
        "counts": {
            "bySplit": {name: len(records) for name, records in split_records.items()},
            "byCategory": count_distribution(all_records, "labelCategory"),
            "byAttackFamily": count_distribution(all_records, "attackFamily"),
            "byProvenance": count_distribution(all_records, "provenance"),
            "bySourceDataset": count_distribution(all_records, "sourceDataset"),
            "byEncoding": count_distribution(all_records, "encoding"),
            "byEvaluationSuite": count_distribution(all_records, "evaluationSuite"),
        },
        "process": combined_stats,
        "sourceCorpusIsSynthetic": True,
        "humanReviewCount": 0,
        "realNormalCount": 0,
        "authorizedRealAttackCount": 0,
        "sourceRegistry": {
            "path": config["paths"]["source_registry"],
            "sourceSampleIdCount": registry["sourceSampleIdCount"],
            "sourceSampleIdsSha256": registry["sourceSampleIdsSha256"],
        },
        "publicSources": {
            "auditPath": config["paths"]["public_source_audit"],
            "acceptedSourceCount": len(public_audit["acceptedSources"]),
            "excludedSourceCount": len(public_audit["excludedSources"]),
            "selectedBeforePipeline": public_audit["selected"],
            "acceptedAfterPipeline": len(public_processed),
            "allowedSplits": ["train", "validation"],
            "upstreamEvaluationSplitsUsedForTraining": False,
        },
        "leakage": leakage,
        "independentSeal": independent_seal,
        "files": {
            name: artifact_metadata(f"ml/data/releases/{'v02-smoke' if smoke else 'v02'}/{filenames[name]}", records)
            for name, records in split_records.items()
        },
        "datasetAcceptance": quality["datasetAcceptance"],
        "preview02Acceptance": quality["preview02Acceptance"],
    }
    report_suffix = "-smoke" if smoke else ""
    write_json(
        release_dir / "manifest.json",
        manifest,
        dry_run=dry_run,
        resume=resume,
    )
    write_json(
        reports_dir / f"dataset-v02-quality-report{report_suffix}.json",
        quality,
        dry_run=dry_run,
        resume=resume,
    )
    from common import guarded_write_text

    guarded_write_text(
        reports_dir / f"dataset-v02-quality-report{report_suffix}.md",
        render_quality_markdown(quality),
        dry_run=dry_run,
        resume=resume,
    )
    write_json(
        reports_dir / f"dataset-v02-leakage-report{report_suffix}.json",
        leakage,
        dry_run=dry_run,
        resume=resume,
    )
    guarded_write_text(
        reports_dir / f"dataset-v02-leakage-report{report_suffix}.md",
        render_leakage_markdown(leakage),
        dry_run=dry_run,
        resume=resume,
    )
    public_audit_json = (
        reports_dir / "dataset-v02-public-source-audit-smoke.json"
        if smoke
        else resolve_path(root, config["paths"]["public_source_audit"])
    )
    write_json(
        public_audit_json,
        public_audit,
        dry_run=dry_run,
        resume=resume,
    )
    guarded_write_text(
        public_audit_json.with_suffix(".md"),
        render_public_source_audit(public_audit),
        dry_run=dry_run,
        resume=resume,
    )
    if not smoke:
        gap = make_gap_analysis(config, root)
        write_json(
            reports_dir / "dataset-v02-gap-analysis.json",
            gap,
            dry_run=dry_run,
            resume=resume,
        )
        guarded_write_text(
            reports_dir / "dataset-v02-gap-analysis.md",
            render_gap_markdown(gap),
            dry_run=dry_run,
            resume=resume,
        )
        write_json(
            resolve_path(root, config["paths"]["manifest"]),
            manifest,
            dry_run=dry_run,
            resume=resume,
        )
        write_json(
            resolve_path(root, config["paths"]["source_registry"]),
            registry,
            dry_run=dry_run,
            resume=resume,
        )
        guarded_write_text(
            reports_dir / "dataset-v02-final-report.md",
            render_final_report(manifest, quality, combined_stats, public_audit),
            dry_run=dry_run,
            resume=resume,
        )
    emit_log(
        "release_build_complete",
        smoke=smoke,
        counts=manifest["counts"]["bySplit"],
        leakageDetected=leakage["detected"],
        datasetAcceptance=quality["datasetAcceptance"]["passed"],
    )
    return manifest


def main() -> int:
    parser = common_parser(__doc__ or "Build data release")
    parser.add_argument("--smoke", action="store_true", help="Build a 100-record smoke release.")
    arguments = parser.parse_args()
    root = repository_root(arguments.repo_root)
    config = load_config(arguments.config, root)
    seed = arguments.seed if arguments.seed is not None else int(config["seed"])
    manifest = build_release(
        root,
        config,
        seed=seed,
        smoke=arguments.smoke,
        dry_run=arguments.dry_run,
        resume=arguments.resume,
    )
    if manifest["leakage"]["detected"]:
        return 1
    if not arguments.smoke and not manifest["datasetAcceptance"]["passed"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
