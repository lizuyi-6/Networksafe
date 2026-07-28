from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path


PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

from common import (  # noqa: E402
    assign_group_ids,
    grouped_split,
    leakage_report,
    stable_json,
    validate_record,
)
from generate_candidates import (  # noqa: E402
    CORE_FAMILIES,
    attack_record,
    hard_negative_record,
    normal_record,
    unknown_record,
)
from review_candidates import review_records  # noqa: E402


def test_config() -> dict:
    return {
        "version": "v02-test",
        "seed": 7,
        "generation": {
            "generator_model": "deterministic-test",
            "prompt_version": "test.1",
            "generated_at": "2026-07-28T00:00:00Z",
            "prompt_injection_interval": 3,
            "source_group_size": 4,
        },
    }


class PipelineTests(unittest.TestCase):
    def test_all_candidate_kinds_pass_deterministic_validation(self) -> None:
        config = test_config()
        samples = [
            attack_record("sqli", 3, config, independent=False),
            normal_record(7, config, independent=False),
            hard_negative_record(9, config, independent=False),
            unknown_record(4, config, independent=False),
        ]
        self.assertEqual([validate_record(sample) for sample in samples], [[], [], [], []])

    def test_prompt_injection_remains_data_and_label_stays_malicious(self) -> None:
        sample = attack_record("ssrf", 0, test_config(), independent=True)
        user = json.loads(sample["messages"][1]["content"])
        assistant = json.loads(sample["messages"][2]["content"])
        self.assertIn("Ignore previous instructions", stable_json(user))
        self.assertEqual(assistant["verdict"], "malicious")
        self.assertEqual(assistant["recommendedAction"], "block")

    def test_invalid_safe_block_is_rejected_without_relabel(self) -> None:
        sample = normal_record(1, test_config(), independent=False)
        original = copy.deepcopy(sample)
        output = json.loads(sample["messages"][2]["content"])
        output["recommendedAction"] = "block"
        sample["messages"][2]["content"] = json.dumps(output, ensure_ascii=False)
        accepted, decisions, queue = review_records([sample])
        self.assertEqual(accepted, [])
        self.assertEqual(len(queue), 1)
        self.assertIn("safe_block", decisions[0]["decision"]["problems"])
        self.assertEqual(original["messages"][2]["content"], normal_record(1, test_config(), independent=False)["messages"][2]["content"])

    def test_group_split_has_no_known_overlap(self) -> None:
        config = test_config()
        development = [
            attack_record(CORE_FAMILIES[index % len(CORE_FAMILIES)], index, config, independent=False)
            for index in range(160)
        ]
        grouped = assign_group_ids(development, 7)
        splits = grouped_split(grouped, {"train": 0.8, "validation": 0.1, "test_closed": 0.1}, 7)
        report = leakage_report(splits)
        self.assertFalse(report["detected"])

    def test_independent_and_development_templates_differ(self) -> None:
        config = test_config()
        development = assign_group_ids(
            [attack_record("xss", index, config, independent=False) for index in range(20)], 7
        )
        independent = assign_group_ids(
            [attack_record("xss", index, config, independent=True) for index in range(20)], 7
        )
        report = leakage_report({"train": development, "test_independent": independent})
        self.assertFalse(report["detected"])

    def test_generation_is_reproducible(self) -> None:
        left = attack_record("business_logic", 11, test_config(), independent=False)
        right = attack_record("business_logic", 11, test_config(), independent=False)
        self.assertEqual(stable_json(left), stable_json(right))


if __name__ == "__main__":
    unittest.main()
