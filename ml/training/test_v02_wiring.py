"""Guards for wiring the AetherArgus v0.2 dataset into the QLoRA trainer.

These tests exercise dataset-integrity verification, manifest hash checks,
test-split rejection, and v0.2 message-format handling WITHOUT loading torch
or a model, so they run fast and offline.
"""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import train_qlora as tq


def _sha(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def _write_jsonl(path: Path, records: list[dict]) -> None:
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records), encoding="utf-8")


def _record() -> dict:
    return {
        "messages": [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": json.dumps({"method": "GET", "path": "/"})},
            {
                "role": "assistant",
                "content": json.dumps(
                    {
                        "verdict": "safe",
                        "confidence": 0.9,
                        "attackFamily": "benign",
                        "severity": "low",
                        "reasoning": "r",
                        "evidence": [],
                        "recommendedAction": "allow",
                    }
                ),
            },
        ],
        "metadata": {"labelCategory": "normal"},
    }


class V02ConfigLoadTests(unittest.TestCase):
    def test_v02_config_loads_and_points_at_release(self) -> None:
        config_path = tq.repository_root() / "ml" / "configs" / "qwen3-4b-qlora-v02.yaml"
        import yaml

        config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        self.assertEqual(config["dataset_version"], "v02")
        self.assertEqual(config["seed"], 20260728)
        self.assertIn("releases/v02", config["train_file"])
        self.assertIn("releases/v02", config["validation_file"])
        self.assertIn("aetherargus-v02-lora", config["output_dir"])


class DatasetIntegrityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.train = self.tmp / "train.jsonl"
        self.val = self.tmp / "validation.jsonl"
        _write_jsonl(self.train, [_record(), _record()])
        _write_jsonl(self.val, [_record()])

    def _config(self) -> dict:
        return {
            "dataset_version": "v02",
            "train_file": str(self.train),
            "validation_file": str(self.val),
        }

    def test_manifest_hash_verification_passes(self) -> None:
        manifest = {
            "files": {
                "train": {"path": str(self.train), "records": 2, "sha256": _sha(self.train)},
                "validation": {"path": str(self.val), "records": 1, "sha256": _sha(self.val)},
            }
        }
        manifest_path = self.tmp / "manifest.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        config = self._config()
        config["dataset_manifest"] = str(manifest_path)
        integrity = tq.verify_dataset_integrity(config)
        self.assertEqual(integrity["trainSha256"], _sha(self.train))
        self.assertEqual(integrity["validationSha256"], _sha(self.val))
        self.assertEqual(integrity["datasetVersion"], "v02")
        self.assertIn("manifestSha256", integrity)

    def test_wrong_manifest_hash_fails(self) -> None:
        manifest = {
            "files": {
                "train": {"path": str(self.train), "records": 2, "sha256": "0" * 64},
                "validation": {"path": str(self.val), "records": 1, "sha256": _sha(self.val)},
            }
        }
        manifest_path = self.tmp / "manifest.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        config = self._config()
        config["dataset_manifest"] = str(manifest_path)
        with self.assertRaises(ValueError):
            tq.verify_dataset_integrity(config)

    def test_test_split_path_is_rejected(self) -> None:
        for bad in (
            "ml/data/releases/v02/test-closed.jsonl",
            "ml/data/releases/v02/test-independent.jsonl",
            "data/test_closed.jsonl",
        ):
            with self.assertRaises(ValueError):
                tq.reject_test_split_path(bad, "train_file")

    def test_train_and_validation_paths_pass(self) -> None:
        tq.reject_test_split_path("ml/data/releases/v02/train.jsonl", "train_file")
        tq.reject_test_split_path("ml/data/releases/v02/validation.jsonl", "validation_file")


class V02MessageFormatTests(unittest.TestCase):
    def test_v02_messages_accepted_by_loader(self) -> None:
        records = tq.load_jsonl_records(self._write_temp())
        self.assertEqual(len(records), 1)
        self.assertEqual([m["role"] for m in records[0]["messages"]], ["system", "user", "assistant"])

    def test_non_three_message_record_rejected(self) -> None:
        bad = {"messages": [{"role": "user", "content": "x"}]}
        path = self._write_temp(record=bad)
        with self.assertRaises(ValueError):
            tq.load_jsonl_records(path)

    def _write_temp(self, record: dict | None = None) -> Path:
        path = Path(tempfile.mkdtemp()) / "train.jsonl"
        _write_jsonl(path, [record or _record()])
        return path


class SummaryFieldTests(unittest.TestCase):
    def test_summary_write_includes_dataset_version_and_hashes(self) -> None:
        """The v0.2 training-summary schema keys the trainer is required to emit."""
        # Mirrors the keys train_qlora.main() writes into training-summary.json.
        required_keys = {
            "datasetVersion",
            "datasetManifestSha256",
            "trainSha256",
            "validationSha256",
            "gitCommit",
            "baseModelRevision",
            "truncation",
        }
        # Static assertion against the trainer source keeps this honest without a GPU run.
        source = (tq.repository_root() / "ml" / "training" / "train_qlora.py").read_text(encoding="utf-8")
        for key in required_keys:
            self.assertIn(f'"{key}"', source, f"train_qlora.py must write summary key {key}")


if __name__ == "__main__":
    unittest.main()
