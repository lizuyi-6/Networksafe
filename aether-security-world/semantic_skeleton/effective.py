"""每个机制族**真正有效**的反事实改法（prompt 与测试共用）。

编译器在 ``_counterfactuals`` 阶段拒绝空干预（``before == after``）：一个什么都不改的
干预会让 verdict-invariance 测试假通过。但"哪个改法有效"取决于机制的**基准状态**，而基准
状态是确定性的——所以它可以被算出来，而不是让生成器猜。

算出来之后有两个用处：

1. generator prompt 只列出有效改法，省掉一整类 token 浪费；
2. 测试断言"每个机制至少有一个有效改法"，防止注册表里出现根本不能反事实的机制。
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any, Mapping

from .compiler.compiler import CompileContext, SemanticSkeletonCompiler, _mutate
from .mechanisms import MECHANISMS, mechanism


def _probe_plan(family: str) -> Any:
    """编译一个机制的最小探针世界，返回它的 :class:`WorldPlan` 与状态。"""
    from .tests._probe import probe_skeleton  # 局部导入避免循环

    document = probe_skeleton(family)
    compiler = SemanticSkeletonCompiler()
    result = compiler.compile_with_plan(document, context=CompileContext())
    return result


@lru_cache(maxsize=None)
def effective_changes(family: str) -> dict[str, tuple[str, ...]]:
    """``fact -> 有效改法``（按机制声明顺序，确定性）。

    有效 = 施加后取值确实改变。全部无效时该事实不出现在结果里。
    """
    item = mechanism(family)
    if item is None:
        return {}
    try:
        result = _probe_plan(family)
    except Exception:  # noqa: BLE001 - 编译不过的机制由 selfcheck 报，这里如实返回空
        return {}
    out: dict[str, tuple[str, ...]] = {}
    for spec in item.counterfactuals:
        valid: list[str] = []
        for change in spec.changes:
            try:
                before, after = _mutate(result.plan, result.state, spec.fact, change)
            except Exception:  # noqa: BLE001 - 该改法不适用（类型不符等）
                continue
            if before != after:
                valid.append(change)
        if valid:
            out[spec.fact] = tuple(valid)
    return out


def effective_changes_summary(family: str) -> str:
    """``fact→[changes]`` 的人读形态（prompt 用）。"""
    mapping = effective_changes(family)
    if not mapping:
        return "（无有效改法）"
    return "; ".join(f"{fact}→[{', '.join(changes)}]" for fact, changes in sorted(mapping.items()))


def all_effective_changes() -> dict[str, dict[str, tuple[str, ...]]]:
    return {item.family: effective_changes(item.family) for item in MECHANISMS}


__all__ = [
    "all_effective_changes",
    "effective_changes",
    "effective_changes_summary",
]
