"""十二个 group key 的确定性派生（设计 §10.1；REVISION 2 任务书 A7）。

A7 的要求逐条落成可证伪断言：

1. ``configs/default.json`` 的 ``leakage_control.group_keys`` 与 ``GROUP_KEYS``
   逐字一致（12 个，含 4 个新键）；
2. 四个新 family id 与对应 hash **严格同源**（``policy_family_id`` 就是
   ``"PF-" + policy_graph_hash[:12]``），不存在第二套派生；
3. ``generator_model_family`` 按声明规则取模型家族段；
4. 派生是纯函数：同输入同输出，跨 ``PYTHONHASHSEED`` 稳定；
5. 缺世界时**宁可失败也不猜**（猜出来的 key 会让泄漏审计静默失效）。
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
from asw_worlds import make_world

from security_world.model import (
    GROUP_KEYS,
    GroupingError,
    episode_group_keys,
    generator_id,
    generator_model_family,
    invariant_family_id,
    policy_family_id,
    policy_graph_hash,
    workflow_family_id,
    workflow_template_hash,
)
from security_world.model.grouping import (
    INVARIANT_FAMILY_ID_PREFIX,
    POLICY_FAMILY_ID_PREFIX,
    WORKFLOW_FAMILY_ID_PREFIX,
)
from security_world.validation import STRATEGY_TO_GROUP_KEY

PROJECT_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture()
def world():
    return make_world(world_id="W-GROUP")


def _stub_episode(world, *, provenance=None, action=None, oracle_output=None):
    from asw_worlds import make_action

    return {
        "counterfactual_family_id": "CF-" + "0" * 12,
        "world_family_id": world.world_family_id,
        "action": action or make_action("read", "ACT-001", resource_id="RES-001"),
        "oracle_output": oracle_output or {"world_truth": "safe", "violated_invariants": []},
        "provenance": provenance,
    }


# --------------------------------------------------------------------------- #
# 键集合与配置一致
# --------------------------------------------------------------------------- #
def test_group_keys_match_the_config() -> None:
    config = json.loads(
        (PROJECT_ROOT / "configs" / "default.json").read_text(encoding="utf-8")
    )
    assert tuple(config["leakage_control"]["group_keys"]) == GROUP_KEYS


def test_the_twelve_keys_are_the_eight_originals_plus_four_new() -> None:
    assert set(GROUP_KEYS) == {
        # 原有 8 个
        "counterfactual_family_id", "world_family_id", "policy_graph_hash",
        "workflow_template_hash", "attack_family", "semantic_scenario_signature",
        "app_domain", "generator_id",
        # REVISION 2 新增 4 个
        "generator_model_family", "policy_family_id", "workflow_family_id",
        "invariant_family_id",
    }


def test_strategy_map_is_unchanged_eight_strategies() -> None:
    """八种 leave-key-out 策略不变（episode.split_assignments 的八行契约不动）。"""
    assert dict(STRATEGY_TO_GROUP_KEY) == {
        "iid": "counterfactual_family_id",
        "world_ood": "world_family_id",
        "app_ood": "app_domain",
        "workflow_ood": "workflow_template_hash",
        "policy_ood": "policy_graph_hash",
        "attack_ood": "attack_family",
        "evidence_ood": "semantic_scenario_signature",
        "generator_ood": "generator_id",
    }
    config = json.loads(
        (PROJECT_ROOT / "configs" / "default.json").read_text(encoding="utf-8")
    )
    assert config["leakage_control"]["strategy_to_group_key"] == dict(STRATEGY_TO_GROUP_KEY)
    # 四个新键的"映射用途说明"必须写在配置里（A7 的文档要求）
    purposes = config["leakage_control"]["group_key_purposes"]
    for key in ("generator_model_family", "policy_family_id", "workflow_family_id",
                "invariant_family_id"):
        assert key in purposes and purposes[key].strip(), key


# --------------------------------------------------------------------------- #
# 新键的派生规则
# --------------------------------------------------------------------------- #
def test_policy_family_id_is_the_short_form_of_the_policy_graph_hash(world) -> None:
    """严格同源：family id 就是 hash 的前 12 位——不可能与 hash 漂移。"""
    digest = policy_graph_hash(world)
    assert policy_family_id(world) == POLICY_FAMILY_ID_PREFIX + digest[:12]
    assert policy_family_id(world).startswith("PF-")
    assert len(policy_family_id(world)) == 15


def test_workflow_family_id_is_the_short_form_of_the_workflow_hash(world) -> None:
    digest = workflow_template_hash(world)
    assert workflow_family_id(world) == WORKFLOW_FAMILY_ID_PREFIX + digest[:12]


def test_invariant_family_id_form_and_determinism(world) -> None:
    first = invariant_family_id(world)
    assert first.startswith(INVARIANT_FAMILY_ID_PREFIX)
    assert len(first) == 15
    assert first[3:].isalpha() is False and all(c in "0123456789abcdef" for c in first[3:])
    assert invariant_family_id(world) == first  # 纯函数


def test_invariant_family_id_separates_different_invariant_sets() -> None:
    """换一条不变量必须换族（否则"同族不同规则"会静默跨 split）。"""
    base = make_world(world_id="W-INV-A")
    other = make_world(
        world_id="W-INV-B",
        invariants=(
            {
                "invariant_id": "INV-EXTRA",
                "category": "authorization",
                "applies_to": ["read"],
                "severity": "high",
                "description": "an extra invariant",
                "expr": {"op": "lit", "value": True},
            },
        ),
    )
    assert invariant_family_id(base) != invariant_family_id(other)


def test_generator_model_family_takes_the_family_segment() -> None:
    episode = _stub_episode(
        make_world(world_id="W-GEN"),
        provenance={"generator_provenance": {
            "model": "deepseek-v4-flash", "model_version": "2026-08-01",
            "prompt_version": "0.1", "prompt_hash": "0" * 64,
        }},
    )
    assert generator_id(episode) == "deepseek-v4-flash@2026-08-01"
    assert generator_model_family(episode) == "deepseek"


def test_generator_model_family_falls_back_to_handcrafted() -> None:
    episode = _stub_episode(make_world(world_id="W-GEN2"), provenance=None)
    assert generator_id(episode) == "handcrafted"
    assert generator_model_family(episode) == "handcrafted"


# --------------------------------------------------------------------------- #
# 汇总与失败模式
# --------------------------------------------------------------------------- #
def test_episode_group_keys_returns_all_twelve(world) -> None:
    keys = episode_group_keys(_stub_episode(world), world=world)
    assert set(keys) == set(GROUP_KEYS)
    assert all(isinstance(value, str) and value for value in keys.values())
    # 与 split 分配同一套函数：派生值必须自洽
    assert keys["policy_family_id"] == policy_family_id(world)
    assert keys["app_domain"] == world.application_domain


def test_episode_group_keys_refuses_to_guess_without_a_world(world) -> None:
    """缺世界 ⇒ GroupingError（L5 转成 ValidationError），绝不猜一个 key 值。"""
    with pytest.raises(GroupingError):
        episode_group_keys(_stub_episode(world), world=None)


def test_episode_group_keys_requires_family_ids(world) -> None:
    episode = _stub_episode(world)
    episode.pop("counterfactual_family_id")
    with pytest.raises(GroupingError):
        episode_group_keys(episode, world=world)


def test_derivation_is_stable_across_pythonhashseed() -> None:
    """group key 派生跨 ``PYTHONHASHSEED`` 稳定（泄漏审计的确定性前提）。"""
    import os

    program = (
        "import sys;sys.path.insert(0,sys.argv[1]);sys.path.insert(0,sys.argv[2]);"
        "from asw_worlds import make_world;"
        "from security_world.model import episode_group_keys;"
        "from security_world.model.canonical import canonical_json;"
        "w=make_world(world_id='W-HASH');"
        "e={'counterfactual_family_id':'CF-'+'0'*12,'world_family_id':w.world_family_id,"
        "'action':{'operation':'read','actor':'ACT-001','resource':'RES-001'},"
        "'oracle_output':{'world_truth':'safe','violated_invariants':[]},'provenance':None};"
        "print(canonical_json(episode_group_keys(e, world=w)))"
    )
    unit_dir = str(Path(__file__).resolve().parent)
    digests = set()
    for hash_seed in ("0", "1", "424242"):
        env = dict(os.environ)
        env["PYTHONHASHSEED"] = hash_seed
        completed = subprocess.run(
            [sys.executable, "-c", program, str(PROJECT_ROOT), unit_dir],
            capture_output=True,
            text=True,
            env=env,
            check=True,
        )
        digests.add(completed.stdout.strip())
    assert len(digests) == 1, f"不同 PYTHONHASHSEED 得到不同 group key: {digests}"
