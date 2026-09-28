"""不变量模板库：把"这类安全性质"编译成一条可求值的 DSL 文档。

为什么要模板库而不是让作者手写 DSL：手写的 ``expr`` 无法被静态审查，而模板
(a) 每个模板是一个**命名**的安全性质，(b) 构造期就过 :func:`parse_expr`
（模板 bug 立刻炸），(c) 声明自己读哪些 action 绑定，于是作用域判定
（``skipped_unbound_subject``）可以静态做而不要求值。

Phase 1 覆盖设计 §7.4 的 **7 类**（其余 13 类推迟到 Phase 2：op 已在 DSL 里，
缺的只是具体模板）::

    ownership            ownership.owner_only / ownership.owner_or_group
    authorization        authorization.privilege_required / role_required / owner_or_privileged
    session_validity     session_validity.active / authenticated / bound_to_principal
                         （schema 枚举里没有 "session_validity"，它是 §7.4 对
                           session_revocation + authentication_state + session_binding
                           三类合起来的称呼；模板逐条落到具体 category 上）
    token_lineage        token_lineage.same_flow / depth_at_most / root_flow_is /
                         subject_matches_principal
    workflow_state       workflow_state.state_is / transition_declared / state_in
                         （schema 类别名是 workflow_transition）
    tenant_isolation     tenant_isolation.same_tenant
    one_time_token       one_time_token.unused

**DSL 的一个如实边界**：``resource.acl`` 是数组而 BNF 没有下标语法，因此
"ACL 里有一条 grantee==actor 且 permission==read 的条目"这类授权**无法**用
v0.1 DSL 表达。授权类模板因此走"角色 / 直授权限 / 属主"三条可表达路径，
不假装支持 ACL 匹配。
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from ..policy.builders import (
    after_expr,
    and_expr,
    eq_expr,
    establishing_evidence_exists_expr,
    in_expr,
    intersects_expr,
    is_empty_expr,
    le_expr,
    lineage_depth_expr,
    lineage_root_expr,
    lit_expr,
    or_expr,
    ref_expr,
    state_is_expr,
    transition_allowed_expr,
)
from ..policy import DslError

#: 常用路径常量（action 绑定视图；编译期由 compile_spec 展开成实例路径）。
ACTOR_ID = "action.actor.actor_id"
ACTOR_ROLES = "action.actor.roles"
ACTOR_GROUPS = "action.actor.groups"
ACTOR_PRIVILEGES = "action.actor.privileges"
ACTOR_TENANT = "action.actor.tenant"
ACTOR_AUTH_STATE = "action.actor.authentication_state"
RESOURCE_OWNER = "action.resource.owner"
RESOURCE_TENANT = "action.resource.tenant"
SESSION_VALID = "action.session.valid"
SESSION_REVOKED = "action.session.revoked"
SESSION_EXPIRES_AT = "action.session.expires_at"
SESSION_PRINCIPAL = "action.session.principal"
TOKEN_ID = "action.token.token_id"
TOKEN_FLOW_ID = "action.token.flow_id"
TOKEN_SUBJECT = "action.token.subject"
TOKEN_ONE_TIME = "action.token.one_time"
TOKEN_USED = "action.token.used"
WORKFLOW_INSTANCE_STATE = "action.workflow_instance.current_state"
CURRENT_FLOW = "current_flow.flow_id"
CURRENT_TIME = "current_time"

#: 模板的默认严重度（只进报告，不参与 world_truth 聚合）。
DEFAULT_SEVERITY = "high"


@dataclass(frozen=True)
class InvariantTemplate:
    """一个可注册的不变量模板。

    ``build`` 接收模板参数（关键字），返回 **DSL 文档**（不是 AST）——文档形态
    才能进 ``Invariant.expr``（L1 的 ``Invariant.expr`` 就是原始文档）。
    """

    key: str
    category: str
    summary: str
    build: Callable[..., Mapping[str, Any]]
    bindings: tuple[str, ...]
    default_severity: str = DEFAULT_SEVERITY
    default_applies_to: tuple[str, ...] = ("*",)
    params: tuple[str, ...] = ()
    #: 可选参数的缺省值（``params`` 里没有出现在这里的仍然是必填）。
    param_defaults: Mapping[str, Any] = field(default_factory=dict)

    def build_expr(self, **params: Any) -> dict[str, Any]:
        unknown = sorted(name for name in params if name not in self.params)
        if unknown:
            raise DslError(f"模板 {self.key} 不接受参数 {unknown}；可用: {list(self.params)}")
        resolved = dict(self.param_defaults)
        resolved.update(params)
        missing = [name for name in self.params if name not in resolved]
        if missing:
            raise DslError(f"模板 {self.key} 缺少必填参数 {missing}")
        return dict(self.build(**resolved))


# --------------------------------------------------------------------------- #
# 参数校验助手（显式、无隐式 coerce）
# --------------------------------------------------------------------------- #
def _roles(value: Any, name: str) -> tuple[str, ...]:
    """string 数组（允许为空：``support_roles=()`` 表示"没有逃生分支"）。

    空数组在 DSL 里是完全合法的（``in(x, [])`` 恒为 False），因此这里不做"非空"
    限制——退化模板该由 Gate 3 那类探针去发现，不该在参数校验层猜。
    """
    if isinstance(value, str) or not isinstance(value, (list, tuple)):
        raise DslError(f"{name} 必须是 string 数组，得到 {type(value).__name__}")
    items = tuple(value)
    for item in items:
        if not isinstance(item, str) or not item:
            raise DslError(f"{name} 的元素必须是非空字符串，得到 {item!r}")
    return items


def _text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise DslError(f"{name} 必须是非空字符串，得到 {value!r}")
    return value


def _count(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise DslError(f"{name} 必须是非负整数，得到 {value!r}")
    if value < 0:
        raise DslError(f"{name} 必须是非负整数，得到 {value}")
    return value


# --------------------------------------------------------------------------- #
# ownership
# --------------------------------------------------------------------------- #
def _build_owner_only(*, support_roles: tuple[str, ...] = ()) -> dict[str, Any]:
    """属主可访问；``support_roles`` 非空时追加"同租户支持角色"逃生分支。"""
    owner_branch = eq_expr(ref_expr(ACTOR_ID), ref_expr(RESOURCE_OWNER))
    if not support_roles:
        return owner_branch
    support_branch = and_expr(
        in_expr(ref_expr(ACTOR_ROLES), lit_expr(list(support_roles))),
        eq_expr(ref_expr(ACTOR_TENANT), ref_expr(RESOURCE_TENANT)),
    )
    return or_expr(owner_branch, support_branch)


def _build_owner_or_group(*, groups: tuple[str, ...]) -> dict[str, Any]:
    return or_expr(
        eq_expr(ref_expr(ACTOR_ID), ref_expr(RESOURCE_OWNER)),
        intersects_expr(ref_expr(ACTOR_GROUPS), lit_expr(list(groups))),
    )


# --------------------------------------------------------------------------- #
# authorization
# --------------------------------------------------------------------------- #
def _build_privilege_required(*, privilege: str) -> dict[str, Any]:
    return in_expr(lit_expr(privilege), ref_expr(ACTOR_PRIVILEGES))


def _build_role_required(*, roles: tuple[str, ...]) -> dict[str, Any]:
    return intersects_expr(ref_expr(ACTOR_ROLES), lit_expr(list(roles)))


def _build_owner_or_privileged(*, roles: tuple[str, ...]) -> dict[str, Any]:
    return or_expr(
        eq_expr(ref_expr(ACTOR_ID), ref_expr(RESOURCE_OWNER)),
        intersects_expr(ref_expr(ACTOR_ROLES), lit_expr(list(roles))),
    )


# --------------------------------------------------------------------------- #
# session validity
# --------------------------------------------------------------------------- #
def _build_session_active() -> dict[str, Any]:
    """会话必须有效、未撤销、未过期（过期判断在虚拟时钟上）。"""
    return and_expr(
        eq_expr(ref_expr(SESSION_VALID), lit_expr(True)),
        and_expr(
            eq_expr(ref_expr(SESSION_REVOKED), lit_expr(False)),
            after_expr(ref_expr(SESSION_EXPIRES_AT), ref_expr(CURRENT_TIME)),
        ),
    )


def _build_authenticated(*, state: str) -> dict[str, Any]:
    return eq_expr(ref_expr(ACTOR_AUTH_STATE), lit_expr(state))


def _build_session_bound_to_principal() -> dict[str, Any]:
    """会话的主体必须正是行动的 principal（会话嫁接/固定化防护）。"""
    return eq_expr(ref_expr(SESSION_PRINCIPAL), ref_expr(ACTOR_ID))


# --------------------------------------------------------------------------- #
# token lineage
# --------------------------------------------------------------------------- #
def _build_token_same_flow() -> dict[str, Any]:
    return eq_expr(ref_expr(TOKEN_FLOW_ID), ref_expr(CURRENT_FLOW))


def _build_token_depth_at_most(*, max_depth: int) -> dict[str, Any]:
    return le_expr(lineage_depth_expr(TOKEN_ID), lit_expr(max_depth))


def _build_token_root_flow_is(*, flow_id: str) -> dict[str, Any]:
    return eq_expr(lineage_root_expr(TOKEN_ID), lit_expr(flow_id))


def _build_token_subject_matches_principal() -> dict[str, Any]:
    return eq_expr(ref_expr(TOKEN_SUBJECT), ref_expr(ACTOR_ID))


# --------------------------------------------------------------------------- #
# workflow state
# --------------------------------------------------------------------------- #
def _build_state_is(*, state: str) -> dict[str, Any]:
    return state_is_expr(WORKFLOW_INSTANCE_STATE, state)


def _build_transition_declared(*, to_state: str) -> dict[str, Any]:
    return transition_allowed_expr(WORKFLOW_INSTANCE_STATE, to_state)


def _build_state_in(*, states: tuple[str, ...]) -> dict[str, Any]:
    if len(states) == 1:
        return state_is_expr(WORKFLOW_INSTANCE_STATE, states[0])
    return or_expr(
        *(state_is_expr(WORKFLOW_INSTANCE_STATE, state) for state in states)
    )


# --------------------------------------------------------------------------- #
# one_time_token / tenant_isolation
# --------------------------------------------------------------------------- #
def _build_one_time_unused() -> dict[str, Any]:
    return or_expr(
        eq_expr(ref_expr(TOKEN_ONE_TIME), lit_expr(False)),
        eq_expr(ref_expr(TOKEN_USED), lit_expr(False)),
    )


def _build_same_tenant() -> dict[str, Any]:
    return or_expr(
        eq_expr(ref_expr(ACTOR_TENANT), ref_expr(RESOURCE_TENANT)),
        is_empty_expr(ref_expr(ACTOR_TENANT)),
    )


#: Phase 1 的模板全集（顺序即文档顺序，``invariant_keys()`` 用它）。
TEMPLATES: tuple[InvariantTemplate, ...] = (
    # ownership
    InvariantTemplate(
        key="ownership.owner_only",
        category="ownership",
        summary="读/写资源的主体必须是属主；可选同租户支持角色逃生分支（BOLA/IDOR 防护）",
        build=_build_owner_only,
        bindings=("actor", "resource"),
        params=("support_roles",),
        param_defaults={"support_roles": ()},
    ),
    InvariantTemplate(
        key="ownership.owner_or_group",
        category="ownership",
        summary="主体是属主或属于授权组",
        build=_build_owner_or_group,
        bindings=("actor", "resource"),
        params=("groups",),
    ),
    # authorization
    InvariantTemplate(
        key="authorization.privilege_required",
        category="authorization",
        summary="主体必须直授某个权限（垂直越权防护）",
        build=_build_privilege_required,
        bindings=("actor",),
        params=("privilege",),
    ),
    InvariantTemplate(
        key="authorization.role_required",
        category="authorization",
        summary="主体必须持有至少一个指定角色（RBAC，垂直越权防护）",
        build=_build_role_required,
        bindings=("actor",),
        params=("roles",),
    ),
    InvariantTemplate(
        key="authorization.owner_or_privileged",
        category="authorization",
        summary="主体是属主或持有特权角色（水平+垂直越权防护）",
        build=_build_owner_or_privileged,
        bindings=("actor", "resource"),
        params=("roles",),
    ),
    # session validity
    InvariantTemplate(
        key="session_validity.active",
        category="session_revocation",
        summary="会话必须 valid、未 revoked、未在虚拟时钟上过期",
        build=_build_session_active,
        bindings=("session",),
    ),
    InvariantTemplate(
        key="session_validity.authenticated",
        category="authentication_state",
        summary="主体的认证状态必须达到要求（默认 authenticated）",
        build=_build_authenticated,
        bindings=("actor",),
        default_applies_to=("*",),
        params=("state",),
        param_defaults={"state": "authenticated"},
    ),
    InvariantTemplate(
        key="session_validity.bound_to_principal",
        category="session_binding",
        summary="会话主体必须正是行动的 principal（会话嫁接防护）",
        build=_build_session_bound_to_principal,
        bindings=("actor", "session"),
    ),
    # token lineage
    InvariantTemplate(
        key="token_lineage.same_flow",
        category="token_lineage",
        summary="token 只能在签发它的 flow 里使用（跨 flow 重用防护）",
        build=_build_token_same_flow,
        bindings=("token",),
        params=(),
    ),
    InvariantTemplate(
        key="token_lineage.depth_at_most",
        category="token_lineage",
        summary="token 血缘深度不得超过上限",
        build=_build_token_depth_at_most,
        bindings=("token",),
        params=("max_depth",),
        param_defaults={"max_depth": 1},
    ),
    InvariantTemplate(
        key="token_lineage.root_flow_is",
        category="token_lineage",
        summary="token 血缘根的 flow 必须是指定 flow",
        build=_build_token_root_flow_is,
        bindings=("token",),
        params=("flow_id",),
    ),
    InvariantTemplate(
        key="token_lineage.subject_matches_principal",
        category="token_lineage",
        summary="token 的 subject 必须正是行动主体（token 嫁接防护）",
        build=_build_token_subject_matches_principal,
        bindings=("actor", "token"),
    ),
    # workflow state
    InvariantTemplate(
        key="workflow_state.state_is",
        category="workflow_transition",
        summary="工作流实例必须处于指定状态",
        build=_build_state_is,
        bindings=("workflow_instance",),
        params=("state",),
    ),
    InvariantTemplate(
        key="workflow_state.transition_declared",
        category="workflow_transition",
        summary="从实例当前态到目标态的转移必须在状态机里声明且条件成立",
        build=_build_transition_declared,
        bindings=("workflow_instance",),
        params=("to_state",),
    ),
    InvariantTemplate(
        key="workflow_state.state_in",
        category="workflow_transition",
        summary="工作流实例必须处于若干允许状态之一",
        build=_build_state_in,
        bindings=("workflow_instance",),
        params=("states",),
    ),
    # one_time_token
    InvariantTemplate(
        key="one_time_token.unused",
        category="one_time_token",
        summary="一次性 token 不得已被使用过",
        build=_build_one_time_unused,
        bindings=("token",),
    ),
    # tenant_isolation
    InvariantTemplate(
        key="tenant_isolation.same_tenant",
        category="tenant_isolation",
        summary="主体与资源必须同租户（主体无租户时不构成跨租户）",
        build=_build_same_tenant,
        bindings=("actor", "resource"),
    ),
)


def _coerce_params(template: InvariantTemplate, params: dict[str, Any]) -> dict[str, Any]:
    """按模板声明把参数收敛成严格类型（无隐式 coerce）。"""
    resolved = {**template.param_defaults, **params}
    missing = [name for name in template.params if name not in resolved]
    if missing:
        raise DslError(f"模板 {template.key} 缺少必填参数 {missing}")
    coerced: dict[str, Any] = {}
    for name in template.params:
        value = resolved[name]
        if name in ("support_roles", "groups", "roles", "states"):
            coerced[name] = _roles(value, name)
        elif name in ("privilege", "state", "flow_id", "to_state"):
            coerced[name] = _text(value, name)
        elif name == "max_depth":
            coerced[name] = _count(value, name)
        else:  # pragma: no cover - 新参数必须在此登记
            raise DslError(f"模板 {template.key} 的参数 {name} 未登记校验规则")
    return coerced


__all__ = [
    "DEFAULT_SEVERITY",
    "TEMPLATES",
    "InvariantTemplate",
    "establishing_evidence_exists_expr",
]
