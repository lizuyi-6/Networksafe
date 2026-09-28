"""Frozen metric implementations for Phase 3 (master brief §38/§39).

Primary metrics (frozen before any training):
  P1 Observable Decision Macro-F1
  P2 Critical Pair Correctness (pair-level, clean groups, base-mode pairing)
  P3 Counterfactual Family Consistency (irrelevant == base-mode prediction)
  P4 Evidence Sufficiency Accuracy (binary: insufficient_evidence abstention)

Secondary: accuracy, attack recall, safe FPR, insufficient recall, raw/correct
irrelevant invariance, masking consistency, stale/conflicting robustness,
trusted-vs-untrusted preference, attackFamily macro-F1, parse/schema rates.

All metrics take (samples, predictions) and never look at oracle-internal
fields beyond observable_decision / attack_family / availability metadata.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from .contract import Verdict

ABSTAIN = Verdict.INSUFFICIENT_EVIDENCE.value


def _macro_f1(pairs: list[tuple[str, str]], classes: set[str] | None = None) -> tuple[float, dict[str, dict]]:
    """pairs of (pred, gt). Returns (macro_f1, per_class).

    Default class set = classes observed in ground truth (predictions outside
    the gt class set count as FP against those classes; junk prediction labels
    like 'none' never dilute the macro average)."""
    if classes is None:
        classes = {gt for _, gt in pairs}
        classes.discard("")
    per: dict[str, dict] = {}
    for c in sorted(classes):
        tp = sum(1 for p, g in pairs if p == c and g == c)
        fp = sum(1 for p, g in pairs if p == c and g != c)
        fn = sum(1 for p, g in pairs if p != c and g == c)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per[c] = {"tp": tp, "fp": fp, "fn": fn, "precision": round(precision, 4),
                  "recall": round(recall, 4), "f1": round(f1, 4)}
    macro = sum(v["f1"] for v in per.values()) / len(per) if per else 0.0
    return macro, per


def _round(x: float | None, n: int = 4) -> float | None:
    return round(x, n) if x is not None else None


def compute_metrics(
    samples: list[Any],
    predictions: list[dict[str, Any]],
) -> dict[str, Any]:
    """samples: loader.Sample-like objects (oracle metadata).
    predictions: [{episode_id, pred_verdict, pred_attack_family, parse_ok, schema_ok}].
    """
    by_id = {p["episode_id"]: p for p in predictions}
    rows = []
    for sample in samples:
        pred = by_id.get(sample.episode_id)
        if pred is None:
            raise KeyError(f"missing prediction for {sample.episode_id}")
        rows.append({
            "episode_id": sample.episode_id,
            "world_id": sample.world_id,
            "group_key": sample.group_key,
            "variant_type": sample.variant_type,
            "availability": sample.evidence_availability,
            "gt_verdict": sample.oracle_decision,
            "gt_family": sample.attack_family,
            "pred_verdict": pred["pred_verdict"],
            "pred_family": pred.get("pred_attack_family"),
            "parse_ok": pred["parse_ok"],
            "schema_ok": pred["schema_ok"],
        })

    n_total = len(rows)
    valid = [r for r in rows if r["schema_ok"]]
    n_valid = len(valid)

    out: dict[str, Any] = {
        "sample_count": n_total,
        "schema_valid_n": n_valid,
        "json_parse_rate": _round(sum(r["parse_ok"] for r in rows) / n_total) if n_total else None,
        "schema_valid_rate": _round(n_valid / n_total) if n_total else None,
    }
    if not n_valid:
        return out

    pairs = [(r["pred_verdict"], r["gt_verdict"]) for r in valid]
    p1_macro, p1_per = _macro_f1(pairs, classes=set((v for v in Verdict)))
    out["P1_observable_decision_macro_f1"] = _round(p1_macro)
    out["P1_per_class"] = p1_per

    # group structures (world-scoped within the evaluated split rows)
    groups: dict[tuple, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for r in valid:
        groups[r["group_key"]][r["variant_type"]].append(r)

    def base_mode(group_rows: dict[str, list[dict]]) -> tuple[str | None, bool]:
        base_rows = group_rows.get("base", [])
        if not base_rows:
            return None, False
        counts = Counter(r["pred_verdict"] for r in base_rows)
        mode_pred, _ = counts.most_common(1)[0]
        mode_gt = Counter(r["gt_verdict"] for r in base_rows).most_common(1)[0][0]
        return mode_pred, mode_pred == mode_gt

    # P2: critical pair correctness on clean groups (mixed excluded upstream)
    pair_total = pair_correct = 0
    p2_groups = 0
    for key, group_rows in groups.items():
        if not group_rows.get("critical_intervention"):
            continue
        mode_pred, mode_ok = base_mode(group_rows)
        if mode_pred is None:
            continue
        p2_groups += 1
        for r in group_rows["critical_intervention"]:
            pair_total += 1
            pair_correct += 1 if (mode_ok and r["pred_verdict"] == r["gt_verdict"]) else 0
    out["P2_critical_pair_correctness"] = _round(pair_correct / pair_total) if pair_total else None
    out["P2_n_pairs"] = pair_total
    out["P2_n_groups"] = p2_groups

    # P3: counterfactual family consistency (irrelevant == base-mode prediction)
    irr_total = irr_consistent = irr_base_ok = 0
    for group_rows in groups.values():
        if not group_rows.get("irrelevant_perturbation"):
            continue
        mode_pred, mode_ok = base_mode(group_rows)
        if mode_pred is None:
            continue
        for r in group_rows["irrelevant_perturbation"]:
            irr_total += 1
            irr_consistent += 1 if r["pred_verdict"] == mode_pred else 0
            irr_base_ok += 1 if mode_ok else 0
    out["P3_counterfactual_family_consistency"] = _round(irr_consistent / irr_total) if irr_total else None
    out["P3_n"] = irr_total

    # P4: evidence sufficiency accuracy (binary abstention)
    abstain_tp = sum(1 for r in valid if r["gt_verdict"] == ABSTAIN and r["pred_verdict"] == ABSTAIN)
    abstain_tn = sum(1 for r in valid if r["gt_verdict"] != ABSTAIN and r["pred_verdict"] != ABSTAIN)
    out["P4_evidence_sufficiency_accuracy"] = _round((abstain_tp + abstain_tn) / n_valid)

    # ---- secondary ----
    acc = sum(1 for r in valid if r["pred_verdict"] == r["gt_verdict"]) / n_valid
    out["accuracy"] = _round(acc)

    def subset_rate(rows_: list[dict], gt: str, pred: str) -> tuple[int, int, float | None]:
        den = sum(1 for r in rows_ if r["gt_verdict"] == gt)
        num = sum(1 for r in rows_ if r["gt_verdict"] == gt and r["pred_verdict"] == pred)
        return num, den, (num / den) if den else None

    num, den, val = subset_rate(valid, Verdict.ATTACK.value, Verdict.ATTACK.value)
    out["attack_recall"] = {"numerator": num, "denominator": den, "value": _round(val)}
    num, den, val = subset_rate(valid, Verdict.SAFE.value, Verdict.ATTACK.value)
    out["safe_fpr"] = {"numerator": num, "denominator": den, "value": _round(val)}
    num, den, val = subset_rate(valid, ABSTAIN, ABSTAIN)
    out["insufficient_recall"] = {"numerator": num, "denominator": den, "value": _round(val)}

    # raw / correct irrelevant invariance (secondary view of P3 with flags)
    out["raw_irrelevant_invariance"] = out["P3_counterfactual_family_consistency"]
    correct_irr = []
    for group_rows in groups.values():
        if not group_rows.get("irrelevant_perturbation"):
            continue
        mode_pred, mode_ok = base_mode(group_rows)
        if mode_pred is None or not mode_ok:
            continue
        for r in group_rows["irrelevant_perturbation"]:
            correct_irr.append(1 if r["pred_verdict"] == mode_pred else 0)
    out["correct_irrelevant_invariance"] = _round(sum(correct_irr) / len(correct_irr)) if correct_irr else None

    # masking consistency: accuracy on evidence_masked variant
    masked = [r for r in valid if r["variant_type"] == "evidence_masked"]
    out["masking_consistency"] = _round(
        sum(1 for r in masked if r["pred_verdict"] == r["gt_verdict"]) / len(masked)) if masked else None

    # robustness subsets
    for name, level in (("stale_evidence_robustness", "stale"),
                        ("conflicting_evidence_accuracy", "contradictory")):
        sub = [r for r in valid if r["availability"] == level]
        out[name] = _round(sum(1 for r in sub if r["pred_verdict"] == r["gt_verdict"]) / len(sub)) if sub else None

    # trusted-vs-untrusted preference on trust_provenance_variant
    trust_rows = [r for r in valid if r["variant_type"] == "trust_provenance_variant"]
    num, den, val = subset_rate(trust_rows, ABSTAIN, ABSTAIN)
    out["trusted_vs_untrusted_preference"] = {
        "insufficient_recall": {"numerator": num, "denominator": den, "value": _round(val)},
        "accuracy": _round(sum(1 for r in trust_rows if r["pred_verdict"] == r["gt_verdict"]) / len(trust_rows)) if trust_rows else None,
    }

    # attackFamily macro-F1 over attack rows (observed gt families)
    fam_pairs = [(r["pred_family"] or "", r["gt_family"]) for r in valid if r["gt_verdict"] == Verdict.ATTACK.value]
    fam_macro, fam_per = _macro_f1(fam_pairs)
    out["attack_family_macro_f1"] = _round(fam_macro)
    out["attack_family_per_class"] = fam_per

    # confusion matrix raw counts (gt rows x pred columns, incl. unparsed None)
    cm: dict[str, dict[str, int]] = {}
    for gt in (v.value for v in Verdict):
        cm[gt] = {p: 0 for p in (v.value for v in Verdict)}
        cm[gt][None] = 0  # type: ignore[assignment]
    for r in rows:
        if r["gt_verdict"] in cm and r["pred_verdict"] in cm[r["gt_verdict"]]:
            cm[r["gt_verdict"]][r["pred_verdict"]] += 1
    out["confusion_matrix_raw_counts"] = cm
    return out
