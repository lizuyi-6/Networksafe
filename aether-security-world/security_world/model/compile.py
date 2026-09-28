"""``compile_spec``：WorldSpec → WorldInstance 的五步契约（设计 §4.1）。

契约逐条落地::

    1. 逐字复制 spec 的全部实体/状态/证据字段
    2. 派生 world_family_id = "WF-" + stable_hash(结构骨架)[:12]
    3. 删除 hypotheses、attack_family（记入 compile.dropped_hypothesis_fields）
    4. 写 compile{compiler_version, source_spec_id, derived_world_family_id,
                  dropped_hypothesis_fields, reason_codes}
    5. 校验：引用完整性 / ref 全域可解析 / policy 非空洞 / state_history 单调 /
             current_state.at >= max(history.at) / actor.roles ⊆ roles[].role_id /
             applies_to 的 operation 存在于 endpoints /
             critical 轴 ⊆ whitelist 且非 observation 路径

任何一条不满足都抛 :class:`CompileError` 并带稳定 ``reason_code``——**不修、
不降级、不静默通过**。

一个刻意**没有**实现的检查：``current_state`` / ``state_history`` 与实体列表的
"双记一致性"。设计 §4.4 说它归 Gate 2，而参考夹具自己的
``current_state.actor_states`` 只列了 4 个 actor 里的 2 个——任何严格一致性检查
都会把黄金夹具拒掉。这里如实记录该边界，由 Gate 2 决定容忍度。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .clock import compare_instants
from .config import (
    IRRELEVANT_AXIS_PREFIX,
    axis_matches_whitelist,
    critical_axes_whitelist,
    try_load_default_config,
)
from .errors import CompileError, ModelError, RefResolutionError, first_error_line
from .refs import (
    ACTION_LOCAL_VIEWS,
    ReferenceRegistry,
    classify_path,
    condition_ref_paths,
    is_literal,
    parse_action_view,
)
from .rng import validate_seed
from .schemas import schema_errors
from .world import (
    OPTIONAL_COLLECTIONS,
    WorldInstance,
    WorldSpec,
    derive_world_family_id,
)

#: 编译器版本（写进 ``compile.compiler_version``）。
COMPILER_VERSION = "0.1.0"

#: 假设字段：编译时整体丢弃并记录（B7）。顺序即设计 §4.1 第 3 步的书写顺序。
#: ``notes`` / ``$comment`` 是作者说明，``world.schema.json`` 结构上装不下它们，
#: 但它们不是假设，故不记入此列表（参考夹具的 ``dropped_hypothesis_fields``
#: 正是这两个、且是这个顺序）。
DROPPED_HYPOTHESIS_FIELDS: tuple[str, ...] = ("hypotheses", "attack_family")

#: spec 独有、instance 不携带的顶层字段。
SPEC_ONLY_FIELDS: frozenset[str] = frozenset({
    "hypotheses",
    "attack_family",
    "notes",
    "critical_state_variables",
    "irrelevant_state_variables",
    "episode_templates",
    "$comment",
})


# --------------------------------------------------------------------------- #
# 引用完整性
# --------------------------------------------------------------------------- #
def _check_ref_path(path: str, registry: ReferenceRegistry) -> tuple[str, str] | None:
    """单条 DSL ref 路径的静态可解析性；返回 ``(reason_code, detail)`` 或 ``None``。"""
    kind = classify_path(path)
    if kind == "context":
        return None
    if kind == "invalid":
        return ("invalid_ref_path", f"ref 路径 {path!r} 不符合 §4.3 的任何一类视图")
    if kind == "id_view":
        if registry.contains(path):
            return None
        try:
            registry.resolve(path)
        except RefResolutionError as exc:
            return ("ref_unresolvable", f"ref 路径 {path!r} 无法解析（{exc.reason}）")
        return None  # pragma: no cover - contains 与 resolve 一致
    # action 绑定视图
    binding, fields = parse_action_view(path)
    if binding in ACTION_LOCAL_VIEWS:
        return None  # action.parameters.* / action.request.* 是动作局部数据
    candidate_ids = registry.ids(binding)
    if not candidate_ids:
        # 世界里没有该类型实体：编译期无法静态验证，运行期按 unbound_subject 跳过。
        return None
    suffix = ".".join(fields)
    if any(registry.contains(f"{binding}.{entity_id}.{suffix}") for entity_id in candidate_ids):
        return None
    return (
        "ref_unresolvable",
        f"ref 路径 {path!r} 展开后没有任何 {binding} 实体具备字段 {suffix!r}",
    )


def entity_reference_errors(world: WorldInstance) -> tuple[tuple[str, str], ...]:
    """实体间的硬引用（owner / principal / subject / holder / role / parent_token…）。"""
    registry = world.registry
    errors: list[tuple[str, str]] = []

    def need(entity_type: str, entity_id: str | None, where: str) -> None:
        if entity_id is None:
            return
        if not registry.has_entity(entity_type, entity_id):
            errors.append(
                (
                    "dangling_ref",
                    f"{where} 引用了不存在的 {entity_type} {entity_id!r}",
                )
            )

    for actor in world.actors:
        for role_id in actor.roles:
            if not registry.has_entity("role", role_id):
                errors.append(
                    ("role_dangling", f"actor {actor.actor_id}.roles 引用了未声明的 role {role_id!r}")
                )
    for resource in world.resources:
        need("actor", resource.owner, f"resource {resource.resource_id}.owner")
    for session in world.sessions:
        need("actor", session.principal, f"session {session.session_id}.principal")
    for token in world.tokens:
        need("actor", token.subject, f"token {token.token_id}.subject")
        need("token", token.parent_token, f"token {token.token_id}.parent_token")
        need("resource", token.bound_resource, f"token {token.token_id}.bound_resource")
    for credential in world.credentials:
        need("actor", credential.holder, f"credential {credential.credential_id}.holder")
    for workflow in world.workflows:
        for instance in workflow.instances:
            need(
                "resource",
                instance.resource_id,
                f"workflow_instance {instance.instance_id}.resource_id",
            )
    for item in world.evidence:
        failure = _check_ref_path(item.asserts_ref, registry)
        if failure is not None:
            errors.append(
                ("dangling_ref", f"evidence {item.evidence_id}.asserts_ref: {failure[1]}")
            )
    for entry in world.caches:
        failure = _check_ref_path(entry.cached_subject, registry)
        if failure is not None:
            errors.append(
                ("dangling_ref", f"cache {entry.cache_id}.cached_subject: {failure[1]}")
            )
    return tuple(errors)


def dsl_reference_errors(world: WorldInstance) -> tuple[tuple[str, str], ...]:
    """policy / invariant / 条件迁移里的每条 ref 都必须可解析（§4.3 规则 1-2）。"""
    registry = world.registry
    errors: list[tuple[str, str]] = []

    def scan(condition: Mapping[str, Any], where: str) -> None:
        for path in condition_ref_paths(condition):
            failure = _check_ref_path(path, registry)
            if failure is not None:
                errors.append((failure[0], f"{where} 的 {failure[1]}"))

    for policy in world.policies:
        scan(policy.condition, f"policy {policy.policy_id}.condition")
    for invariant in world.invariants:
        scan(invariant.expr, f"invariant {invariant.invariant_id}.expr")
    for workflow in world.workflows:
        for transition in workflow.transitions:
            if transition.condition is not None:
                scan(
                    transition.condition,
                    f"workflow {workflow.workflow_id}.transitions[]"
                    f"[{transition.from_state}->{transition.to_state}].condition",
                )
    return tuple(errors)


def reference_integrity_errors(world: WorldInstance) -> tuple[tuple[str, str], ...]:
    """合并实体引用与 DSL 引用的完整性错误（空元组表示完整）。"""
    return entity_reference_errors(world) + dsl_reference_errors(world)


def token_cycle_errors(world: WorldInstance) -> tuple[tuple[str, str], ...]:
    """``parent_token`` 链上的环（``lineage_depth`` / ``lineage_root`` 因此是全函数）。"""
    parents = {token.token_id: token.parent_token for token in world.tokens}
    errors: list[tuple[str, str]] = []
    for token_id in sorted(parents):
        seen = {token_id}
        current = parents[token_id]
        while current is not None:
            if current in seen:
                errors.append(
                    ("cycle", f"token {token_id} 的 parent_token 链上存在环（{current!r}）")
                )
                break
            seen.add(current)
            current = parents.get(current)
    return tuple(errors)


# --------------------------------------------------------------------------- #
# 其余编译期校验
# --------------------------------------------------------------------------- #
def policy_vacuity_errors(world: WorldInstance) -> tuple[tuple[str, str], ...]:
    """policy 非空洞性（R5）：恒真放行与恒拒都拒。

    只查**顶层字面量**：``and`` / ``or`` 的常量折叠留给 Gate 3 的探针算法
    （设计 §8.4 需要真正求值，那是 L2/L5 的能力）。这里能低成本堵掉最典型的
    两种退化——``allow if true`` 与"永不匹配的规则"。
    """
    errors: list[tuple[str, str]] = []
    for policy in world.policies:
        if is_literal(policy.condition, True):
            if policy.effect == "allow" and not policy.is_default_rule:
                errors.append(
                    (
                        "vacuous_policy",
                        f"policy {policy.policy_id} 的条件是常量 true 且 effect=allow"
                        "（allow if true，R5）；如确为闭世界兜底请标 is_default_rule",
                    )
                )
        elif is_literal(policy.condition, False):
            errors.append(
                (
                    "vacuous_policy",
                    f"policy {policy.policy_id} 的条件是常量 false，永不匹配",
                )
            )
    return tuple(errors)


def temporal_errors(world: WorldInstance) -> tuple[tuple[str, str], ...]:
    """``state_history`` 单调 + ``current_state.at >= max(history.at)``（§4.4 / S3）。"""
    errors: list[tuple[str, str]] = []
    previous: str | None = None
    latest: str | None = None
    for index, snapshot in enumerate(world.state_history):
        if previous is not None and compare_instants(snapshot.at, previous) < 0:
            errors.append(
                (
                    "history_non_monotonic",
                    f"state_history[{index}].at={snapshot.at} 早于前一个快照 {previous}",
                )
            )
        previous = snapshot.at
        if latest is None or compare_instants(snapshot.at, latest) > 0:
            latest = snapshot.at
    if latest is not None and compare_instants(world.current_state.at, latest) < 0:
        errors.append(
            (
                "current_state_before_history",
                f"current_state.at={world.current_state.at} 早于 state_history 的最大值 {latest}",
            )
        )
    return tuple(errors)


def applies_to_errors(world: WorldInstance) -> tuple[tuple[str, str], ...]:
    """``applies_to`` 里的 operation 必须存在于 ``application.endpoints``（§7.4）。"""
    operations = world.application.operations()
    errors: list[tuple[str, str]] = []
    for invariant in world.invariants:
        for operation in invariant.applies_to:
            if operation == "*":
                continue
            if operation not in operations:
                errors.append(
                    (
                        "applies_to_unknown_operation",
                        f"invariant {invariant.invariant_id}.applies_to 的 operation "
                        f"{operation!r} 不在 application.endpoints",
                    )
                )
    return tuple(errors)


def axis_errors(
    world: WorldInstance,
    critical_axes: Sequence[str],
    irrelevant_axes: Sequence[str],
    *,
    whitelist: Sequence[str],
) -> tuple[tuple[str, str], ...]:
    """关键轴 ⊆ 白名单、非 observation 路径、可解析；无关轴必须是 observation 路径。"""
    errors: list[tuple[str, str]] = []
    for axis in critical_axes:
        if axis.startswith("observation."):
            errors.append(
                ("axis_is_observation_path", f"critical 轴 {axis!r} 指向 observation 表面路径（B9）")
            )
            continue
        if not axis_matches_whitelist(axis, tuple(whitelist)):
            errors.append(
                ("axis_not_in_whitelist", f"critical 轴 {axis!r} 不匹配 critical_axes_whitelist")
            )
            continue
        if not world.contains(axis):
            errors.append(("axis_unresolvable", f"critical 轴 {axis!r} 在本世界中无法解析"))
    for axis in irrelevant_axes:
        if not axis.startswith(IRRELEVANT_AXIS_PREFIX):
            errors.append(
                (
                    "irrelevant_axis_not_observation_path",
                    f"irrelevant 轴 {axis!r} 必须是 observation.(request|rendering).* 路径（B9）",
                )
            )
    return tuple(errors)


# --------------------------------------------------------------------------- #
# compile_spec
# --------------------------------------------------------------------------- #
def compile_spec(
    spec: WorldSpec,
    *,
    seed: int | None = None,
    config: Mapping[str, Any] | None = None,
) -> WorldInstance:
    """把 spec 编译成 instance。任一校验失败抛 :class:`CompileError`。

    ``seed`` 省略时用 ``spec.seed``；显式传入则覆盖，用于从同一个 spec 派生多个
    统计独立的实例（设计 §15.3 的签名是 ``compile_spec(spec, *, seed: int)``，
    这里放宽成可选以兼容 ``compile_spec(spec)`` 的调用方式）。
    """
    resolved_seed = spec.seed if seed is None else validate_seed(seed)
    spec_document = spec.to_document()

    # 步骤 1 + 3：逐字复制，删除假设块。
    instance_document: dict[str, Any] = {
        key: value for key, value in spec_document.items() if key not in SPEC_ONLY_FIELDS
    }
    instance_document["seed"] = resolved_seed
    for collection in OPTIONAL_COLLECTIONS:
        instance_document.setdefault(collection, [])
    dropped = [key for key in DROPPED_HYPOTHESIS_FIELDS if key in spec_document]

    # 步骤 2：派生 world_family_id（在写入派生字段之前算，骨架只含结构与策略）。
    instance_document["world_family_id"] = derive_world_family_id(instance_document)

    # 步骤 4：写 compile 审计块。
    instance_document["compile"] = {
        "compiler_version": COMPILER_VERSION,
        "source_spec_id": spec.world_id,
        "derived_world_family_id": True,
        "dropped_hypothesis_fields": dropped,
        "reason_codes": [],
    }

    failures = schema_errors(instance_document, "world")
    if failures:
        raise CompileError("schema_invalid", "; ".join(failures))

    try:
        world = WorldInstance.from_document(instance_document)
    except ModelError as exc:
        raise CompileError("malformed_document", first_error_line(exc)) from exc

    effective_config = config if config is not None else try_load_default_config()
    whitelist = critical_axes_whitelist(effective_config)

    # 步骤 5：逐项校验（顺序即设计的第 5 步顺序，保证 reason_code 可预期）。
    checks: tuple[tuple[str, tuple[tuple[str, str], ...]], ...] = (
        ("引用完整性", reference_integrity_errors(world)),
        ("token 血缘", token_cycle_errors(world)),
        ("policy 非空洞", policy_vacuity_errors(world)),
        ("时间单调", temporal_errors(world)),
        ("applies_to 作用域", applies_to_errors(world)),
        (
            "反事实轴",
            axis_errors(
                world,
                spec.critical_state_variables,
                spec.irrelevant_state_variables,
                whitelist=whitelist,
            ),
        ),
    )
    for label, errors in checks:
        if errors:
            reason_code, detail = errors[0]
            raise CompileError(reason_code, f"{label}: {detail}（共 {len(errors)} 处）")
    return world


__all__ = [
    "COMPILER_VERSION",
    "DROPPED_HYPOTHESIS_FIELDS",
    "SPEC_ONLY_FIELDS",
    "applies_to_errors",
    "axis_errors",
    "compile_spec",
    "dsl_reference_errors",
    "entity_reference_errors",
    "policy_vacuity_errors",
    "reference_integrity_errors",
    "temporal_errors",
    "token_cycle_errors",
]
