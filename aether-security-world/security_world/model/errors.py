"""模型层异常体系。

设计 §15.3 只钉死两个公共异常（``RefResolutionError`` / ``CompileError``），
二者都必须是 ``ValueError`` 的子类——调用方普遍写 ``except ValueError``。
这里给它们一个共同基类 :class:`ModelError`，既保持 ``isinstance(e, ValueError)``
成立，又让"文档形态错误"与"引用/编译错误"可以被分别捕获。

``reason_code`` / ``reason`` 是机器可判定的稳定字符串（Gate 与 release 的
``rejection_reasons`` 直接统计它们），**不是自然语言**。
"""
from __future__ import annotations

from typing import Any


class ModelError(ValueError):
    """模型层所有确定性的、可预期的错误的基类。

    刻意不用 ``Exception``：调用方捕获 ``ValueError`` 的现有写法必须继续工作。
    """


class SchemaValidationError(ModelError):
    """文档未通过 ``schemas/*.schema.json`` 校验。

    ``errors`` 是逐条人类可读的错误（含 JSON 路径），空列表表示合法。
    这里**绝不**做"尽力修复"：坏文档进 ``rejected/`` 并记 reason code（设计 §11.2）。
    """

    def __init__(self, errors: tuple[str, ...] | list[str], *, schema_stem: str = "") -> None:
        self.errors: tuple[str, ...] = tuple(errors)
        self.schema_stem = schema_stem
        joined = "\n  - ".join(self.errors) if self.errors else "<no detail>"
        super().__init__(f"{schema_stem or 'document'} schema validation failed:\n  - {joined}")


class RefResolutionError(ModelError):
    """ID 视图路径无法解析（设计 §4.3 BNF）。

    ``reason`` 取值：

    * ``invalid_path`` —— 不符合任何一类视图语法；
    * ``unknown_entity_type`` —— 前缀不是 10 类实体之一；
    * ``unknown_entity_id`` —— 该类型下没有这个 id（**悬空引用，硬失败**）；
    * ``unknown_field`` —— 实体存在但没有这个字段；
    * ``unsupported_index`` —— BNF 没有数组下标语法；
    * ``null_path`` —— 中间节点是 ``null``；
    * ``unbound_subject`` —— action 绑定视图对应的绑定为 ``None``；
    * ``action_local_view`` —— ``action.parameters.*`` / ``action.request.*``
      不是实体绑定，无法展开成实例路径；
    * ``not_an_id_view`` —— 传入了 action 视图或 context 视图。
    """

    def __init__(self, path: str, reason: str, *, detail: str = "") -> None:
        self.path = path
        self.reason = reason
        self.detail = detail
        message = f"无法解析引用路径 {path!r}（reason={reason}）"
        if detail:
            message = f"{message}: {detail}"
        super().__init__(message)


class CompileError(ModelError):
    """``compile_spec`` 拒绝一个 spec。

    ``reason_code`` 取值（设计 §4.1 第 5 步 / §15.3）::

        dangling_ref | cycle | state_mismatch | vacuous_policy |
        axis_not_in_whitelist | axis_is_observation_path | axis_unresolvable |
        role_dangling | history_non_monotonic | current_state_before_history |
        applies_to_unknown_operation | ref_unresolvable | schema_invalid | ...
    """

    def __init__(self, reason_code: str, detail: str = "") -> None:
        self.reason_code = reason_code
        self.detail = detail
        message = f"compile_spec 拒绝（reason_code={reason_code}）"
        if detail:
            message = f"{message}: {detail}"
        super().__init__(message)


class SeedError(ModelError):
    """种子不合法（非整数、负数、或来自无种子随机源）。"""


class GroupingError(ModelError):
    """group key 派生失败（缺世界/缺 action/缺 family id）。

    ``reason_code`` 是稳定契约（L5 的 ``ValidationError`` 原样转报它们，测试按它
    断言）。放在 L1 是因为 group key 派生是**纯文档函数**（``stable_hash`` over
    结构骨架），而 L4 的 episode 组装器也要在组装期盖章——L4 不能 import L5
    （设计 §3.1 的分层 DAG），因此派生与它的拒绝原因都住 L1。
    """

    def __init__(self, reason_code: str, message: str) -> None:
        self.reason_code = str(reason_code)
        self.message = str(message)
        super().__init__(f"[{self.reason_code}] {self.message}")


class ClockError(ModelError):
    """虚拟时钟时间戳不合法或顺序错误。"""


class DeterminismError(ModelError):
    """确定性不变量被破坏（同入参得到不同出参）。仅测试与自检使用。"""


def first_error_line(exc: BaseException) -> str:
    """把异常压成一行——写进 reason code / 审计记录时用。"""
    text = str(exc).strip().splitlines()
    return text[0] if text else type(exc).__name__


def coerce_reason(value: Any) -> str:
    """把任意对象转成稳定的 reason 字符串（审计记录用）。"""
    if isinstance(value, str):
        return value
    return type(value).__name__


__all__ = [
    "ClockError",
    "CompileError",
    "DeterminismError",
    "GroupingError",
    "ModelError",
    "RefResolutionError",
    "SchemaValidationError",
    "SeedError",
    "coerce_reason",
    "first_error_line",
]
