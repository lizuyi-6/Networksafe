"""Data usage policy + OOD protection guards (master brief §21/§22)."""
import pytest

from experiments.phase3 import contract
from experiments.phase3.contract import SplitPolicyError, assert_split_allowed


def test_train_updates_params_only_from_train_split():
    assert_split_allowed(contract.TRAIN, "param_update")
    for ood in (contract.WORLD_OOD, contract.MECHANISM_OOD, contract.GENERATOR_OOD, contract.IID_DEV):
        with pytest.raises(SplitPolicyError):
            assert_split_allowed(ood, "param_update")


def test_checkpoint_selection_only_on_iid_dev():
    assert_split_allowed(contract.IID_DEV, "checkpoint_selection")
    for ood in (contract.WORLD_OOD, contract.MECHANISM_OOD, contract.GENERATOR_OOD):
        with pytest.raises(SplitPolicyError):
            assert_split_allowed(ood, "checkpoint_selection")
        with pytest.raises(SplitPolicyError):
            assert_split_allowed(ood, "hyperparameter_search")
        with pytest.raises(SplitPolicyError):
            assert_split_allowed(ood, "early_stopping")


def test_final_evaluation_forbidden_for_generator_ood_this_run():
    assert_split_allowed(contract.WORLD_OOD, "final_evaluation")
    assert_split_allowed(contract.MECHANISM_OOD, "final_evaluation")
    with pytest.raises(SplitPolicyError):
        assert_split_allowed(contract.GENERATOR_OOD, "final_evaluation")


def test_workflow_ood_unsupported_in_v01():
    with pytest.raises(SplitPolicyError):
        assert_split_allowed(contract.WORKFLOW_OOD, "final_evaluation")


def test_unknown_split_and_mode_raise():
    with pytest.raises(SplitPolicyError):
        assert_split_allowed("not-a-split", "param_update")
    with pytest.raises(SplitPolicyError):
        assert_split_allowed(contract.TRAIN, "not-a-mode")


def test_policy_table_matches_brief():
    assert contract.DATA_USAGE_POLICY[contract.TRAIN] is contract.Usage.PARAM_UPDATE
    assert contract.DATA_USAGE_POLICY[contract.IID_DEV] is contract.Usage.CHECKPOINT_SELECTION
    assert contract.DATA_USAGE_POLICY[contract.WORLD_OOD] is contract.Usage.FINAL_EVALUATION_ONLY
    assert contract.DATA_USAGE_POLICY[contract.MECHANISM_OOD] is contract.Usage.FINAL_EVALUATION_ONLY
    assert contract.DATA_USAGE_POLICY[contract.GENERATOR_OOD] is contract.Usage.FINAL_EVALUATION_ONLY
    assert contract.DATA_USAGE_POLICY[contract.WORKFLOW_OOD] is contract.Usage.UNSUPPORTED


def test_label_semantics_frozen():
    assert contract.VERDICT_VALUES == ("attack", "safe", "insufficient_evidence")
    assert contract.TARGET_KEYS == ("verdict", "attack_family")
    assert contract.CF_AXIS_CLEAN == 573 and contract.CF_AXIS_MIXED == 11
