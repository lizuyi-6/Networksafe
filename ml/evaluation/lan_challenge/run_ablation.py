#!/usr/bin/env python3
"""Score predeclared, one-variable inference-path diagnostics.

This scorer runs only after every prediction file has been produced by a label-blind
inference process. It never mutates prompts or predictions. Missing diagnostics produce
an INCOMPLETE report and a non-zero exit status; they are never treated as evidence.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from scoring import (
    EXPECTED_INPUT_SHA256,
    clopper_pearson_interval,
    load_predictions,
    load_references,
)


ROOT = Path(__file__).resolve().parents[3]
REPORT = ROOT / "ml/reports/lan-challenge-evaluation"
PREDICTIONS = REPORT / "predictions"
ABLATION_PREDICTIONS = PREDICTIONS / "ablation"
LABELS = ROOT / "ml/data/lan_challenge_capture/adjudication/final-labels.jsonl"
OUT_JSON = REPORT / "inference-path-ablation-v2.json"
OUT_MD = REPORT / "inference-path-ablation-v2.md"

SYSTEM_PROMPT_SHA256 = "9b07be6e2cf57443232df24ffde5f7765a1b071029eaf86c06724ed6182a4cd8"
PRIMARY_HF = "aetherargus-v02-merged-bf16"
PRIMARY_OLLAMA = "aetherargus-v02-ollama-f16"
HF_SINGLE = "aetherargus-v02-merged-bf16-single-concat"
OLLAMA_SINGLE = "aetherargus-v02-ollama-f16-single-concat"
HF_SERIALIZED = "aetherargus-v02-merged-bf16-hf-serialized"
OLLAMA_SERIALIZED = "aetherargus-v02-ollama-f16-hf-serialized"

FILES = {
    PRIMARY_HF: PREDICTIONS / f"{PRIMARY_HF}.jsonl",
    PRIMARY_OLLAMA: PREDICTIONS / f"{PRIMARY_OLLAMA}.jsonl",
    HF_SINGLE: ABLATION_PREDICTIONS / f"{HF_SINGLE}.jsonl",
    OLLAMA_SINGLE: ABLATION_PREDICTIONS / f"{OLLAMA_SINGLE}.jsonl",
    HF_SERIALIZED: ABLATION_PREDICTIONS / f"{HF_SERIALIZED}.jsonl",
    OLLAMA_SERIALIZED: ABLATION_PREDICTIONS / f"{OLLAMA_SERIALIZED}.jsonl",
}


def indexed(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {row["sampleId"]: row for row in rows}


def safe_fpr(rows: dict[str, dict[str, Any]], references: dict[str, str]) -> dict[str, Any]:
    safe_ids = [sample_id for sample_id, verdict in references.items() if verdict == "safe"]
    false_positives = sum(rows[sample_id]["verdict"] == "attack" for sample_id in safe_ids)
    return {
        "falsePositiveCount": false_positives,
        "safeSupport": len(safe_ids),
        "rate": false_positives / len(safe_ids),
    }


def compare(
    left_id: str,
    right_id: str,
    predictions: dict[str, dict[str, dict[str, Any]]],
    references: dict[str, str],
) -> dict[str, Any]:
    left = predictions[left_id]
    right = predictions[right_id]
    sample_ids = sorted(references)
    pairs = Counter((left[sample_id]["verdict"], right[sample_id]["verdict"]) for sample_id in sample_ids)
    agree = sum(count for (left_verdict, right_verdict), count in pairs.items() if left_verdict == right_verdict)
    left_fpr = safe_fpr(left, references)
    right_fpr = safe_fpr(right, references)
    return {
        "leftModelId": left_id,
        "rightModelId": right_id,
        "sampleCount": len(sample_ids),
        "verdictAgreement": {
            "agree": agree,
            "total": len(sample_ids),
            "rate": agree / len(sample_ids),
            "clopperPearson95": clopper_pearson_interval(agree, len(sample_ids)),
        },
        "verdictDisagreementBreakdown": {
            f"{left_verdict}->{right_verdict}": count
            for (left_verdict, right_verdict), count in sorted(pairs.items())
            if left_verdict != right_verdict
        },
        "safeFPR": {
            "left": left_fpr,
            "right": right_fpr,
            "deltaRightMinusLeft": right_fpr["rate"] - left_fpr["rate"],
        },
    }


def validate_diagnostic_metadata(
    predictions: dict[str, dict[str, dict[str, Any]]],
) -> None:
    expected_modes = {
        HF_SINGLE: "single-concatenated",
        OLLAMA_SINGLE: "single-concatenated",
        HF_SERIALIZED: "pre-serialized",
        OLLAMA_SERIALIZED: "pre-serialized",
    }
    for model_id, mode in expected_modes.items():
        for row in predictions[model_id].values():
            if row.get("messageMode") != mode:
                raise ValueError(f"{model_id}: expected messageMode={mode}")
            if row.get("systemPromptSha256") != SYSTEM_PROMPT_SHA256:
                raise ValueError(f"{model_id}: system prompt SHA mismatch")
    for sample_id in predictions[HF_SERIALIZED]:
        left_sha = predictions[HF_SERIALIZED][sample_id].get("serializedPromptSha256")
        right_sha = predictions[OLLAMA_SERIALIZED][sample_id].get("serializedPromptSha256")
        if not isinstance(left_sha, str) or left_sha != right_sha:
            raise ValueError(f"shared serialized prompt mismatch for {sample_id}")


def write_incomplete(missing: list[str]) -> None:
    result = {
        "schemaVersion": 3,
        "status": "INCOMPLETE",
        "reason": "Required predeclared diagnostic prediction files are missing.",
        "missingPredictionFiles": missing,
        "requiredOperatorAction": "Run all commands in inference-path-ablation-plan.md on the frozen operator environment, commit the four diagnostic prediction files, then rerun this scorer and strict validation.",
        "controlledVariables": {
            "contextLengthTokens": 2048,
            "systemPromptSha256": SYSTEM_PROMPT_SHA256,
            "sampling": {"temperature": 0, "topP": 1, "topK": 0, "seed": 0},
            "maxNewTokens": 320,
            "inputSha256": EXPECTED_INPUT_SHA256,
        },
    }
    OUT_JSON.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    OUT_MD.write_text(
        "# Inference-Path Ablation v2\n\n"
        "**Status: INCOMPLETE.** The required one-variable diagnostics have not all been run.\n\n"
        "Missing prediction files:\n\n"
        + "\n".join(f"- `{path}`" for path in missing)
        + "\n\nRun the locked commands in `inference-path-ablation-plan.md`, then rerun "
        "`python ml/evaluation/lan_challenge/run_ablation.py`. No causal conclusion about the "
        "historical FPR difference is permitted while this report is incomplete.\n",
        encoding="utf-8",
    )


def main() -> int:
    missing = [str(path.relative_to(ROOT)) for path in FILES.values() if not path.exists()]
    if missing:
        write_incomplete(missing)
        print(json.dumps({"status": "INCOMPLETE", "missingPredictionFiles": missing}, indent=2))
        return 2

    loaded = {model_id: indexed(load_predictions(path, model_id)) for model_id, path in FILES.items()}
    reference_rows = load_references(LABELS)
    references = {row["sampleId"]: row["verdict"] for row in reference_rows}
    if any(set(rows) != set(references) for rows in loaded.values()):
        raise ValueError("ablation prediction/reference sampleId mismatch")
    validate_diagnostic_metadata(loaded)

    native_runtime = compare(PRIMARY_HF, PRIMARY_OLLAMA, loaded, references)
    hf_message = compare(PRIMARY_HF, HF_SINGLE, loaded, references)
    ollama_message = compare(PRIMARY_OLLAMA, OLLAMA_SINGLE, loaded, references)
    shared_runtime = compare(HF_SERIALIZED, OLLAMA_SERIALIZED, loaded, references)
    hf_serialization = compare(PRIMARY_HF, HF_SERIALIZED, loaded, references)
    ollama_serialization = compare(PRIMARY_OLLAMA, OLLAMA_SERIALIZED, loaded, references)

    result = {
        "schemaVersion": 3,
        "status": "COMPLETE",
        "sampleCount": 413,
        "artifactRelationship": {
            "sameCheckpointLineage": True,
            "bitIdenticalArtifacts": False,
            "note": "Transformers uses merged BF16 safetensors and Ollama uses an f16 GGUF conversion. Runtime and numeric representation remain coupled in cross-runtime comparisons; the artifacts are not claimed to be bit-identical.",
        },
        "controlledVariables": {
            "contextLengthTokens": 2048,
            "systemPromptSha256": SYSTEM_PROMPT_SHA256,
            "sampling": {"temperature": 0, "topP": 1, "topK": 0, "seed": 0},
            "maxNewTokens": 320,
            "inputSha256": EXPECTED_INPUT_SHA256,
        },
        "diagnostics": {
            "systemUserVsSingleConcat": {
                "status": "SUCCESS",
                "changedVariable": "chat message structure only within each runtime",
                "sampleCountPerVariant": 413,
                "transformers": hf_message,
                "ollama": ollama_message,
            },
            "sharedSerializedPromptAcrossRuntimes": {
                "status": "SUCCESS",
                "changedVariable": "runtime plus unavoidable BF16-to-f16 artifact representation; prompt bytes are identical per sample",
                "sampleCountPerVariant": 413,
                "comparison": shared_runtime,
            },
            "nativeTemplateVsSharedHfSerialization": {
                "status": "SUCCESS",
                "changedVariable": "native chat-template application versus a pre-serialized Transformers template within each runtime",
                "sampleCountPerVariant": 413,
                "transformers": hf_serialization,
                "ollama": ollama_serialization,
            },
        },
        "nativeSystemUserCrossRuntime": native_runtime,
        "interpretationLimits": [
            "The challenge set was not used to choose prompts or runtime settings.",
            "A zero observed verdict difference does not prove numerical equivalence outside these 413 inputs.",
            "The cross-runtime comparison cannot separate runtime effects from the BF16-to-f16 artifact representation without a bit-identical backend pair.",
            "Latency remains non-comparable across stacks because timing boundaries and hardware/runtime overhead differ.",
        ],
    }
    shared_agreement = shared_runtime["verdictAgreement"]
    result["conclusion"] = (
        "With byte-identical pre-serialized prompts, the Transformers merged-BF16 and Ollama f16 "
        f"paths agreed on {shared_agreement['agree']}/{shared_agreement['total']} verdicts "
        f"({shared_agreement['rate']:.1%}) on this frozen set. The within-runtime message-structure "
        "comparisons quantify template/serialization sensitivity. Any residual cross-runtime effect "
        "still combines runtime and BF16-to-f16 representation and must not be attributed to quantization alone."
    )
    OUT_JSON.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")

    comparisons = [
        ("Native system+user: Transformers vs Ollama", native_runtime),
        ("Transformers: system+user vs single concatenated", hf_message),
        ("Ollama: system+user vs single concatenated", ollama_message),
        ("Shared HF-serialized prompt: Transformers vs Ollama", shared_runtime),
        ("Transformers: native vs pre-serialized", hf_serialization),
        ("Ollama: native vs pre-serialized", ollama_serialization),
    ]
    md = [
        "# Inference-Path Ablation v2",
        "",
        "**Status: COMPLETE.** Every predeclared diagnostic covers all 413 frozen inputs.",
        "",
        "## Controls",
        "",
        "Context length 2048, output cap 320, temperature 0, top_p 1, top_k 0, seed 0, "
        f"system prompt SHA-256 `{SYSTEM_PROMPT_SHA256}`, input SHA-256 `{EXPECTED_INPUT_SHA256}`.",
        "",
        "## Results",
        "",
        "| comparison | verdict agreement | left safe FPR | right safe FPR | delta (right-left) |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for name, block in comparisons:
        agreement = block["verdictAgreement"]
        fpr = block["safeFPR"]
        md.append(
            f"| {name} | {agreement['agree']}/{agreement['total']} ({agreement['rate']:.1%}) "
            f"| {fpr['left']['rate']:.4f} | {fpr['right']['rate']:.4f} "
            f"| {fpr['deltaRightMinusLeft']:+.4f} |"
        )
    md += [
        "",
        "## Artifact qualification",
        "",
        "Both artifacts descend from the same trained checkpoint, but they are not bit-identical: "
        "Transformers uses merged BF16 safetensors and Ollama uses an f16 GGUF conversion. Therefore "
        "cross-runtime differences still combine runtime and numeric-representation effects.",
        "",
        "## Conclusion",
        "",
        result["conclusion"],
        "",
        "Latency is intentionally excluded from causal ranking because the two timing boundaries and runtime overheads differ.",
    ]
    OUT_MD.write_text("\n".join(md) + "\n", encoding="utf-8")
    print(json.dumps({"status": "COMPLETE", "wrote": [OUT_JSON.name, OUT_MD.name]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
