"""可注入的虚拟时钟与时间运算。

两条硬规则（设计 §8.1 / R7）：

1. **数据路径上没有挂钟。** ``time.time()`` / ``datetime.now()`` 不得出现在任何
   生成路径；世界里的每个时间戳都是 **VirtualClock 派生值**（schema 里
   ``generation_timestamp`` / ``created_at`` 的注释逐字这么写）。
2. **时钟必须可注入。** 测试要能冻结时间、要能回拨时钟验证防回拨逻辑；因此
   :class:`Clock` 是一个协议，:class:`FixedClock` / :class:`MutableClock` 是
   两个可用的实现，调用方永远面向协议编程。

时间格式与 ``action.schema.json`` / ``evidence.schema.json`` 的模式一致::

    ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,6})?Z$

所有函数都是纯函数（无 IO、无全局状态），因此 ``before`` / ``after`` /
``within`` 三个 DSL 时间 op 与 Gate 2 的单调性检查可以共用同一套语义。
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from .errors import ClockError

#: 与 schema 模式逐字对应的时间戳正则（供 fail-fast 校验，不替代 jsonschema）。
INSTANT_PATTERN = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$"
)

#: ``VirtualClock`` 的默认起点（设计 §8.1：世界时间是声明出来的，不是读出来的）。
EPOCH = "2026-01-01T00:00:00Z"


class Clock(Protocol):
    """虚拟时钟协议：返回当前虚拟时刻（ISO-8601 Z 字符串）。"""

    def now(self) -> str:  # pragma: no cover - 协议定义
        ...


def is_valid_instant(text: Any) -> bool:
    """``text`` 是否是合法的时间戳字符串（模式 + 真实日历校验）。"""
    if not isinstance(text, str) or not INSTANT_PATTERN.match(text):
        return False
    try:
        parse_instant(text)
    except ClockError:
        return False
    return True


def parse_instant(text: Any) -> datetime:
    """把时间戳解析成**带时区的 UTC ``datetime``**。

    拒绝 naive datetime 的歧义：世界里的每个时刻都显式是 UTC。
    """
    if not isinstance(text, str):
        raise ClockError(f"时间戳必须是字符串，得到 {type(text).__name__}: {text!r}")
    if not INSTANT_PATTERN.match(text):
        raise ClockError(f"时间戳不符合 VirtualClock 格式: {text!r}")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ClockError(f"时间戳不是真实时刻: {text!r}（{exc}）") from exc
    if parsed.tzinfo is None:  # 由正则保证不会发生，防御性保留
        raise ClockError(f"时间戳缺少时区: {text!r}")
    return parsed.astimezone(timezone.utc)


def format_instant(moment: datetime) -> str:
    """把 ``datetime`` 格式化回 VirtualClock 时间戳（秒级精度，``Z`` 后缀）。"""
    if not isinstance(moment, datetime):
        raise ClockError(f"format_instant 需要 datetime，得到 {type(moment).__name__}")
    if moment.tzinfo is None:
        raise ClockError("format_instant 拒绝 naive datetime（世界时间必须显式 UTC）")
    return (
        moment.astimezone(timezone.utc)
        .replace(microsecond=0)
        .strftime("%Y-%m-%dT%H:%M:%SZ")
    )


def compare_instants(left: Any, right: Any) -> int:
    """比较两个时间戳：``-1`` / ``0`` / ``1``。"""
    a, b = parse_instant(left), parse_instant(right)
    if a < b:
        return -1
    if a > b:
        return 1
    return 0


def instant_delta_ms(later: Any, earlier: Any) -> int:
    """``later - earlier`` 的毫秒数（可能为负，用于回拨检测）。"""
    delta = parse_instant(later) - parse_instant(earlier)
    return delta // timedelta(milliseconds=1)


def is_within(start: Any, end: Any, window_ms: Any) -> bool:
    """``0 <= end - start <= window_ms``（DSL ``within`` op 的语义）。"""
    if isinstance(window_ms, bool) or not isinstance(window_ms, int):
        raise ClockError(f"within 的窗口必须是非负整数毫秒，得到 {window_ms!r}")
    if window_ms < 0:
        raise ClockError(f"within 的窗口必须是非负整数毫秒，得到 {window_ms!r}")
    delta = instant_delta_ms(end, start)
    return 0 <= delta <= window_ms


class FixedClock:
    """永远返回同一个时刻的时钟——测试冻结时间用。"""

    __slots__ = ("_now",)

    def __init__(self, now: str = EPOCH) -> None:
        self._now = format_instant(parse_instant(now))

    def now(self) -> str:
        return self._now

    def __repr__(self) -> str:  # pragma: no cover - 调试辅助
        return f"FixedClock({self._now!r})"


class MutableClock:
    """可显式推进/回拨的时钟。

    推进必须显式调用 :meth:`advance`；**没有** ``sleep``、没有自动前进，
    因此时钟永远不会把挂钟时间泄漏进数据路径。回拨被允许且可检测——固件侧的
    "时钟回拨防护"（FW-004）与 Gate 2 的单调性检查正是要对这种输入 fail-closed。
    """

    __slots__ = ("_now",)

    def __init__(self, now: str = EPOCH) -> None:
        self._now = parse_instant(now)

    def now(self) -> str:
        return format_instant(self._now)

    def advance(self, *, milliseconds: int = 0, seconds: int = 0) -> str:
        """按毫秒/秒推进，返回推进后的时刻。"""
        if milliseconds < 0 or seconds < 0:
            raise ClockError("MutableClock.advance 只接受非负增量（回拨请用 rewind）")
        self._now = self._now + timedelta(milliseconds=milliseconds, seconds=seconds)
        return self.now()

    def rewind(self, *, milliseconds: int = 0, seconds: int = 0) -> str:
        """显式回拨——用于构造"时钟回拨"负样本。"""
        if milliseconds < 0 or seconds < 0:
            raise ClockError("MutableClock.rewind 只接受非负增量")
        self._now = self._now - timedelta(milliseconds=milliseconds, seconds=seconds)
        return self.now()

    def set(self, now: str) -> str:
        """直接设置当前时刻。"""
        self._now = parse_instant(now)
        return self.now()

    def __repr__(self) -> str:  # pragma: no cover - 调试辅助
        return f"MutableClock({self.now()!r})"


def clock_from_config(config: Mapping[str, Any] | None, *, key: str = "virtual_clock_start") -> Clock:
    """从配置读虚拟时钟起点；配置缺失时用 :data:`EPOCH`。"""
    if not isinstance(config, Mapping):
        return FixedClock()
    start = config.get(key, EPOCH)
    return FixedClock(start if isinstance(start, str) else EPOCH)


__all__ = [
    "EPOCH",
    "INSTANT_PATTERN",
    "Clock",
    "FixedClock",
    "MutableClock",
    "clock_from_config",
    "compare_instants",
    "format_instant",
    "instant_delta_ms",
    "is_valid_instant",
    "is_within",
    "parse_instant",
]
