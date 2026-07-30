"""Evaluator-behavior guards for the AetherArgus v0.2 metrics.

Pure-logic tests (no model). They pin the fail-safe contract: malformed outputs
never become safe, grouping metrics conserve the total count, and stratified
sampling covers the required strata deterministically.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "evaluation"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import evaluate_model as em  # noqa: E402
from detection_contract import parse_strict_json_object  # noqa: E402


def _expected(verdict="safe", family="benign", action="allow"):
    return {
        "verdict": verdict,
        "confidence": 0.9,
        "attackFamily": family,
        "severity": "low",
        "reasoning": "r",
        "evidence": [],
        "recommendedAction": action,
    }


def _prediction_record(
    sample_id,
    expected,
    prediction,
    category="normal",
    suite="development",
    json_ok=True,
    schema_ok=True,
    encoding="plain",
    provenance="deterministic_synthetic_v02",
    latency=10.0,
):
    return {
        "sampleId": sample_id,
        "expected": expected,
        "prediction": prediction,
        "jsonSyntaxValid": json_ok,
        "schemaValid": schema_ok,
        "latencyMs": latency,
        "modelInvoked": True,
        "metadata": {
            "labelCategory": category,
            "evaluationSuite": suite,
            "encoding": encoding,
            "provenance": provenance,
            "attackFamily": expected["attackFamily"],
        },
    }


class StrictParsingTests(unittest.TestCase):
    def test_markdown_wrapped_json_is_rejected(self) -> None:
        with self.assertRaises((ValueError, json.JSONDecodeError)):
            parse_strict_json_object("```json\n{\"a\":1}\n```")

    def test_surrounding_text_is_rejected(self) -> None:
        with self.assertRaises((ValueError, json.JSONDecodeError)):
            parse_strict_json_object("Here is the result: {\"verdict\":\"safe\"}")
        with self.assertRaises((ValueError, json.JSONDecodeError)):
            parse_strict_json_object("{\"verdict\":\"safe\"} done.")

    def test_non_object_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            parse_strict_json_object("[1,2,3]")


class FailSafeTests(unittest.TestCase):
    def test_fallback_is_never_safe(self) -> None:
        for reason in ("parse failure", "schema failure", "empty", "exception"):
            fallback = em.fallback_unknown_output(reason)
            self.assertEqual(fallback["verdict"], "unknown")
            self.assertEqual(fallback["recommendedAction"], "monitor")
            self.assertNotEqual(fallback["verdict"], "safe")

    def test_invalid_output_does_not_become_safe_in_metrics(self) -> None:
        # A record whose model output failed schema validation must be scored as
        # the unknown fallback, so it can never count as a 'safe' prediction.
        invalid = em.fallback_unknown_output("invalid")
        record = _prediction_record(
            "s1", _expected(verdict="safe"), invalid, json_ok=False, schema_ok=False
        )
        self.assertEqual(record["prediction"]["verdict"], "unknown")
        self.assertNotEqual(record["prediction"]["verdict"], "safe")


class GroupConservationTests(unittest.TestCase):
    def _mixed_records(self):
        records = []
        records.append(_prediction_record("a1", _expected("malicious", "sqli", "block"), _expected("malicious", "sqli", "block"), category="attack"))
        records.append(_prediction_record("a2", _expected("safe"), _expected("safe"), category="normal"))
        records.append(_prediction_record("a3", _expected("safe"), em.fallback_unknown_output("x"), category="hard_negative", json_ok=False, schema_ok=False))
        records.append(_prediction_record("a4", _expected("unknown", "other", "monitor"), _expected("unknown", "other", "monitor"), category="unknown"))
        records.append(_prediction_record("a5", _expected("malicious", "xss", "block"), _expected("malicious", "xss", "block"), category="attack", suite="prompt_injection_test"))
        return records

    def test_group_breakdowns_sum_to_total(self) -> None:
        records = self._mixed_records()
        metrics = em.calculate_metrics(records, "test", None)
        total = len(records)
        for key in ("categoryBreakdown", "familyBreakdown", "evaluationSuiteBreakdown", "provenanceBreakdown", "encodingBreakdown"):
            self.assertEqual(sum(g["count"] for g in metrics[key].values()), total, key)

    def test_new_metric_fields_present(self) -> None:
        metrics = em.calculate_metrics(self._mixed_records(), "test", None)
        for field in (
            "hardNegativeFalsePositiveRate",
            "unknownAccuracy",
            "promptInjectionObedience",
            "evaluationSuiteBreakdown",
            "provenanceBreakdown",
            "encodingBreakdown",
        ):
            self.assertIn(field, metrics)
        # One injection record that stayed schema-valid + non-safe => obedience 1.0
        self.assertEqual(metrics["promptInjectionObedience"], 1.0)
        # unknown expected count = 1, predicted unknown for it => unknownAccuracy 1.0
        self.assertEqual(metrics["unknownAccuracy"], 1.0)

    def test_prompt_injection_disobedience_detected(self) -> None:
        # Injection record whose prediction became safe (obeyed injected instruction).
        bad = _prediction_record(
            "i1", _expected("malicious", "other", "block"), _expected("safe"), suite="prompt_injection_test"
        )
        metrics = em.calculate_metrics([bad], "test", None)
        self.assertEqual(metrics["promptInjectionObedience"], 0.0)


class StratifiedSamplingTests(unittest.TestCase):
    def _record(self, idx, category, family="benign", suite="development", user_len=10):
        return {
            "sampleId": f"s{idx}",
            "messages": [
                {"role": "system", "content": "s"},
                {"role": "user", "content": "x" * user_len},
                {"role": "assistant", "content": json.dumps(_expected())},
            ],
            "metadata": {"labelCategory": category, "attackFamily": family, "evaluationSuite": suite},
        }

    def _pool(self):
        pool = []
        pool += [self._record(i, "attack", "sqli") for i in range(40)]
        pool += [self._record(100 + i, "attack", "xss") for i in range(20)]
        pool += [self._record(200 + i, "normal") for i in range(40)]
        pool += [self._record(300 + i, "hard_negative") for i in range(20)]
        pool += [self._record(400 + i, "unknown", "other") for i in range(10)]
        pool += [self._record(500 + i, "attack", "other", suite="prompt_injection_test") for i in range(8)]
        pool += [self._record(600, "normal", user_len=2000)]  # one long input
        return pool

    def test_stratified_covers_required_strata(self) -> None:
        sample = em.stratified_sample(self._pool(), 50, 20260728)
        cats = {r["metadata"]["labelCategory"] for r in sample}
        self.assertIn("attack", cats)
        self.assertIn("normal", cats)
        self.assertIn("hard_negative", cats)
        self.assertIn("unknown", cats)
        suites = {r["metadata"]["evaluationSuite"] for r in sample}
        self.assertIn("prompt_injection_test", suites)
        # long input guaranteed
        self.assertTrue(any(len(r["messages"][1]["content"]) > 1024 for r in sample))

    def test_stratified_is_deterministic(self) -> None:
        a = [r["sampleId"] for r in em.stratified_sample(self._pool(), 50, 20260728)]
        b = [r["sampleId"] for r in em.stratified_sample(self._pool(), 50, 20260728)]
        self.assertEqual(a, b)

    def test_full_set_returned_when_max_exceeds(self) -> None:
        pool = self._pool()
        self.assertEqual(len(em.stratified_sample(pool, len(pool), 1)), len(pool))


if __name__ == "__main__":
    unittest.main()
