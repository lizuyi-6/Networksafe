"""``diff_worlds``：单变量反事实的机械强制（设计 §9.2 / D4）。

需求 §29-5「counterfactual 是否只改变一个关键变量」必须是**机械断言**，不是人工
review：``diff_worlds(base, variant).changed_paths ==
(intervention.intervention_variable,)``（§9.2）。因此 diff 只用一个信息源——两边
世界的 :meth:`~security_world.model.world.WorldInstance.ref_universe` 与
:meth:`~security_world.model.world.WorldInstance.resolve`（§4.3 的唯一路径 BNF），
逐路径比较**规范化 JSON**（键序不影响判定；类型严格，``1`` 不等于 ``"1"``，
``true`` 不等于 ``1``——D6 不许隐式转换）。

两类路径**不参与**比较，否则"恰好一个变量"的断言在结构上不可能成立：

1. **中间 Mapping 节点**（``session.SES-001.privilege_snapshot``）：它的变化完全
   由叶子（``...privilege_snapshot.privilege_version``）承载，两边都报等于把一次
   干预记成两次。只在**最大可寻址路径**（没有被更长路径扩展的路径）上比较。
2. **已注册实体的容器路径**（``workflow.WFL-ORDER.instances``）：数组元素是
   ``workflow_instance`` 实体的文档，而那些实体有自己的 ID 视图
   （``workflow_instance.WFI-001.current_state``）。容器路径是**存储布局**不是
   状态变量——改一个实例的当前态必然改掉整个数组的规范化 JSON，若把它算进
   ``changed_paths``，§9.2 的单变量断言对 ``workflow_instance.*`` 轴永假。
   容器内实体的增删仍能被发现：新增/消失实体的叶子路径只在一侧的 ref 全域里。

只在一侧可解析的路径（可选字段被写没/新写出来）算**已变更**：掩蔽或增删一个字段
和改一个值同样改变世界状态，静默忽略它会让"只改一个变量"的断言漏过真。
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from ..model.canonical import canonical_json
from ..model.errors import RefResolutionError
from ..model.refs import ENTITY_TYPES
from ..model.world import WorldInstance
from .errors import ExpansionError

#: "这一侧没有这个路径"的哨兵（不能用 ``None``：世界状态里 ``None`` 是合法值）。
_ABSENT = object()


@dataclass(frozen=True)
class WorldDiff:
    """两个世界在 ID 视图状态路径上的差异（设计 §15.3）。"""

    changed_paths: tuple[str, ...]

    def is_single(self, path: str) -> bool:
        """是否**恰好只有** ``path`` 一条路径发生变化（D4 的断言原语）。"""
        return self.changed_paths == (path,)

    def is_empty(self) -> bool:
        """世界状态是否零变化（``irrelevant_perturbation`` / ``evidence_masked``
        的不变量：只有 observation 变，世界不变）。"""
        return not self.changed_paths

    def __len__(self) -> int:
        return len(self.changed_paths)

    def __iter__(self):
        return iter(self.changed_paths)

    def to_document(self) -> dict[str, Any]:
        return {"changed_paths": list(self.changed_paths)}


def diff_worlds(a: WorldInstance, b: WorldInstance) -> WorldDiff:
    """逐路径比较两个世界的 ID 视图状态，返回变化路径元组（排序，确定性）。

    纯函数：不写文件、不取随机数、不读时钟；同样入参 ⇒ 相同输出。比较规模是
    ``O(|universe|²)`` 的前缀过滤——世界的 ref 全域是数百条量级，展开层每个家族
    调用十几次，实测远低于毫秒级；若未来世界规模上到万级实体，再换成前缀树。
    """
    for name, world in (("a", a), ("b", b)):
        if not isinstance(world, WorldInstance):
            raise ExpansionError(
                "diff_requires_world_instance",
                f"{name} 必须是 WorldInstance，得到 {type(world).__name__}",
            )
    universe = a.ref_universe() | b.ref_universe()
    registered = _registered_ids(a) | _registered_ids(b)
    compared = _comparable_paths(a, b, universe, registered)
    changed: list[str] = []
    for path in sorted(compared):
        left = _try_resolve(a, path)
        right = _try_resolve(b, path)
        if left is _ABSENT or right is _ABSENT:
            changed.append(path)
            continue
        if canonical_json(left) != canonical_json(right):
            changed.append(path)
    return WorldDiff(tuple(changed))


# --------------------------------------------------------------------------- #
# 内部助手
# --------------------------------------------------------------------------- #
def _try_resolve(world: WorldInstance, path: str) -> Any:
    try:
        return world.resolve(path)
    except RefResolutionError:
        return _ABSENT


def _registered_ids(world: WorldInstance) -> set[str]:
    """世界注册表里的全部实体 id（容器判定的"这是别人的文档"用）。"""
    ids: set[str] = set()
    for entity_type in ENTITY_TYPES:
        ids.update(world.registry.ids(entity_type))
    return ids


def _comparable_paths(
    a: WorldInstance,
    b: WorldInstance,
    universe: frozenset[str],
    registered: set[str],
) -> tuple[str, ...]:
    """参与比较的路径：最大可寻址路径去掉"已注册实体的容器"（见模块 docstring）。"""
    maximal = [
        path
        for path in universe
        if not any(other != path and other.startswith(f"{path}.") for other in universe)
    ]
    return tuple(
        path
        for path in maximal
        if not _is_entity_container(a, path, registered)
        and not _is_entity_container(b, path, registered)
    )


def _is_entity_container(world: WorldInstance, path: str, registered: set[str]) -> bool:
    """路径值是否是"装着已注册实体文档的数组"（例如 ``workflow.*.instances``）。"""
    value = _try_resolve(world, path)
    if value is _ABSENT or not isinstance(value, (list, tuple)) or not value:
        return False
    for item in value:
        if not isinstance(item, Mapping):
            return False
        if not any(
            key.endswith("_id") and isinstance(candidate, str) and candidate in registered
            for key, candidate in item.items()
        ):
            return False
    return True


__all__ = ["WorldDiff", "diff_worlds"]
