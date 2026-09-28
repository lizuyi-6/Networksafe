"""group-key split：leave-key-out 的八种策略（设计 §10.2 / §10.3）。

算法（§10.2，逐字落地）::

    1. 每个 episode 收集其八个 group key 值集合
    2. union-find：共享任意一个 key 值 ⇒ 同一连通分量（最小不可分单位）
    3. 分量按 (strategy 指定的 holdout key, 分量大小 desc) 排序
    4. 每分量用 sha256(canonical_json(分量代表) + seed) 取模落入 train/validation/test，
       带大小感知的分层修正；低于 min_groups_per_split 时显式告警
    5. 断言：任何 key 值不出现在两个 split（G8）

**为什么必须 union-find**：只按 holdout key 分会把"同一世界的两个不同攻击族变体"
拆进不同 split——那确实满足 leave-key-out 的字面要求，但训练集里已经见过同一个世界。
§10.1 的最小不可分单位是"共享任意 key 的连通分量"，本模块按它实现。

``assign_splits`` 需要世界才能算出 ``app_domain`` / ``policy_graph_hash`` /
``workflow_template_hash``（episode 不带它们）。拿不到就抛
:class:`ValidationError`——猜一个 key 值会让泄漏审计静默失效。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Callable

from ..model.canonical import canonical_json, stable_hash
from ..model.episode import SPLIT_NAMES
from ..model.world import WorldInstance
from .errors import ValidationError
from .grouping import GROUP_KEYS, STRATEGY_TO_GROUP_KEY, episode_group_keys

#: 默认 split 比例（``configs/default.json`` 的 ``leakage_control.split_ratios``）。
DEFAULT_RATIOS: Mapping[str, float] = {"train": 0.8, "validation": 0.1, "test": 0.1}

#: 每个 split 的最少分量数（``configs/default.json`` 的 ``min_groups_per_split``）。
DEFAULT_MIN_GROUPS_PER_SPLIT = 50

#: 再平衡的最多搬动次数（防止病态输入上无限循环）。
_MAX_REBALANCE_MOVES = 256


@dataclass(frozen=True)
class SplitAssignment:
    """一种策略下的 split 分配结果。"""

    strategy: str
    group_key: str
    assignments: Mapping[str, str]
    ratios: Mapping[str, float] = field(default_factory=lambda: dict(DEFAULT_RATIOS))
    #: 显式告警（分量不足、比例偏差、被搬动的分量）。**告警不是失败**，
    #: 但必须出现在 manifest 里——静默产出偏斜 split 比偏斜本身更坏。
    warnings: tuple[str, ...] = ()
    corrections: tuple[dict[str, Any], ...] = ()
    component_count: int = 0

    def groups_for(self, split: str) -> frozenset[str]:
        """落在某个 split 里的全部 group key 值（holdout key）。"""
        return frozenset(
            episode_id
            for episode_id, assigned in self.assignments.items()
            if assigned == split
        )

    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for assigned in self.assignments.values():
            out[assigned] = out.get(assigned, 0) + 1
        return out

    def to_document(self) -> dict[str, Any]:
        return {
            "strategy": self.strategy,
            "group_key": self.group_key,
            "counts": self.counts(),
            "group_overlap_audit": [],
            "component_count": self.component_count,
            "ratios": dict(self.ratios),
            "warnings": list(self.warnings),
            "corrections": [dict(item) for item in self.corrections],
        }


@dataclass
class _Component:
    """一个 union-find 连通分量（最小不可分单位）。"""

    index: int
    episode_ids: tuple[str, ...]
    key_values: Mapping[str, frozenset[str]]
    holdout_value: str = ""
    size: int = 0
    split: str = "train"
    bucket: int = 0


def assign_splits(
    episodes: Sequence[Any],
    *,
    strategy: str,
    ratios: Mapping[str, float] | None = None,
    seed: int = 0,
    worlds: Mapping[str, WorldInstance] | None = None,
    group_keys: Mapping[str, Mapping[str, str]] | None = None,
    declared_attack_families: Mapping[str, str] | None = None,
    min_groups_per_split: int = DEFAULT_MIN_GROUPS_PER_SPLIT,
) -> SplitAssignment:
    """按策略分配 split（设计 §10.2）。

    ``worlds`` / ``group_keys`` / ``declared_attack_families`` 三个可选参数分别
    提供"世界注册表"、"显式 group key 覆盖"、"spec 声明的攻击族"；三者都不给时
    只用 episode 自带的两个 family id 加可派生键，缺的键会抛
    :class:`ValidationError`（不猜）。
    """
    if strategy not in STRATEGY_TO_GROUP_KEY:
        raise ValidationError(
            "unknown_split_strategy",
            f"strategy 必须是 {sorted(STRATEGY_TO_GROUP_KEY)} 之一，得到 {strategy!r}",
        )
    if not episodes:
        raise ValidationError("empty_episode_set", "assign_splits 需要至少一个 episode")
    resolved_ratios = _normalize_ratios(ratios)
    holdout_key = STRATEGY_TO_GROUP_KEY[strategy]
    keys_by_episode = _collect_keys(
        episodes,
        worlds=worlds,
        group_keys=group_keys,
        declared_attack_families=declared_attack_families,
    )
    # 退化 key（全集里只有一个取值）不参与合并：它不可能被"留出"（没有第二个值可留），
    # 却会把整个语料并成一个连通分量，于是八种策略退化成一种。手写语料的
    # ``generator_id`` 恒为 "handcrafted" 正是这种情形——如实告警，不静默合并。
    effective_keys, degenerate = _drop_degenerate_keys(keys_by_episode)
    if not any(effective_keys.values()):
        # 全部 key 都退化（典型：只有一个反事实家族的小语料）时，摘掉它们会把一个
        # 连通分量炸成 N 个单例——那不是"更细的划分"，是把"这些样本本来就不可分"
        # 这个事实丢掉。此时保留原 key：语料确实只有一个不可分单位。
        effective_keys = {episode_id: dict(keys) for episode_id, keys in keys_by_episode.items()}
        degenerate = ()
    components = _components(episodes, effective_keys, holdout_key)
    for component in components:
        representative = canonical_json(
            {
                "episode_ids": list(component.episode_ids),
                "key_values": {key: sorted(values) for key, values in sorted(component.key_values.items())},
                "strategy": strategy,
            }
        )
        component.bucket = int(stable_hash([representative, int(seed)]), 16) % len(resolved_ratios)
    _assign_buckets(components, resolved_ratios)
    corrections = _rebalance(components, resolved_ratios)
    assignments = {
        episode_id: component.split for component in components for episode_id in component.episode_ids
    }
    warnings = list(
        _warnings(components, resolved_ratios, min_groups_per_split, corrections, strategy)
    )
    for key in degenerate:
        warnings.append(
            f"group key {key!r} 在全数据集里只有一个取值，不参与连通分量合并"
            "（没有第二个值可留出；否则全部 episode 会被并成一个分量，八种策略退化成一种）"
        )
    if holdout_key in degenerate:
        warnings.append(
            f"策略 {strategy!r} 的 holdout key {holdout_key!r} 本身退化：该策略在此语料上无意义"
        )
    return SplitAssignment(
        strategy=strategy,
        group_key=holdout_key,
        assignments=assignments,
        ratios=resolved_ratios,
        warnings=tuple(warnings),
        corrections=tuple(corrections),
        component_count=len(components),
    )


def _drop_degenerate_keys(
    keys_by_episode: Mapping[str, Mapping[str, str]]
) -> tuple[dict[str, dict[str, str]], tuple[str, ...]]:
    """把全集里只有一个取值的 group key 从每个 episode 的键集合里摘掉。"""
    value_sets: dict[str, set[str]] = {}
    for keys in keys_by_episode.values():
        for key, value in keys.items():
            if value:
                value_sets.setdefault(key, set()).add(value)
    degenerate = sorted(key for key, values in value_sets.items() if len(values) < 2)
    if not degenerate:
        return {episode_id: dict(keys) for episode_id, keys in keys_by_episode.items()}, ()
    drop = set(degenerate)
    return (
        {
            episode_id: {key: value for key, value in keys.items() if key not in drop}
            for episode_id, keys in keys_by_episode.items()
        },
        tuple(degenerate),
    )


def audit_keys(
    episodes: Sequence[Any],
    *,
    worlds: Mapping[str, WorldInstance] | None = None,
    declared_attack_families: Mapping[str, str] | None = None,
) -> dict[str, dict[str, str]]:
    """给 :func:`group_overlap_audit` 用的 group key 表。

    与 :func:`assign_splits` **逐字同一套**规则：spec 声明的 attack_family 优先，
    退化 key（全集里只有一个取值）摘掉。审计侧自己另算一套会把"合法动作没违反任何
    不变量"判成 ``benign`` 族、或把恒定的 ``generator_id`` 当成跨 split 的泄漏，
    于是对正确数据报假失败。
    """
    keys = _collect_keys(
        episodes,
        worlds=worlds,
        group_keys=None,
        declared_attack_families=declared_attack_families,
    )
    effective, _degenerate = _drop_degenerate_keys(keys)
    return effective


def group_overlap_audit(
    assignment: SplitAssignment,
    group_key_of: Callable[[str], Mapping[str, str]] | Mapping[str, Mapping[str, str]],
) -> list[dict[str, Any]]:
    """审计"没有任何 group key 值出现在两个 split"（G8；必须为空）。

    ``group_key_of`` 可以是 ``episode_id -> {key: value}`` 的映射或同名可调用。
    """
    values: dict[str, dict[str, set[str]]] = {}
    for episode_id in sorted(assignment.assignments):
        split = assignment.assignments[episode_id]
        keys = group_key_of(episode_id) if callable(group_key_of) else group_key_of.get(episode_id, {})
        for key, value in (keys or {}).items():
            if value is None or value == "":
                continue
            values.setdefault(str(key), {}).setdefault(str(value), set()).add(split)
    out: list[dict[str, Any]] = []
    for key in sorted(values):
        for value in sorted(values[key]):
            splits = values[key][value]
            if len(splits) > 1:
                out.append({"group_key": key, "value": value, "splits": sorted(splits)})
    return out


# --------------------------------------------------------------------------- #
# 内部实现
# --------------------------------------------------------------------------- #
def _normalize_ratios(ratios: Mapping[str, float] | None) -> dict[str, float]:
    source = dict(ratios) if ratios is not None else dict(DEFAULT_RATIOS)
    unknown = sorted(set(source) - set(SPLIT_NAMES))
    if unknown:
        raise ValidationError("unknown_split_name", f"ratios 出现未知 split 名 {unknown}")
    positive = {name: float(value) for name, value in source.items() if float(value) > 0}
    if not positive:
        raise ValidationError("empty_ratios", "ratios 必须至少给一个正比例")
    total = sum(positive.values())
    return {name: value / total for name, value in sorted(positive.items())}


def _collect_keys(
    episodes: Sequence[Any],
    *,
    worlds: Mapping[str, WorldInstance] | None,
    group_keys: Mapping[str, Mapping[str, str]] | None,
    declared_attack_families: Mapping[str, str] | None,
) -> dict[str, dict[str, str]]:
    declared = dict(declared_attack_families or {})
    out: dict[str, dict[str, str]] = {}
    for episode in episodes:
        episode_id = _episode_id(episode)
        world = (worlds or {}).get(_world_id(episode))
        if group_keys is not None and episode_id in group_keys:
            out[episode_id] = dict(group_keys[episode_id])
            continue
        out[episode_id] = episode_group_keys(
            episode,
            world=world,
            declared_attack_family=declared.get(_world_id(episode)),
        )
    return out


def _episode_id(episode: Any) -> str:
    value = getattr(episode, "episode_id", None)
    if value is None and isinstance(episode, Mapping):
        value = episode.get("episode_id")
    if not value:
        raise ValidationError("episode_without_id", "episode 必须带 episode_id")
    return str(value)


def _world_id(episode: Any) -> str:
    value = getattr(episode, "world_id", None)
    if value is None and isinstance(episode, Mapping):
        value = episode.get("world_id")
    return str(value or "")


def _components(
    episodes: Sequence[Any],
    keys_by_episode: Mapping[str, Mapping[str, str]],
    holdout_key: str,
) -> list[_Component]:
    """union-find：共享任意一个 key 值 ⇒ 同一分量（§10.2 第 2 步）。"""
    ids = [_episode_id(episode) for episode in episodes]
    parent = {episode_id: episode_id for episode_id in ids}

    def find(node: str) -> str:
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    def union(left: str, right: str) -> None:
        root_left, root_right = find(left), find(right)
        if root_left == root_right:
            return
        # 确定性 tie-break：字典序小的当根
        if root_right < root_left:
            root_left, root_right = root_right, root_left
        parent[root_right] = root_left

    value_to_ids: dict[tuple[str, str], list[str]] = {}
    for episode_id in ids:
        for key in sorted(GROUP_KEYS):
            value = (keys_by_episode.get(episode_id) or {}).get(key)
            if value is None or value == "":
                continue
            value_to_ids.setdefault((key, str(value)), []).append(episode_id)
    for members in value_to_ids.values():
        for other in members[1:]:
            union(members[0], other)

    grouped: dict[str, list[str]] = {}
    for episode_id in ids:
        grouped.setdefault(find(episode_id), []).append(episode_id)
    components: list[_Component] = []
    for index, root in enumerate(sorted(grouped)):
        members = tuple(sorted(grouped[root]))
        key_values: dict[str, frozenset[str]] = {}
        for key in sorted(GROUP_KEYS):
            values = {
                str((keys_by_episode.get(episode_id) or {}).get(key))
                for episode_id in members
                if (keys_by_episode.get(episode_id) or {}).get(key)
            }
            if values:
                key_values[key] = frozenset(values)
        holdout = sorted(key_values.get(holdout_key, frozenset()))
        components.append(
            _Component(
                index=index,
                episode_ids=members,
                key_values=key_values,
                holdout_value=holdout[0] if holdout else "",
                size=len(members),
            )
        )
    # §10.2 第 3 步：按 (holdout key, 分量大小 desc) 排序
    components.sort(key=lambda component: (component.holdout_value, -component.size, component.index))
    return components


def _assign_buckets(components: Sequence[_Component], ratios: Mapping[str, float]) -> None:
    """hash 取模落入各 split（§10.2 第 4 步的前半段）。"""
    names = list(ratios)
    for component in components:
        component.split = names[component.bucket % len(names)]


def _rebalance(
    components: list[_Component], ratios: Mapping[str, float]
) -> list[dict[str, Any]]:
    """大小感知的分层修正：把最小分量从超配 split 搬到欠配 split。

    只在**确实降低总偏差** ``Σ|count - target|`` 时才搬。没有这条 guard，单个分量
    会在两个 split 之间来回搬直到搬满上限——那既是死循环也是假修正。
    """
    names = list(ratios)
    total = sum(component.size for component in components)
    targets = {name: ratios[name] * total for name in names}

    def deviation() -> float:
        counts = {name: 0 for name in names}
        for component in components:
            counts[component.split] += component.size
        return sum(abs(counts[name] - targets[name]) for name in names)

    moves: list[dict[str, Any]] = []
    for _ in range(_MAX_REBALANCE_MOVES):
        counts = {name: 0 for name in names}
        for component in components:
            counts[component.split] += component.size
        over_candidates = [name for name in names if counts[name] > targets[name]]
        under_candidates = [name for name in names if counts[name] < targets[name]]
        if not over_candidates or not under_candidates:
            break
        over = max(over_candidates, key=lambda name: (counts[name] - targets[name], name))
        under = min(under_candidates, key=lambda name: (targets[name] - counts[name], name))
        candidates = [component for component in components if component.split == over]
        if not candidates:
            break
        chosen = min(candidates, key=lambda component: (component.size, component.index))
        before = deviation()
        chosen.split = under
        after = deviation()
        if after >= before:
            # 搬了不降偏差 ⇒ 回滚并停止（语料太小，无法同时满足所有比例）
            chosen.split = over
            break
        moves.append(
            {
                "episode_ids": list(chosen.episode_ids),
                "from": over,
                "to": under,
                "size": chosen.size,
                "reason": "size_aware_stratification",
            }
        )
    return moves


def _warnings(
    components: Sequence[_Component],
    ratios: Mapping[str, float],
    min_groups_per_split: int,
    corrections: Sequence[Mapping[str, Any]],
    strategy: str,
) -> tuple[str, ...]:
    warnings: list[str] = []
    counts = {name: 0 for name in ratios}
    for component in components:
        counts[component.split] = counts.get(component.split, 0) + 1
    for name in sorted(counts):
        if counts[name] < min_groups_per_split:
            warnings.append(
                f"split {name!r} 只有 {counts[name]} 个分量，低于 min_groups_per_split="
                f"{min_groups_per_split}（小语料上 expected；不静默调整阈值）"
            )
    if corrections:
        warnings.append(
            f"大小感知修正搬动了 {len(corrections)} 个分量（见 corrections；只在超配/欠配时发生）"
        )
    if len(components) < 2:
        warnings.append(f"策略 {strategy!r} 下只有 {len(components)} 个不可分分量，split 无统计意义")
    return tuple(warnings)


__all__ = [
    "DEFAULT_MIN_GROUPS_PER_SPLIT",
    "DEFAULT_RATIOS",
    "SplitAssignment",
    "assign_splits",
    "audit_keys",
    "group_overlap_audit",
]
