"""求值上下文：:class:`Action`（oracle 的主输入）与 :class:`EvalContext`。

``Action`` 是 **L2 的公共符号**（设计 §15.3），不是 L1 的数据类——L1 只声明
``ActionLike`` 结构协议（``security_world/model/refs.py``），避免两个包导出同名
符号后调用方不知道该 import 哪一个。本模块的 ``Action`` 满足该协议。

``action.schema.json`` 的三个绑定（``session`` / ``token`` / ``workflow_instance``）
**可空是有意的**：未绑定主体正是"撤销会话重用"、"跨 flow token 重用"、"绕过工作流"
三类样本的表示方式；未绑定主体让对应不变量记 ``skipped_unbound_subject``，
而不是被静默判成满足。
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

from ..model.canonical import to_plain_json
from ..model.documents import (
    require_mapping,
    require_non_empty_str,
    require_str_or_none,
)
from ..model.errors import ModelError, RefResolutionError
from ..model.refs import ActionLike, is_action_view, try_expand_action_view
from .ast import DslError
from .parser import parse_expr

#: action 文档允许的键（与 ``schemas/action.schema.json`` 的 properties 一致）。
ACTION_KEYS: frozenset[str] = frozenset({
    "$comment", "action_id", "operation", "actor", "resource", "session", "token",
    "workflow_instance", "flow_id", "at", "parameters", "request", "binding_note",
})

#: action 文档必填的键（schema 的 required）。
ACTION_REQUIRED: frozenset[str] = frozenset({"action_id", "operation", "actor", "flow_id", "at"})


@dataclass(frozen=True)
class Action(ActionLike):
    """oracle 的主输入：一个动作对世界的**具名**介入。

    每个绑定字段都是世界里的 ID 引用，因此"episode + 它的 world"完整决定 verdict
    （B6：第三方拿着冻结 release 就能独立重放 oracle）。
    """

    action_id: str
    operation: str
    actor: str
    resource: str | None = None
    session: str | None = None
    token: str | None = None
    workflow_instance: str | None = None
    flow_id: str = ""
    at: str = ""
    parameters: Mapping[str, Any] = field(default_factory=dict)
    request: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "parameters", dict(to_plain_json(dict(self.parameters))))
        object.__setattr__(self, "request", dict(to_plain_json(dict(self.request))))

    # -- 文档往返 ----------------------------------------------------------- #
    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Action":
        require_mapping(document, "action")
        unknown = sorted(key for key in document if key not in ACTION_KEYS)
        if unknown:
            raise ModelError(
                f"action: 出现 schema 未定义的键 {unknown}（additionalProperties: false）"
            )
        missing = sorted(key for key in ACTION_REQUIRED if key not in document)
        if missing:
            raise ModelError(f"action: 缺少必填键 {missing}")
        return cls(
            action_id=require_non_empty_str(document["action_id"], "action.action_id"),
            operation=require_non_empty_str(document["operation"], "action.operation"),
            actor=require_non_empty_str(document["actor"], "action.actor"),
            resource=require_str_or_none(document.get("resource"), "action.resource"),
            session=require_str_or_none(document.get("session"), "action.session"),
            token=require_str_or_none(document.get("token"), "action.token"),
            workflow_instance=require_str_or_none(
                document.get("workflow_instance"), "action.workflow_instance"
            ),
            flow_id=require_non_empty_str(document["flow_id"], "action.flow_id"),
            at=require_non_empty_str(document["at"], "action.at"),
            parameters=document.get("parameters") or {},
            request=document.get("request") or {},
        )

    def to_document(self) -> dict[str, Any]:
        document: dict[str, Any] = {
            "action_id": self.action_id,
            "operation": self.operation,
            "actor": self.actor,
            "flow_id": self.flow_id,
            "at": self.at,
        }
        for key in ("resource", "session", "token", "workflow_instance"):
            value = getattr(self, key)
            if value is not None:
                document[key] = value
        if self.parameters:
            document["parameters"] = dict(self.parameters)
        if self.request:
            document["request"] = dict(self.request)
        return document

    # -- 绑定查询 ----------------------------------------------------------- #
    @property
    def bindings(self) -> dict[str, str | None]:
        """五类实体绑定（``parameters`` / ``request`` 不是实体绑定，不在此列）。"""
        return {
            "actor": self.actor,
            "resource": self.resource,
            "session": self.session,
            "token": self.token,
            "workflow_instance": self.workflow_instance,
        }

    def is_bound(self, binding: str) -> bool:
        """该绑定是否已绑定（``actor`` 必填，恒为 True）。"""
        if binding not in self.bindings:
            raise DslError(f"未知 action 绑定 {binding!r}；可用: {sorted(self.bindings)}")
        return self.bindings[binding] is not None

    def resource_type(self, world: Any) -> str | None:
        """绑定资源的 ``resource_type``（策略匹配用）。

        未绑定资源 ⇒ ``None``（``ActionPattern.matches`` 对 ``None`` 放行，
        见 L1 语义）；绑定但世界里不存在该资源 ⇒ :class:`RefResolutionError`
        （引用完整性违规，硬失败，绝不静默变成"任意类型"）。
        """
        if self.resource is None:
            return None
        value = world.resolve(f"resource.{self.resource}.resource_type")
        if not isinstance(value, str):
            raise RefResolutionError(
                f"resource.{self.resource}.resource_type",
                "unknown_field",
                detail=f"resource_type 必须是字符串，得到 {type(value).__name__}",
            )
        return value


class ConditionContext(Protocol):
    """能求值一条 DSL 条件文档的上下文（工作流条件迁移用）。

    由 :class:`EvalContext` 实现。``security_world.workflows`` 只面向这个协议编程，
    **不** import ``security_world.policy``——否则 L2 内部出现 policy ↔ workflows
    环（``test_import_boundaries`` 会拒）。
    """

    def evaluate_condition(self, document: Mapping[str, Any]) -> bool:  # pragma: no cover
        ...


@dataclass(frozen=True)
class EvalContext(ConditionContext):
    """一次求值的全部环境（设计 §15.3）。

    ``evidence_view is None`` ⇒ **truth 趟**：只读世界状态，不读证据
    （``world_truth`` 因此在完整状态上计算，与证据掩蔽无关）。

    ``consulted_refs`` 是**求值期动态记录**的"实际读到的 ID 视图路径"集合
    （§8.2 / B3）：短路分支不计入，context 视图与 action 局部视图不计入，
    action 绑定自身的身份字段不计入（见 :meth:`record_ref`）。

    ``read_paths`` 是同一过程的**完整台帐**（含身份字段与 context / action 局部
    视图），供 ``decision_trace`` 的 ``operands.ref`` 使用；它不参与充分性判定。
    """

    world: Any
    action: Action | None = None
    evidence_view: Any | None = None
    now: str = ""
    current_flow_id: str = ""
    consulted_refs: set[str] = field(default_factory=set)
    read_paths: set[str] = field(default_factory=set)

    # -- 条件求值（workflows 的入口） --------------------------------------- #
    def evaluate_condition(self, document: Mapping[str, Any]) -> bool:
        """求值一条 DSL 条件文档，返回布尔（非布尔 ⇒ :class:`DslError`）。

        用**同一个** ctx（含 ``consulted_refs`` / ``read_paths``），因此条件迁移里
        读到的 ref 也计入 consulted_facts——决策确实依赖它们。
        """
        from .evaluator import eval_expr  # 延迟导入：evaluator 依赖本模块

        value = eval_expr(parse_expr(document, where="condition"), self)
        if isinstance(value, bool):
            return value
        raise DslError(f"条件迁移的 condition 必须求值为 boolean，得到 {value!r}")

    # -- consulted_facts 记录 ---------------------------------------------- #
    def record_read(self, path: str) -> None:
        """记录一条**实际读到**的 DSL 路径（原样，未展开）。

        与 :meth:`record_ref` 的分工：``read_paths`` 是"这条求值碰过哪些路径"的
        完整台帐（含 action 绑定自身的身份字段、context 视图、action 局部视图），
        供 ``decision_trace`` 的 ``operands.ref`` 命名操作数；``consulted_refs``
        是其中**需要证据建立**的那部分（世界事实）。两者都必须在输出前排序——
        集合迭代序受 ``PYTHONHASHSEED`` 影响。
        """
        if isinstance(path, str) and path:
            self.read_paths.add(path)

    def record_ref(self, path: str, action: Action | None = None) -> None:
        """记录一条**实际读到**的 ID 视图路径（已展开成实例路径）。

        三类不计入（都写在 §8.2 / B3 的理由里）：

        1. **context 视图**（``current_time`` / ``current_flow.flow_id``）与
           **action 局部视图**（``action.parameters.*`` / ``action.request.*``）：
           它们由 action 文档本身给出，不是世界状态，不需要证据建立。
        2. **action 绑定自身的身份字段**（``actor.ACT-003.actor_id`` 等）：
           请求里已经点名了 principal，再要求一条"证明 principal 是谁"的证据是
           循环的——黄金 fixture 的 ``consulted_facts`` 正是因此不含
           ``actor.ACT-003.actor_id``，否则每个读 principal 的策略都会因为缺证据
           把全部样本判成 ``insufficient_evidence``。
        3. 解析失败的路径（调用方在抛错前不会走到这里）。
        """
        if not isinstance(path, str) or not path:
            return
        if is_action_view(path):  # 未展开的 action 视图不该进事实键空间
            expanded = try_expand_action_view(path, action) if action is not None else None
            if expanded is None:
                return
            path = expanded
        subject = action if action is not None else self.action
        if is_self_establishing_identity(path, subject):
            return
        self.consulted_refs.add(path)


def is_self_establishing_identity(path: str, action: Action | None) -> bool:
    """``path`` 是否是某个 action 绑定实体自己的身份字段。

    ``actor.ACT-003.actor_id`` / ``resource.RES-001.resource_id`` /
    ``session.SES-003.session_id`` / ``token.TOK-001.token_id`` /
    ``workflow_instance.WFI-001.instance_id``——绑定 id 由 action 文档建立。
    """
    if action is None:
        return False
    for binding, entity_id in action.bindings.items():
        if entity_id is None:
            continue
        prefix = f"{binding}.{entity_id}."
        if path.startswith(prefix) and _IDENTITY_FIELDS[binding] == path[len(prefix):]:
            return True
    return False


#: 每类实体文档里"这是我自己"的字段名（与 L1 实体的 id 字段一致）。
_IDENTITY_FIELDS: dict[str, str] = {
    "actor": "actor_id",
    "resource": "resource_id",
    "session": "session_id",
    "token": "token_id",
    "workflow_instance": "instance_id",
}


__all__ = [
    "ACTION_KEYS",
    "ACTION_REQUIRED",
    "Action",
    "ConditionContext",
    "EvalContext",
    "is_self_establishing_identity",
]
