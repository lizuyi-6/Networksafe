"""Schema 注册表与 jsonschema 校验（L0 契约的运行时入口）。

与 ``conftest.py`` / ``scripts/validate_schemas.py`` 用同一套注册表构造方式：
把 ``schemas/*.schema.json`` 按 ``$id`` 装进一个 ``referencing.Registry``，
跨文件 ``$ref``（``world.schema.json`` → ``policy.schema.json`` /
``evidence.schema.json``）才能解析。

**坏文档绝不修复**（设计 §11.2）：``validate_document`` 返回逐条错误（含 JSON
路径），调用方决定是拒绝还是记录；本模块不做任何"猜一个合理值补上"的动作。
"""
from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from .config import PROJECT_ROOT
from .errors import ModelError, SchemaValidationError

#: 8 个 schema 的词干（与 ``scripts/validate_schemas.py`` 的 SCHEMA_STEMS 一致）。
SCHEMA_STEMS: tuple[str, ...] = (
    "action",
    "episode",
    "evidence",
    "oracle-output",
    "policy",
    "release",
    "world",
    "world-spec",
)

SCHEMAS_DIR = PROJECT_ROOT / "schemas"


def schemas_dir() -> Path:
    """``schemas/`` 目录。

    **不读环境变量**：``configs/default.json`` 的约定是"任何东西都不得依赖挂钟、
    环境或线程调度"。需要换目录的调用方显式传 ``directory=`` 参数。
    """
    return SCHEMAS_DIR


def load_schemas(directory: Path | None = None) -> dict[str, dict[str, Any]]:
    """读取全部 schema；``词干 -> schema 文档``。"""
    target = directory if directory is not None else schemas_dir()
    if not target.is_dir():
        raise ModelError(f"schemas 目录不存在: {target}")
    schemas: dict[str, dict[str, Any]] = {}
    for path in sorted(target.glob("*.schema.json")):
        stem = path.name[: -len(".schema.json")]
        document = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(document, dict):
            raise ModelError(f"{path.name} 不是 object")
        schemas[stem] = document
    missing = [stem for stem in SCHEMA_STEMS if stem not in schemas]
    if missing:
        raise ModelError(f"schemas 目录缺少必需 schema: {missing}")
    return schemas


def build_registry(directory: Path | None = None) -> Registry:
    """一个注册表装下全部 schema，使跨文件 ``$ref`` 可解析。"""
    resources = [
        (schema["$id"], Resource.from_contents(schema, default_specification=DRAFT202012))
        for schema in load_schemas(directory).values()
        if isinstance(schema.get("$id"), str)
    ]
    return Registry().with_resources(resources)


@lru_cache(maxsize=None)
def _validator(stem: str, directory: str) -> Draft202012Validator:
    schema = load_schemas(Path(directory) if directory else None)[stem]
    Draft202012Validator.check_schema(schema)  # schema 自身坏了是硬错误
    return Draft202012Validator(schema, registry=build_registry(Path(directory) if directory else None))


def validator_for(stem: str, *, directory: Path | None = None) -> Draft202012Validator:
    """取某个 schema 的校验器（带完整注册表）。"""
    if stem not in SCHEMA_STEMS:
        raise ModelError(f"未知 schema 词干 {stem!r}；可用: {list(SCHEMA_STEMS)}")
    return _validator(stem, str(directory) if directory is not None else "")


def schema_errors(document: Any, stem: str, *, directory: Path | None = None) -> list[str]:
    """逐条错误（含 JSON 路径）；空列表表示合法。"""
    validator = validator_for(stem, directory=directory)
    errors = sorted(validator.iter_errors(document), key=lambda error: list(error.absolute_path))
    rendered: list[str] = []
    for error in errors:
        path = "/".join(str(part) for part in error.absolute_path) or "<root>"
        rendered.append(f"{stem}.schema.json 在 {path} 拒绝: {error.message}")
    return rendered


def validate_document(document: Any, stem: str, *, directory: Path | None = None) -> list[str]:
    """:func:`schema_errors` 的别名（语义更明确的入口）。"""
    return schema_errors(document, stem, directory=directory)


def validate_or_raise(document: Any, stem: str, *, directory: Path | None = None) -> None:
    """不合法就抛 :class:`SchemaValidationError`（携带全部错误）。"""
    errors = schema_errors(document, stem, directory=directory)
    if errors:
        raise SchemaValidationError(errors, schema_stem=stem)


def check_schemas_meta(directory: Path | None = None) -> list[str]:
    """每个 schema 自身是否是合法 draft 2020-12（镜像 validate_schemas.py 第 1 项）。"""
    failures: list[str] = []
    for stem, schema in load_schemas(directory).items():
        try:
            Draft202012Validator.check_schema(schema)
        except Exception as exc:  # noqa: BLE001 - 原样上报
            failures.append(f"{stem}.schema.json 不是合法 draft 2020-12 schema: {exc}")
    return failures


def iter_example_paths(directory: Path | None = None) -> Iterable[Path]:
    """``schemas/examples/*.example.json``。"""
    target = (directory if directory is not None else schemas_dir()) / "examples"
    return sorted(target.glob("*.example.json"))


def load_schema_document(stem: str, *, directory: Path | None = None) -> Mapping[str, Any]:
    """原样取某个 schema 文档（Gate 与测试要用它的枚举/模式）。"""
    return load_schemas(directory)[stem]


__all__ = [
    "SCHEMAS_DIR",
    "SCHEMA_STEMS",
    "build_registry",
    "check_schemas_meta",
    "iter_example_paths",
    "load_schema_document",
    "load_schemas",
    "schema_errors",
    "schemas_dir",
    "validate_document",
    "validate_or_raise",
    "validator_for",
]
