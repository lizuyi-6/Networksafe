"""``tests/gates/`` 的 conftest：导入垫片 + 门禁测试共享夹具。

两件事：

1. **导入垫片**——设计 §13.5 的数据门禁测试放在本目录（与 §15.2 的目录归属一致），
   而共享构造器 ``asw_worlds`` / ``asw_expansion`` 在 ``tests/unit/``。pytest 的默认
   import 模式下每个被测目录只在**收集到时**才进 ``sys.path``，没有这个垫片，本目录
   的测试会 ImportError。与 ``tests/metamorphic/conftest.py`` 同一手法。
2. **夹具**——§13.5 要求"每个 Gate 一个拒绝坏样本负例 + 一个放行好样本正例"，
   这些用例共享同一批夹具（HC-001 世界 + 它的家族）。
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

_UNIT_DIR = Path(__file__).resolve().parent.parent / "unit"
if str(_UNIT_DIR) not in sys.path:
    sys.path.insert(0, str(_UNIT_DIR))

from security_world.expansion import ExpansionConfig, expand_family
from security_world.model import compile_spec
from security_world.validation import FamilyView, family_view

from worlds.registry import load_all

#: 全部落盘的人工世界（23 个），session 级缓存。
CORPUS: tuple[Any, ...] = load_all()


def _world(number: int) -> Any:
    for item in CORPUS:
        if item.number == number:
            return item
    raise KeyError(number)


@pytest.fixture(scope="session")
def corpus() -> tuple[Any, ...]:
    return CORPUS


@pytest.fixture(scope="session")
def hc001() -> Any:
    """HC-001：owner-only IDOR 世界（一个决定性不变量 + 一个翻转轴）。"""
    return _world(1)


@pytest.fixture(scope="session")
def hc001_two_families(hc001: Any) -> tuple:
    """HC-001 的两个 probe action 家族（合法动作 + 攻击动作）。

    G11 的标识符判定需要**至少两个**反事实家族才有意义（单家族时"取值只属于一个
    家族"恒真），因此这个夹具给标识符/旋钮之分的测试用。
    """
    from analysis.pipeline import (
        action_from_binds,
        axes_for_probe,
        family_view_for_action,
        spec_with_axes,
    )

    spec = hc001.spec
    out = []
    at = str(hc001.spec_document["current_state"]["at"])
    for index, (_summary, binds) in enumerate(hc001.probes(), start=1):
        action = action_from_binds(binds, action_id=f"ACTN-{hc001.number:03d}-{index}", at=at)
        probe_spec = spec_with_axes(spec, axes_for_probe(spec, binds))
        result = expand_family(probe_spec, seed=spec.seed, action=action)
        out.append(family_view_for_action(result, action, seed=spec.seed))
    return tuple(out)


@pytest.fixture(scope="session")
def hc001_world(hc001: Any) -> Any:
    return compile_spec(hc001.spec, seed=hc001.spec.seed)


@pytest.fixture(scope="session")
def hc001_family(hc001: Any) -> FamilyView:
    """HC-001 的攻击动作家族（base + 关键干预 + 无关扰动 + 掩蔽）。"""
    from analysis.pipeline import (
        action_from_binds,
        axes_for_probe,
        family_view_for_action,
        spec_with_axes,
    )

    spec = hc001.spec
    _summary, binds = hc001.probes()[-1]
    action = action_from_binds(
        binds,
        action_id=f"ACTN-{hc001.number:03d}-2",
        at=str(hc001.spec_document["current_state"]["at"]),
    )
    probe_spec = spec_with_axes(spec, axes_for_probe(spec, binds))
    result = expand_family(probe_spec, seed=spec.seed, action=action)
    return family_view_for_action(result, action, seed=spec.seed)


@pytest.fixture(scope="session")
def small_config() -> dict[str, Any]:
    """一份最小展开配置（每世界 1 base + 1 关键 + 1 无关 + 2 掩蔽）。"""
    base = ExpansionConfig.default()
    return {
        "expansion": {
            "variants_per_world": {
                "base": 1,
                "critical_intervention": 1,
                "irrelevant_perturbation": 1,
                "evidence_masked": 2,
            }
        },
        "evidence_masking": {"levels": list(base.masking_levels)},
        "seed": 20260920,
    }


@pytest.fixture()
def config() -> dict[str, Any]:
    """``configs/default.json`` 原样读取。"""
    from security_world.model.config import load_default_config

    return load_default_config()
