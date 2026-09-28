"""L6 发布层的异常（``reason_code`` 是稳定契约，见 :mod:`security_world.validation.errors`）。"""
from __future__ import annotations

from ..model.errors import ModelError


class ReleaseError(ModelError):
    """发布/冻结层的确定性失败。"""

    def __init__(self, reason_code: str, message: str) -> None:
        self.reason_code = str(reason_code)
        super().__init__(f"[{self.reason_code}] {message}")


__all__ = ["ReleaseError"]
