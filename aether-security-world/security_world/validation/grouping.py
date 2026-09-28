"""八个→十二个 group key 的 L5 兼容层（设计 §10.1 / §10.3；REVISION 2）。

**实现在 L1**（``security_world/model/grouping.py``）：group key 派生是纯文档函数，
L4 的 ``assemble_episode`` 要在组装期把 key 值盖章进 episode 文档（Gate 2 的存在性
校验），而 L4 不能 import L5（设计 §3.1 分层 DAG）。本模块只做三件事：

1. **转发**全部公共符号（``GROUP_KEYS`` / ``episode_group_keys`` /
   ``policy_graph_hash`` / …），公共 API 与调用点不变；
2. **异常转译**：L1 的 :class:`~security_world.model.errors.GroupingError` 转回
   L5 的 :class:`~security_world.validation.errors.ValidationError`（reason code
   逐字保留，测试按它断言）；
3. **新增四个 REVISION 2 key 的派生出口**（``policy_family_id`` /
   ``workflow_family_id`` / ``invariant_family_id`` / ``generator_model_family``）。

**只有一个实现**：L5 自己另算一套会让"盖在 episode 上的 group_keys"与"split 实际
使用的 key 值"悄悄漂移——那种漂移正是泄漏审计静默失效的形态。
"""
from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType
from typing import Any

from ..model.grouping import (
    BENIGN_ATTACK_FAMILY,
    GROUP_KEYS,
    HANDCRAFTED_GENERATOR,
    INVARIANT_CATEGORY_TO_ATTACK_FAMILIES,
    INVARIANT_FAMILY_ID_PREFIX,
    POLICY_FAMILY_ID_PREFIX,
    STRATEGY_TO_GROUP_KEY as _STRATEGY_TO_GROUP_KEY,
    UNMAPPED_CATEGORY_PREFIX,
    WORKFLOW_FAMILY_ID_PREFIX,
    all_invariant_categories,
    app_domain_of,
    attack_family_of,
    derive_attack_family,
    generator_id,
    generator_model_family,
    invariant_categories_covered,
    invariant_family_hash,
    invariant_family_id,
    policy_family_id,
    policy_graph_hash,
    semantic_scenario_signature,
    violated_invariant_categories,
    workflow_family_id,
    workflow_template_hash,
)
from ..model.errors import GroupingError
from ..model.world import WorldInstance
from .errors import ValidationError

#: 策略 → holdout key（设计 §10.3 的表；与 L1 ``STRATEGY_TO_GROUP_KEY`` 逐字一致，
#: 由测试钉死，两边不许漂移）。只读视图：调用方改不了这张表。
STRATEGY_TO_GROUP_KEY: Mapping[str, str] = MappingProxyType(dict(_STRATEGY_TO_GROUP_KEY))


def _translated(call, *args, **kwargs):
    """把 L1 的 GroupingError 转成 L5 的 ValidationError（reason code 逐字保留）。"""
    try:
        return call(*args, **kwargs)
    except GroupingError as exc:
        raise ValidationError(exc.reason_code, exc.message) from exc


def episode_group_keys(
    episode: Any,
    *,
    world: WorldInstance | None = None,
    declared_attack_family: str | None = None,
) -> dict[str, str]:
    """一个 episode 的十二个 group key 值（缺失即抛 :class:`ValidationError`）。"""
    from ..model.grouping import episode_group_keys as _episode_group_keys

    return _translated(
        _episode_group_keys,
        episode,
        world=world,
        declared_attack_family=declared_attack_family,
    )


def attack_family_of(episode: Any, *, declared: str | None = None) -> str:
    """episode 的攻击族（spec 声明优先，否则从 oracle 输出派生）。"""
    from ..model.grouping import attack_family_of as _attack_family_of

    return _translated(_attack_family_of, episode, declared=declared)


def app_domain_of(episode: Any, world: WorldInstance | None = None) -> str:
    """应用域（只能从世界取；episode 不带它）。"""
    from ..model.grouping import app_domain_of as _app_domain_of

    return _translated(_app_domain_of, episode, world)


def semantic_scenario_signature(episode: Any, world: WorldInstance | None = None) -> str:
    """场景形状签名（标识符抽象成类型占位符）。"""
    from ..model.grouping import semantic_scenario_signature as _signature

    return _translated(_signature, episode, world)


__all__ = [
    "BENIGN_ATTACK_FAMILY",
    "GROUP_KEYS",
    "HANDCRAFTED_GENERATOR",
    "INVARIANT_CATEGORY_TO_ATTACK_FAMILIES",
    "INVARIANT_FAMILY_ID_PREFIX",
    "POLICY_FAMILY_ID_PREFIX",
    "STRATEGY_TO_GROUP_KEY",
    "UNMAPPED_CATEGORY_PREFIX",
    "WORKFLOW_FAMILY_ID_PREFIX",
    "all_invariant_categories",
    "app_domain_of",
    "attack_family_of",
    "derive_attack_family",
    "episode_group_keys",
    "generator_id",
    "generator_model_family",
    "invariant_categories_covered",
    "invariant_family_hash",
    "invariant_family_id",
    "policy_family_id",
    "policy_graph_hash",
    "semantic_scenario_signature",
    "violated_invariant_categories",
    "workflow_family_id",
    "workflow_template_hash",
]
