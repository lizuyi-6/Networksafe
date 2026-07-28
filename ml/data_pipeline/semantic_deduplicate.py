#!/usr/bin/env python3
"""Audit near duplicates with SimHash, MinHash and character n-gram vectors."""

from __future__ import annotations

import json
from collections import defaultdict

from common import (
    add_io_arguments,
    char_ngrams,
    common_parser,
    emit_log,
    iter_jsonl,
    jaccard,
    load_config,
    minhash_signature,
    minhash_similarity,
    normalize_text,
    parse_record,
    repository_root,
    resolve_path,
    simhash_distance,
    stable_hash,
    write_json,
    write_jsonl,
)


def semantic_cluster_records(
    records: list[dict],
    *,
    jaccard_threshold: float,
    simhash_max_distance: int,
    minhash_threshold: float,
) -> tuple[list[dict], list[dict]]:
    """Assign conservative lexical clusters; do not delete reviewed variants."""

    result = [json.loads(json.dumps(record, ensure_ascii=False)) for record in records]
    buckets: dict[tuple[str, str], list[int]] = defaultdict(list)
    payloads: list[str] = []
    minhashes: list[list[int]] = []
    for index, record in enumerate(result):
        detection_input, _ = parse_record(record)
        payload = normalize_text(json.dumps(detection_input, ensure_ascii=False, sort_keys=True))
        payloads.append(payload)
        signature = minhash_signature(payload)
        minhashes.append(signature)
        family = str(record["metadata"]["attackFamily"])
        simhash_prefix = str(record["metadata"]["simHash"])[:2]
        buckets[(family, simhash_prefix)].append(index)
        record["metadata"]["minHash"] = signature
        record["metadata"]["semanticClusterId"] = stable_hash(
            f"template:{record['metadata']['templateFingerprint']}"
        )
    flagged: list[dict] = []
    for bucket_indices in buckets.values():
        for left_position, left_index in enumerate(bucket_indices):
            for right_index in bucket_indices[left_position + 1 : left_position + 65]:
                left = result[left_index]
                right = result[right_index]
                if left["metadata"]["templateFingerprint"] == right["metadata"]["templateFingerprint"]:
                    continue
                sim_distance = simhash_distance(left["metadata"]["simHash"], right["metadata"]["simHash"])
                if sim_distance > simhash_max_distance:
                    continue
                min_similarity = minhash_similarity(minhashes[left_index], minhashes[right_index])
                if min_similarity < minhash_threshold:
                    continue
                lexical_similarity = jaccard(
                    char_ngrams(payloads[left_index], 4),
                    char_ngrams(payloads[right_index], 4),
                )
                if lexical_similarity >= jaccard_threshold:
                    cluster_id = stable_hash(
                        "|".join(
                            sorted(
                                [
                                    left["metadata"]["semanticClusterId"],
                                    right["metadata"]["semanticClusterId"],
                                ]
                            )
                        )
                    )
                    left["metadata"]["semanticClusterId"] = cluster_id
                    right["metadata"]["semanticClusterId"] = cluster_id
                    flagged.append(
                        {
                            "left": left["sampleId"],
                            "right": right["sampleId"],
                            "simHashDistance": sim_distance,
                            "minHashSimilarity": round(min_similarity, 4),
                            "charNgramJaccard": round(lexical_similarity, 4),
                            "action": "clustered_not_deleted",
                        }
                    )
    return result, flagged


def main() -> int:
    parser = common_parser(__doc__ or "Semantic duplicate audit")
    add_io_arguments(parser)
    parser.add_argument("--report", help="Near-duplicate report JSON path.")
    arguments = parser.parse_args()
    root = repository_root(arguments.repo_root)
    config = load_config(arguments.config, root)
    if not arguments.input or not arguments.output:
        parser.error("--input and --output are required")
    records = list(iter_jsonl(resolve_path(root, arguments.input)))
    quality = config["quality"]
    clustered, flagged = semantic_cluster_records(
        records,
        jaccard_threshold=float(quality["near_duplicate_jaccard"]),
        simhash_max_distance=int(quality["simhash_max_distance"]),
        minhash_threshold=float(quality["minhash_similarity"]),
    )
    write_jsonl(resolve_path(root, arguments.output), clustered, dry_run=arguments.dry_run, resume=arguments.resume)
    write_json(
        resolve_path(root, arguments.report or "ml/reports/dataset-v02-semantic-duplicates.json"),
        {
            "input": len(records),
            "output": len(clustered),
            "flaggedPairs": len(flagged),
            "pairs": flagged,
            "backend": "SimHash64 + MinHash24 + character-4-gram Jaccard",
            "neuralEmbeddingUsed": False,
        },
        dry_run=arguments.dry_run,
        resume=arguments.resume,
    )
    emit_log("semantic_deduplication_complete", input=len(records), flaggedPairs=len(flagged))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
