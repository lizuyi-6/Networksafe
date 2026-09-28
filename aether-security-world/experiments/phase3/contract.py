"""Phase 3 experiment contract (frozen constants + policy guards).

Everything here is pre-registered protocol: label semantics, data usage policy,
variant algebra, OOD protection. Training/evaluation code must import from this
module instead of redefining any of it.
"""
from __future__ import annotations

import enum

# ---------------------------------------------------------------- labels
class Verdict(str, enum.Enum):
    """Observable decision labels (ASW oracle_output.observable_decision).

    world_truth is a DIFFERENT layer (oracle-internal); the supervised target is
    the observable decision only. There is no third "world truth" class here.
    """

    ATTACK = "attack"
    SAFE = "safe"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"


VERDICT_VALUES = (Verdict.ATTACK.value, Verdict.SAFE.value, Verdict.INSUFFICIENT_EVIDENCE.value)

# Model output JSON keys (frozen target contract)
TARGET_KEYS = ("verdict", "attack_family")
FAMILY_NONE = "none"

# ---------------------------------------------------------------- splits
TRAIN = "train"
IID_DEV = "iid-dev"
WORLD_OOD = "world-ood"
MECHANISM_OOD = "mechanism-ood"
GENERATOR_OOD = "generator-ood"
WORKFLOW_OOD = "workflow-ood"  # unsupported_in_asw_v0.1 (0 lines)

TRAIN_SPLITS = (TRAIN,)
IID_EVAL_SPLITS = (IID_DEV,)
FINAL_EVAL_SPLITS = (WORLD_OOD, MECHANISM_OOD, GENERATOR_OOD)

RELEASE_ID = "asw-v0.1"
RELEASE_TOTAL = 60902
PRODUCTION_TOTAL = 54370


class Usage(str, enum.Enum):
    PARAM_UPDATE = "param_update"
    CHECKPOINT_SELECTION = "checkpoint_selection"
    FINAL_EVALUATION_ONLY = "final_evaluation_only"
    UNSUPPORTED = "unsupported"


DATA_USAGE_POLICY = {
    TRAIN: Usage.PARAM_UPDATE,
    IID_DEV: Usage.CHECKPOINT_SELECTION,
    WORLD_OOD: Usage.FINAL_EVALUATION_ONLY,
    MECHANISM_OOD: Usage.FINAL_EVALUATION_ONLY,
    GENERATOR_OOD: Usage.FINAL_EVALUATION_ONLY,
    WORKFLOW_OOD: Usage.UNSUPPORTED,
}

# Generator-OOD stays sealed even after M3 freeze (master brief §23/§64).
GENERATOR_OOD_SEALED_THIS_RUN = True


class SplitPolicyError(RuntimeError):
    """Raised when a usage mode violates the data usage policy (brief §22)."""


def assert_split_allowed(split: str, mode: str) -> None:
    """Code-level OOD protection (brief §22).

    mode: one of "param_update", "checkpoint_selection", "hyperparameter_search",
    "early_stopping", "final_evaluation".
    Raises SplitPolicyError when split usage conflicts with the mode.
    """
    usage = DATA_USAGE_POLICY.get(split)
    if usage is None:
        raise SplitPolicyError(f"unknown split: {split}")
    if mode in ("param_update",):
        if usage is not Usage.PARAM_UPDATE:
            raise SplitPolicyError(f"split {split} may not be used for {mode}")
        return
    if mode in ("checkpoint_selection", "hyperparameter_search", "early_stopping"):
        if usage is not Usage.CHECKPOINT_SELECTION:
            raise SplitPolicyError(f"split {split} may not be used for {mode} (OOD protection)")
        return
    if mode == "final_evaluation":
        if usage is Usage.UNSUPPORTED:
            raise SplitPolicyError(f"split {split} is unsupported in {RELEASE_ID}")
        if usage is Usage.PARAM_UPDATE:
            raise SplitPolicyError(f"split {split} is not an evaluation split")
        if split == GENERATOR_OOD and GENERATOR_OOD_SEALED_THIS_RUN:
            raise SplitPolicyError("generator-ood is sealed for this master run (brief §23/§64)")
        return
    raise SplitPolicyError(f"unknown mode: {mode}")


# ---------------------------------------------------------------- variants
class Variant(str, enum.Enum):
    BASE = "base"
    CRITICAL = "critical_intervention"
    IRRELEVANT = "irrelevant_perturbation"
    MASKED = "evidence_masked"
    TRUST = "trust_provenance_variant"


ALL_VARIANTS = tuple(v.value for v in Variant)

# Counterfactual relation groups (counterfactual audit, release asw-v0.1):
# 584 axes total; 573 clean single-axis, 11 mixed-base. Mixed-base pairs must
# NOT be treated as single-variable interventions in the M3 objective (§29).
CF_AXIS_TOTAL = 584
CF_AXIS_CLEAN = 573
CF_AXIS_MIXED = 11


class CFGroup:
    """One (counterfactual_family_id, world_id) episode group in one split."""

    __slots__ = ("cf_family", "world_id", "split", "members")

    def __init__(self, cf_family: str, world_id: str, split: str):
        self.cf_family = cf_family
        self.world_id = world_id
        self.split = split
        self.members: dict[str, dict] = {}

    def complete(self) -> bool:
        return all(v in self.members for v in ALL_VARIANTS)

    def mixed_base(self) -> bool:
        """True when this group is one of the 11 mixed-base groups (declared in
        the release counterfactual audit) - identified by the mixed_base flag in
        the group index, never re-derived at training time."""
        return bool(self.members.get(Variant.CRITICAL.value, {}).get("_mixed_base", False))


# ---------------------------------------------------------------- methods
class Method(str, enum.Enum):
    M0_ZERO_SHOT = "m0-zero-shot"
    M1_ORDINARY = "m1-ordinary-sft"
    M2_STATEFUL = "m2-stateful-sft"
    M3_STATEFUL_CF = "m3-stateful-counterfactual"


# Methods with genuine algorithmic differences are required (brief §24).
METHODS_WITH_REAL_DIFFERENCE = (Method.M1_ORDINARY, Method.M2_STATEFUL, Method.M3_STATEFUL_CF)

# ---------------------------------------------------------------- seeding
PRIMARY_SEED = 20260921
BOOTSTRAP_SEED = 20260921
BOOTSTRAP_RESAMPLES = (2000, 5000, 10000)
