"""世界 / spec / episode 的加载器。

加载顺序是**fail-fast 且分层**的：

1. 读文件、解析 JSON（语法错误就停）；
2. jsonschema 校验（契约层，返回逐条错误而不是抛异常的是
   :func:`validate_world_document` / :func:`validate_world_spec_document`）；
3. 构建内存形态（严格字段校验，D6：无隐式 coerce）；
4. 引用完整性（悬空引用即 :class:`CompileError`，绝不静默变成 ``None``）。

``load_world`` 对**已经编译好的**世界文档也跑第 4 步：一个声称已编译的世界
带着悬空引用，说明产出它的管线坏了，静默放行会让错误流到 oracle。
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .compile import reference_integrity_errors, token_cycle_errors
from .errors import CompileError, ModelError, SchemaValidationError, first_error_line
from .episode import Episode
from .schemas import schema_errors
from .world import WorldInstance, WorldSpec


def load_json(path: Path | str) -> Any:
    """读并解析 JSON 文件。"""
    target = Path(path)
    if not target.is_file():
        raise ModelError(f"文件不存在: {target}")
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ModelError(f"{target} 不是合法 JSON: {exc}") from exc


def _validate_path(document: Any, stem: str, source: Path) -> None:
    errors = schema_errors(document, stem)
    if errors:
        raise SchemaValidationError(errors, schema_stem=stem)


def validate_world_document(document: Any) -> list[str]:
    """世界文档的 schema 错误列表（空列表 = 合法）。"""
    return schema_errors(document, "world")


def validate_world_spec_document(document: Any) -> list[str]:
    """spec 文档的 schema 错误列表（空列表 = 合法）。"""
    return schema_errors(document, "world-spec")


def validate_episode_document(document: Any) -> list[str]:
    """episode 文档的 schema 错误列表（空列表 = 合法）。"""
    return schema_errors(document, "episode")


def validate_action_document(document: Any) -> list[str]:
    """action 文档的 schema 错误列表（空列表 = 合法）。"""
    return schema_errors(document, "action")


def _ensure_reference_integrity(world: WorldInstance, source: Path) -> None:
    errors = reference_integrity_errors(world) + token_cycle_errors(world)
    if errors:
        reason_code, detail = errors[0]
        raise CompileError(reason_code, f"{source.name}: {detail}（共 {len(errors)} 处）")


def load_world(path: Path | str) -> WorldInstance:
    """加载一个**已编译**世界实例。"""
    source = Path(path)
    document = load_json(source)
    _validate_path(document, "world", source)
    try:
        world = WorldInstance.from_document(document)
    except ModelError as exc:
        raise CompileError("malformed_document", f"{source.name}: {first_error_line(exc)}") from exc
    _ensure_reference_integrity(world, source)
    return world


def load_world_spec(path: Path | str) -> WorldSpec:
    """加载一个世界**种子**（可含假设）。"""
    source = Path(path)
    document = load_json(source)
    _validate_path(document, "world-spec", source)
    try:
        return WorldSpec.from_document(document)
    except ModelError as exc:
        raise CompileError("malformed_document", f"{source.name}: {first_error_line(exc)}") from exc


def load_episode(path: Path | str) -> Episode:
    """加载一个 episode（世界侧由调用方另行加载）。"""
    source = Path(path)
    document = load_json(source)
    _validate_path(document, "episode", source)
    try:
        return Episode.from_document(document)
    except ModelError as exc:
        raise CompileError("malformed_document", f"{source.name}: {first_error_line(exc)}") from exc


def load_action(path: Path | str) -> dict[str, Any]:
    """加载一个 action 文档（oracle 的输入，L2 会把它变成 ``Action``）。"""
    source = Path(path)
    document = load_json(source)
    _validate_path(document, "action", source)
    if not isinstance(document, dict):
        raise CompileError("malformed_document", f"{source.name}: action 必须是 object")
    return document


def compile_spec_file(path: Path | str, *, seed: int | None = None) -> WorldInstance:
    """``load_world_spec`` + ``compile_spec`` 的便利组合。"""
    from .compile import compile_spec

    return compile_spec(load_world_spec(path), seed=seed)


__all__ = [
    "compile_spec_file",
    "load_action",
    "load_episode",
    "load_json",
    "load_world",
    "load_world_spec",
    "validate_action_document",
    "validate_episode_document",
    "validate_world_document",
    "validate_world_spec_document",
]
