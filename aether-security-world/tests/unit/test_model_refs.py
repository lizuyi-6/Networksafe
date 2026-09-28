"""引用路径 BNF、注册表解析与 action 视图展开（设计 §4.3）。

第 1 轮复审发现原先有**三套互不通约**的路径语法，黄金 fixture 的 verdict 无法由
文档算法推出。现在只有一套：ID 视图是唯一事实键命名空间，action 绑定视图在编译期
展开成实例路径，证据视图没有 ref 路径。这些测试把三条规则钉成可证伪断言。

REVISION 2（任务书 A3）追加两类断言：

* **round-trip 性质**：``parse`` 的输出必须能无损 ``format`` 回原文
  （``parse_id_view(p).path == p``，且按 (type, id, fields) 重组逐字相同）；
  ``expand_action_view`` 的输出必须重新分类为 ``id_view`` 并可解析；
* **单一 BNF**：``refs.ID_VIEW_PATTERN`` 必须与 schemas 里**每一个**路径字段的
  模式逐字相同（cache/evidence/actor/resource/session/token/workflow/action 全部
  路径字段）——曾出现过的第二套表示法（world-spec 的 critical 轴模式少
  ``workflow``/``role`` 两类实体）由本测试永久封死。
"""
from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from security_world.model import (
    ENTITY_TYPES,
    RefResolutionError,
    ReferenceRegistry,
    classify_path,
    condition_ref_paths,
    expand_action_view,
    is_action_view,
    is_context_view,
    is_id_view,
    is_literal,
    iter_document_ref_paths,
    load_world,
    parse_action_view,
    parse_id_view,
    try_expand_action_view,
)
from security_world.model.refs import ID_VIEW_PATTERN


@dataclasses.dataclass(frozen=True)
class _Action:
    """满足 ``ActionLike`` 的最小替身（真实 ``Action`` 归 L2 policy 包）。"""

    action_id: str = "ACTN-000001-000"
    operation: str = "read"
    actor: str = "ACT-003"
    resource: str | None = "RES-001"
    session: str | None = "SES-003"
    token: str | None = None
    workflow_instance: str | None = None
    flow_id: str = "FLOW-READ"
    at: str = "2026-09-20T08:00:00Z"


@pytest.fixture(scope="module")
def reference_world_instance(examples_dir):
    """参考世界实例（``schemas/examples/world.example.json``）。"""
    return load_world(examples_dir / "world.example.json")


# --------------------------------------------------------------------------- #
# 视图分类
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "path",
    [
        "resource.RES-001.owner",
        "actor.ACT-001.privilege_version",
        "session.SES-003.privilege_snapshot.privilege_version",
        "token.TOK-001.parent_token",
        "workflow.WFL-ORDER.states",
        "workflow_instance.WFI-001.current_state",
        "cache.CACHE-PERM-001.cached_value",
        "service.SVC-DB.service_type",
        "credential.CRED-001.status",
        "role.ROLE-SUPPORT.privileges",
    ],
)
def test_id_view_paths_are_recognised(path):
    assert is_id_view(path)
    assert classify_path(path) == "id_view"


@pytest.mark.parametrize(
    "path",
    [
        "action.actor.actor_id",
        "action.resource.owner",
        "action.session.privilege_snapshot.privilege_version",
        "action.token.flow_id",
        "action.workflow_instance.current_state",
        "action.parameters.tainted_inputs",
        "action.request.headers.User-Agent",
    ],
)
def test_action_view_paths_are_recognised(path):
    assert is_action_view(path)
    assert classify_path(path) == "action_view"


@pytest.mark.parametrize("path", ["current_flow.flow_id", "current_time"])
def test_context_paths_are_recognised(path):
    assert is_context_view(path)
    assert classify_path(path) == "context"


@pytest.mark.parametrize(
    "path",
    [
        "evidence_view.EV-OWN-001.value",  # B19：证据视图已从 DSL 删除
        "actor",  # 没有字段段
        "actor.ACT-001",  # 仍然没有字段段
        "widget.WID-001.field",  # 未知实体类型
        "action.actor",  # action 视图至少要一个字段段
        "",
        "current_flow",
        "resource.RES-001.",
    ],
)
def test_invalid_paths_are_rejected(path):
    assert classify_path(path) == "invalid"
    assert not is_id_view(path) and not is_action_view(path) and not is_context_view(path)


def test_entity_types_are_the_ten_bnf_types():
    assert ENTITY_TYPES == (
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


def test_parse_id_view_splits_type_id_and_fields():
    view = parse_id_view("session.SES-003.privilege_snapshot.privilege_version")
    assert view.entity_type == "session"
    assert view.entity_id == "SES-003"
    assert view.fields == ("privilege_snapshot", "privilege_version")


def test_parse_action_view_returns_binding_and_fields():
    assert parse_action_view("action.resource.owner") == ("resource", ("owner",))
    assert parse_action_view("action.parameters.tainted_inputs") == ("parameters", ("tainted_inputs",))
    with pytest.raises(RefResolutionError) as excinfo:
        parse_action_view("resource.RES-001.owner")
    assert excinfo.value.reason == "invalid_path"


# --------------------------------------------------------------------------- #
# 解析
# --------------------------------------------------------------------------- #
def test_resolve_reads_nested_entity_fields(reference_world_instance):
    world = reference_world_instance
    assert world.resolve("resource.RES-001.owner") == "ACT-002"
    assert world.resolve("resource.RES-001.attributes.total_cents") == 129900
    assert world.resolve("actor.ACT-001.identity.email") == "alice@example.invalid"
    assert world.resolve("session.SES-003.privilege_snapshot.privilege_version") == 0
    assert world.resolve("token.TOK-002.parent_token") == "TOK-001"
    assert world.resolve("workflow_instance.WFI-001.current_state") == "paid"
    assert world.resolve("cache.CACHE-PERM-001.cached_value") == 2
    assert world.resolve("role.ROLE-SUPPORT.privileges") == ["order.read.tenant", "order.refund.tenant"]


def test_resolve_returns_arrays_but_never_indexes_them(reference_world_instance):
    assert reference_world_instance.resolve("actor.ACT-001.roles") == ["ROLE-CUSTOMER"]
    with pytest.raises(RefResolutionError) as excinfo:
        reference_world_instance.resolve("actor.ACT-001.roles.0")
    assert excinfo.value.reason == "unsupported_index"


@pytest.mark.parametrize(
    ("path", "reason"),
    [
        ("actor.ACT-999.roles", "unknown_entity_id"),
        ("resource.RES-001.nope", "unknown_field"),
        ("resource.RES-001.owner.deeper", "unknown_field"),
        ("resource.RES-001.acl.0.grantee", "unsupported_index"),
        ("evidence_view.EV-OWN-001.value", "not_an_id_view"),
        ("action.resource.owner", "not_an_id_view"),
        ("current_time", "not_an_id_view"),
        ("widget.WID-001.field", "not_an_id_view"),
    ],
)
def test_resolve_failures_are_loud_not_silent_none(reference_world_instance, path, reason):
    """悬空引用必须炸，不能变成静默的 ``None`` 流进 oracle。"""
    with pytest.raises(RefResolutionError) as excinfo:
        reference_world_instance.resolve(path)
    assert excinfo.value.reason == reason


def test_resolve_handles_ids_containing_dots():
    """schema 的 id 模式允许 ``.``，纯正则贪婪匹配会切错，必须按已知 id 查找。

    真实世界里 id 不含 ``.``，此时最长候选（``ACT-001.identity``）不存在，查找
    自然落到 ``ACT-001``。歧义时的解是确定性的：**最长已知 id 优先**，随后按字段
    走查，走不通就 ``unknown_field``——绝不静默返回 ``None``。
    """
    plain = ReferenceRegistry(
        {"actor": {"ACT-001": {"actor_id": "ACT-001", "identity": {"email": "a@x.invalid"}}}}
    )
    assert plain.resolve("actor.ACT-001.identity.email") == "a@x.invalid"

    ambiguous = ReferenceRegistry(
        {
            "actor": {
                "ACT-001": {"actor_id": "ACT-001", "identity": {"email": "a@x.invalid"}},
                "ACT-001.identity": {
                    "actor_id": "ACT-001.identity",
                    "identity": {"email": "b@x.invalid"},
                },
            }
        }
    )
    # 最长已知 id "ACT-001.identity" 胜出，它自己没有 email 字段 -> 响亮失败。
    with pytest.raises(RefResolutionError) as excinfo:
        ambiguous.resolve("actor.ACT-001.identity.email")
    assert excinfo.value.reason == "unknown_field"
    # 显式走到那个实体的 identity.email。
    assert ambiguous.resolve("actor.ACT-001.identity.identity.email") == "b@x.invalid"
    with pytest.raises(RefResolutionError):
        ambiguous.resolve("actor.ACT-002.identity.email")


def test_ref_universe_covers_intermediate_and_leaf_paths(reference_world_instance):
    universe = reference_world_instance.ref_universe()
    assert "resource.RES-001.owner" in universe
    assert "resource.RES-001.attributes.total_cents" in universe
    assert "session.SES-003.privilege_snapshot" in universe
    assert "session.SES-003.privilege_snapshot.privilege_version" in universe
    # 数组本身是路径，下标不是（BNF 没有下标语法）。
    assert "actor.ACT-001.roles" in universe
    assert "actor.ACT-001.roles.0" not in universe
    # 裸 <type>.<id> 不是合法 ID 视图（至少要一个字段段）。
    assert "actor.ACT-001" not in universe
    assert all(path.startswith(tuple(ENTITY_TYPES)) for path in universe)


def test_ref_universe_is_deterministic(reference_world_instance):
    first = reference_world_instance.ref_universe()
    second = reference_world_instance.ref_universe()
    assert first == second
    assert isinstance(first, frozenset)


# --------------------------------------------------------------------------- #
# action 视图展开
# --------------------------------------------------------------------------- #
def test_expand_action_view_binds_to_the_instance_path():
    action = _Action()
    assert expand_action_view("action.resource.owner", action) == "resource.RES-001.owner"
    assert expand_action_view("action.actor.actor_id", action) == "actor.ACT-003.actor_id"
    assert (
        expand_action_view("action.session.privilege_snapshot.privilege_version", action)
        == "session.SES-003.privilege_snapshot.privilege_version"
    )


def test_expand_action_view_rejects_unbound_subject():
    action = _Action(token=None)
    with pytest.raises(RefResolutionError) as excinfo:
        expand_action_view("action.token.flow_id", action)
    assert excinfo.value.reason == "unbound_subject"


def test_expand_action_view_rejects_action_local_views():
    action = _Action()
    for path in ("action.parameters.tainted_inputs", "action.request.headers.User-Agent"):
        with pytest.raises(RefResolutionError) as excinfo:
            expand_action_view(path, action)
        assert excinfo.value.reason == "action_local_view"


def test_expand_action_view_rejects_non_action_paths():
    with pytest.raises(RefResolutionError) as excinfo:
        expand_action_view("resource.RES-001.owner", _Action())
    assert excinfo.value.reason == "invalid_path"


def test_try_expand_action_view_returns_none_instead_of_raising():
    assert try_expand_action_view("action.resource.owner", _Action()) == "resource.RES-001.owner"
    assert try_expand_action_view("action.token.flow_id", _Action(token=None)) is None
    assert try_expand_action_view("action.request.body", _Action()) is None


def test_expanded_path_resolves_in_the_reference_world(reference_world_instance):
    """D3：展开后 ``decision_facts()`` 与 ``asserts_ref`` 必须逐字可比。"""
    world = reference_world_instance
    action = _Action()
    expanded = world.expand_action_view("action.resource.owner", action)
    assert expanded == "resource.RES-001.owner"
    assert world.resolve(expanded) == "ACT-002"
    evidence_refs = {item.asserts_ref for item in world.evidence}
    assert expanded in evidence_refs


# --------------------------------------------------------------------------- #
# DSL 文档遍历
# --------------------------------------------------------------------------- #
def test_iter_document_ref_paths_walks_in_document_order():
    node = {
        "op": "and",
        "args": [
            {"op": "ref", "path": "action.actor.actor_id"},
            {
                "op": "or",
                "args": [
                    {"op": "ref", "path": "action.resource.owner"},
                    {"op": "lit", "value": True},
                ],
            },
        ],
    }
    assert list(iter_document_ref_paths(node)) == [
        "action.actor.actor_id",
        "action.resource.owner",
    ]


def test_iter_document_ref_paths_yields_evidence_bridge_fact_keys():
    node = {
        "op": "establishing_evidence_exists",
        "args": ["resource.RES-001.owner"],
    }
    assert list(iter_document_ref_paths(node)) == ["resource.RES-001.owner"]


def test_iter_document_ref_paths_rejects_malformed_nodes():
    with pytest.raises(ValueError, match="DSL 节点必须是 object"):
        list(iter_document_ref_paths(["not", "a", "node"]))
    with pytest.raises(ValueError, match="缺少字符串 op"):
        list(iter_document_ref_paths({"args": []}))


def test_condition_ref_paths_deduplicates_but_keeps_order():
    node = {
        "op": "and",
        "args": [
            {"op": "ref", "path": "action.actor.tenant"},
            {"op": "ref", "path": "action.resource.tenant"},
            {"op": "ref", "path": "action.actor.tenant"},
        ],
    }
    assert condition_ref_paths(node) == ("action.actor.tenant", "action.resource.tenant")


def test_is_literal_is_type_strict():
    assert is_literal({"op": "lit", "value": True})
    assert is_literal({"op": "lit", "value": True}, True)
    # ``lit true`` 不等于 ``lit 1``：否则常量真值会被整数常量蒙混过关（D6）。
    assert not is_literal({"op": "lit", "value": 1}, True)
    assert not is_literal({"op": "ref", "path": "current_time"})


def test_registry_rejects_non_object_entity_documents():
    with pytest.raises(ValueError, match="实体文档必须是 object"):
        ReferenceRegistry({"actor": {"ACT-001": ["not", "a", "mapping"]}})


def test_registry_ids_are_sorted_and_unknown_types_raise():
    registry = ReferenceRegistry({"actor": {"ACT-002": {"actor_id": "ACT-002"}, "ACT-001": {"actor_id": "ACT-001"}}})
    assert registry.ids("actor") == ("ACT-001", "ACT-002")
    with pytest.raises(RefResolutionError) as excinfo:
        registry.ids("widget")
    assert excinfo.value.reason == "unknown_entity_type"


# --------------------------------------------------------------------------- #
# REVISION 2（任务书 A3）：round-trip 性质
# --------------------------------------------------------------------------- #
#: 覆盖十类实体 + 多级字段 + 含点 id 的合法路径样本。
ROUND_TRIP_PATHS: tuple[str, ...] = (
    "resource.RES-001.owner",
    "actor.ACT-001.privilege_version",
    "session.SES-003.privilege_snapshot.privilege_version",
    "token.TOK-001.parent_token",
    "workflow.WFL-ORDER.states",
    "workflow_instance.WFI-001.current_state",
    "cache.CACHE-PERM-001.cached_value",
    "service.SVC-DB.service_type",
    "credential.CRED-001.status",
    "role.ROLE-SUPPORT.privileges",
    "actor.ACT-001.identity.email",
    "resource.RES-001.attributes.total_cents",
)


@pytest.mark.parametrize("path", ROUND_TRIP_PATHS)
def test_parse_format_round_trip(path):
    """``parse_id_view`` 必须无损往返：``parse(p).path == p`` 且按件重组逐字相同。"""
    view = parse_id_view(path)
    assert view.path == path
    assert classify_path(path) == "id_view"
    # formatter：把解析结果重新拼成路径文本
    formatted = ".".join((view.entity_type, view.entity_id, *view.fields))
    assert formatted == path
    # 再解析一次必须得到结构相等的视图（parse(format(x)) == x）
    assert parse_id_view(formatted) == view


def test_expand_action_view_output_reparses_as_an_id_view():
    """action 视图展开的产物必须落在 ID 视图命名空间里（D3：两边逐字可比）。"""
    action = _Action()
    for action_path, expected in (
        ("action.resource.owner", "resource.RES-001.owner"),
        ("action.actor.actor_id", "actor.ACT-003.actor_id"),
        ("action.session.privilege_snapshot.privilege_version",
         "session.SES-003.privilege_snapshot.privilege_version"),
    ):
        expanded = expand_action_view(action_path, action)
        assert expanded == expected
        assert classify_path(expanded) == "id_view"
        assert parse_id_view(expanded).path == expanded


def test_ref_universe_round_trips(reference_world_instance):
    """世界里每一个可解析路径都必须能无损 parse/format 往返。"""
    universe = sorted(reference_world_instance.ref_universe())
    assert universe
    for path in universe:
        view = parse_id_view(path)
        assert view.path == path
        assert ".".join((view.entity_type, view.entity_id, *view.fields)) == path


# --------------------------------------------------------------------------- #
# REVISION 2（任务书 A3）：全仓只有一套路径 BNF
# --------------------------------------------------------------------------- #
#: schemas 里**每一个**受同一 BNF 约束的路径字段（文件 → JSON 指针）。
PATH_FIELDS: tuple[tuple[str, str], ...] = (
    ("world.schema.json", "$defs.cache_entry.properties.cached_subject.pattern"),
    ("evidence.schema.json", "properties.asserts_ref.pattern"),
    ("episode.schema.json", "$defs.evidence_observation.properties.asserts_ref.pattern"),
    ("oracle-output.schema.json", "properties.required_evidence.items.properties.asserts_ref.pattern"),
    ("oracle-output.schema.json", "properties.required_evidence.items.properties.decision_fact.pattern"),
    ("oracle-output.schema.json", "properties.missing_evidence.items.properties.decision_fact.pattern"),
    ("world-spec.schema.json", "properties.critical_state_variables.items.pattern"),
)


def _schema_document(name: str) -> dict:
    schemas_dir = Path(__file__).resolve().parents[2] / "schemas"
    return json.loads((schemas_dir / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize(("name", "pointer"), PATH_FIELDS, ids=lambda item: item)
def test_every_path_field_uses_the_one_canonical_bnf(name, pointer):
    """每个路径字段的模式必须与 ``refs.ID_VIEW_PATTERN`` 逐字相同。

    world-spec 的 ``critical_state_variables`` 曾是第二套表示法（实体类型表少了
    ``workflow`` 与 ``role``），让合法轴在 schema 层被静默拒绝——本测试把"只有一
    套 BNF"钉成可证伪断言。``policy.schema.json`` 的 ref 模式是三类视图的并集，
    单独在下面断言它包含本模式。
    """
    node: dict = _schema_document(name)
    for part in pointer.split("."):
        node = node[part]
    assert node == ID_VIEW_PATTERN.pattern, f"{name}::{pointer} 与 refs.py 的 BNF 不一致"


def test_policy_ref_pattern_is_the_union_of_the_three_views():
    policy = _schema_document("policy.schema.json")
    pattern = policy["$defs"]["expr"]["oneOf"][1]["properties"]["path"]["pattern"]
    # 三类视图都必须在并集里；ID 视图段与 canonical BNF 逐字同款（去掉两端锚点后比较，
    # 因为并集模式只有一个统一的 ^...$）。
    id_view_core = ID_VIEW_PATTERN.pattern
    assert id_view_core[1:-1] in pattern
    for fragment in ("action\\.(actor|resource|session|token|workflow_instance|parameters|request)",
                     "current_flow\\.[A-Za-z0-9_]+", "current_time"):
        assert fragment in pattern


def test_the_canonical_pattern_accepts_every_entity_type():
    for entity_type in ENTITY_TYPES:
        path = f"{entity_type}.X-001.field"
        assert ID_VIEW_PATTERN.match(path), path
