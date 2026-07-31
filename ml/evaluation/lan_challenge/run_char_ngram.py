#!/usr/bin/env python3
"""Train the locked char n-gram baseline, then infer without opening references."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

try:
    import resource  # type: ignore[import-not-found]
except ImportError:
    resource = None  # type: ignore[assignment]  (Windows has no resource module)

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.multiclass import OneVsRestClassifier
from sklearn.pipeline import Pipeline

from inference_common import (
    assert_complete,
    canonical_request_text,
    prepare_append_only_output,
    read_model_inputs,
    write_prediction,
)

MODEL_ID = "char-ngram-logreg"


def load_sft(path: Path) -> tuple[list[str], list[str]]:
    texts: list[str] = []
    labels: list[str] = []
    with path.open("r", encoding="utf-8") as stream:
        for line in stream:
            if not line.strip():
                continue
            row = json.loads(line)
            messages = row.get("messages") or []
            user = next(message["content"] for message in messages if message.get("role") == "user")
            assistant = json.loads(next(message["content"] for message in messages if message.get("role") == "assistant"))
            verdict = assistant.get("verdict")
            label = "attack" if verdict in {"malicious", "suspicious", "attack"} else verdict
            if label not in {"safe", "attack", "unknown"}:
                raise ValueError(f"unsupported training verdict: {verdict!r}")
            texts.append(user)
            labels.append(label)
    return texts, labels


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    for source in (arguments.train, arguments.validation):
        if not source.is_file():
            raise FileNotFoundError(f"locked non-challenge training asset is unavailable: {source}")
        if "lan_challenge" in source.as_posix() or "test-" in source.name:
            raise ValueError("challenge/test data cannot train the baseline")
    train_texts, train_labels = load_sft(arguments.train)
    validation_texts, validation_labels = load_sft(arguments.validation)
    texts = train_texts + validation_texts
    labels = train_labels + validation_labels
    pipeline = Pipeline(
        [
            (
                "tfidf",
                TfidfVectorizer(
                    analyzer="char",
                    ngram_range=(3, 5),
                    min_df=2,
                    max_features=250000,
                    sublinear_tf=True,
                ),
            ),
            (
                "classifier",
                # The protocol locks solver=liblinear. liblinear is binary-only, so for the
                # 3-class verdict task we wrap it in OneVsRestClassifier (one binary liblinear
                # model per class). This is the faithful multiclass realisation of the locked
                # solver; it does NOT change the solver or any other locked hyperparameter.
                OneVsRestClassifier(
                    LogisticRegression(
                        class_weight="balanced",
                        solver="liblinear",
                        random_state=20260728,
                        max_iter=2000,
                    )
                ),
            ),
        ]
    )
    pipeline.fit(texts, labels)

    rows = read_model_inputs(arguments.input)
    output, completed = prepare_append_only_output(arguments.output, MODEL_ID)
    started = time.perf_counter()
    try:
        for row in rows:
            if row["sampleId"] in completed:
                continue
            sample_started = time.perf_counter()
            text = canonical_request_text(row["input"])
            predicted = str(pipeline.predict([text])[0])
            probabilities = pipeline.predict_proba([text])[0]
            confidence = int(max(1, min(5, round(float(max(probabilities)) * 5))))
            prediction = {
                "verdict": predicted,
                "attackFamily": "not_supported",
                "recommendedAction": "allow" if predicted == "safe" else "block" if predicted == "attack" else "challenge",
                "contextSufficient": predicted != "unknown",
                "confidence": confidence,
            }
            record = {
                "sampleId": row["sampleId"],
                "modelId": MODEL_ID,
                "rawOutput": json.dumps(prediction, ensure_ascii=False, separators=(",", ":")),
                "parsed": True,
                "schemaValid": True,
                **prediction,
                "latencyMs": (time.perf_counter() - sample_started) * 1000,
                "inputTokenCount": None,
                "outputTokenCount": None,
                "errorType": None,
                "inputSha256": "c77f4949cbe1860f97219a83f0ee16de40740321a4d2f628d56f15069fe6b8c3",
            }
            write_prediction(output, record)
    finally:
        output.close()
    assert_complete(rows, arguments.output)
    summary = {
        "modelId": MODEL_ID,
        "status": "SUCCESS",
        "sampleCount": len(rows),
        "trainingRecordCount": len(texts),
        "trainRecordCount": len(train_texts),
        "validationRecordCount": len(validation_texts),
        "actualFeatureCount": len(pipeline.named_steps["tfidf"].vocabulary_),
        "elapsedSeconds": time.perf_counter() - started,
        "peakHostMemoryMiB": (resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024) if resource is not None else None,
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
