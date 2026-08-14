"""v0.3 quota matrix at TARGET=300,000 accepted samples.

Each cell is (verdict, attackFamily, generationType, promptInjectionPresent, count).
The spec_planner expands cells into individual GenerationSpec objects with rotating context
axes for diversity. Counts are TARGETS (ceil); the orchestrator's deficit scheduler fills
toward the global target and stops when all cells are saturated.

Gates satisfied (mission §9-10):
  malicious  >= 100k   -> 116k
  safe       >= 75k    -> 96k  (incl 60k hard_negative)
  suspicious >= 35k    -> 40k
  unknown    >= 35k    -> 48k
  hard_negative (genType)      >= 60k -> 60k
  promptInjectionPresent=true >= 60k -> 60k
  contrastive members          >= 50k -> 50k (25k pairs)
  each core attack family      >= 7k  -> 5k standard + 2k injection = 7k per family (minimum)
  other <= 5% of malicious     -> 4k / 116k = 3.4%
Total = 116 + 96 + 40 + 48 = 300k

Contrastive cells emit specs in PAIRS (count must be even; count/2 pairs). Each pair shares a
pairId and differs in exactly one axis (the contrastive axis), per mission §24.

long_context and family_boundary_pair are realized via context axes within standard/contrastive
cells (targetLengthClass=xl; contrastive axis = attackFamily), not separate genType cells, so they
do not need their own quota rows.
"""
from __future__ import annotations
from typing import Any

from . import config as _config

# generationType values mirror generation_spec.GENERATION_TYPES
GT_STANDARD = "standard_attack"
GT_HARD_NEG = "hard_negative"
GT_CONTRASTIVE = "contrastive_member"
GT_INJECTION = "prompt_injection_carrier"
GT_UNKNOWN = "unknown_insufficient"


def _cells() -> list[tuple[str, str, str, bool, int]]:
    c: list[tuple[str, str, str, bool, int]] = []
    fams = _config.CORE_ATTACK_FAMILIES  # 12 families

    # ---- malicious: 116k ----
    # standard_attack, no injection, 5k per family = 60k
    for f in fams:
        c.append(("malicious", f, GT_STANDARD, False, 5_000))
    # prompt_injection_carrier, 2k per family = 24k
    for f in fams:
        c.append(("malicious", f, GT_INJECTION, True, 2_000))
    # contrastive members (malicious side) = 28k -> 14k pairs, spread across families
    for f in fams:
        c.append(("malicious", f, GT_CONTRASTIVE, False, 2_000))  # 12 * 2k = 24k
    c.append(("malicious", f, GT_CONTRASTIVE, False, 4_000))  # top up one family -> 28k total
    # "other" family (capped) = 4k
    c.append(("malicious", "other", GT_STANDARD, False, 2_000))
    c.append(("malicious", "other", GT_INJECTION, True, 2_000))
    # malicious subtotal: 60 + 24 + 28 + 4 = 116k

    # ---- safe: 96k ----
    # hard_negative (no injection) = 60k, family=benign (safe by context, not by text)
    c.append(("safe", "benign", GT_HARD_NEG, False, 60_000))
    # standard safe = 10k
    c.append(("safe", "benign", GT_STANDARD, False, 10_000))
    # prompt_injection in safe context = 16k (decorrelated: injection text but safe verdict)
    c.append(("safe", "benign", GT_INJECTION, True, 16_000))
    # contrastive (safe side) = 10k -> 5k pairs
    c.append(("safe", "benign", GT_CONTRASTIVE, False, 10_000))
    # safe subtotal: 60 + 10 + 16 + 10 = 96k

    # ---- suspicious: 40k ----
    c.append(("suspicious", "benign", GT_STANDARD, False, 10_000))  # benign-family suspicious
    # suspicious with attack families (partial indicators)
    for f in fams[:6]:
        c.append(("suspicious", f, GT_STANDARD, False, 1_000))  # 6k
    c.append(("suspicious", "benign", GT_INJECTION, True, 15_000))
    c.append(("suspicious", "benign", GT_CONTRASTIVE, False, 9_000))  # 9k members
    # suspicious subtotal: 10 + 6 + 15 + 9 = 40k

    # ---- unknown: 48k ----
    c.append(("unknown", "benign", GT_UNKNOWN, False, 38_000))
    c.append(("unknown", "benign", GT_INJECTION, True, 5_000))
    c.append(("unknown", "benign", GT_CONTRASTIVE, False, 5_000))
    # unknown subtotal: 38 + 5 + 5 = 48k

    return c


def cells() -> list[dict[str, Any]]:
    """Return the quota matrix as a list of cell dicts (stable order)."""
    out: list[dict[str, Any]] = []
    for verdict, family, gtype, inj, count in _cells():
        out.append({
            "verdict": verdict,
            "attackFamily": family,
            "generationType": gtype,
            "promptInjectionPresent": inj,
            "count": count,
        })
    return out


def gate_summary() -> dict[str, int]:
    """Aggregate the matrix into the mission's gate dimensions for validation."""
    cs = cells()
    g = {
        "malicious": 0, "safe": 0, "suspicious": 0, "unknown": 0,
        "hard_negative": 0, "prompt_injection": 0, "contrastive": 0, "other": 0,
        "total": 0,
    }
    per_family: dict[str, int] = {}
    for c in cs:
        v, f, gt, inj, n = c["verdict"], c["attackFamily"], c["generationType"], c["promptInjectionPresent"], c["count"]
        g[v] += n
        g["total"] += n
        if gt == GT_HARD_NEG:
            g["hard_negative"] += n
        if inj:
            g["prompt_injection"] += n
        if gt == GT_CONTRASTIVE:
            g["contrastive"] += n
        if f == "other":
            g["other"] += n
        per_family[f] = per_family.get(f, 0) + n
    g["per_family"] = per_family
    return g


GATES_MIN = {
    "malicious": 100_000,
    "safe": 75_000,
    "suspicious": 35_000,
    "unknown": 35_000,
    "hard_negative": 60_000,
    "prompt_injection": 60_000,
    "contrastive": 50_000,
}
# each core family >= 7k
GATES_MIN_PER_CORE_FAMILY = 7_000
# other <= 5% of malicious
OTHER_MAX_FRACTION_OF_MALICIOUS = 0.05


def validate() -> list[str]:
    """Return a list of gate violations (empty = all gates satisfied)."""
    g = gate_summary()
    violations: list[str] = []
    for k, mn in GATES_MIN.items():
        if g[k] < mn:
            violations.append(f"{k}={g[k]} < min {mn}")
    for f in _config.CORE_ATTACK_FAMILIES:
        if g["per_family"].get(f, 0) < GATES_MIN_PER_CORE_FAMILY:
            violations.append(f"family {f}={g['per_family'].get(f,0)} < min {GATES_MIN_PER_CORE_FAMILY}")
    if g["malicious"] > 0:
        frac = g["other"] / g["malicious"]
        if frac > OTHER_MAX_FRACTION_OF_MALICIOUS:
            violations.append(f"other={g['other']} is {frac:.1%} of malicious={g['malicious']} > 5%")
    return violations


__all__ = ["cells", "gate_summary", "validate", "GATES_MIN", "GT_STANDARD", "GT_HARD_NEG", "GT_CONTRASTIVE", "GT_INJECTION", "GT_UNKNOWN"]
