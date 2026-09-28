"""Gate 3 的非空洞性探针（设计 §8.4）与攻击族可达性（§10.5）。

一个 AI 写的策略可以合法、可解析、且**永远放行**（``condition: lit(true)``），
于是整个世界的 attack 标签全部来自 default-deny 之外的空白——那就是"policy 空洞"。
§8.4 把探测算法写死：

```
for each policy P in world.policies:
    refs = static_refs(P.condition)                 # ID 视图路径
    domains[r] = declared_domain(r)                 # 从 schema 推导，不猜
    for A in sample(domains):                       # 有界笛卡尔采样
        d = decide_policy(world with refs overridden by A, probe_action)
    if all allow → reject(P, "G3_policy_vacuous")
    if all deny  → reject(P, "G3_policy_never_allows")
```

``declared_domain`` 是**schema 驱动**的：把 ``actor.ACT-001.roles`` 这类 ID 视图
路径导航到 ``world.schema.json`` 的对应节点（实体 id 段跳过，它不是 schema 属性），
然后按节点的 ``enum`` / ``type`` 取值域；无法导航时退回"世界现值 + 同类型实体 id"，
并把这个退回记进结果（``domain_source``），绝不静默猜。

探针世界只用于求值，**永不进入数据集**（§8.4）。
"""
from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..model.canonical import canonical_json, stable_hash
from ..model.errors import RefResolutionError
from ..model.schemas import load_schema_document
from ..model.world import WorldInstance
from ..oracle import OverlayError, override_world_values
from ..policy import (
    Action,
    DslError as PolicyDslError,
    decide_policy,
    parse_expr,
    split_entity_path,
    static_refs,
)
from .errors import ValidationError

#: 每个 ref 的取值域上限（§8.4：每 ref 最多 4 值）。
MAX_VALUES_PER_REF = 4

#: 探针世界上限（§8.4：总量上限 ``config.probe.max_worlds``；Phase 1 无该配置项，
#: 由本常量承载，测试钉死）。
MAX_PROBE_WORLDS = 64


# --------------------------------------------------------------------------- #
# schema 导航：ID 视图路径 → world.schema.json 节点
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=1)
def _world_schema() -> Mapping[str, Any]:
    return load_schema_document("world")


def _resolve_ref(node: Mapping[str, Any]) -> Mapping[str, Any]:
    """解析 ``#/$defs/<name>`` 形式的本地 ``$ref``（非本地 ref 原样返回）。"""
    seen = 0
    while isinstance(node, Mapping) and "$ref" in node and seen < 16:
        ref = str(node["$ref"])
        if not ref.startswith("#/"):
            break
        target: Any = _world_schema()
        for part in ref[2:].split("/"):
            if not isinstance(target, Mapping) or part not in target:
                return node
            target = target[part]
        if not isinstance(target, Mapping):
            return node
        node = target
        seen += 1
    return node


#: 实体类型 → schema 导航起点（``world.schema.json`` 的 ``properties``）。
_SCHEMA_ROOT_FOR_TYPE: Mapping[str, str] = {
    "actor": "actors",
    "resource": "resources",
    "session": "sessions",
    "token": "tokens",
    "credential": "credentials",
    "workflow": "workflows",
    "service": "services",
    "cache": "caches",
    "role": "roles",
}


def _schema_node_for_path(world: WorldInstance, path: str) -> Mapping[str, Any] | None:
    """把 ID 视图路径导航到 schema 节点；实体 id 段跳过，失败返回 ``None``。"""
    from ..policy import split_entity_path

    try:
        entity_type, _entity_id, fields = split_entity_path(path, world)
    except (PolicyDslError, RefResolutionError, ValueError):
        return None
    node: Mapping[str, Any] | None = None
    if entity_type == "workflow_instance":
        workflows = _world_schema()["properties"]["workflows"]
        workflow_node = _resolve_ref((workflows.get("items") or {}))
        instances = (workflow_node.get("properties") or {}).get("instances")
        if not isinstance(instances, Mapping):
            return None
        node = _resolve_ref(instances.get("items") or {})
        if not isinstance(node, Mapping) or "properties" not in node:
            return None
    else:
        collection = _SCHEMA_ROOT_FOR_TYPE.get(entity_type)
        if collection is None:
            return None
        top = _world_schema()["properties"].get(collection)
        if not isinstance(top, Mapping):
            return None
        node = _resolve_ref(top.get("items") or {})
    if node is None:
        return None
    for field_name in fields:
        properties = node.get("properties")
        if not isinstance(properties, Mapping) or field_name not in properties:
            return None
        node = _resolve_ref(properties[field_name])
    return node


def _entity_ids_of_type(world: WorldInstance, entity_type: str) -> tuple[str, ...]:
    from ..model.refs import ENTITY_TYPES  # noqa: F401 - 文档用途：类型表在本包只读

    try:
        return tuple(sorted(world.registry.ids(entity_type)))
    except Exception:  # noqa: BLE001 - 未知类型 ⇒ 无候选
        return ()


#: "指向另一个实体 id"的字段 → 目标实体类型（域取自世界中该类型实体的 id）。
_FIELD_TARGET_TYPE: Mapping[str, str] = {
    "owner": "actor",
    "principal": "actor",
    "subject": "actor",
    "holder": "actor",
    "parent_token": "token",
    "bound_resource": "resource",
    "source_of_truth": "service",
    "resource_id": "resource",
    "instance_id": "workflow_instance",
    "actor_id": "actor",
    "session_id": "session",
    "token_id": "token",
    "cache_id": "cache",
    "service_id": "service",
    "credential_id": "credential",
    "workflow_id": "workflow",
    "role_id": "role",
}


#: 实体类型 → 该实体文档里的 id 字段名（``actor.ACT-001.actor_id`` 是**身份**不是
#: 状态，探针不覆盖它——改 id 会造出重复实体，不是一次状态干预）。
_ID_FIELD_FOR_TYPE: Mapping[str, str] = {
    "actor": "actor_id",
    "resource": "resource_id",
    "session": "session_id",
    "token": "token_id",
    "credential": "credential_id",
    "service": "service_id",
    "cache": "cache_id",
    "role": "role_id",
    "workflow": "workflow_id",
    "workflow_instance": "instance_id",
}


def _lineage_nested_refs(expr: Any) -> frozenset[str]:
    """被 ``lineage_root`` / ``lineage_depth`` 直接包住的 ref 路径。"""
    from ..policy import REF_OP
    from ..policy.ast import LINEAGE_OPS

    found: set[str] = set()

    def walk(node: Any) -> None:
        if getattr(node, "op", None) in LINEAGE_OPS:
            for arg in getattr(node, "args", ()) or ():
                if getattr(arg, "op", None) == REF_OP and getattr(arg, "path", None):
                    found.add(str(arg.path))
            return
        for arg in getattr(node, "args", ()) or ():
            walk(arg)

    walk(expr)
    return frozenset(found)


def _lineage_closure_domain(world: WorldInstance, token_path: str) -> tuple[list[Any], str]:
    """一个 token 的 ``parent_token`` 取值域：世界中**其它** token id + ``None``（根）。

    自身 id 被排除：``parent_token == self`` 立即构成环，而编译期就拒环，探针没有
    理由去构造一个非法的世界。
    """
    try:
        entity_type, entity_id, _fields = split_entity_path(token_path, world)
    except (PolicyDslError, RefResolutionError, ValueError):
        return [], "world_current"
    if entity_type != "token":
        return [], "world_current"
    ids = [item for item in _entity_ids_of_type(world, "token") if item != entity_id]
    return [*ids, None], "world_entity_ids"


def _is_identity_path(path: str) -> bool:
    """路径是否指向实体自己的 id 字段（探针跳过：改 id 不是状态干预）。"""
    segments = path.split(".")
    if len(segments) < 3:
        return False
    return segments[-1] == _ID_FIELD_FOR_TYPE.get(segments[0])


def declared_domain(world: WorldInstance, path: str) -> tuple[list[Any], str]:
    """一个 ID 视图路径的取值域（§8.4 的 ``declared_domain``）。

    返回 ``(values, source)``；``source`` 记录域的**主要**来源（``schema_enum`` /
    ``schema_bool`` / ``schema_integer`` / ``schema_string_pattern`` /
    ``schema_array`` / ``world_current`` / ``world_entity_ids`` /
    ``world_field_values`` / ``schema_workflow_states``）。测试断言"常见状态字段的
    域来自 schema"，防止实现悄悄退化成"只探当前值"——那种探针永远测不出空洞。

    取值优先级（§8.4 的"每 ref 最多 4 值"按这个顺序截断）：

    1. **当前值**——它是该字段的一个合法实例，必然属于声明域；
    2. **世界中该字段实际出现过的取值**——探针必须能看见"使条件为假"的那个取值，
       否则一条合法策略会被误判成空洞（HC-006 的 benign 动作绑在 authenticated 的
       actor 上，而 ``disabled`` 只出现在另一个 actor 身上）；
    3. schema 推导出的其余取值（枚举 / 布尔 / 整数上界 / 同类型实体 id / 工作流状态）。
    """
    values, source = _declared_domain_raw(world, path)
    try:
        current = world.resolve(path)
    except RefResolutionError:
        current = None
    world_values = _distinct_field_values(world, path)
    ordered: list[Any] = []
    for candidate in (current, *world_values, *values):
        if candidate is None and not ordered:
            continue
        if any(canonical_json(candidate) == canonical_json(item) for item in ordered):
            continue
        ordered.append(candidate)
        if len(ordered) >= MAX_VALUES_PER_REF:
            break
    return ordered[:MAX_VALUES_PER_REF], source


def _declared_domain_raw(world: WorldInstance, path: str) -> tuple[list[Any], str]:
    """取值域的原始推导（不含"当前值 / 世界取值优先"的排序修正）。"""
    current: Any = None
    try:
        current = world.resolve(path)
    except RefResolutionError:
        current = None
    node = _schema_node_for_path(world, path)
    if node is None:
        return ([current], "world_current")
    if "enum" in node:
        return ([value for value in node["enum"]][:MAX_VALUES_PER_REF], "schema_enum")
    if "const" in node:
        return ([node["const"]], "schema_const")
    node_type = _primary_type(node)
    if node_type == "boolean":
        return ([False, True], "schema_bool")
    if node_type in ("integer", "number"):
        seen = _max_integer_of_kind(world, path)
        values = [0, 1, 2]
        if seen is not None and seen not in values:
            values.append(seen)
        return (values[:MAX_VALUES_PER_REF], "schema_integer")
    if node_type == "array":
        items = _resolve_ref(node.get("items") or {})
        candidates: list[Any] = []
        if isinstance(current, list):
            candidates.append(list(current))
        candidates.append([])
        if "enum" in items:
            candidates.append([items["enum"][0]])
        else:
            # 无 enum 的字符串数组（roles / privileges / scope / audience）：
            # 域取自世界中该字段出现过的全部标量取值——否则"支持角色读"这条策略
            # 的探针永远见不到 ROLE-SUPPORT，被误判成死规则。
            for scalar in _distinct_scalar_values(world, path):
                candidates.append([scalar])
        unique: dict[str, Any] = {}
        for candidate in candidates:
            unique.setdefault(canonical_json(candidate), candidate)
        ordered = [unique[key] for key in sorted(unique)]
        return (ordered[:MAX_VALUES_PER_REF], "schema_array")
    if node_type == "string":
        segments = path.split(".")
        field_name = segments[-1]
        entity_type = segments[0]
        # 1) 指向别的实体 id 的字段 ⇒ 世界中该类型实体的 id 全集
        target_type = _FIELD_TARGET_TYPE.get(field_name)
        if target_type is not None:
            ids = _entity_ids_of_type(world, target_type)
            if field_name == "parent_token":
                # parent_token 可空：根 token 的父链接口是 None。
                return ([*ids, None][:MAX_VALUES_PER_REF], "world_entity_ids")
            if ids:
                return (list(ids)[:MAX_VALUES_PER_REF], "world_entity_ids")
        # 2) 工作流实例的当前态 ⇒ 该工作流声明的状态全集
        if entity_type == "workflow_instance" and field_name == "current_state":
            states = _workflow_states(world)
            if states:
                return (list(states)[:MAX_VALUES_PER_REF], "schema_workflow_states")
        # 3) 自由字符串 ⇒ 世界中同类型实体该字段出现过的全部取值
        seen_values = _distinct_field_values(world, path)
        if len(seen_values) > 1:
            return (seen_values[:MAX_VALUES_PER_REF], "world_field_values")
        return ([current] if current is not None else [], "schema_string_pattern")
    if node_type == "object":
        return ([current] if current is not None else [], "world_current")
    # 无类型节点（``cache.*.cached_value`` 在 schema 里是 ``{}``）：退回世界中该字段
    # 出现过的取值，否则域里只有当前值，探针永远证明不了"换个值就放行"。
    seen_values = _distinct_field_values(world, path)
    if len(seen_values) > 1:
        return (list(seen_values)[:MAX_VALUES_PER_REF], "world_field_values")
    return ([current], "world_current")


def _primary_type(node: Mapping[str, Any]) -> Any:
    """schema 节点的有效类型（``type`` 可能是数组，如 ``["string","null"]``）。"""
    node_type = node.get("type")
    if isinstance(node_type, list):
        for candidate in node_type:
            if candidate != "null":
                return candidate
        return node_type[0] if node_type else None
    return node_type


def _workflow_states(world: WorldInstance) -> tuple[str, ...]:
    """全部工作流声明的状态（``workflow.states`` 的并集，排序）。"""
    states: set[str] = set()
    for workflow in world.workflows:
        states.update(str(state) for state in (workflow.states or ()))
    return tuple(sorted(states))


def _distinct_scalar_values(world: WorldInstance, path: str) -> tuple[Any, ...]:
    """世界中同类型实体在该**数组**字段里出现过的全部标量取值（排序，确定性）。"""
    segments = path.split(".")
    entity_type, field_name = segments[0], segments[-1]
    document = world.to_document()
    collected: list[Any] = []
    if entity_type == "workflow_instance":
        for workflow in document.get("workflows") or ():
            for instance in workflow.get("instances") or ():
                value = instance.get(field_name) if isinstance(instance, Mapping) else None
                if isinstance(value, list):
                    collected.extend(value)
    else:
        collection = _SCHEMA_ROOT_FOR_TYPE.get(entity_type)
        if collection is None:
            return ()
        for item in document.get(collection) or ():
            value = item.get(field_name) if isinstance(item, Mapping) else None
            if isinstance(value, list):
                collected.extend(value)
    unique: dict[str, Any] = {}
    for value in collected:
        if isinstance(value, (dict, list)):
            continue
        unique.setdefault(canonical_json(value), value)
    return tuple(unique[key] for key in sorted(unique))


def _distinct_field_values(world: WorldInstance, path: str) -> tuple[Any, ...]:
    """世界中同类型实体在该字段上出现过的全部取值（按规范化 JSON 排序，确定性）。"""
    segments = path.split(".")
    entity_type, field_name = segments[0], segments[-1]
    document = world.to_document()
    collected: list[Any] = []
    if entity_type == "workflow_instance":
        for workflow in document.get("workflows") or ():
            for instance in workflow.get("instances") or ():
                if isinstance(instance, Mapping) and field_name in instance:
                    collected.append(instance[field_name])
    else:
        collection = _SCHEMA_ROOT_FOR_TYPE.get(entity_type)
        if collection is None:
            return ()
        for item in document.get(collection) or ():
            if isinstance(item, Mapping) and field_name in item:
                collected.append(item[field_name])
    unique: dict[str, Any] = {}
    for value in collected:
        unique.setdefault(canonical_json(value), value)
    return tuple(unique[key] for key in sorted(unique))


def _max_integer_of_kind(world: WorldInstance, path: str) -> int | None:
    """同类型整数字段在世界里的最大值（域的上界候选，§8.4 的 ``max_seen``）。"""
    field_name = path.rsplit(".", 1)[-1]
    entity_type = path.split(".", 1)[0]
    collection = _SCHEMA_ROOT_FOR_TYPE.get(entity_type)
    if collection is None:
        return None
    document = world.to_document()
    best: int | None = None
    for item in document.get(collection) or ():
        if not isinstance(item, Mapping) or field_name not in item:
            continue
        value = item[field_name]
        if isinstance(value, bool) or not isinstance(value, int):
            continue
        best = value if best is None else max(best, value)
    return best


# --------------------------------------------------------------------------- #
# 探针动作
# --------------------------------------------------------------------------- #
def _probe_action(world: WorldInstance, policy: Any, action: Action) -> Action:
    """按策略自己的 ``action_pattern`` 造一个探针动作。

    用被探策略自己的 operation / resource_type 造动作，探针才是在问"这个条件
    空洞吗"；用 episode 的动作会让不匹配的策略永远落到 default-deny，
    于是每个策略都"永不放行"——假失败。
    """
    pattern = policy.action
    operation = pattern.operation if pattern.operation != "*" else action.operation
    document: dict[str, Any] = {
        "action_id": f"ACTN-PROBE-{policy.policy_id}",
        "operation": operation,
        "actor": action.actor,
        "flow_id": action.flow_id or f"FLOW-{operation}",
        "at": action.at,
    }
    for key in ("resource", "session", "token", "workflow_instance"):
        value = getattr(action, key, None)
        if value is not None:
            document[key] = value
    return Action.from_document(document)


def _expand_ref(world: WorldInstance, path: str, action: Action) -> str | None:
    """把策略条件里的 ref 规范成可覆盖的 ID 视图路径。

    * 已经是 ID 视图 ⇒ 原样返回（``cache.CACHE-001.fresh`` 这类世界状态路径）；
    * action 绑定视图 ⇒ 用当前 action 展开成实例路径（``action.resource.owner``
      → ``resource.RES-001.owner``）；
    * 展开不了（action 局部数据、未绑定主体）⇒ ``None``，该 ref 不参与覆盖。
    """
    from ..model.refs import is_id_view

    if is_id_view(path):
        return path
    try:
        expanded = world.try_expand_action_view(path, action)
    except Exception:  # noqa: BLE001 - 展开失败 ⇒ 该 ref 不参与覆盖
        return None
    return expanded


def _bounded_product(domains: Mapping[str, tuple[Any, ...]], limit: int) -> list[dict[str, Any]]:
    """有界笛卡尔采样：全量超限时按等距步长取（确定性，不随机）。"""
    keys = sorted(domains)
    if not keys:
        return [{}]
    combos: list[dict[str, Any]] = [{}]
    for key in keys:
        values = domains[key] or (None,)
        combos = [{**combo, key: value} for combo in combos for value in values]
        if len(combos) > limit * 8:  # 提前截断，避免指数爆炸
            stride = max(1, len(combos) // limit)
            combos = combos[::stride][:limit]
            break
    if len(combos) <= limit:
        return combos
    stride = len(combos) / limit
    picked: list[dict[str, Any]] = []
    index = 0.0
    while len(picked) < limit and int(index) < len(combos):
        picked.append(combos[int(index)])
        index += stride
    return picked


# --------------------------------------------------------------------------- #
# 结果类型
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class PolicyProbeResult:
    """一条策略的探针结论（§8.4）。"""

    policy_id: str
    probed: bool
    reason_code: str | None = None
    outcomes: tuple[str, ...] = ()
    probe_world_count: int = 0
    domains: Mapping[str, tuple[Any, ...]] = field(default_factory=dict)
    domain_sources: Mapping[str, str] = field(default_factory=dict)
    #: 每个探针世界上该策略**条件**的求真结果（``true`` / ``false`` / ``unbound``）。
    #: 空洞性判在条件上，不在 effect 上：一条 ``effect=deny`` 的兜底规则本来就该
    #: 永远拒绝，把它记成"永拒"是假失败。
    condition_outcomes: tuple[str, ...] = ()
    #: 因"赋值不可表示"而跳过的探针赋值数（探针局限，不是策略缺陷）。
    skipped_assignments: int = 0

    @property
    def vacuous(self) -> bool:
        """``allow`` 策略的条件恒真 ⇒ 它不可能拒绝任何东西（policy 空洞）。"""
        return self.reason_code == "G3_policy_vacuous"

    @property
    def never_allows(self) -> bool:
        """条件恒假 ⇒ 该策略是死规则，任何动作都匹配不上它。"""
        return self.reason_code == "G3_policy_never_allows"

    def to_document(self) -> dict[str, Any]:
        return {
            "policy_id": self.policy_id,
            "probed": self.probed,
            "reason_code": self.reason_code,
            "outcomes": list(self.outcomes),
            "condition_outcomes": list(self.condition_outcomes),
            "skipped_assignments": self.skipped_assignments,
            "probe_world_count": self.probe_world_count,
            "domains": {key: list(value) for key, value in sorted(self.domains.items())},
            "domain_sources": dict(sorted(self.domain_sources.items())),
        }


_PROBE_CACHE: dict[str, tuple[PolicyProbeResult, ...]] = {}


def probe_world_policies(
    world: WorldInstance,
    action: Action,
    *,
    max_worlds: int = MAX_PROBE_WORLDS,
    max_values_per_ref: int = MAX_VALUES_PER_REF,
    use_cache: bool = True,
) -> tuple[PolicyProbeResult, ...]:
    """对世界里的每条策略跑 §8.4 非空洞性探针（缓存按世界+动作签名）。"""
    signature = stable_hash(
        {
            "world": world.to_document(),
            "action": action.to_document() if hasattr(action, "to_document") else dict(action),
            "max_worlds": max_worlds,
            "max_values_per_ref": max_values_per_ref,
        }
    )
    if use_cache and signature in _PROBE_CACHE:
        return _PROBE_CACHE[signature]
    results = tuple(
        _probe_one(world, policy, action, max_worlds=max_worlds, max_values_per_ref=max_values_per_ref)
        for policy in world.policies
    )
    if use_cache:
        _PROBE_CACHE[signature] = results
    return results


def _probe_one(
    world: WorldInstance,
    policy: Any,
    action: Action,
    *,
    max_worlds: int,
    max_values_per_ref: int,
) -> PolicyProbeResult:
    try:
        expr = parse_expr(policy.condition)
    except PolicyDslError:
        return PolicyProbeResult(policy.policy_id, False, reason_code="G3_policy_unparseable")
    refs = sorted(static_refs(expr))
    lineage_refs = _lineage_nested_refs(expr)
    overridable: dict[str, tuple[Any, ...]] = {}
    sources: dict[str, str] = {}
    for ref in refs:
        expanded = _expand_ref(world, ref, action)
        if expanded is None or not world.contains(expanded):
            continue
        if _is_identity_path(expanded):
            # 身份字段不是状态：探针覆盖它会造出重复实体，因此不参与采样。
            continue
        values, source = declared_domain(world, expanded)
        if not values:
            continue
        overridable[expanded] = tuple(values[:max_values_per_ref])
        sources[expanded] = source
        if ref in lineage_refs:
            # ``lineage_root`` / ``lineage_depth`` 读的是**父链**，不是被引字段本身：
            # 不改 parent_token 就永远探不到"换个根"的那个赋值，于是一条合法的血缘
            # 策略会被误判成死规则。因此把该 token 的 parent_token 也加进可覆盖集。
            closure_values, closure_source = _lineage_closure_domain(world, expanded)
            if closure_values:
                parent_path = f"token.{split_entity_path(expanded, world)[1]}.parent_token"
                overridable[parent_path] = tuple(closure_values[:max_values_per_ref])
                sources[parent_path] = closure_source
    assignments = _bounded_product(overridable, max_worlds)
    probe_action = _probe_action(world, policy, action)
    # 绑定变体：条件读 ``action.<binding>`` 时，只探一个绑定看不见"换成别的实体就
    # 被拒"——HC-020 的 benign 动作绑在深度 1 的令牌上，而深度 2 的令牌在另一个绑定
    # 上。因此对每个被引用的绑定类型，额外用世界里的其它实体各探一次。
    binding_actions = _binding_variants(world, action, lineage_refs | set(refs))
    outcomes: list[str] = []
    condition_outcomes: list[str] = []
    skipped = 0
    for assignment in assignments:
        try:
            probe_world = override_world_values(world, assignment)
        except (OverlayError, RefResolutionError):
            # 该赋值在本世界不可表示（典型：把可选集合覆写成 []，而 L1 的
            # to_document 会丢掉空集合）。这是**探针的**局限，不是策略的缺陷——
            # 跳过这个赋值继续，绝不让它伪装成策略失败。
            skipped += 1
            continue
        try:
            decision = decide_policy(probe_world, probe_action)
            condition = _condition_outcome(expr, probe_world, probe_action)
        except (PolicyDslError, RefResolutionError):
            # 探针世界让 DSL 抛错（典型：构造出了编译期就拒的父链环）。这不是策略的
            # 缺陷，是这个赋值不可判定——跳过它，绝不伪装成策略失败。
            skipped += 1
            continue
        outcomes.append(decision.effect)
        condition_outcomes.append(condition)
    for variant_action in binding_actions:
        try:
            decision = decide_policy(world, variant_action)
            condition = _condition_outcome(expr, world, variant_action)
        except (PolicyDslError, RefResolutionError):
            skipped += 1
            continue
        outcomes.append(decision.effect)
        condition_outcomes.append(condition)
    if not condition_outcomes:
        return PolicyProbeResult(
            policy.policy_id,
            False,
            reason_code="G3_probe_not_runnable",
            probe_world_count=0,
            skipped_assignments=skipped,
        )
    reason: str | None = None
    if condition_outcomes and all(outcome == "false" for outcome in condition_outcomes):
        # 条件恒假 ⇒ 死规则：它永远匹配不上任何动作（含 default-deny 兜底）。
        reason = "G3_policy_never_allows"
    elif (
        condition_outcomes
        and all(outcome == "true" for outcome in condition_outcomes)
        and str(policy.effect) == "allow"
    ):
        # allow 策略条件恒真 ⇒ 无条件放行（policy 空洞）。
        reason = "G3_policy_vacuous"
    return PolicyProbeResult(
        policy_id=policy.policy_id,
        probed=True,
        reason_code=reason,
        outcomes=tuple(outcomes),
        probe_world_count=len(outcomes),
        domains=overridable,
        domain_sources=sources,
        condition_outcomes=tuple(condition_outcomes),
        skipped_assignments=skipped,
    )


#: 每个绑定类型最多探几个替代实体（有界，防止组合爆炸）。
_MAX_BINDING_VARIANTS = 4

#: action 绑定视图的第二段 → 世界里的实体类型（探针的绑定变体用）。
#: 绑定名与实体类型同名（``action.token.*`` → ``token`` 实体）。
_BINDING_TYPES: frozenset[str] = frozenset({
    "actor",
    "resource",
    "session",
    "token",
    "workflow_instance",
})


def _binding_variants(
    world: WorldInstance, action: Action, refs: frozenset[str] | set[str]
) -> tuple[Action, ...]:
    """条件引用到的 action 绑定的替代实体动作（确定性，有界）。"""
    from ..model.refs import is_action_view

    types: set[str] = set()
    for ref in refs:
        if not is_action_view(ref):
            continue
        binding = ref.split(".")[1]
        if binding in _BINDING_TYPES:
            types.add(binding)
    if not types:
        return ()
    out: list[Action] = []
    for binding in sorted(types):
        ids = _entity_ids_of_type(world, binding)
        current = getattr(action, binding, None)
        candidates = [item for item in ids if item != current][:_MAX_BINDING_VARIANTS]
        for entity_id in candidates:
            document = action.to_document() if hasattr(action, "to_document") else dict(action)
            document = dict(document)
            document[binding] = entity_id
            document["action_id"] = f"{document.get('action_id')}-PROBE-{binding}-{entity_id}"
            try:
                out.append(Action.from_document(document))
            except Exception:  # noqa: BLE001 - 构造失败的动作跳过
                continue
    return tuple(out)


def _condition_outcome(expr: Any, world: WorldInstance, action: Action) -> str:
    """探针世界上策略条件的求真结果（``true`` / ``false`` / ``unbound``）。"""
    from ..policy import EvalContext, eval_expr

    ctx = EvalContext(world=world, action=action, evidence_view=None, now=action.at, current_flow_id=action.flow_id)
    try:
        value = eval_expr(expr, ctx)
    except (PolicyDslError, RefResolutionError):
        # 未绑定主体 / 未知实体 ⇒ 该探针动作对这个条件不可判定（L2 的语义是
        # condition_unbound，不是异常）。
        return "unbound"
    if value is True:
        return "true"
    if value is False:
        return "false"
    return "unbound"


# --------------------------------------------------------------------------- #
# 攻击族可达性（§10.5）
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class ReachabilityResult:
    """一个声明攻击族的可达性（``reachable_samples == 0`` 是硬发布失败）。"""

    attack_family: str
    declared_worlds: int
    reachable_samples: int

    @property
    def reachable(self) -> bool:
        return self.reachable_samples > 0

    def to_document(self) -> dict[str, Any]:
        return {
            "attack_family": self.attack_family,
            "declared_worlds": self.declared_worlds,
            "reachable_samples": self.reachable_samples,
        }


def attack_family_reachability(
    episodes: Any,
    *,
    declared_families: Mapping[str, str] | None = None,
    reachable_family_of: Any = None,
    worlds: Mapping[str, Any] | None = None,
) -> tuple[ReachabilityResult, ...]:
    """每个声明攻击族的 ``declared_worlds`` / ``reachable_samples``（§10.5）。

    ``declared_families`` 是 ``world_id -> spec.attack_family``（作者先验声明）。
    ``reachable_samples`` 数的是**声明了该族的世界里，oracle 真的产出
    ``world_truth == "attack"`` 的样本数**——"世界声明了一个它表达不出来的攻击"
    说的正是这件事。没有声明表时退回按 episode 的 violated invariants 派生族。
    """
    from .grouping import derive_attack_family

    declared = dict(declared_families or {})
    declared_worlds: dict[str, set[str]] = {}
    for world_id, family in sorted(declared.items()):
        declared_worlds.setdefault(str(family), set()).add(str(world_id))
    samples: dict[str, int] = {}
    seen_worlds: dict[str, set[str]] = {}
    world_map = dict(worlds or {})
    for episode in episodes:
        world_id = str(
            getattr(episode, "world_id", None)
            or (episode.get("world_id") if isinstance(episode, Mapping) else "")
        )
        truth = _world_truth_of_episode(episode)
        if reachable_family_of is not None:
            family = reachable_family_of(episode)
        else:
            family = declared.get(world_id) or derive_attack_family(episode, world_map.get(world_id))
        if family is None:
            continue
        seen_worlds.setdefault(family, set()).add(world_id)
        if truth == "attack":
            samples[family] = samples.get(family, 0) + 1
    families = sorted(set(declared_worlds) | set(seen_worlds))
    out: list[ReachabilityResult] = []
    for family in families:
        world_ids = declared_worlds.get(family) or seen_worlds.get(family) or set()
        out.append(
            ReachabilityResult(
                attack_family=family,
                declared_worlds=len(world_ids),
                reachable_samples=int(samples.get(family, 0)),
            )
        )
    return tuple(out)


def _world_truth_of_episode(episode: Any) -> str:
    output = getattr(episode, "oracle_output", None)
    if output is None and isinstance(episode, Mapping):
        output = episode.get("oracle_output")
    if isinstance(output, Mapping):
        return str(output.get("world_truth") or "")
    return str(getattr(output, "world_truth", "") or "")


# --------------------------------------------------------------------------- #
# 族级可达性（REVISION 2 任务书 A6：不变量族 / 失效族）
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class FamilyReachabilityResult:
    """一个 **(world, family)** 对的可达性（A6）。

    ``kind="invariant"`` 的 family 是不变量类别（world 声明了哪类不变量）；
    ``kind="failure"`` 的 family 是失效族（spec 声明的攻击族）。``witnesses`` 数的
    是**程序可达**的样本：

    * invariant 族：episode 的不变量真的被求值过（进 satisfied/violated，而不是
      ``skipped_out_of_scope``／``skipped_unbound_subject``）——只被跳过说明这个
      族在任何动作上都没有可执行语义；
    * failure 族：episode 的 ``world_truth == "attack"`` 且被违反的不变量类别能
      映射到该族（或该族由 spec 为这个世界显式声明，声明优先，§10.5）。

    ``witnesses == 0`` ⇒ **unsupported**：世界声明了它表达不出来的族。unsupported
    的族在 coverage/report 里如实列出，**绝不计入"已支持"**（A6 的硬要求）。
    """

    kind: str
    family: str
    world_id: str
    witnesses: int = 0
    witness_episode_ids: tuple[str, ...] = ()

    @property
    def reachable(self) -> bool:
        return self.witnesses > 0

    @property
    def supported(self) -> bool:
        """语义别名：可达 == 被支持。没有 witness 的族不支持，也不许计入支持数。"""
        return self.reachable

    def to_document(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "family": self.family,
            "world_id": self.world_id,
            "witnesses": self.witnesses,
            "witness_episode_ids": list(self.witness_episode_ids),
            "supported": self.supported,
        }


@dataclass(frozen=True)
class FamilyCoverage:
    """族级可达性的汇总报告（A6 的"coverage/report"）。"""

    invariant: tuple[FamilyReachabilityResult, ...] = ()
    failure: tuple[FamilyReachabilityResult, ...] = ()
    #: 每个 family 最多保留几个 witness episode id（报告体积有界，计数不受限）。
    max_witness_examples: int = 3

    @property
    def results(self) -> tuple[FamilyReachabilityResult, ...]:
        return self.invariant + self.failure

    @property
    def unsupported(self) -> tuple[FamilyReachabilityResult, ...]:
        return tuple(result for result in self.results if not result.supported)

    @property
    def supported(self) -> tuple[FamilyReachabilityResult, ...]:
        return tuple(result for result in self.results if result.supported)

    def to_document(self) -> dict[str, Any]:
        return {
            "invariant_families": [item.to_document() for item in self.invariant],
            "failure_families": [item.to_document() for item in self.failure],
            "supported_count": len(self.supported),
            "unsupported_count": len(self.unsupported),
            # 未支持的族逐条列出（world + family + 为什么没有 witness）——它们
            # 不计入 supported_count，也不从表里消失。
            "unsupported": [item.to_document() for item in self.unsupported],
        }


def _episode_id(episode: Any) -> str:
    value = getattr(episode, "episode_id", None)
    if value is None and isinstance(episode, Mapping):
        value = episode.get("episode_id")
    return str(value or "")


def _evaluated_invariant_ids(episode: Any) -> set[str]:
    """episode 里**被求值过**的不变量 id（satisfied ∪ violated；skipped 不算）。"""
    output = getattr(episode, "oracle_output", None)
    if output is None and isinstance(episode, Mapping):
        output = episode.get("oracle_output")
    if isinstance(output, Mapping):
        document = output
    else:
        to_document = getattr(output, "to_document", None)
        document = to_document() if callable(to_document) else {}
    evaluated: set[str] = set()
    for key in ("satisfied_invariants", "violated_invariants"):
        evaluated.update(str(item) for item in (document.get(key) or ()))
    return evaluated


def _violated_categories(episode: Any, world: Any) -> set[str]:
    output = getattr(episode, "oracle_output", None)
    if output is None and isinstance(episode, Mapping):
        output = episode.get("oracle_output")
    if isinstance(output, Mapping):
        document = output
    else:
        to_document = getattr(output, "to_document", None)
        document = to_document() if callable(to_document) else {}
    violated = {str(item) for item in (document.get("violated_invariants") or ())}
    if not violated or world is None:
        return set()
    return {
        invariant.category
        for invariant in getattr(world, "invariants", ())
        if invariant.invariant_id in violated
    }


def family_reachability(
    episodes: Any,
    *,
    worlds: Mapping[str, Any] | None = None,
    declared_families: Mapping[str, str] | None = None,
    max_witness_examples: int = 3,
) -> FamilyCoverage:
    """不变量族 + 失效族的 witness 级可达性（A6）。

    ``declared_families`` 是 ``world_id -> spec.attack_family``（作者先验声明）。
    每个 (world, family) 对都要求至少一个**程序可达** witness；没有的进
    ``unsupported``——如实列出，绝不计入已支持。
    """
    from .grouping import INVARIANT_CATEGORY_TO_ATTACK_FAMILIES

    world_map = dict(worlds or {})
    declared = dict(declared_families or {})
    declared_categories: dict[tuple[str, str], int] = {}
    invariant_witnesses: dict[tuple[str, str], list[str]] = {}
    failure_witnesses: dict[tuple[str, str], list[str]] = {}
    for world_id, world in sorted(world_map.items()):
        for invariant in getattr(world, "invariants", ()):
            key = (str(world_id), str(invariant.category))
            declared_categories[key] = declared_categories.get(key, 0) + 1
        family = declared.get(str(world_id))
        if family:
            failure_witnesses.setdefault((str(world_id), str(family)), [])
    for episode in episodes:
        world_id = _episode_world_id(episode)
        world = world_map.get(world_id)
        if world is None:
            continue
        evaluated = _evaluated_invariant_ids(episode)
        categories = {
            invariant.category
            for invariant in getattr(world, "invariants", ())
            if invariant.invariant_id in evaluated
        }
        for category in categories:
            key = (world_id, str(category))
            if key in declared_categories:
                bucket = invariant_witnesses.setdefault(key, [])
                if len(bucket) < max_witness_examples:
                    bucket.append(_episode_id(episode))
        # 失效族 witness：attack 真值 + 违反类别能映射到该族（或 spec 声明优先）
        if _world_truth_of_episode(episode) != "attack":
            continue
        violated = _violated_categories(episode, world)
        mappable: set[str] = set()
        for category in violated:
            mappable.update(INVARIANT_CATEGORY_TO_ATTACK_FAMILIES.get(category, ()))
        declared_family = declared.get(world_id)
        if declared_family:
            mappable.add(str(declared_family))
        for family in sorted(mappable):
            key = (world_id, family)
            if key in failure_witnesses:
                bucket = failure_witnesses.setdefault(key, [])
                if len(bucket) < max_witness_examples:
                    bucket.append(_episode_id(episode))
    invariant_rows = tuple(
        FamilyReachabilityResult(
            kind="invariant",
            family=category,
            world_id=world_id,
            witnesses=len(invariant_witnesses.get((world_id, category), ())),
            witness_episode_ids=tuple(invariant_witnesses.get((world_id, category), ())),
        )
        for (world_id, category) in sorted(declared_categories)
    )
    failure_rows = tuple(
        FamilyReachabilityResult(
            kind="failure",
            family=family,
            world_id=world_id,
            witnesses=len(failure_witnesses.get((world_id, family), ())),
            witness_episode_ids=tuple(failure_witnesses.get((world_id, family), ())),
        )
        for (world_id, family) in sorted(failure_witnesses)
    )
    return FamilyCoverage(
        invariant=invariant_rows,
        failure=failure_rows,
        max_witness_examples=max_witness_examples,
    )


def _episode_world_id(episode: Any) -> str:
    value = getattr(episode, "world_id", None)
    if value is None and isinstance(episode, Mapping):
        value = episode.get("world_id")
    return str(value or "")


def unsupported_families(
    episodes: Any,
    worlds: Mapping[str, Any] | None = None,
    declared_families: Mapping[str, str] | None = None,
    *,
    max_witness_examples: int = 3,
) -> tuple[FamilyReachabilityResult, ...]:
    """无 witness 的 (world, family) 族（A6 的 coverage 原料；REVISION 3 / P0-3）。

    **纯函数**：输入 ``(episodes, worlds, declared)``，输出 witness 数为 0 的族
    （不变量族 + 失效族），如实列出、**不拒收**。语料可以合法地携带一个故意越界的
    不变量（HC-017 的 ownership，用来训练 skipped 路径），也可以声明一个它表达不
    出来的攻击族（W-L4-001 的 trust_boundary 不变量 100% ``unbound_subject``）——
    这些都不是"拒收数据"的理由，但**必须出现在 coverage/report 里，绝不计入"已
    支持"**。静态的 ``[]`` 会把"没算过"显示成"没有"，这正是 runner 的
    ``state/provider-coverage.json`` 在 P0-3 之前的形态。

    与 :func:`family_reachability` 同一套判定，只是过滤出 unsupported 子集并直接
    返回结果对象（调用方可 ``to_document()`` 落盘或直接计数）。
    """
    coverage = family_reachability(
        episodes,
        worlds=worlds,
        declared_families=declared_families,
        max_witness_examples=max_witness_examples,
    )
    return coverage.unsupported


__all__ = [
    "MAX_PROBE_WORLDS",
    "MAX_VALUES_PER_REF",
    "FamilyCoverage",
    "FamilyReachabilityResult",
    "PolicyProbeResult",
    "ReachabilityResult",
    "attack_family_reachability",
    "declared_domain",
    "family_reachability",
    "probe_world_policies",
    "unsupported_families",
]
