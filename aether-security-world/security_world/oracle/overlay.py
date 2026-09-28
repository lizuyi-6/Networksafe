"""observable 趟的世界覆盖：把"已建立事实表"写回一个世界副本。

设计 §8.2 的最后一步是**在已建立事实表上重跑同一套策略**；Gate 3 的非空洞性探针
用同一个机制（``probe_world = world with refs overridden by A``，§8.4）。因此这里
不做"给求值器加一个证据旁路"，而是真的产出一个**值被覆盖过的世界**：

* 求值器保持完全不知道证据的存在（L2 不读证据，B19）；
* 覆盖是显式的、可 diff 的、可单测的（``override_world_values(world, {path: value})``）；
* 覆盖绝不写回原世界——输入世界是 frozen dataclass + 普通 JSON 文档的深拷，
  ``test_no_path_mutation`` 断言求值前后世界 ``canonical_json`` 逐字节相同。
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..model.canonical import canonical_json, to_plain_json
from ..model.errors import ModelError, RefResolutionError
from ..model.world import WorldInstance


class OverlayError(ModelError):
    """世界覆盖无法忠实表达某个已建立值（窄边界，见 :func:`override_world_values`）。"""

#: 实体类型 → 世界文档里的顶层集合键（``workflow_instance`` 没有独立顶层数组）。
_COLLECTION_FOR_TYPE: dict[str, str] = {
    "actor": "actors",
    "resource": "resources",
    "session": "sessions",
    "token": "tokens",
    "credential": "credentials",
    "service": "services",
    "cache": "caches",
    "role": "roles",
    "workflow": "workflows",
}

#: 实体类型 → 该实体文档里的 id 字段名。
_ID_FIELD: dict[str, str] = {
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


def split_id_view(path: str, world: WorldInstance) -> tuple[str, str, tuple[str, ...]]:
    """把 ID 视图路径切成 ``(entity_type, entity_id, fields)``（最长匹配）。

    与 :meth:`ReferenceRegistry.resolve` 同一套规则：schema 的 id 模式允许 ``.``，
    纯正则贪婪匹配会切错。
    """
    from ..policy import split_entity_path

    return split_entity_path(path, world)


def override_world_values(world: WorldInstance, values: Mapping[str, Any]) -> WorldInstance:
    """返回一个把 ``values`` 里的 ID 视图路径改成对应值的世界副本。

    ``values`` 的键必须是本世界可解析的 ID 视图路径；解析不了即
    :class:`RefResolutionError`（绝不静默跳过——一个没写进去的覆盖会让
    observable 趟悄悄用回世界真值，那是 ground truth 漏洞）。

    覆盖后**逐条校验**：新世界里每条路径都必须解析回写入的值。这一条挡的是一个
    L1 的往返不对称——``Actor.to_document`` 之类的 ``put_if_present`` 会把**空**
    可选集合（``groups`` / ``acl`` / ``attributes`` ...）整个丢掉，于是一条
    "``actor.ACT-001.groups == []``" 的已建立证据无法在覆盖后的世界里表示。
    此时抛 :class:`OverlayError` 而不是静默用回世界真值。
    """
    document = to_plain_json(world.to_document())
    for path in sorted(values):
        _patch(document, path, values[path], world)
    overlaid = WorldInstance.from_document(document)
    for path in sorted(values):
        try:
            actual = overlaid.resolve(path)
        except RefResolutionError as exc:
            raise OverlayError(
                f"覆盖 {path!r} 后无法在新世界解析（reason={exc.reason}）："
                "该字段的值很可能是空集合，而 L1 的 to_document 会丢掉空可选集合"
            ) from exc
        if canonical_json(actual) != canonical_json(values[path]):
            raise OverlayError(
                f"覆盖 {path!r} 后期望 {values[path]!r}，实际解析到 {actual!r}"
            )
    return overlaid


def _patch(document: dict[str, Any], path: str, value: Any, world: WorldInstance) -> None:
    entity_type, entity_id, fields = split_id_view(path, world)
    if not fields:
        raise RefResolutionError(path, "invalid_path", detail="ID 视图至少需要一个字段段")
    container = _locate(document, entity_type, entity_id, path)
    current: Any = container
    for index, field_name in enumerate(fields[:-1]):
        walked = ".".join(fields[: index + 1])
        if not isinstance(current, dict) or field_name not in current:
            raise RefResolutionError(
                path, "unknown_field", detail=f"{entity_type}.{entity_id} 没有字段 {walked!r}"
            )
        current = current[field_name]
    leaf = fields[-1]
    if not isinstance(current, dict):
        raise RefResolutionError(
            path, "unknown_field", detail=f"{'.'.join(fields[:-1])!r} 不是 object，无法写 {leaf!r}"
        )
    if leaf not in current:
        raise RefResolutionError(
            path, "unknown_field", detail=f"{entity_type}.{entity_id} 没有字段 {leaf!r}"
        )
    current[leaf] = to_plain_json(value)


def _locate(document: dict[str, Any], entity_type: str, entity_id: str, path: str) -> dict[str, Any]:
    """在世界文档里定位实体文档（数组按下标 id 匹配）。"""
    if entity_type == "workflow_instance":
        for workflow in document.get("workflows") or []:
            for instance in workflow.get("instances") or []:
                if instance.get("instance_id") == entity_id:
                    return instance
        raise RefResolutionError(
            path, "unknown_entity_id", detail=f"workflow_instance {entity_id!r} 不存在"
        )
    collection_key = _COLLECTION_FOR_TYPE.get(entity_type)
    if collection_key is None:  # pragma: no cover - split_entity_path 已约束
        raise ModelError(f"未知实体类型 {entity_type!r}")
    id_field = _ID_FIELD[entity_type]
    for item in document.get(collection_key) or []:
        if item.get(id_field) == entity_id:
            return item
    raise RefResolutionError(
        path, "unknown_entity_id", detail=f"{entity_type} {entity_id!r} 不存在"
    )


__all__ = ["OverlayError", "override_world_values", "split_id_view"]
