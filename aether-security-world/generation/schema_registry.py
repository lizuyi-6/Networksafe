"""Schema registry loader for the generation layer.

The parser validates every decoded element against ``schemas/world-spec.schema.json``,
whose ``$ref`` graph pulls in ``world.schema.json``, ``policy.schema.json`` and
``evidence.schema.json``. This module builds the same single-registry validator the
architect's ``conftest.py`` builds (so a test can cross-check the two), but as a
library function the parser can call.

Nothing here mutates the schema files; they are read-only contract artefacts.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

#: ``aether-security-world/schemas`` — owned by the architect, read-only for us.
SCHEMAS_DIR = Path(__file__).resolve().parents[1] / "schemas"

WORLD_SPEC_SCHEMA = "world-spec"


def build_registry(schemas_dir: Path | None = None) -> Registry:
    """One registry holding every schema, so cross-file ``$ref``s resolve."""
    directory = Path(schemas_dir) if schemas_dir is not None else SCHEMAS_DIR
    resources = []
    for path in sorted(directory.glob("*.schema.json")):
        schema = json.loads(path.read_text(encoding="utf-8"))
        resources.append((schema["$id"], Resource.from_contents(schema, default_specification=DRAFT202012)))
    return Registry().with_resources(resources)


@lru_cache(maxsize=None)
def _cached_validator(schemas_dir_str: str, schema_stem: str) -> Draft202012Validator:
    directory = Path(schemas_dir_str)
    registry = build_registry(directory)
    schema = json.loads((directory / f"{schema_stem}.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)  # a broken schema is a hard error
    return Draft202012Validator(schema, registry=registry)


def world_spec_validator(schemas_dir: Path | None = None) -> Draft202012Validator:
    """A cached validator for ``world-spec.schema.json`` with cross-file refs resolved."""
    directory = Path(schemas_dir) if schemas_dir is not None else SCHEMAS_DIR
    return _cached_validator(str(directory.resolve()), WORLD_SPEC_SCHEMA)


def error_paths(errors) -> list[str]:
    """Deterministic, sorted JSON paths for a validator's errors."""
    return sorted("/".join(str(part) for part in error.absolute_path) for error in errors)


__all__ = [
    "SCHEMAS_DIR",
    "WORLD_SPEC_SCHEMA",
    "build_registry",
    "error_paths",
    "world_spec_validator",
]
