#!/usr/bin/env python3
"""Score a complete prediction file after inference has closed it."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from scoring import calculate_metrics, load_predictions, load_references


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--performance-metadata", type=Path)
    arguments = parser.parse_args()
    if not arguments.predictions.is_file():
        raise FileNotFoundError(arguments.predictions)
    prediction_completed_at = datetime.fromtimestamp(
        arguments.predictions.stat().st_mtime, tz=UTC
    ).isoformat()
    predictions = load_predictions(arguments.predictions, arguments.model_id)
    references = load_references(arguments.labels)
    performance_metadata = (
        json.loads(arguments.performance_metadata.read_text(encoding="utf-8"))
        if arguments.performance_metadata and arguments.performance_metadata.is_file()
        else {}
    )
    metrics = calculate_metrics(
        predictions,
        references,
        model_id=arguments.model_id,
        performance_metadata=performance_metadata,
    )
    metrics["predictionCompletedAt"] = prediction_completed_at
    metrics["scoredAt"] = datetime.now(UTC).isoformat()
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "modelId": arguments.model_id,
                "sampleCount": metrics["sampleCount"],
                "accuracy": metrics["verdict"]["accuracy"],
                "macroF1": metrics["verdict"]["macroF1"],
                "safeFPR": metrics["safeFPR"]["rate"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
