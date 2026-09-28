"""group key 的确定性派生（设计 §10.1 / §10.3；REVISION 2 从 L5 下沉到 L1）。

泄漏控制的全部依据是"两个样本共享某个 key 值 ⇒ 它们不可分"。因此 key 的派生必须是
**纯函数**：同一 episode（+ 同一世界）⇒ 同一组 key 值，跨进程、跨
``PYTHONHASHSEED`` 稳定（``stable_hash`` 是 sha256 over ``canonical_json``）。

**为什么住 L1**（REVISION 2）：group key 派生是纯文档函数，而 L4 的
``assemble_episode`` 必须在组装期把 key 值盖章进 episode 文档（Gate 2 校验存在性）。
L4 不能 import L5（设计 §3.1 的分层 DAG，``tests/test_import_boundaries.py`` 静态
断言），因此派生逻辑住 L1，L5 的 ``security_world/validation/grouping.py`` 只做
兼容转发（公共 API 与异常类型不变）。**只有一个实现**——两套派生规则会让
"盖在 episode 上的值"与"split 实际用的值"悄悄漂移。

十二个 key（``configs/default.json`` 的 ``leakage_control.group_keys`` 逐字一致）::

    counterfactual_family_id    episode 自带（编译器派生，作者不可填）
    world_family_id             episode 自带（结构骨架派生）
    policy_graph_hash           策略图的抽象骨架 hash（全量 sha256）
    policy_family_id            "PF-" + policy_graph_hash[:12]（同源短形式）
    workflow_template_hash     工作流模板的抽象骨架 hash（全量 sha256）
    workflow_family_id          "WFF-" + workflow_template_hash[:12]（同源短形式）
    invariant_family_id         "IF-" + 不变量集合骨架 hash[:12]
    attack_family              违反的不变量类别 → 攻击族（spec 声明值优先）
    semantic_scenario_signature 场景形状签名：标识符抽象成类型占位符
    app_domain                 世界自带（``world.application_domain``）
    generator_id               provenance 里的生成器标识（手写世界 = "handcrafted"）
    generator_model_family      generator_id 的模型家族段（provider/家族名）

**抽象规则**与 ``world_structural_skeleton_from_document`` 同源：已知实体 id
（无论出现在值位置还是键位置）被替换成实体类型占位符，因此 ``RES-001`` 与
``RES-002`` 的世界共享同一个 ``policy_graph_hash``——"换个资源 id"不构成新的
策略图，而"加一条 deny 规则"构成。
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .canonical import FAMILY_ID_HASH_CHARS, stable_hash
from .entities import INVARIANT_CATEGORIES
from .errors import GroupingError
from .episode import STRATEGY_TO_GROUP_KEY
from .world import WorldInstance, world_structural_skeleton_from_document

#: family id 前缀（与 schema 的 ``group_keys`` 模式一一对应；``WF-``/``CF-`` 与
#: ``canonical.py`` 的两个既有前缀同源，``WFL-`` 是 workflow_id 前缀不冲突）。
POLICY_FAMILY_ID_PREFIX = "PF-"
WORKFLOW_FAMILY_ID_PREFIX = "WFF-"
INVARIANT_FAMILY_ID_PREFIX = "IF-"

#: 十二个 group key（与 ``configs/default.json`` 的 ``leakage_control.group_keys`` 同序）。
GROUP_KEYS: tuple[str, ...] = (
    "counterfactual_family_id",
    "world_family_id",
    "policy_graph_hash",
    "workflow_template_hash",
    "attack_family",
    "semantic_scenario_signature",
    "app_domain",
    "generator_id",
    "generator_model_family",
    "policy_family_id",
    "workflow_family_id",
    "invariant_family_id",
)

#: 无违反不变量时的攻击族取值（``ATTACK_FAMILIES`` 里的 ``benign``）。
BENIGN_ATTACK_FAMILY = "benign"

#: 不变量类别 → 它被违反时对应的攻击族候选（引擎私有常量，不随 author 输入变化）。
#:
#: 一个类别可能对应多个族（``workflow_transition`` 既可能是 bypass 也可能是
#: invalid_state_transition），因此这里是**候选集**；episode 的派生攻击族取候选集
#: 排序后的第一个（确定性 tie-break，与策略匹配的 ``policy_id asc`` 同一哲学）。
#: 类别没有对应族时退化为 ``category:<类别名>``——仍然是确定性的分组键，只是不在
#: 43 个攻击族词表里（如实反映"该类别还没有映射到族"）。
INVARIANT_CATEGORY_TO_ATTACK_FAMILIES: Mapping[str, tuple[str, ...]] = {
    "ownership": ("idor_bola", "owner_mismatch"),
    "authorization": ("horizontal_privesc", "stale_authorization", "vertical_privesc"),
    "tenant_isolation": ("tenant_isolation_violation", "tenant_mismatch"),
    "session_binding": ("cross_account_session_misuse",),
    "session_revocation": ("inconsistent_revocation_state", "revoked_session_reuse"),
    "token_scope": ("audience_mismatch", "scope_mismatch"),
    "token_lineage": ("cross_resource_token_reuse", "cross_workflow_token_reuse", "token_lineage_confusion"),
    "one_time_token": ("one_time_token_reuse",),
    "workflow_transition": (
        "invalid_state_transition",
        "repeated_operation",
        "skipping_required_step",
        "workflow_bypass",
    ),
    "replay": ("token_replay",),
    "privilege_version": ("privilege_version_mismatch", "stale_session_privilege"),
    "cache_consistency": (
        "cache_invalidation_failure",
        "inconsistent_replicas",
        "stale_ownership_cache",
        "stale_permission_cache",
    ),
    "authentication_state": ("session_after_account_disable", "session_after_password_reset"),
    "trust_boundary": (),
    "resource_state": ("irreversible_state_reversal", "resource_state_violation"),
    "temporal": ("race_sensitive_state", "stale_object_reference"),
    "cross_flow_isolation": ("cross_workflow_token_reuse",),
    "cross_user_isolation": ("cross_account_session_misuse",),
    "cross_tenant_isolation": ("tenant_mismatch",),
    "state_freshness": ("stale_session_privilege",),
}

#: 未知类别 ⇒ 无候选（诚实：引擎不为没实现的类别猜族）。
UNMAPPED_CATEGORY_PREFIX = "category:"

#: 手写世界的生成器标识（``provenance.generator_provenance`` 缺失时的兜底）。
HANDCRAFTED_GENERATOR = "handcrafted"


def _skeleton_of(world: WorldInstance | Mapping[str, Any]) -> Mapping[str, Any]:
    if isinstance(world, WorldInstance):
        return world.structural_skeleton()
    return world_structural_skeleton_from_document(world)


def _find(items: Any, id_field: str, entity_id: Any) -> Any:
    """按 id 字段在一个实体元组里找实体（找不到返回 None，绝不抛）。"""
    if entity_id is None:
        return None
    for item in items or ():
        if getattr(item, id_field, None) == entity_id:
            return item
    return None


# --------------------------------------------------------------------------- #
# 结构族 hash / family id
# --------------------------------------------------------------------------- #
def policy_graph_hash(world: WorldInstance | Mapping[str, Any]) -> str:
    """策略图的结构骨架 hash（标识符抽象成类型占位符）。"""
    skeleton = _skeleton_of(world)
    return stable_hash({"policies": skeleton.get("policies") or []})


def workflow_template_hash(world: WorldInstance | Mapping[str, Any]) -> str:
    """工作流模板的结构骨架 hash（状态机形状，不含实例数据）。"""
    skeleton = _skeleton_of(world)
    workflows = (skeleton.get("entities") or {}).get("workflows") or []
    return stable_hash({"workflows": workflows})


def invariant_family_hash(world: WorldInstance | Mapping[str, Any]) -> str:
    """不变量集合的结构骨架 hash（类别 + expr 形状，标识符抽象）。"""
    skeleton = _skeleton_of(world)
    return stable_hash({"invariants": skeleton.get("invariants") or []})


def policy_family_id(world: WorldInstance | Mapping[str, Any]) -> str:
    """``"PF-" + policy_graph_hash[:12]``（REVISION 2：策略族的短 id 形式）。

    与 ``policy_graph_hash`` **严格同源**（1:1，不是两套派生）：同一个策略图 ⇒ 同一个
    family id，测试钉死这条一一对应。短 id 给人读与 manifest 用，全量 hash 给
    union-find 用——两者必须不可能漂移，所以 family id 就是 hash 的前 12 位。
    """
    return POLICY_FAMILY_ID_PREFIX + policy_graph_hash(world)[:FAMILY_ID_HASH_CHARS]


def workflow_family_id(world: WorldInstance | Mapping[str, Any]) -> str:
    """``"WFF-" + workflow_template_hash[:12]``（REVISION 2：工作流族短 id）。"""
    return WORKFLOW_FAMILY_ID_PREFIX + workflow_template_hash(world)[:FAMILY_ID_HASH_CHARS]


def invariant_family_id(world: WorldInstance | Mapping[str, Any]) -> str:
    """``"IF-" + invariant_family_hash[:12]``（REVISION 2：不变量族短 id）。"""
    return INVARIANT_FAMILY_ID_PREFIX + invariant_family_hash(world)[:FAMILY_ID_HASH_CHARS]


# --------------------------------------------------------------------------- #
# 攻击族
# --------------------------------------------------------------------------- #
def attack_family_of(episode: Any, *, declared: str | None = None) -> str:
    """episode 的攻击族。

    ``declared`` 给出时（``spec.attack_family``，即作者先验声明）优先——泄漏审计与
    ``attack_family_reachability`` 要比较的正是"声明的族"与"可达的样本"。
    否则委托 :func:`derive_attack_family` 从 oracle 输出派生。
    """
    if declared is not None:
        declared_text = str(declared).strip()
        if not declared_text:
            raise GroupingError(
                "empty_declared_attack_family", "declared attack_family 不允许为空字符串"
            )
        return declared_text
    return derive_attack_family(episode)


def _oracle_document(episode: Any) -> Mapping[str, Any]:
    output = getattr(episode, "oracle_output", None)
    if output is None and isinstance(episode, Mapping):
        output = episode.get("oracle_output")
    if output is None:
        raise GroupingError("episode_without_oracle_output", "episode 缺少 oracle_output")
    to_document = getattr(output, "to_document", None)
    if callable(to_document):
        return to_document()
    if isinstance(output, Mapping):
        return output
    raise GroupingError(
        "oracle_output_not_document",
        f"oracle_output 必须是文档或带 to_document()，得到 {type(output).__name__}",
    )


def violated_invariant_categories(episode: Any, world: WorldInstance | None = None) -> tuple[str, ...]:
    """episode 被违反不变量的类别（排序去重；世界缺失时返回空元组）。"""
    document = _oracle_document(episode)
    violated = tuple(str(item) for item in document.get("violated_invariants") or ())
    if not violated or world is None:
        return ()
    categories = {
        invariant.category
        for invariant in world.invariants
        if invariant.invariant_id in set(violated)
    }
    return tuple(sorted(categories))


def derive_attack_family(episode: Any, world: WorldInstance | None = None) -> str:
    """从违反的不变量**派生**攻击族（无 spec 声明时的确定性回退）。"""
    categories = violated_invariant_categories(episode, world)
    if not categories:
        return BENIGN_ATTACK_FAMILY
    candidates: set[str] = set()
    for category in categories:
        candidates.update(INVARIANT_CATEGORY_TO_ATTACK_FAMILIES.get(category, ()))
        if not INVARIANT_CATEGORY_TO_ATTACK_FAMILIES.get(category):
            candidates.add(f"{UNMAPPED_CATEGORY_PREFIX}{category}")
    if not candidates:
        return BENIGN_ATTACK_FAMILY
    return sorted(candidates)[0]


# --------------------------------------------------------------------------- #
# 生成器与域
# --------------------------------------------------------------------------- #
def generator_id(episode: Any) -> str:
    """生成器标识（``provenance.generator_provenance`` 的 model+version；手写世界兜底）。"""
    provenance = getattr(episode, "provenance", None)
    if provenance is None and isinstance(episode, Mapping):
        provenance = episode.get("provenance")
    generator = (provenance or {}).get("generator_provenance") if isinstance(provenance, Mapping) else None
    if not isinstance(generator, Mapping):
        return HANDCRAFTED_GENERATOR
    model = str(generator.get("model") or "unknown")
    version = str(generator.get("model_version") or "unknown")
    return f"{model}@{version}"


def generator_model_family(episode: Any) -> str:
    """生成器**模型家族**（REVISION 2 新增 group key）。

    规则：``generator_id`` 的模型段（``@`` 前的第一段，即 provider/家族名）——
    ``deepseek-v4-flash@2026-08-01`` 与 ``deepseek-v4-flash@2026-09-01`` 同族，
    与 ``qwen3-4b@...`` 不同族。手写世界（无 generator provenance）⇒ ``handcrafted``。

    它度量的是"哪个生成器家族产出了这个世界"：同一家族的不同版本共享模板指纹，
    ``generator_ood`` 按 ``generator_id``（精确到版本）留出，本 key 则让审计能按
    家族聚合——两个粒度都要可查，否则"换了个版本号就绕过家族级审计"。
    """
    identifier = generator_id(episode)
    if identifier == HANDCRAFTED_GENERATOR:
        return HANDCRAFTED_GENERATOR
    model = identifier.split("@", 1)[0]
    return model.split("-", 1)[0] if "-" in model else model


def app_domain_of(episode: Any, world: WorldInstance | None = None) -> str:
    """应用域（世界权威字段；episode 不带它——投影白名单禁止它进 model_visible）。"""
    if world is None:
        raise GroupingError(
            "app_domain_requires_world",
            "app_domain 只能从世界取（configs.default.json 的 world_side_forbidden 禁止它"
            "进入 model_visible）；请传 worlds= 或 group_keys=",
        )
    return str(world.application_domain)


def semantic_scenario_signature(episode: Any, world: WorldInstance | None = None) -> str:
    """场景形状签名：把场景里的一切实体标识符抽象成类型/形状占位符。

    签名刻画的是"这是一次什么样的操作"（operation、资源类型、actor 角色名集合、
    actor 类型、绑定了哪些可空主体、世界规模），**不**包含任何具体 id、任何状态值、
    任何标签——因此两个只有 id 不同的世界共享签名，而"读订单"与"退款订单"不共享。
    """
    action = getattr(episode, "action", None)
    if action is None and isinstance(episode, Mapping):
        action = episode.get("action")
    if not isinstance(action, Mapping):
        to_document = getattr(action, "to_document", None)
        action = to_document() if callable(to_document) else action
    if not isinstance(action, Mapping):
        raise GroupingError("episode_without_action", "episode 缺少 action 文档")

    role_names: tuple[str, ...] = ()
    actor_type = "unknown"
    resource_type = "unbound"
    if world is not None:
        actor_id = action.get("actor")
        actor = _find(world.actors, "actor_id", actor_id)
        if actor is not None:
            actor_type = str(actor.actor_type)
            declared_roles = {role.role_id: role.name for role in world.roles}
            role_names = tuple(
                sorted(
                    declared_roles.get(role_id, role_id)
                    for role_id in (actor.roles or ())
                )
            )
        resource_id = action.get("resource")
        if resource_id is not None:
            resource = _find(world.resources, "resource_id", resource_id)
            resource_type = str(resource.resource_type) if resource is not None else "unknown"
    signature = {
        "operation": str(action.get("operation") or ""),
        "resource_type": resource_type,
        "actor_type": actor_type,
        "actor_role_names": list(role_names),
        "bindings": {
            "session": bool(action.get("session")),
            "token": bool(action.get("token")),
            "workflow_instance": bool(action.get("workflow_instance")),
        },
        "world_scale": {
            "actors": len(world.actors) if world is not None else -1,
            "resources": len(world.resources) if world is not None else -1,
            "sessions": len(world.sessions) if world is not None else -1,
            "tokens": len(world.tokens) if world is not None else -1,
        },
    }
    return stable_hash(signature)


# --------------------------------------------------------------------------- #
# 汇总
# --------------------------------------------------------------------------- #
def episode_group_keys(
    episode: Any,
    *,
    world: WorldInstance | None = None,
    declared_attack_family: str | None = None,
) -> dict[str, str]:
    """一个 episode 的**十二个** group key 值（缺失即抛 :class:`GroupingError`）。

    调用方（``assign_splits`` / ``run_gates`` / ``assemble_episode``）负责提供
    ``world``；没有世界就**算不出** ``app_domain`` / ``policy_graph_hash`` /
    ``workflow_template_hash`` / ``invariant_family_id``，此时宁可失败也不猜一个
    值——猜出来的 key 会让泄漏审计静默失效。
    """
    family_id = getattr(episode, "counterfactual_family_id", None)
    world_family_id = getattr(episode, "world_family_id", None)
    if family_id is None and isinstance(episode, Mapping):
        family_id = episode.get("counterfactual_family_id")
        world_family_id = episode.get("world_family_id")
    if not family_id or not world_family_id:
        raise GroupingError(
            "episode_without_family_ids",
            "episode 必须带 counterfactual_family_id / world_family_id",
        )
    if declared_attack_family is not None:
        family = attack_family_of(episode, declared=declared_attack_family)
    else:
        family = derive_attack_family(episode, world)
    if world is None:
        missing = "policy_graph_hash / workflow_template_hash / app_domain / invariant_family_id"
        raise GroupingError(
            "group_keys_require_world",
            f"group key 派生需要世界（{missing}）；请传 worlds= 或显式 group_keys=",
        )
    return {
        "counterfactual_family_id": str(family_id),
        "world_family_id": str(world_family_id),
        "policy_graph_hash": policy_graph_hash(world),
        "workflow_template_hash": workflow_template_hash(world),
        "attack_family": family,
        "semantic_scenario_signature": semantic_scenario_signature(episode, world),
        "app_domain": app_domain_of(episode, world),
        "generator_id": generator_id(episode),
        "generator_model_family": generator_model_family(episode),
        "policy_family_id": policy_family_id(world),
        "workflow_family_id": workflow_family_id(world),
        "invariant_family_id": invariant_family_id(world),
    }


def invariant_categories_covered(world: WorldInstance) -> tuple[str, ...]:
    """世界声明的不变量类别（用于 domain coverage 审计）。"""
    return tuple(sorted({invariant.category for invariant in world.invariants}))


def all_invariant_categories() -> tuple[str, ...]:
    """引擎实现的全部不变量类别（``INVARIANT_CATEGORIES``，Phase 1 已实现的子集）。"""
    return tuple(sorted(INVARIANT_CATEGORIES))


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
