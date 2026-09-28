"""Phase 2A 的**机制族注册表**（brief §24-25）。

一个机制族是一份**声明式程序**：它说清楚这个世界要开哪些实体槽、每个语义事实落在
哪个槽、状态随时间怎么走、要编译出哪些不变量、证据怎么摆、信任关系长什么样、反事实
允许怎么改。编译器（:mod:`semantic_skeleton.compiler`）只是这份声明的解释器——它不
为任何机制写特殊分支，因此新增机制不需要改编译器，只需要在这里加一条记录 + 测试。

三条硬规则：

1. **``attack_family`` 由机制派生，不由 LLM 标注**（brief §17 禁止骨架携带 attack
   label）。同一机制在不同业务域下编译出的世界，attack_family 逐字相同。
2. **覆盖标签是多标签的**（brief §26 "允许一个 world 多标签"）。Phase 1 用
   ``attack_family → 单一类别`` 的映射，导致 multi_tenant = 0 也无从补救；Phase 2A
   直接由机制声明它参与哪些覆盖类别。
3. **机制必须可判定**：注册期的自校验会真的把机制编译成一个世界并跑 Oracle，确认
   (a) 能编译、(b) 至少一个 base 判决不是 insufficient、(c) 声明的关键轴确实能翻转
   判决。跑不过的机制在 import 时就炸——而不是等 provider 烧完 token 才发现。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping

#: 覆盖类别（brief §26/§27）。多标签，允许重叠。
COVERAGE_LABELS: tuple[str, ...] = (
    "authorization", "session", "token", "workflow", "cache_distributed",
    "multi_tenant", "trust_boundary", "temporal_history", "cross_flow_reuse",
)

#: 状态更新的路径前缀（槽名）→ 世界状态里的分组。
SLOT_GROUPS: Mapping[str, str] = {
    "principal": "actor_states",
    "peer": "actor_states",
    "target_resource": "resource_states",
    "acting_session": "session_states",
    "acting_token": "token_states",
    "lineage_parent": "token_states",
    "workflow_instance": "workflow_states",
    "cache_entry": "caches",
    "second_cache": "caches",
    "authority_service": "services",
    "credential": "credentials",
    "boundary": "trust_boundaries",
}


@dataclass(frozen=True)
class StateStep:
    """轨迹上的一步：某个 landmark 事件发生时，哪些状态字段变成什么。"""

    landmark: str
    updates: tuple[tuple[str, object], ...]


@dataclass(frozen=True)
class InvariantSpec:
    """要编译出的一条不变量（archetype + 参数）。"""

    archetype: str
    params: Mapping[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class CounterfactualSpec:
    """一个允许的反事实：改哪个语义事实、允许哪些改法、缺省期望是什么。"""

    fact: str
    changes: tuple[str, ...]
    #: 缺省 semantic_expectation（最终分类仍由 Oracle 轨迹决定，brief §35）。
    default_expectation: str = "verdict_flip"


@dataclass(frozen=True)
class EvidenceSpec:
    """一条证据的摆放：断言哪个语义事实、用什么信任级别、新鲜度与可控性。"""

    fact: str
    trust: str = "trusted"
    freshness: str = "fresh"
    attacker_controllable: bool = False
    provenance: str = "system_of_record"
    optional: bool = False


@dataclass(frozen=True)
class Mechanism:
    """一个机制族的完整声明。"""

    family: str
    category: str
    coverage_labels: tuple[str, ...]
    attack_family: str
    summary: str
    #: 必须出现的语义事实（缺一个即 MISSING_CRITICAL_FACT）。
    required_facts: tuple[str, ...]
    #: 可以出现但不强求的语义事实。
    optional_facts: tuple[str, ...] = ()
    #: 要开出来的实体（决定 EntityConstructor 建什么）。
    entities: tuple[str, ...] = ("actor", "resource", "workflow", "service")
    #: 槽 → 语义事实（FactBinder 的权威绑定；同一事实只能占一个槽）。
    slot_facts: Mapping[str, str] = field(default_factory=dict)
    #: 状态轨迹（landmark 顺序即时间顺序）。
    trajectory: tuple[StateStep, ...] = ()
    #: 必须出现的历史 landmark（按序）；缺一个即 HISTORY_INCONSISTENT。
    required_landmarks: tuple[str, ...] = ()
    #: 编译出的不变量。
    invariants: tuple[InvariantSpec, ...] = ()
    #: 反事实计划。
    counterfactuals: tuple[CounterfactualSpec, ...] = ()
    #: 证据计划（required_evidence 的落地）。
    evidence: tuple[EvidenceSpec, ...] = ()
    #: 信任关系需要编译器落地的结构（boundary / cache source / consistency）。
    trust_boundary: bool = False
    cache_source: str = ""
    service_consistency: str = "strong"
    #: 工作流状态机（空表示用通用生命周期）。
    workflow_states: tuple[str, ...] = ()
    workflow_initial_state: str = ""
    workflow_transitions: tuple[tuple[str, str], ...] = ()
    #: 无关事实的候选（irrelevant_facts 必须从这里取，且不得与 critical 冲突）。
    irrelevant_candidates: tuple[str, ...] = ()
    #: 是否让世界**声明**一对互相矛盾的 establishing 证据。
    #: 掩蔽的 ``contradictory`` level 只能保留世界声明出来的矛盾，不能制造它；而一旦
    #: 声明，被矛盾的事实就建不起来 ⇒ base 的 observable_decision 只能是
    #: insufficient_evidence。因此这**不是**免费的样本类：只有本来就设计成"决策建立在
    #: 不可信/冲突来源上"的机制才该开。其余机制如实少一个掩蔽 level（进 ``skipped``），
    #: 与 Phase 1 人工世界的行为一致。
    declare_contradiction: bool = False


# --------------------------------------------------------------------------- #
# 便捷构造助手
# --------------------------------------------------------------------------- #
def _inv(archetype: str, **params: object) -> InvariantSpec:
    return InvariantSpec(archetype=archetype, params=dict(params))


def _cf(fact: str, *changes: str, expectation: str = "verdict_flip") -> CounterfactualSpec:
    return CounterfactualSpec(fact=fact, changes=tuple(changes), default_expectation=expectation)


def _ev(
    fact: str,
    *,
    trust: str = "trusted",
    freshness: str = "fresh",
    attacker_controllable: bool = False,
    provenance: str = "system_of_record",
    optional: bool = False,
) -> EvidenceSpec:
    return EvidenceSpec(
        fact=fact, trust=trust, freshness=freshness,
        attacker_controllable=attacker_controllable, provenance=provenance,
        optional=optional,
    )


_GENERIC_WORKFLOW = ("open", "active", "closed")
_GENERIC_TRANSITIONS = (("open", "active"), ("active", "closed"))
_APPROVAL_WORKFLOW = ("draft", "submitted", "approved", "deployed", "rejected")
_APPROVAL_TRANSITIONS = (
    ("draft", "submitted"), ("submitted", "approved"), ("submitted", "rejected"),
    ("approved", "deployed"),
)

#: 全部机制族的**无关事实候选**（跨族共用；与 critical_facts 的冲突由 validator 查）。
_COMMON_IRRELEVANT = ("resource_sensitivity", "session_auth_strength", "identity_verified")


def _mt(
    family: str,
    *,
    attack_family: str,
    summary: str,
    required_facts: tuple[str, ...],
    entities: tuple[str, ...],
    slot_facts: Mapping[str, str],
    trajectory: tuple[StateStep, ...],
    landmarks: tuple[str, ...],
    invariants: tuple[InvariantSpec, ...],
    counterfactuals: tuple[CounterfactualSpec, ...],
    evidence: tuple[EvidenceSpec, ...],
    extra_labels: tuple[str, ...] = (),
    **kwargs: object,
) -> Mechanism:
    labels = tuple(dict.fromkeys(("multi_tenant", *extra_labels)))
    return Mechanism(
        family=family,
        category="multi_tenant",
        coverage_labels=labels,
        attack_family=attack_family,
        summary=summary,
        required_facts=required_facts,
        entities=entities,
        slot_facts=dict(slot_facts),
        trajectory=trajectory,
        required_landmarks=landmarks,
        invariants=invariants,
        counterfactuals=counterfactuals,
        evidence=evidence,
        **kwargs,  # type: ignore[arg-type]
    )


# --------------------------------------------------------------------------- #
# authorization
# --------------------------------------------------------------------------- #
_AUTHORIZATION: tuple[Mechanism, ...] = (
    Mechanism(
        family="ownership_boundary_crossing",
        category="authorization",
        coverage_labels=("authorization",),
        attack_family="idor_bola",
        summary="调用方不是资源属主却读到了它：属主比较是唯一的决定性条件。",
        required_facts=("authenticated_principal", "resource_owner"),
        entities=("actor", "resource", "workflow", "service"),
        slot_facts={"principal": "authenticated_principal", "target_resource": "resource_owner"},
        required_landmarks=("login", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("ownership"),),
        counterfactuals=(_cf("resource_owner", "reassign_to_peer"),),
        evidence=(_ev("resource_owner"),),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="horizontal_peer_access",
        category="authorization",
        coverage_labels=("authorization", "multi_tenant"),
        attack_family="horizontal_privesc",
        summary="同租户内的平级主体读取他人资源：属主不同但租户相同。",
        required_facts=("authenticated_principal", "peer_principal", "resource_owner", "authenticated_tenant"),
        entities=("actor", "resource", "workflow", "service"),
        slot_facts={
            "principal": "authenticated_principal",
            "peer": "peer_principal",
            "target_resource": "resource_owner",
        },
        required_landmarks=("login", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("ownership"),),
        counterfactuals=(_cf("resource_owner", "reassign_to_peer"),),
        evidence=(_ev("resource_owner"), _ev("authenticated_tenant")),
        irrelevant_candidates=("resource_sensitivity", "session_auth_strength"),
    ),
    Mechanism(
        family="vertical_privilege_escalation",
        category="authorization",
        coverage_labels=("authorization",),
        attack_family="vertical_privesc",
        summary="主体缺少特权角色却执行了特权操作。",
        required_facts=("current_role", "authenticated_principal"),
        entities=("actor", "resource", "workflow", "service"),
        slot_facts={"principal": "current_role"},
        required_landmarks=("login", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("role_required", roles=("ROLE-ADMIN",)),),
        counterfactuals=(_cf("current_role", "grant_privileged_role", "drop_privileged_role"),),
        evidence=(_ev("current_role"),),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="privilege_version_drift",
        category="authorization",
        coverage_labels=("authorization", "temporal_history"),
        attack_family="stale_authorization",
        summary="权限在主体侧已升级，但会话仍持旧版本快照，授权按旧版本放行。",
        required_facts=("privilege_version", "session_privilege_version"),
        entities=("actor", "resource", "session", "workflow", "service"),
        slot_facts={
            "principal": "privilege_version",
            "acting_session": "session_privilege_version",
        },
        required_landmarks=("login", "role_changed", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep(
                "role_changed",
                (("principal.privilege_version", 2), ("acting_session.privilege_version", 1)),
            ),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("session_privilege_version_matches_actor"),),
        counterfactuals=(
            _cf("session_privilege_version", "align_with_authoritative"),
            # 权威侧回落到会话快照的版本：两条轴从两侧把同一条等式修好/破坏。
            _cf("privilege_version", "align_with_session_snapshot"),
        ),
        evidence=(_ev("privilege_version"), _ev("session_privilege_version")),
        irrelevant_candidates=("resource_sensitivity", "session_auth_strength"),
    ),
    Mechanism(
        family="owner_cache_lag",
        category="authorization",
        coverage_labels=("authorization", "cache_distributed"),
        attack_family="stale_ownership_cache",
        summary="属主在系统里已变更，授权缓存仍持旧属主，按旧属主放行。",
        required_facts=("cached_owner", "resource_owner"),
        entities=("actor", "resource", "cache", "workflow", "service"),
        slot_facts={
            "cache_entry": "cached_owner",
            "target_resource": "resource_owner",
        },
        required_landmarks=("cache_populated", "permission_changed", "sensitive_operation"),
        trajectory=(
            StateStep("cache_populated", (("cache_entry.cached_value", "ACT-001"),)),
            StateStep("permission_changed", ()),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("cache_matches_authority", subject="resource_owner"),),
        counterfactuals=(_cf("cached_owner", "align_with_authoritative"),),
        evidence=(_ev("cached_owner"), _ev("resource_owner")),
        cache_source="SVC-RECORDS",
        irrelevant_candidates=("resource_sensitivity",),
    ),
)

# --------------------------------------------------------------------------- #
# session
# --------------------------------------------------------------------------- #
_SESSION: tuple[Mechanism, ...] = (
    Mechanism(
        family="revoked_session_reuse",
        category="session",
        coverage_labels=("session",),
        attack_family="revoked_session_reuse",
        summary="会话已被撤销，攻击方仍拿它执行敏感操作。",
        required_facts=("session_revoked", "authenticated_principal"),
        entities=("actor", "resource", "session", "workflow", "service"),
        slot_facts={"acting_session": "session_revoked", "principal": "authenticated_principal"},
        required_landmarks=("login", "session_revoked", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("session_revoked", (("acting_session.revoked", True),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("session_not_revoked"),),
        counterfactuals=(_cf("session_revoked", "unrevoke"),),
        evidence=(_ev("session_revoked"),),
        irrelevant_candidates=("resource_sensitivity", "session_auth_strength"),
    ),
    Mechanism(
        family="session_privilege_snapshot_stale",
        category="session",
        coverage_labels=("session", "temporal_history"),
        attack_family="stale_session_privilege",
        summary="会话快照的权限版本落后于主体当前版本，授权按旧快照放行。",
        required_facts=("session_privilege_version", "privilege_version"),
        entities=("actor", "resource", "session", "workflow", "service"),
        slot_facts={
            "acting_session": "session_privilege_version",
            "principal": "privilege_version",
        },
        required_landmarks=("login", "role_changed", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep(
                "role_changed",
                (("principal.privilege_version", 3), ("acting_session.privilege_version", 1)),
            ),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("session_privilege_version_matches_actor"),),
        counterfactuals=(_cf("session_privilege_version", "align_with_authoritative"),),
        evidence=(_ev("session_privilege_version"), _ev("privilege_version")),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="session_principal_swap",
        category="session",
        coverage_labels=("session", "multi_tenant"),
        attack_family="cross_account_session_misuse",
        summary="会话绑定的主体与当前行动主体不同（会话嫁接）。",
        required_facts=("session_principal", "authenticated_principal"),
        entities=("actor", "resource", "session", "workflow", "service"),
        # 不开 peer 槽绑定：peer 实体仍由 entities 开出（第二个 probe 用它），但
        # ``session_principal`` 的基准值由编译器按机制直接取 peer——再绑一个
        # peer_principal 会让"机制要求的事实"超出骨架声明集合。
        slot_facts={
            "acting_session": "session_principal",
            "principal": "authenticated_principal",
        },
        required_landmarks=("login", "sensitive_operation"),
        trajectory=(
            StateStep(
                "login",
                (("principal.authentication_state", "authenticated"),),
            ),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("session_bound_to_principal"),),
        counterfactuals=(_cf("session_principal", "bind_to_acting_principal"),),
        evidence=(_ev("session_principal"),),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="post_password_reset_session",
        category="session",
        coverage_labels=("session", "temporal_history"),
        attack_family="session_after_password_reset",
        summary="密码重置后旧会话未被吊销，仍可继续操作。",
        required_facts=("session_valid", "credential_status"),
        entities=("actor", "resource", "session", "credential", "workflow", "service"),
        slot_facts={
            "acting_session": "session_valid",
            "credential": "credential_status",
        },
        required_landmarks=("login", "password_reset", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("password_reset", (("credential.status", "rotated"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("session_active"), _inv("credential_active")),
        counterfactuals=(_cf("session_valid", "invalidate"),),
        evidence=(_ev("session_valid"), _ev("credential_status")),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="post_disable_session",
        category="session",
        coverage_labels=("session",),
        attack_family="session_after_account_disable",
        summary="账号被停用后会话仍有效。",
        required_facts=("session_valid", "authentication_state"),
        entities=("actor", "resource", "session", "workflow", "service"),
        slot_facts={
            "acting_session": "session_valid",
            "principal": "authentication_state",
        },
        required_landmarks=("login", "account_disabled", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("account_disabled", (("principal.authentication_state", "disabled"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("session_active"), _inv("authentication_state_required")),
        counterfactuals=(
            _cf("session_valid", "invalidate"),
            # base 的 authentication_state 已经是 disabled（轨迹里 account_disabled
            # 置的），再 disable 就是空干预——改成"恢复认证"才是这条轴的证伪操作。
            _cf("authentication_state", "restore_principal"),
        ),
        evidence=(_ev("session_valid"), _ev("authentication_state")),
        irrelevant_candidates=("resource_sensitivity",),
    ),
)

# --------------------------------------------------------------------------- #
# token
# --------------------------------------------------------------------------- #
_TOKEN: tuple[Mechanism, ...] = (
    Mechanism(
        family="one_time_token_reuse",
        category="token",
        coverage_labels=("token", "workflow"),
        attack_family="one_time_token_reuse",
        summary="一次性凭证已被消费，重放它再次通过校验。",
        required_facts=("token_used", "token_one_time"),
        entities=("actor", "resource", "token", "workflow", "service"),
        slot_facts={"acting_token": "token_used"},
        required_landmarks=("token_issued", "token_used", "sensitive_operation"),
        trajectory=(
            StateStep("token_issued", (("acting_token.one_time", True),)),
            StateStep("token_used", (("acting_token.used", True),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("one_time_token_unused"),),
        counterfactuals=(_cf("token_used", "unconsume"),),
        evidence=(_ev("token_used"),),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="token_scope_overreach",
        category="token",
        coverage_labels=("token", "authorization"),
        attack_family="scope_mismatch",
        summary="token 的范围不包含目标操作所需的范围。",
        required_facts=("token_scope",),
        entities=("actor", "resource", "token", "workflow", "service"),
        slot_facts={"acting_token": "token_scope"},
        required_landmarks=("token_issued", "sensitive_operation"),
        trajectory=(
            StateStep("token_issued", ()),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("token_scope_subset", required_scope=("read",)),),
        counterfactuals=(_cf("token_scope", "align_with_required", "diverge_from_required"),),
        evidence=(_ev("token_scope"),),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="token_audience_mismatch",
        category="token",
        coverage_labels=("token", "trust_boundary"),
        attack_family="audience_mismatch",
        summary="token 的受众不含接收服务，跨服务呈递被拒。",
        required_facts=("token_audience", "authority_source"),
        entities=("actor", "resource", "token", "service", "workflow"),
        slot_facts={"acting_token": "token_audience", "authority_service": "authority_source"},
        required_landmarks=("token_issued", "sensitive_operation"),
        trajectory=(
            StateStep("token_issued", ()),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("token_audience_includes_service"),),
        counterfactuals=(_cf("token_audience", "align_with_authoritative", "diverge_from_authoritative"),),
        evidence=(_ev("token_audience"),),
        trust_boundary=True,
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="token_privilege_version_stale",
        category="token",
        coverage_labels=("token", "temporal_history"),
        attack_family="privilege_version_mismatch",
        summary="token 签发时的权限版本已落后于主体当前版本。",
        required_facts=("token_privilege_version", "privilege_version"),
        entities=("actor", "resource", "token", "workflow", "service"),
        slot_facts={
            "acting_token": "token_privilege_version",
            "principal": "privilege_version",
        },
        required_landmarks=("token_issued", "role_changed", "sensitive_operation"),
        trajectory=(
            StateStep("token_issued", (("acting_token.privilege_version", 1),)),
            StateStep("role_changed", (("principal.privilege_version", 3),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("token_privilege_version_matches_actor"),),
        counterfactuals=(_cf("token_privilege_version", "align_with_authoritative"),),
        evidence=(_ev("token_privilege_version"), _ev("privilege_version")),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="token_lineage_confusion",
        category="token",
        coverage_labels=("token", "cross_flow_reuse"),
        attack_family="token_lineage_confusion",
        summary="token 的血缘根不在本次 flow，跨 flow 血缘混用。",
        required_facts=("token_lineage", "token_lineage_root_flow"),
        entities=("actor", "resource", "token", "workflow", "service"),
        slot_facts={
            "acting_token": "token_lineage",
            "lineage_parent": "token_lineage_root_flow",
        },
        required_landmarks=("token_issued", "sensitive_operation"),
        trajectory=(
            StateStep("token_issued", ()),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("token_root_flow_is", flow_id="FLOW-ROOT"),),
        counterfactuals=(_cf("token_lineage", "detach_from_parent", "attach_to_root"),),
        evidence=(_ev("token_lineage"),),
        irrelevant_candidates=("resource_sensitivity",),
    ),
)

# --------------------------------------------------------------------------- #
# workflow
# --------------------------------------------------------------------------- #
_WORKFLOW: tuple[Mechanism, ...] = (
    Mechanism(
        family="workflow_state_bypass",
        category="workflow",
        coverage_labels=("workflow", "authorization"),
        attack_family="workflow_bypass",
        summary="工作流未走到允许的状态就被推进到下一步。",
        required_facts=("workflow_state", "approval_state"),
        entities=("actor", "resource", "workflow", "service"),
        slot_facts={"workflow_instance": "workflow_state"},
        required_landmarks=("resource_created", "workflow_transition", "sensitive_operation"),
        trajectory=(
            StateStep("resource_created", (("workflow_instance.current_state", "draft"),)),
            StateStep("workflow_transition", (("workflow_instance.current_state", "deployed"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("workflow_state_in", states=("approved",)),),
        counterfactuals=(_cf("workflow_state", "advance_to_required", "rewind_to_initial"),),
        evidence=(_ev("workflow_state"),),
        workflow_states=_APPROVAL_WORKFLOW,
        workflow_initial_state="draft",
        workflow_transitions=_APPROVAL_TRANSITIONS,
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="invalid_state_transition",
        category="workflow",
        coverage_labels=("workflow",),
        attack_family="invalid_state_transition",
        summary="状态机里没有声明这条转移。",
        required_facts=("workflow_state", "transition_target_state"),
        entities=("actor", "resource", "workflow", "service"),
        slot_facts={"workflow_instance": "workflow_state"},
        required_landmarks=("resource_created", "workflow_transition", "sensitive_operation"),
        trajectory=(
            StateStep("resource_created", (("workflow_instance.current_state", "draft"),)),
            StateStep("workflow_transition", (("workflow_instance.current_state", "deployed"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("workflow_transition_declared", to_state="approved"),),
        counterfactuals=(_cf("workflow_state", "rewind_to_declared_predecessor", "advance_to_required"),),
        evidence=(_ev("workflow_state"),),
        workflow_states=_APPROVAL_WORKFLOW,
        workflow_initial_state="draft",
        workflow_transitions=_APPROVAL_TRANSITIONS,
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="repeated_operation",
        category="workflow",
        coverage_labels=("workflow", "token"),
        attack_family="repeated_operation",
        summary="同一消耗性凭证被用于第二次同类操作。",
        required_facts=("token_used", "workflow_state"),
        entities=("actor", "resource", "token", "workflow", "service"),
        slot_facts={"acting_token": "token_used", "workflow_instance": "workflow_state"},
        required_landmarks=("token_issued", "token_used", "workflow_transition", "sensitive_operation"),
        trajectory=(
            StateStep("token_issued", (("acting_token.one_time", True),)),
            StateStep("token_used", (("acting_token.used", True),)),
            StateStep("workflow_transition", (("workflow_instance.current_state", "active"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("one_time_token_unused"),),
        counterfactuals=(_cf("token_used", "unconsume"),),
        evidence=(_ev("token_used"),),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="skipping_required_step",
        category="workflow",
        coverage_labels=("workflow",),
        attack_family="skipping_required_step",
        summary="跳过了状态机里必经的提交/审批环节。",
        required_facts=("workflow_state", "approval_state"),
        entities=("actor", "resource", "workflow", "service"),
        slot_facts={"workflow_instance": "workflow_state"},
        required_landmarks=("resource_created", "workflow_transition", "sensitive_operation"),
        trajectory=(
            StateStep("resource_created", (("workflow_instance.current_state", "draft"),)),
            StateStep("workflow_transition", (("workflow_instance.current_state", "deployed"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("workflow_state_in", states=("approved",)),),
        counterfactuals=(_cf("workflow_state", "advance_to_required"),),
        evidence=(_ev("workflow_state"),),
        workflow_states=_APPROVAL_WORKFLOW,
        workflow_initial_state="draft",
        workflow_transitions=_APPROVAL_TRANSITIONS,
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="irreversible_state_reversal",
        category="workflow",
        coverage_labels=("workflow", "temporal_history"),
        attack_family="irreversible_state_reversal",
        summary="把已标记为不可逆的状态回退。",
        required_facts=("workflow_state", "resource_state"),
        entities=("actor", "resource", "workflow", "service"),
        slot_facts={
            "workflow_instance": "workflow_state",
            "target_resource": "resource_state",
        },
        required_landmarks=("resource_created", "workflow_transition", "sensitive_operation"),
        trajectory=(
            StateStep("resource_created", (("workflow_instance.current_state", "approved"),)),
            StateStep("workflow_transition", (("workflow_instance.current_state", "draft"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("workflow_state_in", states=("approved", "deployed")),),
        counterfactuals=(_cf("workflow_state", "advance_to_required", "rewind_to_initial"),),
        evidence=(_ev("workflow_state"), _ev("resource_state")),
        workflow_states=_APPROVAL_WORKFLOW,
        workflow_initial_state="draft",
        workflow_transitions=_APPROVAL_TRANSITIONS,
        irrelevant_candidates=("resource_sensitivity",),
    ),
)

# --------------------------------------------------------------------------- #
# cache_distributed
# --------------------------------------------------------------------------- #
_CACHE: tuple[Mechanism, ...] = (
    Mechanism(
        family="permission_cache_staleness",
        category="cache_distributed",
        coverage_labels=("cache_distributed", "authorization"),
        attack_family="stale_permission_cache",
        summary="权限缓存落后于权威权限版本，授权按缓存放行。",
        required_facts=("cached_privilege_version", "privilege_version"),
        entities=("actor", "resource", "cache", "session", "workflow", "service"),
        slot_facts={
            "cache_entry": "cached_privilege_version",
            "principal": "privilege_version",
        },
        required_landmarks=("cache_populated", "permission_changed", "sensitive_operation"),
        trajectory=(
            StateStep("cache_populated", (("cache_entry.cached_value", 1),)),
            StateStep("permission_changed", (("principal.privilege_version", 3),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("cache_matches_authority", subject="privilege_version"),),
        counterfactuals=(_cf("cached_privilege_version", "align_with_authoritative"),),
        evidence=(_ev("cached_privilege_version"), _ev("privilege_version")),
        cache_source="SVC-IAM",
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="revocation_not_propagated",
        category="cache_distributed",
        coverage_labels=("cache_distributed", "session"),
        attack_family="inconsistent_revocation_state",
        summary="撤销已在权威侧生效，副本缓存仍认为有效。",
        required_facts=("cache_freshness", "session_revoked"),
        entities=("actor", "resource", "cache", "session", "workflow", "service"),
        slot_facts={
            "cache_entry": "cache_freshness",
            "acting_session": "session_revoked",
        },
        required_landmarks=("cache_populated", "session_revoked", "sensitive_operation"),
        trajectory=(
            StateStep("cache_populated", (("cache_entry.fresh", True),)),
            StateStep("session_revoked", (("acting_session.revoked", True),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("cache_not_stale_when_revoked"),),
        counterfactuals=(_cf("cache_freshness", "mark_stale"),),
        evidence=(_ev("cache_freshness"), _ev("session_revoked")),
        cache_source="SVC-SESSION",
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="replica_divergence",
        category="cache_distributed",
        coverage_labels=("cache_distributed", "trust_boundary"),
        attack_family="inconsistent_replicas",
        summary="两个副本对同一份快照给出不同答案。",
        required_facts=("cached_owner", "replica_cached_value"),
        entities=("actor", "resource", "cache", "workflow", "service"),
        slot_facts={
            "cache_entry": "cached_owner",
            "second_cache": "replica_cached_value",
        },
        required_landmarks=("cache_populated", "sensitive_operation"),
        trajectory=(
            StateStep("cache_populated", (("cache_entry.cached_value", "ACT-001"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("replicas_agree"),),
        counterfactuals=(_cf("cached_owner", "align_with_authoritative"),),
        evidence=(_ev("cached_owner"), _ev("replica_cached_value")),
        cache_source="SVC-RECORDS",
        service_consistency="eventual",
        trust_boundary=True,
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="cache_invalidation_failure",
        category="cache_distributed",
        coverage_labels=("cache_distributed",),
        attack_family="cache_invalidation_failure",
        summary="状态变更后缓存没有被标记失效。",
        required_facts=("cache_freshness", "cached_policy_version", "current_policy_version"),
        entities=("actor", "resource", "cache", "workflow", "service"),
        slot_facts={
            "cache_entry": "cached_policy_version",
            "second_cache": "current_policy_version",
        },
        required_landmarks=("cache_populated", "permission_changed", "sensitive_operation"),
        trajectory=(
            StateStep("cache_populated", (("cache_entry.cached_value", 1),)),
            StateStep("permission_changed", (("second_cache.cached_value", 4),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("cache_matches_authority", subject="cached_policy_version"),),
        counterfactuals=(
            _cf("cached_policy_version", "align_with_authoritative"),
            _cf("current_policy_version", "align_with_cached_value"),
        ),
        evidence=(_ev("cached_policy_version"), _ev("current_policy_version")),
        cache_source="SVC-IAM",
        irrelevant_candidates=("resource_sensitivity",),
    ),
)

# --------------------------------------------------------------------------- #
# multi_tenant（brief §25 的十个机制，全部一等公民）
# --------------------------------------------------------------------------- #
_MULTI_TENANT: tuple[Mechanism, ...] = (
    _mt(
        "stale_tenant_context",
        attack_family="tenant_isolation_violation",
        summary="用户切换了活动租户，下游授权缓存仍持上一个租户的上下文。",
        required_facts=("authenticated_tenant", "cached_tenant", "resource_tenant"),
        entities=("actor", "resource", "cache", "session", "workflow", "service"),
        slot_facts={
            "principal": "authenticated_tenant",
            "cache_entry": "cached_tenant",
            "target_resource": "resource_tenant",
        },
        landmarks=("login", "cache_populated", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("cache_populated", (("cache_entry.cached_value", "TEN-A"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("tenant_isolation", authority="cache"),),
        counterfactuals=(
            _cf("cached_tenant", "switch_tenant"),
            _cf("authenticated_tenant", "switch_tenant"),
        ),
        evidence=(_ev("cached_tenant"), _ev("authenticated_tenant"), _ev("resource_tenant")),
        extra_labels=("cache_distributed",),
        cache_source="SVC-IAM",
        irrelevant_candidates=("resource_sensitivity", "session_auth_strength"),
    ),
    _mt(
        "cross_tenant_cache",
        attack_family="tenant_isolation_violation",
        summary="授权缓存把 A 租户的决策结果复用给了 B 租户的请求。",
        required_facts=("cached_tenant", "authenticated_tenant", "cached_privilege_version"),
        entities=("actor", "resource", "cache", "session", "workflow", "service"),
        slot_facts={
            "cache_entry": "cached_tenant",
            "principal": "authenticated_tenant",
            "second_cache": "cached_privilege_version",
        },
        landmarks=("login", "cache_populated", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("cache_populated", (("cache_entry.cached_value", "TEN-A"),)),
            StateStep("sensitive_operation", ()),
        ),
        # 只留一条决定性不变量：两条都读缓存的世界里，改一个缓存值修不好另一条，
        # 反事实就翻转不了判决（自检抓到过）。
        invariants=(_inv("tenant_isolation", authority="cache"),),
        counterfactuals=(_cf("cached_tenant", "switch_tenant"),),
        evidence=(_ev("cached_tenant"), _ev("authenticated_tenant")),
        extra_labels=("cache_distributed",),
        cache_source="SVC-AUTHZ",
        irrelevant_candidates=("resource_sensitivity",),
    ),
    _mt(
        "token_tenant_mismatch",
        attack_family="tenant_mismatch",
        summary="token 声明的租户与主体当前租户不一致。",
        required_facts=("authenticated_tenant", "token_scope"),
        entities=("actor", "resource", "token", "session", "workflow", "service"),
        slot_facts={
            "principal": "authenticated_tenant",
            "acting_token": "token_scope",
        },
        landmarks=("login", "token_issued", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("token_issued", ()),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("token_scope_carries_tenant"),),
        counterfactuals=(_cf("token_scope", "carry_current_tenant", "diverge_from_required"),),
        evidence=(_ev("token_scope"), _ev("authenticated_tenant")),
        extra_labels=("token",),
        trust_boundary=True,
        irrelevant_candidates=("resource_sensitivity",),
    ),
    _mt(
        "service_account_tenant_crossover",
        attack_family="tenant_isolation_violation",
        summary="服务账号的租户上下文越界到另一个租户的资源。",
        required_facts=("authenticated_tenant", "resource_tenant"),
        entities=("actor", "resource", "session", "workflow", "service"),
        slot_facts={
            "principal": "authenticated_tenant",
            "target_resource": "resource_tenant",
        },
        landmarks=("login", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("tenant_isolation", authority="actor"),),
        counterfactuals=(
            _cf("authenticated_tenant", "switch_tenant"),
            _cf("resource_tenant", "switch_tenant"),
        ),
        evidence=(_ev("authenticated_tenant"), _ev("resource_tenant")),
        extra_labels=("trust_boundary",),
        trust_boundary=True,
        irrelevant_candidates=("resource_sensitivity",),
    ),
    _mt(
        "delegated_tenant_access",
        attack_family="tenant_mismatch",
        summary="委派访问令牌的目标租户不是被委派的租户。",
        required_facts=("authenticated_tenant", "resource_tenant", "token_scope"),
        entities=("actor", "resource", "token", "session", "workflow", "service"),
        slot_facts={
            "principal": "authenticated_tenant",
            "target_resource": "resource_tenant",
            "acting_token": "token_scope",
        },
        landmarks=("login", "token_issued", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("token_issued", ()),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("token_scope_carries_tenant"),),
        counterfactuals=(_cf("token_scope", "carry_current_tenant"),),
        evidence=(_ev("resource_tenant"), _ev("token_scope")),
        extra_labels=("token", "trust_boundary"),
        trust_boundary=True,
        irrelevant_candidates=("resource_sensitivity",),
    ),
    _mt(
        "resource_tenant_mismatch",
        attack_family="tenant_isolation_violation",
        summary="资源所属租户与主体租户不同（最典型的跨租户读取）。",
        required_facts=("authenticated_tenant", "resource_tenant"),
        entities=("actor", "resource", "session", "workflow", "service"),
        slot_facts={
            "principal": "authenticated_tenant",
            "target_resource": "resource_tenant",
        },
        landmarks=("login", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("tenant_isolation", authority="actor"),),
        counterfactuals=(
            _cf("resource_tenant", "switch_tenant"),
            _cf("authenticated_tenant", "switch_tenant"),
        ),
        evidence=(_ev("authenticated_tenant"), _ev("resource_tenant")),
        irrelevant_candidates=("resource_sensitivity", "session_auth_strength"),
    ),
    _mt(
        "tenant_switch_stale_session",
        attack_family="tenant_isolation_violation",
        summary="租户切换后旧会话仍持原租户上下文。",
        required_facts=("authenticated_tenant", "session_principal", "resource_tenant"),
        entities=("actor", "resource", "session", "workflow", "service"),
        slot_facts={
            "principal": "authenticated_tenant",
            "acting_session": "session_principal",
            "target_resource": "resource_tenant",
        },
        landmarks=("login", "permission_changed", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("permission_changed", (("principal.tenant", "TEN-B"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("tenant_isolation", authority="actor"), _inv("session_bound_to_principal")),
        counterfactuals=(_cf("authenticated_tenant", "switch_tenant"),),
        evidence=(_ev("authenticated_tenant"), _ev("session_principal"), _ev("resource_tenant")),
        extra_labels=("session",),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    _mt(
        "cross_service_tenant_propagation_delay",
        attack_family="tenant_isolation_violation",
        summary="租户上下文在服务间最终一致传播，下游读到旧值。",
        required_facts=("authenticated_tenant", "cached_tenant", "service_consistency"),
        entities=("actor", "resource", "cache", "service", "session", "workflow"),
        slot_facts={
            "principal": "authenticated_tenant",
            "cache_entry": "cached_tenant",
            "authority_service": "service_consistency",
        },
        landmarks=("login", "cache_populated", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("cache_populated", (("cache_entry.cached_value", "TEN-A"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("tenant_isolation", authority="cache"),),
        counterfactuals=(_cf("cached_tenant", "switch_tenant"),),
        evidence=(_ev("cached_tenant"), _ev("authenticated_tenant")),
        extra_labels=("cache_distributed", "trust_boundary"),
        cache_source="SVC-IAM",
        service_consistency="eventual",
        trust_boundary=True,
        irrelevant_candidates=("resource_sensitivity",),
    ),
    _mt(
        "tenant_identifier_collision",
        attack_family="tenant_mismatch",
        summary="两个租户的标识在同一命名空间里碰撞，授权按标识而非按租户放行。",
        required_facts=("authenticated_tenant", "resource_tenant", "current_role"),
        entities=("actor", "resource", "session", "workflow", "service"),
        slot_facts={
            "principal": "authenticated_tenant",
            "target_resource": "resource_tenant",
            "peer": "current_role",
        },
        landmarks=("login", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("tenant_isolation", authority="actor"),),
        counterfactuals=(_cf("resource_tenant", "switch_tenant"),),
        evidence=(_ev("authenticated_tenant"), _ev("resource_tenant")),
        extra_labels=("trust_boundary",),
        trust_boundary=True,
        irrelevant_candidates=("resource_sensitivity",),
    ),
    _mt(
        "cached_authorization_cross_tenant_reuse",
        attack_family="tenant_isolation_violation",
        summary="A 租户的授权结论被缓存后直接复用到 B 租户的同类请求。",
        required_facts=("cached_tenant_context_version", "current_tenant_context_version", "authenticated_tenant"),
        entities=("actor", "resource", "cache", "service", "session", "workflow"),
        slot_facts={
            "cache_entry": "cached_tenant_context_version",
            "second_cache": "current_tenant_context_version",
            "principal": "authenticated_tenant",
        },
        landmarks=("cache_populated", "permission_changed", "sensitive_operation"),
        trajectory=(
            StateStep("cache_populated", (("cache_entry.cached_value", 1),)),
            StateStep("permission_changed", (("second_cache.cached_value", 2),)),
            StateStep("sensitive_operation", ()),
        ),
        # 授权结论是在旧版租户上下文上算出来的：版本不等即复用。一条不变量读两个缓存，
        # 任一侧的反事实都能翻转它。
        invariants=(_inv("cache_matches_authority", subject="cached_tenant_context_version"),),
        # 两条轴都从"消除版本差"的方向来：把缓存侧抬到权威值，或把权威侧压到缓存值。
        # 反向（让差更大）不会移除违反，判决仍为 attack——那不是 verdict_flip。
        counterfactuals=(
            _cf("cached_tenant_context_version", "align_with_authoritative"),
            _cf("current_tenant_context_version", "align_with_cached_value"),
        ),
        evidence=(
            _ev("cached_tenant_context_version"),
            _ev("current_tenant_context_version"),
            _ev("authenticated_tenant"),
        ),
        extra_labels=("cache_distributed",),
        cache_source="SVC-TENANT",
        irrelevant_candidates=("resource_sensitivity",),
    ),
)

# --------------------------------------------------------------------------- #
# trust_boundary（引擎可判定的信任维度：证据信任 + 权威来源，而非 payload 文本）
# --------------------------------------------------------------------------- #
_TRUST: tuple[Mechanism, ...] = (
    Mechanism(
        family="untrusted_source_establishes_decisive_fact",
        category="trust_boundary",
        coverage_labels=("trust_boundary", "multi_tenant"),
        attack_family="tenant_mismatch",
        summary="决定性事实的唯一证据来自客户端可控输入，决策实际建立在不可信来源上。",
        required_facts=("authenticated_tenant", "resource_tenant", "source_trust"),
        entities=("actor", "resource", "session", "service", "trust_boundary", "workflow"),
        slot_facts={
            "principal": "authenticated_tenant",
            "target_resource": "resource_tenant",
            "authority_service": "source_trust",
        },
        required_landmarks=("login", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(
            _inv("tenant_isolation", authority="actor"),
            _inv("decisive_fact_established_by_trusted_evidence", fact="authenticated_tenant"),
        ),
        counterfactuals=(
            _cf("authenticated_tenant", "switch_tenant"),
            _cf("resource_tenant", "switch_tenant"),
        ),
        evidence=(
            EvidenceSpec(
                fact="authenticated_tenant", trust="untrusted",
                attacker_controllable=True, provenance="client_supplied",
            ),
            _ev("resource_tenant"),
        ),
        trust_boundary=True,
        declare_contradiction=True,
        irrelevant_candidates=("resource_sensitivity", "session_auth_strength"),
    ),
    Mechanism(
        family="derived_summary_overrides_system_of_record",
        category="trust_boundary",
        coverage_labels=("trust_boundary", "cache_distributed"),
        attack_family="stale_ownership_cache",
        summary="派生摘要与系统记录冲突，授权按派生摘要放行。",
        required_facts=("cached_owner", "resource_owner", "source_trust"),
        entities=("actor", "resource", "cache", "service", "trust_boundary", "workflow"),
        slot_facts={
            "cache_entry": "cached_owner",
            "target_resource": "resource_owner",
            "authority_service": "source_trust",
        },
        required_landmarks=("cache_populated", "sensitive_operation"),
        trajectory=(
            StateStep("cache_populated", (("cache_entry.cached_value", "ACT-002"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(
            _inv("cache_matches_authority", subject="resource_owner"),
            _inv("decisive_fact_established_by_trusted_evidence", fact="resource_owner"),
        ),
        counterfactuals=(_cf("cached_owner", "align_with_authoritative"),),
        evidence=(
            EvidenceSpec(fact="cached_owner", trust="derived", provenance="llm_derived"),
            _ev("resource_owner"),
        ),
        trust_boundary=True,
        cache_source="SVC-RECORDS",
        declare_contradiction=True,
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="boundary_crossing_without_required_assertion",
        category="trust_boundary",
        coverage_labels=("trust_boundary", "session"),
        attack_family="cross_account_session_misuse",
        summary="跨信任边界的会话缺少边界声明要求的断言。",
        required_facts=("session_principal", "boundary_crossing_requirement", "authenticated_principal"),
        entities=("actor", "resource", "session", "service", "trust_boundary", "workflow"),
        slot_facts={
            "acting_session": "session_principal",
            "boundary": "boundary_crossing_requirement",
            "principal": "authenticated_principal",
        },
        required_landmarks=("login", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("session_bound_to_principal"),),
        counterfactuals=(_cf("session_principal", "bind_to_acting_principal"),),
        # 证据只摆 session_principal：``evidence.schema.json`` 的 asserts_ref 模式
        # 不含 trust_boundary 实体类型，摆 boundary 事实会产出 schema 违规。
        evidence=(_ev("session_principal"),),
        trust_boundary=True,
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="eventual_consistency_read_before_write_visible",
        category="trust_boundary",
        coverage_labels=("trust_boundary", "cache_distributed", "temporal_history"),
        attack_family="inconsistent_replicas",
        summary="最终一致存储上，读发生在写传播到达之前。",
        required_facts=("cached_owner", "replica_cached_value", "service_consistency"),
        entities=("actor", "resource", "cache", "service", "trust_boundary", "workflow"),
        slot_facts={
            "cache_entry": "cached_owner",
            "second_cache": "replica_cached_value",
            "authority_service": "service_consistency",
        },
        required_landmarks=("cache_populated", "permission_changed", "sensitive_operation"),
        trajectory=(
            StateStep("cache_populated", (("cache_entry.cached_value", "ACT-001"),)),
            StateStep("permission_changed", ()),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("replicas_agree"),),
        counterfactuals=(_cf("cached_owner", "align_with_authoritative"),),
        evidence=(_ev("cached_owner"), _ev("replica_cached_value")),
        trust_boundary=True,
        cache_source="SVC-RECORDS",
        service_consistency="eventual",
        irrelevant_candidates=("resource_sensitivity",),
    ),
)

# --------------------------------------------------------------------------- #
# temporal_history
# --------------------------------------------------------------------------- #
_TEMPORAL: tuple[Mechanism, ...] = (
    Mechanism(
        family="expiry_window_violation",
        category="temporal_history",
        coverage_labels=("temporal_history", "token"),
        attack_family="stale_object_reference",
        summary="凭证已过到期时刻仍被接受。",
        required_facts=("expiry_time", "current_time"),
        entities=("actor", "resource", "token", "service", "workflow"),
        slot_facts={"acting_token": "expiry_time", "authority_service": "current_time"},
        required_landmarks=("token_issued", "sensitive_operation"),
        trajectory=(
            StateStep("token_issued", ()),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("token_not_expired"),),
        counterfactuals=(_cf("expiry_time", "extend_into_future", "move_into_past"),),
        evidence=(_ev("expiry_time"),),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="revocation_after_issue",
        category="temporal_history",
        coverage_labels=("temporal_history", "session"),
        attack_family="stale_authorization",
        summary="撤销时刻晚于签发时刻但早于使用时刻，旧凭证仍在窗口内被用。",
        required_facts=("revocation_time", "issue_time", "session_revoked"),
        entities=("actor", "resource", "session", "token", "service", "workflow"),
        # session_revoked 必须留在 session 槽上：派到 principal 槽会产出
        # ``actor.<id>.revoked`` 这种不存在的路径，编译期直接撞白名单。
        slot_facts={
            "acting_session": "session_revoked",
            "acting_token": "issue_time",
        },
        required_landmarks=("token_issued", "session_revoked", "sensitive_operation"),
        trajectory=(
            StateStep("token_issued", ()),
            StateStep("session_revoked", (("acting_session.revoked", True),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("revocation_before_use"),),
        counterfactuals=(_cf("session_revoked", "unrevoke"),),
        evidence=(_ev("revocation_time"), _ev("issue_time")),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="race_sensitive_state",
        category="temporal_history",
        coverage_labels=("temporal_history", "workflow", "token"),
        attack_family="race_sensitive_state",
        summary="两个动作竞争同一个消耗性状态，校验与使用之间状态被改写。",
        required_facts=("token_used", "workflow_state"),
        entities=("actor", "resource", "token", "workflow", "service"),
        slot_facts={"acting_token": "token_used", "workflow_instance": "workflow_state"},
        required_landmarks=("token_issued", "token_used", "workflow_transition", "sensitive_operation"),
        trajectory=(
            StateStep("token_issued", (("acting_token.one_time", True),)),
            StateStep("token_used", (("acting_token.used", True),)),
            StateStep("workflow_transition", (("workflow_instance.current_state", "active"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("one_time_token_unused"),),
        counterfactuals=(_cf("token_used", "unconsume"),),
        evidence=(_ev("token_used"),),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="stale_snapshot_read",
        category="temporal_history",
        coverage_labels=("temporal_history", "cache_distributed"),
        attack_family="stale_object_reference",
        summary="读取发生在缓存填充之后、权威状态变更之前，读到过期快照。",
        required_facts=("cache_populated_at", "cached_owner", "resource_owner"),
        entities=("actor", "resource", "cache", "service", "workflow"),
        slot_facts={
            "cache_entry": "cache_populated_at",
            "second_cache": "cached_owner",
            "target_resource": "resource_owner",
        },
        required_landmarks=("cache_populated", "permission_changed", "sensitive_operation"),
        trajectory=(
            StateStep("cache_populated", (("cache_entry.cached_value", "ACT-001"),)),
            StateStep("permission_changed", ()),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("cache_matches_authority", subject="resource_owner"),),
        counterfactuals=(_cf("cached_owner", "align_with_authoritative"),),
        evidence=(_ev("cache_populated_at"), _ev("cached_owner"), _ev("resource_owner")),
        cache_source="SVC-RECORDS",
        irrelevant_candidates=("resource_sensitivity",),
    ),
)

# --------------------------------------------------------------------------- #
# cross_flow_reuse
# --------------------------------------------------------------------------- #
_CROSS_FLOW: tuple[Mechanism, ...] = (
    Mechanism(
        family="token_reused_across_flow",
        category="cross_flow_reuse",
        coverage_labels=("cross_flow_reuse", "token"),
        attack_family="cross_workflow_token_reuse",
        summary="token 在它不是为此签发的 flow 里被使用。",
        required_facts=("token_flow", "token_subject"),
        entities=("actor", "resource", "token", "session", "workflow", "service"),
        slot_facts={"acting_token": "token_flow"},
        required_landmarks=("token_issued", "sensitive_operation"),
        trajectory=(
            StateStep("token_issued", ()),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("token_same_flow"),),
        counterfactuals=(_cf("token_flow", "align_with_current_flow", "diverge_from_current_flow"),),
        evidence=(_ev("token_flow"),),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="token_bound_to_other_resource",
        category="cross_flow_reuse",
        coverage_labels=("cross_flow_reuse", "token", "authorization"),
        attack_family="cross_resource_token_reuse",
        summary="token 绑定的是另一个资源，却被呈递到本资源上。",
        required_facts=("token_bound_resource", "resource_owner"),
        entities=("actor", "resource", "token", "workflow", "service"),
        slot_facts={"acting_token": "token_bound_resource", "target_resource": "resource_owner"},
        required_landmarks=("token_issued", "sensitive_operation"),
        trajectory=(
            StateStep("token_issued", ()),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("token_bound_to_action_resource"),),
        counterfactuals=(_cf("token_bound_resource", "align_with_action_resource"),),
        evidence=(_ev("token_bound_resource"),),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="session_reused_across_flow",
        category="cross_flow_reuse",
        coverage_labels=("cross_flow_reuse", "session"),
        attack_family="cross_account_session_misuse",
        summary="会话在另一个 flow 里被复用，绕过该 flow 的既定顺序。",
        required_facts=("session_principal", "token_flow"),
        entities=("actor", "resource", "session", "token", "workflow", "service"),
        slot_facts={"acting_session": "session_principal", "acting_token": "token_flow"},
        required_landmarks=("login", "token_issued", "sensitive_operation"),
        trajectory=(
            StateStep("login", (("principal.authentication_state", "authenticated"),)),
            StateStep("token_issued", ()),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("session_bound_to_principal"), _inv("token_same_flow")),
        counterfactuals=(_cf("token_flow", "align_with_current_flow"),),
        evidence=(_ev("session_principal"),),
        irrelevant_candidates=("resource_sensitivity",),
    ),
    Mechanism(
        family="workflow_instance_reused_across_flow",
        category="cross_flow_reuse",
        coverage_labels=("cross_flow_reuse", "workflow"),
        attack_family="state_machine_confusion",
        summary="同一工作流实例被两个 flow 同时推进，状态归属混乱。",
        required_facts=("workflow_state", "token_flow"),
        entities=("actor", "resource", "workflow", "token", "service"),
        slot_facts={"workflow_instance": "workflow_state", "acting_token": "token_flow"},
        required_landmarks=("resource_created", "token_issued", "workflow_transition", "sensitive_operation"),
        trajectory=(
            StateStep("resource_created", (("workflow_instance.current_state", "active"),)),
            StateStep("token_issued", ()),
            StateStep("workflow_transition", (("workflow_instance.current_state", "closed"),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("token_same_flow"),),
        # 轴必须是被不变量读到的那个事实：workflow_state 在这条不变量里没有读者，
        # 展开期记 axis_skipped_no_reader，整条轴被静默丢掉。
        counterfactuals=(_cf("token_flow", "align_with_current_flow"),),
        evidence=(_ev("workflow_state"), _ev("token_flow")),
        workflow_states=_GENERIC_WORKFLOW,
        workflow_initial_state="open",
        workflow_transitions=_GENERIC_TRANSITIONS,
        irrelevant_candidates=("resource_sensitivity",),
    ),
)


#: 全部机制族（按类别顺序，确定性）。
MECHANISMS: tuple[Mechanism, ...] = (
    _AUTHORIZATION + _SESSION + _TOKEN + _WORKFLOW + _CACHE + _MULTI_TENANT
    + _TRUST + _TEMPORAL + _CROSS_FLOW
)

_BY_FAMILY: Mapping[str, Mechanism] = {item.family: item for item in MECHANISMS}


def mechanism_families() -> tuple[str, ...]:
    """全部机制族名（排序，确定性）。"""
    return tuple(sorted(_BY_FAMILY))


def mechanism(family: str) -> Mechanism | None:
    """取一个机制族；未知返回 ``None``。"""
    return _BY_FAMILY.get(family)


def is_known_mechanism(family: str) -> bool:
    return family in _BY_FAMILY


def mechanisms_by_category() -> dict[str, tuple[str, ...]]:
    """``category -> 机制族名``（覆盖调度与测试共用）。"""
    out: dict[str, set[str]] = {}
    for item in MECHANISMS:
        out.setdefault(item.category, set()).add(item.family)
    return {category: tuple(sorted(names)) for category, names in sorted(out.items())}


def label_families() -> dict[str, tuple[str, ...]]:
    """``coverage_label -> 机制族名``（多标签；brief §26/§27 的覆盖口径）。"""
    out: dict[str, set[str]] = {}
    for item in MECHANISMS:
        for label in item.coverage_labels:
            out.setdefault(label, set()).add(item.family)
    return {label: tuple(sorted(names)) for label, names in sorted(out.items())}


def unknown_mechanisms(values: object) -> tuple[str, ...]:
    if isinstance(values, str) or not isinstance(values, (list, tuple, set)):
        return ()
    return tuple(dict.fromkeys(str(item) for item in values if not is_known_mechanism(str(item))))


def attack_family_for(family: str) -> str | None:
    item = _BY_FAMILY.get(family)
    return None if item is None else item.attack_family


__all__ = [
    "COVERAGE_LABELS",
    "MECHANISMS",
    "Mechanism",
    "SLOT_GROUPS",
    "StateStep",
    "attack_family_for",
    "is_known_mechanism",
    "label_families",
    "mechanism",
    "mechanism_families",
    "mechanisms_by_category",
    "unknown_mechanisms",
]
