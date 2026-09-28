"""文档形态基类与**显式**字段校验助手。

设计 §3 D6：**内部表示用 frozen dataclass + 显式校验函数，不用 pydantic 隐式
coerce**——数据工厂最怕"字符串被悄悄转成数字"。因此这里每个 ``require_*`` 都做
严格类型判定，``bool`` 永远不被当成 ``int``（``Number(true)`` / ``int(True)``
是经典的静默污染），缺失键与多余键都是硬错误而不是默认值。

"缺失键"为什么要硬失败：``world.schema.json`` 全部是 ``additionalProperties:
false``，一个拼错的字段名在 jsonschema 层会被拒，在内存层也必须被拒——否则
``WorldInstance`` 会带着一个静默丢失的字段跑过整个管线，最后在 oracle 里变成
一个来源不明的 ``None``。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .canonical import to_plain_json
from .errors import ModelError


class Document:
    """所有 schema 文档的内存形态基类。

    约定：

    * ``to_document()`` 返回**普通** ``dict``（可 ``json.dumps``、可再校验）；
    * ``from_document(doc)`` 是严格逆运算，``from_document(x.to_document())``
      与 ``x`` 相等；
    * 可选字段在文档里缺失时存 ``None`` / 空 tuple，``to_document()`` **不**把
      它们补回去——补默认值会让"同一份数据"在不同工具链下字节不同。
    """

    def to_document(self) -> dict[str, Any]:
        raise NotImplementedError(f"{type(self).__name__} 未实现 to_document()")

    @classmethod
    def from_document(cls, document: Mapping[str, Any]) -> "Document":
        raise NotImplementedError(f"{cls.__name__} 未实现 from_document()")


# --------------------------------------------------------------------------- #
# 通用校验助手
# --------------------------------------------------------------------------- #
def require_mapping(value: Any, where: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ModelError(f"{where}: 需要 object，得到 {type(value).__name__}: {value!r}")
    for key in value:
        if not isinstance(key, str):
            raise ModelError(f"{where}: object 键必须是字符串，得到 {type(key).__name__}: {key!r}")
    return value


def require_str(value: Any, where: str) -> str:
    if not isinstance(value, str):
        raise ModelError(f"{where}: 需要 string，得到 {type(value).__name__}: {value!r}")
    return value


def require_non_empty_str(value: Any, where: str) -> str:
    text = require_str(value, where)
    if not text:
        raise ModelError(f"{where}: 不允许空字符串")
    return text


def require_str_or_none(value: Any, where: str) -> str | None:
    if value is None:
        return None
    return require_str(value, where)


def require_int(value: Any, where: str) -> int:
    # bool 是 int 的子类，必须先排掉——否则 True 会被当成 1 静默落库。
    if isinstance(value, bool) or not isinstance(value, int):
        raise ModelError(f"{where}: 需要 integer，得到 {type(value).__name__}: {value!r}")
    return value


def require_non_negative_int(value: Any, where: str) -> int:
    number = require_int(value, where)
    if number < 0:
        raise ModelError(f"{where}: 需要非负整数，得到 {number}")
    return number


def require_int_or_none(value: Any, where: str) -> int | None:
    if value is None:
        return None
    return require_int(value, where)


def require_non_negative_int_or_none(value: Any, where: str) -> int | None:
    if value is None:
        return None
    return require_non_negative_int(value, where)


def require_bool(value: Any, where: str) -> bool:
    if not isinstance(value, bool):
        raise ModelError(f"{where}: 需要 boolean，得到 {type(value).__name__}: {value!r}")
    return value


def require_bool_or_none(value: Any, where: str) -> bool | None:
    if value is None:
        return None
    return require_bool(value, where)


def require_enum(value: Any, where: str, allowed: Sequence[str]) -> str:
    text = require_str(value, where)
    if text not in allowed:
        raise ModelError(f"{where}: {text!r} 不在枚举 {list(allowed)} 内")
    return text


def require_str_tuple(value: Any, where: str, *, unique: bool = False) -> tuple[str, ...]:
    if isinstance(value, str) or not isinstance(value, Sequence):
        raise ModelError(f"{where}: 需要 string 数组，得到 {type(value).__name__}: {value!r}")
    items = tuple(require_str(item, f"{where}[{index}]") for index, item in enumerate(value))
    if unique and len(set(items)) != len(items):
        raise ModelError(f"{where}: 数组元素必须唯一，得到 {list(items)}")
    return items


def require_str_tuple_or_none(
    value: Any, where: str, *, unique: bool = False
) -> tuple[str, ...] | None:
    if value is None:
        return None
    return require_str_tuple(value, where, unique=unique)


def require_object(value: Any, where: str) -> dict[str, Any]:
    """自由形态 object（``additionalProperties: true``）：深拷成普通 dict。"""
    require_mapping(value, where)
    plain = to_plain_json(value)
    if not isinstance(plain, dict):  # pragma: no cover - _prepare 对 Mapping 必返回 dict
        raise ModelError(f"{where}: 无法规范化为 object")
    return plain


def require_object_or_none(value: Any, where: str) -> dict[str, Any] | None:
    if value is None:
        return None
    return require_object(value, where)


def require_value(value: Any, where: str) -> Any:
    """``"value": {}`` 这类任意 JSON 值的落点。"""
    return to_plain_json(value)


def require_fields(
    document: Mapping[str, Any],
    where: str,
    *,
    allowed: Sequence[str],
    required: Sequence[str] = (),
) -> dict[str, Any]:
    """校验键集合：多余键与缺失的必填键都是硬错误。

    ``allowed`` 必须包含该 schema 的 ``properties`` 全表（含 ``$comment``），
    这样"拼错的字段名"与"schema 已删除的字段"都会在这里被抓住。
    """
    require_mapping(document, where)
    allowed_set = set(allowed)
    unknown = sorted(key for key in document if key not in allowed_set)
    if unknown:
        raise ModelError(
            f"{where}: 出现 schema 未定义的键 {unknown}（additionalProperties: false）；"
            f"允许的键: {sorted(allowed_set)}"
        )
    missing = sorted(key for key in required if key not in document)
    if missing:
        raise ModelError(f"{where}: 缺少必填键 {missing}")
    return dict(document)


def put_if_present(target: dict[str, Any], key: str, value: Any) -> None:
    """``to_document()`` 用的助手：``None`` 表示"文档里没有这个键"，不写回。"""
    if value is not None:
        target[key] = value


__all__ = [
    "Document",
    "put_if_present",
    "require_bool",
    "require_bool_or_none",
    "require_enum",
    "require_fields",
    "require_int",
    "require_int_or_none",
    "require_mapping",
    "require_non_empty_str",
    "require_non_negative_int",
    "require_non_negative_int_or_none",
    "require_object",
    "require_object_or_none",
    "require_str",
    "require_str_or_none",
    "require_str_tuple",
    "require_str_tuple_or_none",
    "require_value",
]
