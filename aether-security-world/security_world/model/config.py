"""读取 ``configs/default.json``（L0 契约，实现者只读）。

只有编译期需要配置：``critical_state_variables`` 必须匹配
``expansion.critical_axes_whitelist``（设计 §9.5 / B9）。其余旋钮（变体数、掩蔽
配额、split 比例、renderer 白名单）分别归 L4 / L5 所有，本模块不替它们读。

配置文件缺失时退回模块内的 :data:`FALLBACK_CRITICAL_AXES_WHITELIST`——
它必须与 ``configs/default.json`` 逐字一致，由
``tests/unit/test_model_compile.py::test_critical_axes_whitelist_matches_config``
钉死，否则"装了 wheel 但没有 configs/"的环境会静默换一套白名单。
"""
from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .errors import ModelError

#: 仓库根（``<root>/security_world/model/config.py`` 的上两级）。
PROJECT_ROOT = Path(__file__).resolve().parents[2]
CONFIGS_DIR = PROJECT_ROOT / "configs"
DEFAULT_CONFIG_PATH = CONFIGS_DIR / "default.json"

#: ``configs/default.json`` 的 ``expansion.critical_axes_whitelist`` 镜像。
FALLBACK_CRITICAL_AXES_WHITELIST: tuple[str, ...] = (
    "resource.*.owner",
    "resource.*.state",
    "actor.*.roles",
    "actor.*.privileges",
    "actor.*.authentication_state",
    "actor.*.privilege_version",
    "session.*.revoked",
    "session.*.valid",
    "session.*.principal",
    "session.*.privilege_snapshot.privilege_version",
    "token.*.used",
    "token.*.one_time",
    "token.*.flow_id",
    "token.*.parent_token",
    "token.*.scope",
    "workflow_instance.*.current_state",
    "cache.*.cached_value",
    "cache.*.fresh",
)

#: 无关轴必须是 observation 表面路径（schema 模式同款，编译期再显式断言一次）。
IRRELEVANT_AXIS_PREFIX = "observation."


def load_default_config(path: Path | None = None) -> dict[str, Any]:
    """读取默认配置；文件缺失或不是 object 时抛 :class:`ModelError`。"""
    target = path if path is not None else DEFAULT_CONFIG_PATH
    if not target.is_file():
        raise ModelError(f"默认配置缺失: {target}")
    try:
        document = json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ModelError(f"默认配置不是合法 JSON: {target}（{exc}）") from exc
    if not isinstance(document, dict):
        raise ModelError(f"默认配置必须是 object: {target}")
    return document


def try_load_default_config(path: Path | None = None) -> dict[str, Any] | None:
    """:func:`load_default_config` 的宽容版：读不到就返回 ``None``。"""
    try:
        return load_default_config(path)
    except ModelError:
        return None


def critical_axes_whitelist(config: Mapping[str, Any] | None) -> tuple[str, ...]:
    """从配置取关键轴白名单（glob）；配置不可用时退回内置镜像。"""
    if isinstance(config, Mapping):
        expansion = config.get("expansion")
        if isinstance(expansion, Mapping):
            whitelist = expansion.get("critical_axes_whitelist")
            if isinstance(whitelist, (list, tuple)):
                items = tuple(str(item) for item in whitelist)
                if items:
                    return items
    return FALLBACK_CRITICAL_AXES_WHITELIST


def irrelevant_axes(config: Mapping[str, Any] | None) -> tuple[str, ...]:
    """从配置取无关轴（``observation.*`` 路径）。"""
    if isinstance(config, Mapping):
        expansion = config.get("expansion")
        if isinstance(expansion, Mapping):
            axes = expansion.get("irrelevant_axes")
            if isinstance(axes, (list, tuple)):
                return tuple(str(item) for item in axes)
    return ()


def glob_segments_match(pattern: str, path: str) -> bool:
    """段式 glob 匹配：``*`` 匹配任意**单个** ``.`` 段，段数必须相同。

    比 ``fnmatch`` 严格：``fnmatch`` 的 ``*`` 会跨 ``.`` 匹配，于是
    ``resource.*.owner`` 会连 ``resource.RES-001.acl.owner`` 一起放行——
    白名单的意义正在于"只放行这一类路径"。
    """
    pattern_segments = pattern.split(".")
    path_segments = path.split(".")
    if len(pattern_segments) != len(path_segments):
        return False
    return all(
        expected == "*" or expected == actual
        for expected, actual in zip(pattern_segments, path_segments)
    )


def axis_matches_whitelist(axis: str, whitelist: tuple[str, ...]) -> bool:
    """关键轴是否命中白名单中的某个 glob。"""
    return any(glob_segments_match(pattern, axis) for pattern in whitelist)


__all__ = [
    "CONFIGS_DIR",
    "DEFAULT_CONFIG_PATH",
    "FALLBACK_CRITICAL_AXES_WHITELIST",
    "IRRELEVANT_AXIS_PREFIX",
    "PROJECT_ROOT",
    "axis_matches_whitelist",
    "critical_axes_whitelist",
    "glob_segments_match",
    "irrelevant_axes",
    "load_default_config",
    "try_load_default_config",
]
