"""可播种的确定性随机源。

硬规则（设计 §7 R7 / AGENTS.md 的安全编码规范）：**生成路径上禁止出现无种子的
``random`` 与 ``time.time()``**。本模块是唯一允许出现 ``random.Random`` 的地方，
并且永远以**局部实例**的形式出现——模块级不用全局 ``random``，因为全局状态会
被并发顺序污染，让"同种子 ⇒ 同字节"（Gate 4）不可能成立。

两个入口：

* :func:`make_rng` —— 由调用方显式给出种子；
* :func:`derive_seed` —— 由父种子 + 用途标签派生子种子，用于"一个世界展开出多个
  变体"这类需要**互不相关**又**完全可复现**的随机流。

``derive_seed`` 走 :func:`~security_world.model.canonical.stable_hash`，因此与
``PYTHONHASHSEED``、平台、Python 版本无关；同一个 ``(parent, label)`` 永远得到
同一个 63 位非负整数。
"""
from __future__ import annotations

import random
from typing import Any, Iterable

from .canonical import stable_hash
from .errors import SeedError

#: 派生种子落到 63 位，保证 ``random.Random`` 与 ``numpy`` 都能吃下（也避免
#: 某些平台把大整数种子截断成有符号 64 位时的符号歧义）。
_SEED_BITS = 63
_SEED_MASK = (1 << _SEED_BITS) - 1

#: 生成路径中禁止出现的随机源（由 ``tests/unit/test_model_no_wallclock.py`` 静态断言）。
FORBIDDEN_RANDOM_CALLS = frozenset({
    "random.random",
    "random.seed",
    "random.randint",
    "random.choice",
    "random.choices",
    "random.shuffle",
    "random.sample",
    "random.uniform",
    "random.getrandbits",
    "os.urandom",
    "secrets.token_bytes",
    "secrets.token_hex",
    "secrets.randbelow",
    "uuid.uuid1",
    "uuid.uuid4",
})


def make_rng(seed: int) -> random.Random:
    """返回一个绑定到 ``seed`` 的**局部** ``random.Random`` 实例。

    ``seed`` 必须是非负整数（``bool`` 不算整数——``True`` 当种子是典型的隐式
    转换陷阱，见设计 §3 D6）。省略种子、传入 ``None``、传入浮点数都会抛
    :class:`SeedError`：**不允许无种子随机源存在**。
    """
    validate_seed(seed)
    return random.Random(seed)


def validate_seed(seed: Any) -> int:
    """校验并原样返回种子。非负整数才合法。"""
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise SeedError(f"种子必须是非负整数，得到 {type(seed).__name__}: {seed!r}")
    if seed < 0:
        raise SeedError(f"种子必须是非负整数，得到负数: {seed!r}")
    return seed


def derive_seed(parent_seed: int, *labels: Any) -> int:
    """从 ``(parent_seed, *labels)`` 确定性地派生子种子。

    ``labels`` 参与规范化 JSON 后再 sha256，因此字符串/整数/列表都能当标签，
    且标签顺序即语义。派生结果与父种子统计独立（hash 的雪崩效应），
    所以"同一世界的 13 个变体"各自持有互不相关的随机流，却整体可复现。
    """
    validate_seed(parent_seed)
    for label in labels:
        if label is None:
            raise SeedError("derive_seed 的标签不允许为 None（用空字符串表示'无标签'）")
    digest = stable_hash([parent_seed, list(labels)])
    return int(digest, 16) & _SEED_MASK


def derive_seeds(parent_seed: int, labels: Iterable[Any]) -> tuple[int, ...]:
    """:func:`derive_seed` 的批量版，按 ``labels`` 顺序返回。"""
    validate_seed(parent_seed)
    materialised = tuple(labels)
    if not materialised:
        raise SeedError("derive_seeds 需要至少一个标签")
    return tuple(derive_seed(parent_seed, label) for label in materialised)


def shuffled(items: tuple[Any, ...] | list[Any], rng: random.Random) -> tuple[Any, ...]:
    """确定性的洗牌（返回新 tuple，不修改入参）。

    直接调 ``rng.sample(items, len(items))`` 等价，但显式拒绝长度不匹配，
    避免 ``sample`` 在 ``k > n`` 时抛出一个和业务无关的 ``ValueError``。
    """
    materialised = tuple(items)
    if not materialised:
        return ()
    return tuple(rng.sample(materialised, len(materialised)))


__all__ = [
    "FORBIDDEN_RANDOM_CALLS",
    "derive_seed",
    "derive_seeds",
    "make_rng",
    "shuffled",
    "validate_seed",
]
