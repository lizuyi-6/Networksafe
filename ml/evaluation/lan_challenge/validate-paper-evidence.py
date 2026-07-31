#!/usr/bin/env python3
"""Fail-closed validation of the frozen LAN challenge evidence package (protocol v2).

Strict mode runs fail-closed checks and requires every one to pass. --allow-not-run retains
the partial-integrity mode for incomplete runs but is NOT a completion path. Completion also
requires the pre-registered one-variable-at-a-time inference-path diagnostics.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

from scoring import (
    EXPECTED_INPUT_SHA256,
    EXPECTED_LABEL_SHA256,
    calculate_metrics,
    load_jsonl,
    load_predictions,
    load_references,
    sha256_file,
)

ROOT = Path(__file__).resolve().parents[3]
EVAL = ROOT / "ml/evaluation/lan_challenge"
REPORT = ROOT / "ml/reports/lan-challenge-evaluation"
METRICS = REPORT / "metrics"
PREDICTIONS = REPORT / "predictions"
INPUT_PATH = ROOT / "ml/data/lan_challenge_capture/model-inputs.jsonl"
LABEL_PATH = ROOT / "ml/data/lan_challenge_capture/adjudication/final-labels.jsonl"
EXPECTED_A_SHA256 = "381dd788a057bef9761c54ef5842b6578f4b038c8dc8aa8057e844be661c7662"
EXPECTED_B_SHA256 = "9c52f7cbdb6650efad43bd04f0282835bd08a47d5ae7860902819833faffa357"
RULES_SOURCE_COMMIT = "4359276fa9c6c0b56b168fc5c002e7e542fe30b3"
RULES_SOURCE_FILE = "backend/src/services/detection-engine.ts"
RULES_SOURCE_BLOB = "95654206590b7fb733d1425b280e7dfacc8c20ba"
TRAIN_PATH = ROOT / "ml/data/releases/v02/train.jsonl"
VALIDATION_PATH = ROOT / "ml/data/releases/v02/validation.jsonl"
INFERENCE_FILES = [
    EVAL / "inference_common.py",
    EVAL / "run_rules_baseline.py",
    EVAL / "rules_engine_adapter.ts",
    EVAL / "generate_rules_manifest.ts",
    EVAL / "run_research_augmented_rules.py",
    EVAL / "run_char_ngram.py",
    EVAL / "run_transformers.py",
    EVAL / "run_ollama.py",
    EVAL / "prepare_ablation_prompts.py",
]
REQUIRED_MODELS = [
    "rules-baseline",
    "char-ngram-logreg",
    "qwen3-4b-zero-shot",
    "qwen3-4b-few-shot",
    "aetherargus-v02-hf-lora",
    "aetherargus-v02-merged-bf16",
    "aetherargus-v02-gguf-q4-k-m",
    "aetherargus-v02-ollama-f16",
]
DIAGNOSTIC_MODELS = {
    "aetherargus-v02-merged-bf16-single-concat": "single-concatenated",
    "aetherargus-v02-ollama-f16-single-concat": "single-concatenated",
    "aetherargus-v02-merged-bf16-hf-serialized": "pre-serialized",
    "aetherargus-v02-ollama-f16-hf-serialized": "pre-serialized",
}


def close(left: float | None, right: float | None, tolerance: float = 1e-12) -> bool:
    if left is None or right is None:
        return left is right
    return abs(float(left) - float(right)) <= tolerance


def v2_protocol_hash() -> str:
    protocol = json.loads((EVAL / "evaluation-protocol-v2.json").read_text(encoding="utf-8"))
    protocol["protocolSha256"] = ""
    canonical = json.dumps(protocol, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256((canonical + "\n").encode("utf-8")).hexdigest()


def git(args: list[str]) -> str:
    proc = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    return proc.stdout.strip()


def introducing_commit(path: str) -> str | None:
    out = git(["log", "--diff-filter=A", "--format=%H", "--", path])
    lines = [line for line in out.splitlines() if line]
    return lines[-1] if lines else None  # oldest commit that added the path


def is_ancestor(ancestor: str, descendant: str) -> bool:
    """Return true only when git proves ancestor is reachable from descendant."""
    if not ancestor or not descendant:
        return False
    proc = subprocess.run(
        ["git", "merge-base", "--is-ancestor", ancestor, descendant],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return proc.returncode == 0


def reachable_commit(value: str) -> bool:
    if not re.fullmatch(r"[0-9a-f]{40}", value or ""):
        return False
    proc = subprocess.run(
        ["git", "cat-file", "-e", f"{value}^{{commit}}"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return proc.returncode == 0 and is_ancestor(value, "HEAD")


def json_field_exists(document: Any, dotted_path: str) -> bool:
    current = document
    for part in dotted_path.strip().split("."):
        if not part:
            return False
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--allow-not-run",
        action="store_true",
        help="Partial-integrity mode for incomplete runs. NOT a completion path.",
    )
    arguments = parser.parse_args()
    checks: list[dict[str, Any]] = []

    missing_operator_assets = [
        str(path.relative_to(ROOT)).replace("\\", "/")
        for path in (TRAIN_PATH, VALIDATION_PATH)
        if not path.is_file()
    ]
    if missing_operator_assets:
        result = {
            "schemaVersion": 3,
            "mode": "allow-not-run" if arguments.allow_not_run else "strict",
            "status": "BLOCKED_OPERATOR_ASSETS_MISSING",
            "checksPassed": 0,
            "checksTotal": 27,
            "failed": [
                {
                    "num": "ASSET",
                    "name": "frozen_train_validation_assets_available",
                    "passed": False,
                    "detail": "missing=" + ",".join(missing_operator_assets),
                }
            ],
            "checks": [],
            "requiredOperatorAction": "Mount the SHA-locked v02 train and validation JSONL assets, then rerun. They are required to prove challenge-set exclusion and are intentionally not reconstructed from predictions.",
        }
        METRICS.mkdir(parents=True, exist_ok=True)
        output = METRICS / (
            "validation-partial.json" if arguments.allow_not_run else "validation-strict.json"
        )
        output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result, indent=2))
        return 2

    def check(num: str, name: str, condition: bool, detail: str) -> None:
        checks.append({"num": num, "name": name, "passed": bool(condition), "detail": detail})

    inputs = load_jsonl(INPUT_PATH)
    references = load_references(LABEL_PATH)
    run_status = json.loads((METRICS / "run-status.json").read_text(encoding="utf-8"))
    status_by_id = {row["modelId"]: row for row in run_status["models"]}
    successful = [row for row in run_status["models"] if row["status"] == "SUCCESS"]

    protocol_v2 = json.loads((EVAL / "evaluation-protocol-v2.json").read_text(encoding="utf-8"))
    manifest = json.loads((REPORT / "evaluation-manifest.json").read_text(encoding="utf-8"))

    # ---- 1: the applicable locked protocol predates each prediction ----
    # rules-baseline was first produced under protocol v1; the other seven runs were
    # introduced after protocol v2 locked their newly available assets.
    v1_intro = introducing_commit("ml/evaluation/lan_challenge/evaluation-protocol.json")
    v2_intro = introducing_commit("ml/evaluation/lan_challenge/evaluation-protocol-v2.json")
    prediction_intros = {
        model_id: introducing_commit(
            f"ml/reports/lan-challenge-evaluation/predictions/{model_id}.jsonl"
        )
        for model_id in REQUIRED_MODELS
    }
    ordering_detail: list[str] = []
    ordering_ok = bool(v1_intro and v2_intro)
    for model_id, intro in prediction_intros.items():
        protocol_intro = v1_intro if model_id == "rules-baseline" else v2_intro
        model_ok = bool(
            intro
            and protocol_intro
            and is_ancestor(protocol_intro, intro)
            and is_ancestor(intro, "HEAD")
        )
        ordering_ok &= model_ok
        ordering_detail.append(
            f"{model_id}:protocol={protocol_intro}:prediction={intro}:ok={model_ok}"
        )
    check(
        "01",
        "applicable_protocol_committed_before_predictions",
        ordering_ok and v2_protocol_hash() == protocol_v2["protocolSha256"],
        "; ".join(ordering_detail)
        + f"; hash_self_consistent={v2_protocol_hash() == protocol_v2['protocolSha256']}",
    )

    # ---- 2: rules manifest locked pre-prediction ----
    rules_manifest = json.loads((EVAL / "rules-baseline-manifest.json").read_text(encoding="utf-8"))
    rm_sha = sha256_file(EVAL / "rules-baseline-manifest.json")
    formal_challenge_clean = all(r["challengeResultUsed"] is False for r in rules_manifest["formalBaseline"]["rules"])
    check("02", "rules_manifest_locked",
          rm_sha == protocol_v2["v2AssetLocks"]["rulesBaselineManifestSha256"] and formal_challenge_clean,
          f"sha_match={rm_sha == protocol_v2['v2AssetLocks']['rulesBaselineManifestSha256']} formal_challenge_clean={formal_challenge_clean}")

    # ---- 3: few-shot locked pre-prediction ----
    fs = json.loads((EVAL / "few-shot-examples-v2.json").read_text(encoding="utf-8"))
    fs_sha = sha256_file(EVAL / "few-shot-examples-v2.json")
    check("03", "few_shot_locked",
          fs["status"] == "AVAILABLE"
          and fs_sha == protocol_v2["v2AssetLocks"]["fewShotExamplesManifestSha256"]
          and fs["examplesSha256"] == protocol_v2["v2AssetLocks"]["fewShotExamplesPayloadSha256"]
          and fs["challengeSetUsed"] is False,
          f"status={fs['status']} sha_match={fs_sha == protocol_v2['v2AssetLocks']['fewShotExamplesManifestSha256']}")

    # ---- 4: each model covers 413 ----
    predictions_by_model: dict[str, list[dict[str, Any]]] = {}
    coverage_ok = True
    for row in successful:
        model_id = row["modelId"]
        predictions = load_predictions(PREDICTIONS / f"{model_id}.jsonl", model_id)
        predictions_by_model[model_id] = predictions
        ids = [p["sampleId"] for p in predictions]
        coverage_ok &= len(ids) == 413 and set(ids) == {r["sampleId"] for r in references}
    check("04", "each_model_covers_413", coverage_ok, f"successful={len(successful)}")

    # ---- 5: no duplicate or missing ids ----
    dup_free = all(len([p["sampleId"] for p in rows]) == len({p["sampleId"] for p in rows}) for rows in predictions_by_model.values())
    check("05", "no_duplicate_or_missing_ids", dup_free and coverage_ok, "sampleId sets aligned & duplicate-free")

    # ---- 6: input + label SHA consistent across all models ----
    input_sha_ok = sha256_file(INPUT_PATH) == EXPECTED_INPUT_SHA256
    label_sha_ok = sha256_file(LABEL_PATH) == EXPECTED_LABEL_SHA256
    per_pred_sha_ok = all(p.get("inputSha256") == EXPECTED_INPUT_SHA256 for rows in predictions_by_model.values() for p in rows)
    check("06", "input_and_label_sha_consistent", input_sha_ok and label_sha_ok and per_pred_sha_ok,
          f"input={sha256_file(INPUT_PATH)[:12]} label={sha256_file(LABEL_PATH)[:12]}")

    # ---- 7: inference/scoring process isolation (no label/response leakage) ----
    banned = ["final-labels", "adjudication.jsonl", "agreement-report", "context-visibility-audit",
              "model-a-annotations", "model-b-annotations", "model-labels.jsonl", "responseStatus",
              "responseBody", "raw-private", "from scoring import", "import scoring"]
    inference_text = "\n".join(path.read_text(encoding="utf-8") for path in INFERENCE_FILES)
    found = [t for t in banned if t in inference_text]
    check("07", "inference_scoring_process_isolation", not found, f"banned_found={found}")

    # ---- 8: train/validation challenge-free + SHA locked ----
    challenge_ids = {row["sampleId"] for row in inputs}
    train_ids = {json.loads(line)["sampleId"] for line in TRAIN_PATH.open(encoding="utf-8") if line.strip()}
    val_ids = {json.loads(line)["sampleId"] for line in VALIDATION_PATH.open(encoding="utf-8") if line.strip()}
    train_sha = sha256_file(TRAIN_PATH)
    val_sha = sha256_file(VALIDATION_PATH)
    check("08", "train_validation_challenge_free",
          not (challenge_ids & train_ids) and not (challenge_ids & val_ids)
          and train_sha == protocol_v2["v2AssetLocks"]["trainingAssetSha256"]
          and val_sha == protocol_v2["v2AssetLocks"]["validationAssetSha256"],
          f"overlap_train={len(challenge_ids & train_ids)} overlap_val={len(challenge_ids & val_ids)}")

    # ---- 9: few-shot challenge-free ----
    fs_ids = set(fs["sampleIds"])
    check("09", "few_shot_challenge_free", not (fs_ids & challenge_ids), f"overlap={len(fs_ids & challenge_ids)}")

    # ---- 10: rules not modified by challenge outcomes ----
    det_blob_now = git(["rev-parse", f"HEAD:{RULES_SOURCE_FILE}"])
    check("10", "rules_not_modified_by_challenge",
          det_blob_now == RULES_SOURCE_BLOB
          and formal_challenge_clean
          and rules_manifest["formalBaseline"]["sourceCommit"] == RULES_SOURCE_COMMIT,
          f"detection_engine_blob_head={det_blob_now}")

    # ---- 11: family Macro-F1 uses reference-only label set ----
    family_label_ok = True
    family_detail = []
    for model_id, predictions in predictions_by_model.items():
        stored = json.loads((METRICS / f"{model_id}.json").read_text(encoding="utf-8"))
        if stored["attackFamily"].get("status") != "SUCCESS":
            continue
        labels = stored["attackFamily"]["confusionMatrix"]["labels"]
        if "none" in labels or "not_supported" in labels:
            family_label_ok = False
            family_detail.append(f"{model_id}: bad label {labels}")
        if stored["attackFamily"].get("labelSetPolicy") != "reference_attack_families_only":
            family_label_ok = False
            family_detail.append(f"{model_id}: policy={stored['attackFamily'].get('labelSetPolicy')}")
    check("11", "family_macro_f1_reference_only_labels", family_label_ok, f"detail={family_detail}")

    # ---- 12: zero-event proportions carry a binomial interval ----
    zero_event_ok = True
    zero_detail = []
    for model_id, predictions in predictions_by_model.items():
        stored = json.loads((METRICS / f"{model_id}.json").read_text(encoding="utf-8"))
        prop = stored.get("proportions", {}).get("safeFPR", {})
        cp = prop.get("clopperPearson95")
        wi = prop.get("wilson95")
        if not cp or not wi:
            zero_event_ok = False
            zero_detail.append(f"{model_id}: missing CP/Wilson")
        elif prop.get("numerator") == 0 and cp[1] <= 0.0:
            zero_event_ok = False
            zero_detail.append(f"{model_id}: degenerate CP upper bound {cp}")
    check("12", "zero_event_binomial_interval", zero_event_ok, f"detail={zero_detail}")

    # ---- 13: statistical tests paired (+ bootstrap seed/iterations) ----
    stats = json.loads((METRICS / "statistical-analysis.json").read_text(encoding="utf-8"))
    paired_ok = all(row.get("status") in {"SUCCESS", "NOT_AVAILABLE"} for row in stats["pairedBootstrapDifferences"])
    seed_ok = stats["bootstrapSeed"] == 20260731 and stats["bootstrapIterations"] == 10000
    check("13", "statistical_tests_paired", paired_ok and seed_ok,
          f"seed={stats['bootstrapSeed']} iter={stats['bootstrapIterations']}")

    # ---- 14: figures + tables match metrics ----
    main_table = list(csv.DictReader((REPORT / "tables/table-1-main-results.csv").open(encoding="utf-8")))
    table_ok = True
    for row in main_table:
        if row.get("status") != "SUCCESS":
            continue
        model = json.loads((METRICS / f"{row['modelId']}.json").read_text(encoding="utf-8"))
        table_ok &= close(float(row["accuracy"]), model["verdict"]["accuracy"], 5e-7)
        table_ok &= close(float(row["macroF1"]), model["verdict"]["macroF1"], 5e-7)
    expected_figures = ["figure-1-model-comparison.png", "figure-1-model-comparison.pdf", "figure-1-model-comparison.svg",
                        *{f"figure-{i}-{n}.{s}" for i, n in [(2, "verdict-confusion-matrices"), (3, "family-f1"), (4, "subset-performance"), (5, "quality-latency-size-tradeoff"), (6, "inference-path-ablation"), (7, "error-taxonomy")] for s in ("png", "pdf")}]
    table_ok &= all((REPORT / "figures" / name).is_file() for name in expected_figures)
    check("14", "figures_tables_match_metrics", table_ok, "main CSV values + required figure files")

    # ---- 15: claims traceable to evidence ----
    claims = list(csv.DictReader((REPORT / "claim-to-evidence-matrix.csv").open(encoding="utf-8")))
    report_json = json.loads((REPORT / "aetherargus-lan-challenge-report.json").read_text(encoding="utf-8"))
    claim_ok = bool(claims) and report_json["claimToEvidenceCount"] == len(claims)
    for row in claims:
        claim_ok &= (ROOT / row["evidenceFile"]).is_file()
        claim_ok &= bool(row["metricField"] and row["allowedWording"] and row["forbiddenWording"])
    check("15", "claims_have_evidence", claim_ok, f"claims={len(claims)}")

    # ---- 16: final labels unchanged ----
    check("16", "final_labels_unchanged", sha256_file(LABEL_PATH) == EXPECTED_LABEL_SHA256, sha256_file(LABEL_PATH)[:12])

    # ---- 17: A/B annotations unchanged ----
    a_path = ROOT / "ml/data/lan_challenge_capture/annotations/model-a-annotations.jsonl"
    b_path = ROOT / "ml/data/lan_challenge_capture/annotations/model-b-annotations.jsonl"
    check("17", "ab_annotations_unchanged",
          sha256_file(a_path) == EXPECTED_A_SHA256 and sha256_file(b_path) == EXPECTED_B_SHA256,
          f"A={sha256_file(a_path)[:12]} B={sha256_file(b_path)[:12]}")

    # ---- 18: training data unchanged (+ inventory scope) ----
    inventory = json.loads((REPORT / "artifact-inventory.json").read_text(encoding="utf-8"))
    check("18", "training_data_unchanged",
          inventory["trainingDataModified"] is False
          and inventory["allowedChangedPrefixes"] == ["ml/evaluation/lan_challenge/", "ml/reports/lan-challenge-evaluation/"],
          "commit scope excludes ml/data/releases + production")

    # ---- 19: production detection path unchanged ----
    check("19", "production_detection_path_unchanged", det_blob_now == RULES_SOURCE_BLOB,
          f"detection-engine.ts blob@HEAD={det_blob_now} expected={RULES_SOURCE_BLOB}")

    # ---- 20: humanReviewed false ----
    adj_manifest = json.loads((ROOT / "ml/data/lan_challenge_capture/adjudication/final-labels-manifest.json").read_text(encoding="utf-8"))
    check("20", "human_reviewed_false",
          adj_manifest["humanReviewed"] is False and adj_manifest["reviewerCount"] == 0,
          f"humanReviewed={adj_manifest['humanReviewed']} reviewerCount={adj_manifest['reviewerCount']}")

    # ---- 21: challengeSetUsedForTuning false everywhere ----
    check("21", "challenge_not_used_for_tuning",
          protocol_v2["challengeSetUsedForTuning"] is False
          and manifest["challengeSetUsedForTuning"] is False
          and fs["challengeSetUsed"] is False
          and protocol_v2["leakageControls"]["challengeSetUsedForFewShot"] is False,
          "protocol_v2 + manifest + few-shot all false")

    # ---- 22: all 8 required models SUCCESS ----
    all_success = all(status_by_id.get(m, {}).get("status") == "SUCCESS" for m in REQUIRED_MODELS) and len(successful) == len(REQUIRED_MODELS)
    # metrics recompute exactness (moved here as part of the completion gate)
    metrics_ok = True
    mismatches: list[str] = []
    for model_id, predictions in predictions_by_model.items():
        stored = json.loads((METRICS / f"{model_id}.json").read_text(encoding="utf-8"))
        recalculated = calculate_metrics(predictions, references, model_id=model_id)
        fields = [(lambda v: v["verdict"]["accuracy"], "acc"), (lambda v: v["verdict"]["macroF1"], "mf1"),
                  (lambda v: v["attackDetectionAll"]["f1"], "atkF1"), (lambda v: v["safeFPR"]["rate"], "fpr"),
                  (lambda v: v["unknown"]["accuracy"], "unkAcc")]
        for accessor, name in fields:
            if not close(accessor(stored), accessor(recalculated)):
                metrics_ok = False
                mismatches.append(f"{model_id}:{name}")
    check("22", "all_required_models_success", all_success and metrics_ok,
          f"all_success={all_success} metrics_recompute_mismatches={mismatches}")

    # Load diagnostics without converting a missing/invalid file into a fabricated result.
    diagnostic_predictions_by_model: dict[str, list[dict[str, Any]]] = {}
    diagnostic_load_errors: list[str] = []
    for model_id in DIAGNOSTIC_MODELS:
        path = PREDICTIONS / "ablation" / f"{model_id}.jsonl"
        if not path.is_file():
            diagnostic_load_errors.append(f"{model_id}:missing")
            continue
        try:
            diagnostic_predictions_by_model[model_id] = load_predictions(path, model_id)
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
            diagnostic_load_errors.append(f"{model_id}:{type(error).__name__}")
    all_prediction_sets = {
        **predictions_by_model,
        **diagnostic_predictions_by_model,
    }

    # ---- 23: committed predictions contain no credential/session material ----
    privacy_patterns = [
        re.compile(r"(?i)\\b(?:cookie|set-cookie|authorization|proxy-authorization)\\s*[:=]"),
        re.compile(r"(?i)\\b(?:access[_-]?token|refresh[_-]?token|session(?:id)?)\\s*[:=]"),
        re.compile(r"(?i)\\bbearer\\s+[a-z0-9._~+/=-]{8,}"),
        re.compile(r"(?i)raw-private"),
    ]
    privacy_hits: list[str] = []
    for model_id, predictions in all_prediction_sets.items():
        for prediction in predictions:
            serialized = json.dumps(prediction, ensure_ascii=False, sort_keys=True)
            if any(pattern.search(serialized) for pattern in privacy_patterns):
                privacy_hits.append(f"{model_id}:{prediction.get('sampleId')}")
    check("23", "prediction_privacy_scan", not privacy_hits,
          f"hits={privacy_hits[:20]} total={len(privacy_hits)}")

    # ---- 24: parse/schema failures are never repaired to safe ----
    invalid_failure_rows: list[str] = []
    for model_id, predictions in all_prediction_sets.items():
        for prediction in predictions:
            failed_output = not prediction.get("parsed") or not prediction.get("schemaValid")
            if failed_output and (
                prediction.get("verdict") != "unknown"
                or not prediction.get("errorType")
            ):
                invalid_failure_rows.append(f"{model_id}:{prediction.get('sampleId')}")
    check("24", "parse_and_schema_failures_remain_unknown", not invalid_failure_rows,
          f"invalid={invalid_failure_rows[:20]} total={len(invalid_failure_rows)}")

    # ---- 25: one-variable-at-a-time inference-path matrix is complete ----
    ablation_path = REPORT / "inference-path-ablation-v2.json"
    ablation = json.loads(ablation_path.read_text(encoding="utf-8")) if ablation_path.is_file() else {}
    diagnostics = ablation.get("diagnostics", {})
    message_diag = diagnostics.get("systemUserVsSingleConcat", {})
    template_diag = diagnostics.get("sharedSerializedPromptAcrossRuntimes", {})
    plan_path = EVAL / "inference-path-ablation-plan.json"
    plan = json.loads(plan_path.read_text(encoding="utf-8")) if plan_path.is_file() else {}
    plan_intro = introducing_commit("ml/evaluation/lan_challenge/inference-path-ablation-plan.json")
    diagnostic_order_ok = bool(plan_intro)
    metadata_ok = len(diagnostic_predictions_by_model) == len(DIAGNOSTIC_MODELS)
    prompt_sha = protocol_v2["v2AssetLocks"]["systemPromptSha256"]
    for model_id, expected_mode in DIAGNOSTIC_MODELS.items():
        intro = introducing_commit(
            f"ml/reports/lan-challenge-evaluation/predictions/ablation/{model_id}.jsonl"
        )
        diagnostic_order_ok &= bool(
            intro and plan_intro and is_ancestor(plan_intro, intro) and is_ancestor(intro, "HEAD")
        )
        rows = diagnostic_predictions_by_model.get(model_id, [])
        metadata_ok &= len(rows) == 413 and all(
            row.get("messageMode") == expected_mode
            and row.get("systemPromptSha256") == prompt_sha
            for row in rows
        )
    left_serialized = {
        row["sampleId"]: row.get("serializedPromptSha256")
        for row in diagnostic_predictions_by_model.get(
            "aetherargus-v02-merged-bf16-hf-serialized", []
        )
    }
    right_serialized = {
        row["sampleId"]: row.get("serializedPromptSha256")
        for row in diagnostic_predictions_by_model.get(
            "aetherargus-v02-ollama-f16-hf-serialized", []
        )
    }
    shared_prompt_ok = bool(left_serialized) and left_serialized == right_serialized
    ablation_ok = (
        ablation.get("status") == "COMPLETE"
        and plan.get("status") == "LOCKED_PRE_RUN"
        and plan.get("challengeSetUsedForTuning") is False
        and not diagnostic_load_errors
        and diagnostic_order_ok
        and metadata_ok
        and shared_prompt_ok
        and message_diag.get("status") == "SUCCESS"
        and message_diag.get("sampleCountPerVariant") == 413
        and template_diag.get("status") == "SUCCESS"
        and template_diag.get("sampleCountPerVariant") == 413
        and ablation.get("controlledVariables", {}).get("contextLengthTokens") == 2048
        and ablation.get("controlledVariables", {}).get("systemPromptSha256") == prompt_sha
    )
    check("25", "inference_path_one_variable_matrix_complete", ablation_ok,
          f"status={ablation.get('status')} message={message_diag.get('status')} "
          f"template={template_diag.get('status')} loadErrors={diagnostic_load_errors} "
          f"order={diagnostic_order_ok} metadata={metadata_ok} sharedPrompt={shared_prompt_ok}")

    # ---- 26: claims and provenance resolve to real fields and reachable commits ----
    inventory = json.loads((REPORT / "artifact-inventory.json").read_text(encoding="utf-8"))
    provenance = json.loads((REPORT / "pull-request-provenance.json").read_text(encoding="utf-8"))
    provenance_commits = [
        manifest.get("repositoryCommit", ""),
        report_json.get("repositoryCommit", ""),
        inventory.get("evaluationCommit", ""),
        provenance.get("evidenceCommit", ""),
    ]
    claim_detail: list[str] = []
    claims_resolve = True
    for row in claims:
        evidence_path = ROOT / row["evidenceFile"]
        row_ok = evidence_path.is_file() and reachable_commit(row["commit"])
        if row_ok and evidence_path.suffix == ".json":
            evidence_doc = json.loads(evidence_path.read_text(encoding="utf-8"))
            for field in row["metricField"].split(";"):
                row_ok &= json_field_exists(evidence_doc, field)
        claims_resolve &= row_ok
        if not row_ok:
            claim_detail.append(row.get("claimId", "?"))
    provenance_ok = (
        len(set(provenance_commits)) == 1
        and all(reachable_commit(value) for value in provenance_commits)
        and claims_resolve
    )
    check("26", "provenance_and_claim_fields_resolve", provenance_ok,
          f"commits={provenance_commits} badClaims={claim_detail}")

    # ---- 27: model sizes are measured, never estimated, and report status is consistent ----
    size_detail: list[str] = []
    sizes_ok = True
    performance_table = {
        row["modelId"]: row
        for row in csv.DictReader(
            (REPORT / "tables/table-4-latency-memory-size.csv").open(encoding="utf-8")
        )
    }
    for model_id in REQUIRED_MODELS:
        stored = json.loads((METRICS / f"{model_id}.json").read_text(encoding="utf-8"))
        size = stored.get("performance", {}).get("modelSizeBytes")
        measurement = stored.get("performance", {}).get("modelSizeMeasurement")
        table_size = performance_table.get(model_id, {}).get("modelSizeBytes", "")
        measured_ok = (
            size is None
            and isinstance(measurement, dict)
            and measurement.get("method") == "not_available"
            and table_size in {"", "null"}
        ) or (
            isinstance(size, int)
            and isinstance(measurement, dict)
            and measurement.get("method") == "filesystem_stat"
            and measurement.get("sizeBytes") == size
            and re.fullmatch(r"[0-9a-f]{64}", measurement.get("artifactSha256", "")) is not None
            and table_size not in {"", "null"}
            and int(float(table_size)) == size
        )
        if not measured_ok:
            sizes_ok = False
            size_detail.append(model_id)
    report_md = (REPORT / "aetherargus-lan-challenge-report.md").read_text(encoding="utf-8")
    expected_complete = all_success and ablation_ok
    report_ok = (
        report_json.get("completionCriteriaMet") is expected_complete
        and ("table-4-latency-memory-size.csv" in report_md)
        and ("table-4-performance.csv" not in report_md)
    )
    check("27", "measured_sizes_and_report_consistency", sizes_ok and report_ok,
          f"unprovenSizes={size_detail} expectedComplete={expected_complete} reportComplete={report_json.get('completionCriteriaMet')}")

    failed = [row for row in checks if not row["passed"]]
    result = {
        "schemaVersion": 2,
        "mode": "allow-not-run" if arguments.allow_not_run else "strict",
        "checksPassed": len(checks) - len(failed),
        "checksTotal": len(checks),
        "failed": failed,
        "checks": checks,
    }
    out_path = METRICS / ("validation-partial.json" if arguments.allow_not_run else "validation-strict.json")
    out_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"mode": result["mode"], "checksPassed": result["checksPassed"], "checksTotal": result["checksTotal"], "failedChecks": [r["name"] for r in failed]}, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
