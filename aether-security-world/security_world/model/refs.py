"""引用路径的唯一 BNF、实体注册表与 action 视图展开。

设计 §4.3（第 1 轮复审：原先有三套互不通约的路径语法，已统一为一套）::

    path      := id_view | action_view | context
    id_view   := <entity_type> "." <entity_id> ("." <field>)+
    entity_type := actor | resource | session | token | workflow | workflow_instance
                 | cache | service | credential | role
    action_view := "action." (actor|resource|session|token|workflow_instance|parameters|request) ("." <field>)*
    context   := "current_flow." <field> | "current_time"

四条规则，逐条对应本模块的落地：

1. **ID 视图是唯一的事实键命名空间。** ``evidence.asserts_ref``、
   ``cache_entry.cached_subject``、``critical_state_variables``、
   ``decision_facts()`` 的返回值全用它——因此两边可以逐字 ``==`` 比较（D3）。
2. **action 绑定视图只出现在 DSL 里**，:func:`expand_action_view` 在编译期把它
   展开成实例路径（``action.resource.owner`` → ``resource.RES-001.owner``）。
   ``action.parameters.*`` / ``action.request.*`` 不是实体绑定，**无法**展开，
   调用方必须显式处理（:func:`try_expand_action_view` 返回 ``None``）。
3. **证据视图没有 ref 路径。** ``evidence_view.<id>.*`` 已从 DSL 删除（B19）；
   唯一入口是 ``establishing_evidence_exists``。
4. ``diff_worlds().changed_paths`` 用同一套 ID 视图路径，因此
   ``intervention.intervention_variable`` 可以直接和 ``changed_paths`` 比。

**引用完整性是硬失败**：任何 actor/resource/token/session 引用解析不了就抛
:class:`RefResolutionError`，绝不静默返回 ``None``——一个静默的 ``None`` 会
在 oracle 里变成一个来源不明的"事实不存在"，比崩溃危险得多。
"""
from __future__ import annotations

import re
from collections.abc import Iterator, Mapping, Sequence
from typing import Any, Protocol

from .errors import ModelError, RefResolutionError
from .documents import require_str

#: 10 类实体（与 ``world.schema.json`` / ``evidence.schema.json`` 的模式一致）。
ENTITY_TYPES: tuple[str, ...] = (
    "actor",
    "resource",
    "session",
    "token",
    "workflow",
    "workflow_instance",
    "cache",
    "service",
    "credential",
    "role",
)

#: action 绑定视图里可绑定的实体类型（可与 ID 视图的实体类型一一对应）。
ACTION_BINDING_TYPES: tuple[str, ...] = (
    "actor",
    "resource",
    "session",
    "token",
    "workflow_instance",
)

#: action 视图里的**非实体**局部视图：动作自带的参数与请求面。
ACTION_LOCAL_VIEWS: tuple[str, ...] = ("parameters", "request")

#: 与 schemas 里的正则逐字一致（只做形状校验；实体 id 的切分由注册表查找决定，
#: 因为 schema 的 id 模式允许出现 "."，贪婪匹配会切错）。
#: action 视图的字段段是**必需**的（schema 模式没有 "?"），因此 "action.actor"
#: 不是合法视图。
ID_VIEW_PATTERN = re.compile(
    r"^(actor|resource|session|token|workflow|workflow_instance|cache|service|credential|role)"
    r"\.[A-Za-z0-9][A-Za-z0-9._-]{0,62}(\.[A-Za-z0-9_]+)+$"
)
ACTION_VIEW_PATTERN = re.compile(
    r"^action\.(actor|resource|session|token|workflow_instance|parameters|request)"
    r"(\.[A-Za-z0-9_][A-Za-z0-9._-]*)$"
)
CONTEXT_VIEW_PATTERN = re.compile(r"^current_flow\.[A-Za-z0-9_]+$|^current_time$")

#: 上下文视图（不是世界路径，由求值器提供，见设计 §4.3 规则 3）。
CONTEXT_PATHS: frozenset[str] = frozenset({"current_time"})


class IdView:
    """解析后的 ID 视图路径。"""

    __slots__ = ("entity_id", "entity_type", "fields", "path")

    def __init__(self, entity_type: str, entity_id: str, fields: tuple[str, ...], path: str) -> None:
        self.entity_type = entity_type
        self.entity_id = entity_id
        self.fields = fields
        self.path = path

    def __repr__(self) -> str:  # pragma: no cover - 调试辅助
        return f"IdView({self.path!r})"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, IdView):
            return NotImplemented
        return (
            self.entity_type == other.entity_type
            and self.entity_id == other.entity_id
            and self.fields == other.fields
        )

    def __hash__(self) -> int:
        return hash((self.entity_type, self.entity_id, self.fields))


class ActionLike(Protocol):
    """oracle 输入的最小结构契约（Agent B 的 ``Action`` 满足它）。

    模型层**不定义** ``Action`` 数据类（那是 L2 ``security_world/policy`` 的
    公共符号，设计 §15.3），只声明"展开 action 视图需要读到什么"，避免两个包
    导出同名符号后调用方不知道该 import 哪一个。
    """

    action_id: str
    operation: str
    actor: str
    resource: str | None
    session: str | None
    token: str | None
    workflow_instance: str | None
    flow_id: str
    at: str


def split_segments(path: str) -> tuple[str, ...]:
    """按 ``.`` 切分路径（不校验形状）。"""
    return tuple(path.split("."))


def classify_path(path: Any) -> str:
    """返回 ``id_view`` / ``action_view`` / ``context`` / ``invalid``。"""
    if not isinstance(path, str) or not path:
        return "invalid"
    if ID_VIEW_PATTERN.match(path):
        return "id_view"
    if ACTION_VIEW_PATTERN.match(path):
        return "action_view"
    if CONTEXT_VIEW_PATTERN.match(path):
        return "context"
    return "invalid"


def is_id_view(path: Any) -> bool:
    return classify_path(path) == "id_view"


def is_action_view(path: Any) -> bool:
    return classify_path(path) == "action_view"


def is_context_view(path: Any) -> bool:
    return classify_path(path) == "context"


def parse_id_view(path: Any) -> IdView:
    """解析 ID 视图路径的**形状**（不查注册表）。

    实体的切分在这里只按语法切；具体 ``entity_id`` 由
    :meth:`ReferenceRegistry.resolve` 用查找决定，因为 schema 的 id 模式允许
    ``.``，纯正则贪婪匹配会切错（``actor.ACT-001.identity.email`` 的 id 段会被
    误切成 ``ACT-001.identity``）。
    """
    text = require_str(path, "path")
    if not ID_VIEW_PATTERN.match(text):
        raise RefResolutionError(text, "invalid_path", detail="不符合 ID 视图 BNF")
    segments = split_segments(text)
    entity_type = segments[0]
    if entity_type not in ENTITY_TYPES:
        raise RefResolutionError(text, "unknown_entity_type", detail=f"{entity_type!r} 不是实体类型")
    if len(segments) < 3:
        raise RefResolutionError(text, "invalid_path", detail="ID 视图至少需要一个字段段")
    # 形状层先按"第一个非空段即 id"给出一个候选；resolve 会用最长匹配覆盖它。
    return IdView(entity_type, segments[1], tuple(segments[2:]), text)


# --------------------------------------------------------------------------- #
# action 视图展开
# --------------------------------------------------------------------------- #
def parse_action_view(path: Any) -> tuple[str, tuple[str, ...]]:
    """解析 action 视图，返回 ``(binding, fields)``。"""
    text = require_str(path, "path")
    match = ACTION_VIEW_PATTERN.match(text)
    if match is None:
        raise RefResolutionError(text, "invalid_path", detail="不符合 action 视图 BNF")
    binding = match.group(1)
    # group(2) 一定以 "." 开头（模式要求至少一个字段段）。
    rest = match.group(2)[1:]
    fields = tuple(segment for segment in rest.split(".") if segment)
    return binding, fields


def expand_action_view(path: Any, action: ActionLike) -> str:
    """把 action 绑定视图展开成实例路径。

    ``action.resource.owner`` + ``action.resource == "RES-001"``
    → ``resource.RES-001.owner``。

    三种失败都是 :class:`RefResolutionError`：路径不是 action 视图
    （``invalid_path``）、绑定为 ``None``（``unbound_subject``，对应
    ``skipped_out_of_scope`` 的运行期语义）、或指向 ``action.parameters.*`` /
    ``action.request.*``（``action_local_view``——动作局部数据没有实例路径）。
    """
    text = require_str(path, "path")
    binding, fields = parse_action_view(text)
    if binding in ACTION_LOCAL_VIEWS:
        raise RefResolutionError(
            text,
            "action_local_view",
            detail=f"action.{binding}.* 是动作局部数据，没有对应的实例路径",
        )
    entity_id = getattr(action, binding, None)
    if entity_id is None:
        raise RefResolutionError(
            text,
            "unbound_subject",
            detail=f"action.{binding} 未绑定；对应不变量必须记 skipped_out_of_scope",
        )
    if not isinstance(entity_id, str) or not entity_id:
        raise RefResolutionError(
            text, "unbound_subject", detail=f"action.{binding} 不是非空字符串: {entity_id!r}"
        )
    if not fields:
        raise RefResolutionError(text, "invalid_path", detail="action 视图至少需要一个字段段")
    return ".".join((binding, entity_id, *fields))


def try_expand_action_view(path: Any, action: ActionLike) -> str | None:
    """:func:`expand_action_view` 的宽容版：无法展开时返回 ``None`` 而不抛错。

    供 ``decision_facts()`` 这类"能展开就记、不能展开就跳过"的调用方使用；
    **不**用于编译期校验（那里必须硬失败）。
    """
    try:
        return expand_action_view(path, action)
    except RefResolutionError:
        return None


# --------------------------------------------------------------------------- #
# 实体注册表
# --------------------------------------------------------------------------- #
class ReferenceRegistry:
    """实体与引用注册表：ID 视图路径的唯一解析权威。

    构造时接收 ``entity_type -> (entity_id -> document)`` 的映射（普通 dict，
    由 :func:`security_world.model.entities.collect_entities` 从世界文档收集）。
    注册表**只读**：解析过程不得修改任何状态（设计 §4.3："The resolver is pure"）。
    """

    __slots__ = ("_entities", "_universe")

    def __init__(self, entities: Mapping[str, Mapping[str, Mapping[str, Any]]]) -> None:
        collected: dict[str, dict[str, Mapping[str, Any]]] = {}
        for entity_type in ENTITY_TYPES:
            bucket = entities.get(entity_type) or {}
            collected[entity_type] = {
                entity_id: require_entity_document(entity_type, entity_id, document)
                for entity_id, document in bucket.items()
            }
        self._entities = collected
        self._universe: frozenset[str] | None = None

    # -- 查询 --------------------------------------------------------------- #
    def ids(self, entity_type: str) -> tuple[str, ...]:
        """某类实体的全部 id（排序，确定性）。"""
        if entity_type not in self._entities:
            raise RefResolutionError("", "unknown_entity_type", detail=entity_type)
        return tuple(sorted(self._entities[entity_type]))

    def has_entity(self, entity_type: str, entity_id: str) -> bool:
        return entity_type in self._entities and entity_id in self._entities[entity_type]

    def entity_document(self, entity_type: str, entity_id: str) -> Mapping[str, Any]:
        bucket = self._entities.get(entity_type)
        if bucket is None:
            raise RefResolutionError(
                f"{entity_type}.{entity_id}", "unknown_entity_type", detail=entity_type
            )
        document = bucket.get(entity_id)
        if document is None:
            raise RefResolutionError(
                f"{entity_type}.{entity_id}",
                "unknown_entity_id",
                detail=f"{entity_type} 集合里没有 {entity_id!r}（悬空引用）",
            )
        return document

    def resolve(self, path: Any) -> Any:
        """解析 ID 视图路径，返回字段值；任何失败都抛 :class:`RefResolutionError`。"""
        text = require_str(path, "path")
        if classify_path(text) != "id_view":
            raise RefResolutionError(text, "not_an_id_view", detail="只有 ID 视图可由世界解析")
        segments = split_segments(text)
        entity_type = segments[0]
        bucket = self._entities.get(entity_type)
        if bucket is None:
            raise RefResolutionError(text, "unknown_entity_type", detail=entity_type)
        # 最长匹配优先：schema 的 id 模式允许 '.'，因此从最长的候选 id 开始找。
        entity_id = ""
        fields: tuple[str, ...] = ()
        for end in range(len(segments) - 1, 1, -1):
            candidate = ".".join(segments[1:end])
            if candidate in bucket:
                entity_id = candidate
                fields = segments[end:]
                break
        if not entity_id:
            raise RefResolutionError(
                text,
                "unknown_entity_id",
                detail=f"{entity_type} 集合里没有 {'.'.join(segments[1:])!r}（悬空引用）",
            )
        if not fields:
            raise RefResolutionError(text, "invalid_path", detail="ID 视图至少需要一个字段段")
        current: Any = bucket[entity_id]
        walked: list[str] = []
        for segment in fields:
            walked.append(segment)
            if isinstance(current, Mapping):
                if segment not in current:
                    raise RefResolutionError(
                        text,
                        "unknown_field",
                        detail=f"{entity_type}.{entity_id} 没有字段 {'.'.join(walked)!r}",
                    )
                current = current[segment]
            elif isinstance(current, (list, tuple)):
                raise RefResolutionError(
                    text,
                    "unsupported_index",
                    detail=f"{'.'.join(walked[:-1])!r} 是数组，BNF 不支持下标访问",
                )
            elif current is None:
                raise RefResolutionError(
                    text, "null_path", detail=f"{'.'.join(walked[:-1])!r} 是 null"
                )
            else:
                raise RefResolutionError(
                    text, "unknown_field", detail=f"{'.'.join(walked[:-1])!r} 是标量，无子字段"
                )
        return current

    def contains(self, path: Any) -> bool:
        try:
            self.resolve(path)
        except RefResolutionError:
            return False
        return True

    def ref_universe(self) -> frozenset[str]:
        """全部可解析的 ID 视图路径（Gate 2 / Gate 3 用）。

        包含中间节点（``session.SES-003.privilege_snapshot``）与叶子
        （``session.SES-003.privilege_snapshot.privilege_version``），因为
        ``resolve`` 两者都支持。数组只产出数组本身的路径——BNF 没有下标。
        """
        if self._universe is None:
            paths: set[str] = set()
            for entity_type in ENTITY_TYPES:
                for entity_id in sorted(self._entities[entity_type]):
                    base = f"{entity_type}.{entity_id}"
                    for suffix in _document_field_paths(self._entities[entity_type][entity_id]):
                        paths.add(f"{base}.{suffix}")
            self._universe = frozenset(paths)
        return self._universe

    def __repr__(self) -> str:  # pragma: no cover - 调试辅助
        counts = {t: len(self._entities[t]) for t in ENTITY_TYPES if self._entities[t]}
        return f"ReferenceRegistry({counts})"


def require_entity_document(
    entity_type: str, entity_id: str, document: Any
) -> Mapping[str, Any]:
    """注册表入口校验：实体文档必须是 object。"""
    if not isinstance(document, Mapping):
        raise ModelError(
            f"{entity_type}.{entity_id}: 实体文档必须是 object，得到 {type(document).__name__}"
        )
    return document


def _document_field_paths(document: Mapping[str, Any], prefix: str = "") -> Iterator[str]:
    """产出实体文档内全部 ``<field>.<subfield>`` 形态的路径（不含实体前缀）。"""
    for key in sorted(document):
        path = f"{prefix}.{key}" if prefix else key
        yield path
        value = document[key]
        if isinstance(value, Mapping):
            yield from _document_field_paths(value, path)


def build_registry_from_documents(entities: Mapping[str, Mapping[str, Mapping[str, Any]]]) -> ReferenceRegistry:
    """便利构造器（供 Agent D/E 在手里只有文档时使用）。"""
    return ReferenceRegistry(entities)


# --------------------------------------------------------------------------- #
# DSL 文档遍历（编译期校验用；求值归 Agent B 的 policy 包）
# --------------------------------------------------------------------------- #
LITERAL_OP = "lit"
REF_OP = "ref"
EVIDENCE_BRIDGE_OP = "establishing_evidence_exists"


def iter_document_ref_paths(node: Any, *, where: str = "expr") -> Iterator[str]:
    """按文档顺序产出 DSL 节点里出现的全部 ref 路径。

    只做**结构遍历**，不求值、不建 AST（``parse_expr`` / ``static_refs`` 是
    L2 ``security_world/policy`` 的公共符号，本模块不重复实现）。编译期需要
    "每条 ref 都能解析"这个性质，而那是文档层的性质，所以遍历放在 L1。

    ``establishing_evidence_exists`` 的参数是字符串事实键（同一 ID 视图命名
    空间），因此也按 ref 路径产出。
    """
    if not isinstance(node, Mapping):
        raise ModelError(f"{where}: DSL 节点必须是 object，得到 {type(node).__name__}")
    op = node.get("op")
    if not isinstance(op, str) or not op:
        raise ModelError(f"{where}: DSL 节点缺少字符串 op")
    if op == REF_OP:
        yield require_str(node.get("path"), f"{where}.path")
        return
    if op == EVIDENCE_BRIDGE_OP:
        args = node.get("args")
        if not isinstance(args, Sequence) or isinstance(args, (str, bytes)):
            raise ModelError(f"{where}: {EVIDENCE_BRIDGE_OP} 的 args 必须是数组")
        for index, fact_key in enumerate(args):
            yield require_str(fact_key, f"{where}.args[{index}]")
        return
    args = node.get("args")
    if args is None:
        return
    if not isinstance(args, Sequence) or isinstance(args, (str, bytes)):
        raise ModelError(f"{where}: args 必须是数组，得到 {type(args).__name__}")
    for index, arg in enumerate(args):
        yield from iter_document_ref_paths(arg, where=f"{where}.args[{index}]")


def is_literal(node: Any, value: Any = None) -> bool:
    """节点是否是 ``lit``（可选地要求等于某个值）——policy 非空洞性检查用。

    比较是**类型严格**的：``lit true`` 不等于 ``lit 1``，否则"常量真值"会被
    一个整数常量蒙混过关（设计 §3 D6：不许隐式转换）。
    """
    if not isinstance(node, Mapping):
        return False
    if node.get("op") != LITERAL_OP:
        return False
    if value is None:
        return True
    actual = node.get("value")
    return type(actual) is type(value) and actual == value


def condition_ref_paths(condition: Any) -> tuple[str, ...]:
    """把 :func:`iter_document_ref_paths` 物化成保序、去重的路径元组。"""
    seen: dict[str, None] = {}
    for path in iter_document_ref_paths(condition):
        seen.setdefault(path, None)
    return tuple(seen)


__all__ = [
    "ACTION_BINDING_TYPES",
    "ACTION_LOCAL_VIEWS",
    "ACTION_VIEW_PATTERN",
    "CONTEXT_PATHS",
    "CONTEXT_VIEW_PATTERN",
    "EVIDENCE_BRIDGE_OP",
    "ENTITY_TYPES",
    "ID_VIEW_PATTERN",
    "LITERAL_OP",
    "REF_OP",
    "ActionLike",
    "IdView",
    "ReferenceRegistry",
    "build_registry_from_documents",
    "classify_path",
    "condition_ref_paths",
    "expand_action_view",
    "is_action_view",
    "is_context_view",
    "is_id_view",
    "is_literal",
    "iter_document_ref_paths",
    "parse_action_view",
    "parse_id_view",
    "require_entity_document",
    "split_segments",
    "try_expand_action_view",
]
