"""L5 门禁层的异常族。

设计原则与 L1/L4 一致：**拒绝必须带 reason code**。一个门禁失败如果不能被机器
归类（``G5_counterfactual_mismatch`` 而不是 "something went wrong"），下游就无法
把"哪一类坏样本被挡住了"统计进 ``release.manifest.json`` 的
``rejection_reasons``——而那张表正是"门禁不是装饰"的唯一证据。

因此本模块只提供一个异常类型，``reason_code`` 是必填构造参数（不是可选属性）。
"""
from __future__ import annotations

from ..model.errors import ModelError


class ValidationError(ModelError):
    """门禁/拆分/去重/发布层的确定性失败。

    ``reason_code`` 取值是稳定契约（测试按它断言拒绝路径），因此新增 reason code
    只能追加，不能改写已有取值的含义。
    """

    def __init__(self, reason_code: str, message: str) -> None:
        self.reason_code = str(reason_code)
        super().__init__(f"[{self.reason_code}] {message}")


__all__ = ["ValidationError"]
