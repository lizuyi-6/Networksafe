"""规范化 JSON 序列化与稳定哈希。

为什么必须有这一层（设计 §3 D6 / R7）：

* **同一份数据必须产出同一串字节。** ``dict`` 迭代序、``set`` 哈希随机化、
  ``PYTHONHASHSEED`` 都会让"看起来一样的 JSON"得到不同哈希，于是
  ``test_determinism_byte_identical`` / ``test_pythonhashseed_stable`` 全盘失效。
  因此一切哈希、dedup、``stable_hash``、release manifest 都只走 :func:`canonical_json`。
* **不允许隐式类型转换。** ``json.dumps`` 会把 ``float('nan')`` 写成非标准 JSON
  （``NaN``），会把 ``tuple`` 悄悄变成数组，会把 ``Enum`` 直接拒掉。
  本模块显式规定每个输入类型的落点，遇到不认识的类型**抛错而不是猜**。
* **dataclass 一等公民。** 世界模型全部是 frozen dataclass；能直接对它们求哈希，
  ``world_family_id`` 的派生才不需要先手工转 dict。

所有函数都是纯函数：无随机、无时钟、无 IO、无全局状态。
"""
from __future__ import annotations

import dataclasses
import enum
import hashlib
import json
import math
from collections.abc import Mapping, Set
from typing import Any

from .errors import ModelError

#: ``canonical_json`` 的分隔符。紧凑、无空格，保证跨平台字节一致。
_SEPARATORS = (",", ":")

#: family id 派生时使用的哈希前缀长度（``WF-`` + 12 hex，见 schemas 的模式约束）。
FAMILY_ID_HASH_CHARS = 12

#: ``world_family_id`` 前缀。``workflow_id`` 用 ``WFL-``，两者命名空间不重叠（S10）。
WORLD_FAMILY_ID_PREFIX = "WF-"

#: ``counterfactual_family_id`` 前缀。
COUNTERFACTUAL_FAMILY_ID_PREFIX = "CF-"


def _prepare(value: Any) -> Any:
    """把任意受支持的输入规范化成"只会被一种方式序列化"的 JSON 结构。

    支持：``None`` / ``bool`` / ``int`` / ``float``（必须有限） / ``str`` /
    ``Mapping`` / ``list`` / ``tuple`` / ``set`` / ``frozenset`` /
    ``Enum`` / dataclass（优先 ``to_document()``，否则 ``dataclasses.asdict``）。

    集合按元素自身的规范化 JSON 排序——这样集合的哈希与插入顺序、与
    ``PYTHONHASHSEED`` 都无关。
    """
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ModelError(f"canonical_json 拒绝非有限浮点数: {value!r}（NaN/Inf 不是合法 JSON）")
        return value
    if isinstance(value, enum.Enum):
        return _prepare(value.value)
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        to_document = getattr(value, "to_document", None)
        if callable(to_document):
            return _prepare(to_document())
        return _prepare(dataclasses.asdict(value))
    if isinstance(value, Mapping):
        prepared: dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise ModelError(
                    f"canonical_json 只接受字符串键，得到 {type(key).__name__}: {key!r}"
                )
            prepared[key] = _prepare(item)
        return prepared
    if isinstance(value, (list, tuple)):
        return [_prepare(item) for item in value]
    if isinstance(value, (set, frozenset, Set)):
        return sorted((_prepare(item) for item in value), key=canonical_json)
    raise ModelError(
        f"canonical_json 无法序列化 {type(value).__name__}: {value!r}；"
        "请先转成 dict/list/dataclass"
    )


def to_plain_json(value: Any) -> Any:
    """把任意受支持的输入转成**普通** JSON 结构（dict/list/标量），不排序、不序列化。

    用于把自由形态字段（``attributes`` / ``parameters`` / ``request`` /
    ``cached_value`` / ``free_form``）从文档里拷进内存：既切断与调用方文档的
    共享引用（frozen dataclass 的字段不该被外部改），又拒绝悄悄塞进集合或自定义
    对象——那会让 ``canonical_json`` 的字节稳定性依赖插入顺序。
    """
    return _prepare(value)


def canonical_json(obj: Any) -> str:
    """返回 ``obj`` 的规范化 JSON 文本。

    契约（设计 §15.3）::

        sort_keys=True, separators=(",", ":"), ensure_ascii=False

    ``ensure_ascii=False`` 是故意的：非 ASCII 的业务语义（人名、域名）以 UTF-8
    原样落盘，``\\uXXXX`` 转义会让"同一份数据"在不同工具链下字节不同。
    """
    return json.dumps(
        _prepare(obj),
        sort_keys=True,
        separators=_SEPARATORS,
        ensure_ascii=False,
        allow_nan=False,
    )


def canonical_bytes(obj: Any) -> bytes:
    """:func:`canonical_json` 的 UTF-8 字节形态——落盘与哈希的直接输入。"""
    return canonical_json(obj).encode("utf-8")


def stable_hash(obj: Any) -> str:
    """``sha256(canonical_json(obj))`` 的十六进制摘要。

    跨进程稳定（不依赖 ``hash()``、``PYTHONHASHSEED`` 或字典插入序），
    因此可以作为 ``world_family_id`` / ``policy_graph_hash`` / dedup 键。
    """
    return hashlib.sha256(canonical_bytes(obj)).hexdigest()


def short_hash(obj: Any, length: int = FAMILY_ID_HASH_CHARS) -> str:
    """:func:`stable_hash` 的前 ``length`` 个十六进制字符（用于 family id）。"""
    digest = stable_hash(obj)
    if length <= 0:
        raise ModelError(f"short_hash 的 length 必须为正整数，得到 {length!r}")
    return digest[:length]


def derive_family_id(prefix: str, *parts: Any) -> str:
    """派生 family id：``prefix + short_hash(parts)``。

    两个 family id 都由编译器派生、**禁止作者填写**（设计 §10.1 / B5）：
    作者可写会让生成器把整个数据集并成一个连通分量，或把同一世界的表面变体
    拆到不同 split。``parts`` 直接进 :func:`canonical_json`，因此顺序即语义。
    """
    if not prefix or not prefix.endswith("-"):
        raise ModelError(f"family id 前缀必须以 '-' 结尾，得到 {prefix!r}")
    return prefix + short_hash(list(parts))


__all__ = [
    "COUNTERFACTUAL_FAMILY_ID_PREFIX",
    "FAMILY_ID_HASH_CHARS",
    "WORLD_FAMILY_ID_PREFIX",
    "canonical_bytes",
    "canonical_json",
    "derive_family_id",
    "short_hash",
    "stable_hash",
    "to_plain_json",
]
