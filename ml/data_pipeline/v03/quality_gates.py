"""Quality gates: validate the ACCEPTED records' distribution against mission §9-10.

Run after generation (and after the final near-dedup pass) to confirm every gate is met on
the REALIZED accepted set, not just the planned cell budget.
"""
from __future__ import annotations
from collections import Counter
from typing import Any

from . import quotas


def evaluate(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute the realized distribution and check every gate. Returns a report dict."""
    verdict = Counter()
    family = Counter()
    gtype = Counter()
    inj_present = Counter()
    hard_neg = 0
    contrastive_members = 0
    pairs: Counter = Counter()
    other = 0
    malicious = 0

    for r in records:
        spec = r.get("spec") or {}
        gt = r.get("groundTruth") or {}
        v = gt.get("verdict", spec.get("verdict", ""))
        f = gt.get("attackFamily", spec.get("attackFamily", ""))
        g = spec.get("generationType", r.get("provenance", {}).get("generationType", ""))
        ip = spec.get("promptInjectionPresent", False)
        verdict[v] += 1
        family[f] += 1
        gtype[g] += 1
        if ip:
            inj_present["true"] += 1
        if g == "hard_negative":
            hard_neg += 1
        if g == "contrastive_member":
            contrastive_members += 1
        pid = r.get("pairId") or spec.get("pairId", "")
        if pid:
            pairs[pid] += 1
        if v == "malicious":
            malicious += 1
        if f == "other":
            other += 1

    total = len(records)
    contrastive_pairs = sum(1 for c in pairs.values() if c == 2)
    contrastive_pairs_broken = sum(1 for c in pairs.values() if c != 2)

    checks = {
        "malicious": ("min", verdict.get("malicious", 0), quotas.GATES_MIN["malicious"]),
        "safe": ("min", verdict.get("safe", 0), quotas.GATES_MIN["safe"]),
        "suspicious": ("min", verdict.get("suspicious", 0), quotas.GATES_MIN["suspicious"]),
        "unknown": ("min", verdict.get("unknown", 0), quotas.GATES_MIN["unknown"]),
        "hard_negative": ("min", hard_neg, quotas.GATES_MIN["hard_negative"]),
        "prompt_injection": ("min", inj_present.get("true", 0), quotas.GATES_MIN["prompt_injection"]),
        "contrastive_members": ("min", contrastive_members, quotas.GATES_MIN["contrastive"]),
    }
    gate_results = {}
    for name, (kind, got, want) in checks.items():
        gate_results[name] = {"got": got, "want": want, "pass": got >= want}

    # per-core-family >= 7k
    family_results = {}
    for fam in quotas._config.CORE_ATTACK_FAMILIES:
        got = family.get(fam, 0)
        family_results[fam] = {"got": got, "want": quotas.GATES_MIN_PER_CORE_FAMILY,
                               "pass": got >= quotas.GATES_MIN_PER_CORE_FAMILY}

    # other <= 5% of malicious
    other_frac = (other / malicious) if malicious else 0.0
    other_ok = other_frac <= quotas.OTHER_MAX_FRACTION_OF_MALICIOUS

    all_pass = (all(g["pass"] for g in gate_results.values())
                and all(g["pass"] for g in family_results.values())
                and other_ok
                and contrastive_pairs_broken == 0)

    return {
        "total": total,
        "verdict": dict(verdict),
        "generationType": dict(gtype),
        "family": dict(family),
        "hard_negative": hard_neg,
        "prompt_injection": inj_present.get("true", 0),
        "contrastive_members": contrastive_members,
        "contrastive_pairs": contrastive_pairs,
        "contrastive_pairs_broken": contrastive_pairs_broken,
        "other": other,
        "other_fraction_of_malicious": round(other_frac, 4),
        "other_pass": other_ok,
        "gates": gate_results,
        "per_family": family_results,
        "all_pass": all_pass,
    }


def format_report(report: dict[str, Any]) -> str:
    lines = [f"Quality gate report (total accepted: {report['total']:,})", ""]
    lines.append("Distribution gates:")
    for name, g in report["gates"].items():
        mark = "PASS" if g["pass"] else "FAIL"
        lines.append(f"  [{mark}] {name}: {g['got']:,} / {g['want']:,}")
    lines.append("")
    lines.append("Per-core-family (>=7k each):")
    for fam, g in report["per_family"].items():
        mark = "PASS" if g["pass"] else "FAIL"
        lines.append(f"  [{mark}] {fam}: {g['got']:,}")
    lines.append("")
    mark = "PASS" if report["other_pass"] else "FAIL"
    lines.append(f"[{mark}] other: {report['other']:,} ({report['other_fraction_of_malicious']:.1%} of malicious, <=5%)")
    mark = "PASS" if report["contrastive_pairs_broken"] == 0 else "FAIL"
    lines.append(f"[{mark}] contrastive pairs intact: {report['contrastive_pairs']:,} (broken: {report['contrastive_pairs_broken']})")
    lines.append("")
    lines.append(f"OVERALL: {'ALL PASS' if report['all_pass'] else 'GATES FAILED'}")
    return "\n".join(lines)


__all__ = ["evaluate", "format_report"]
