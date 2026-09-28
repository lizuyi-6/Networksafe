"""Validate the Aether Security World JSON Schemas against reference fixtures.

This is the schema-level acceptance check for design v0.1. REVISION 1: it used to
assert only "each negative fixture was rejected by some rule", which is how six of
the seven negative fixtures passed while being rejected for reasons that had
nothing to do with what they claimed to prove (most of them by an undeclared root
`$comment`). It now asserts, for every negative fixture, that at least one error is
reported at the PATH the fixture declares it violates. A rejection at the wrong
path is a failure.

Four checks, nothing more:

1. every schema in ``schemas/`` is itself a valid JSON Schema (draft 2020-12
   meta-schema), including cross-file ``$ref`` resolution;
2. every ``*.example.json`` fixture validates against the schema of the same stem;
3. every ``*.invalid.json`` fixture is REJECTED, and at the declared path;
4. the declared negative paths are not vacuous: removing the offending value must
   make the same fixture validate (so the path really is what rejects it).

Run:  py -3 scripts/validate_schemas.py
Exit code 0 == all four checks pass.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

SCHEMA_DIR = Path(__file__).resolve().parents[1] / "schemas"
EXAMPLES_DIR = SCHEMA_DIR / "examples"

SCHEMA_STEMS = [
    "action",
    "episode",
    "evidence",
    "oracle-output",
    "policy",
    "release",
    "world",
    "world-spec",
]

# fixture -> (schema, declared violation path, mutation that must repair it)
#
# `declared_path` is the JSON path at which the fixture MUST be rejected. `repair`
# is applied to a copy of the fixture; the repaired copy must then validate, which
# proves the declared path is genuinely what rejected the original.
NEGATIVE_CASES: dict[str, tuple[str, str, Any]] = {
    "evidence.invalid.json": (
        "evidence",
        "trust_level",
        lambda d: d.__setitem__("trust_level", "trusted"),
    ),
    "oracle-output.invalid.json": (
        "oracle-output",
        "decision_trace",
        lambda d: d.__setitem__(
            "decision_trace",
            [{"step": 0, "rule": "verdict.aggregate", "operands": {"denied": True}, "result": "attack"}],
        ),
    ),
    "policy.invalid.json": (
        "policy",
        "policies/0/condition",
        lambda d: d["policies"][0]["condition"].__setitem__("op", "eq"),
    ),
    "release.invalid.json": (
        "release",
        "split_statistics/group_overlap_audit",
        lambda d: (
            d["split_statistics"].__setitem__("group_overlap_audit", []),
            [row.__setitem__("group_overlap_audit", []) for row in d.get("split_assignments", [])],
        ),
    ),
    "world.invalid.json": (
        "world",
        "",  # root: additionalProperties reports at the document root, naming the key
        lambda d: d.pop("ground_truth"),
    ),
    "world-spec.invalid.json": (
        "world-spec",
        "critical_state_variables/0",
        lambda d: d.__setitem__("critical_state_variables", ["resource.RES-001.owner"]),
    ),
    "episode.invalid.json": (
        "episode",
        "",  # root: the allOf/if-then reports the failure at the document root
        lambda d: d.__setitem__(
            "variant_type", "base"
        ),
    ),
}


def build_registry() -> Registry:
    """Load every schema into one registry so cross-file $refs resolve."""
    resources = []
    for path in sorted(SCHEMA_DIR.glob("*.schema.json")):
        schema = json.loads(path.read_text(encoding="utf-8"))
        resource = Resource.from_contents(schema, default_specification=DRAFT202012)
        resources.append((schema["$id"], resource))
    return Registry().with_resources(resources)


def error_paths(errors) -> list[str]:
    return ["/".join(str(p) for p in e.absolute_path) for e in errors]


def main() -> int:
    failures: list[str] = []
    registry = build_registry()

    validators: dict[str, Draft202012Validator] = {}
    for stem in SCHEMA_STEMS:
        path = SCHEMA_DIR / f"{stem}.schema.json"
        if not path.is_file():
            failures.append(f"missing schema file: {path.name}")
            continue
        schema = json.loads(path.read_text(encoding="utf-8"))
        try:
            Draft202012Validator.check_schema(schema)
        except Exception as exc:  # noqa: BLE001 - reported verbatim
            failures.append(f"{path.name} is not a valid draft 2020-12 schema: {exc}")
            continue
        validators[stem] = Draft202012Validator(schema, registry=registry)

    positive = 0
    for path in sorted(EXAMPLES_DIR.glob("*.example.json")):
        stem = path.name.split(".")[0]
        validator = validators.get(stem)
        if validator is None:
            failures.append(f"fixture {path.name} has no matching schema {stem}.schema.json")
            continue
        instance = json.loads(path.read_text(encoding="utf-8"))
        errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.absolute_path))
        if errors:
            for error in errors:
                failures.append(
                    f"{path.name} rejected by {stem}.schema.json at "
                    f"{'/'.join(str(p) for p in error.absolute_path) or '<root>'}: {error.message}"
                )
        else:
            positive += 1
            print(f"[pass] {path.name} -> {stem}.schema.json")

    negative = 0
    for fixture, (stem, declared_path, repair) in sorted(NEGATIVE_CASES.items()):
        validator = validators.get(stem)
        path = EXAMPLES_DIR / fixture
        if validator is None or not path.is_file():
            failures.append(f"negative case {fixture} unusable (schema {stem} or fixture missing)")
            continue
        instance = json.loads(path.read_text(encoding="utf-8"))

        errors = list(validator.iter_errors(instance))
        if not errors:
            failures.append(f"{fixture} was ACCEPTED by {stem}.schema.json - the guard does not exist")
            continue

        paths = error_paths(errors)
        if declared_path and not any(p == declared_path or p.startswith(declared_path + "/") for p in paths):
            failures.append(
                f"{fixture} was rejected by {stem}.schema.json but NOT at the declared path "
                f"'{declared_path}'; actual paths: {paths}"
            )
            continue

        # The declared path must be load-bearing: repairing it must make the fixture valid.
        repaired = json.loads(json.dumps(instance))
        repair(repaired)
        residual = list(validator.iter_errors(repaired))
        if residual:
            failures.append(
                f"{fixture}: repairing the declared path '{declared_path}' still leaves "
                f"{len(residual)} error(s) at {error_paths(residual)} - the fixture is rejected for "
                f"an undeclared reason too"
            )
            continue

        negative += 1
        print(f"[pass] {fixture} rejected by {stem}.schema.json at '{decl_path_label(declared_path)}' and only there")

    print()
    print(f"schemas_meta_validated={len(validators)}")
    print(f"positive_fixtures_passed={positive}")
    print(f"negative_fixtures_rejected_at_declared_path={negative}")
    if failures:
        print()
        print("SCHEMA_VALIDATION=FAILED")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("SCHEMA_VALIDATION=passed")
    return 0


def decl_path_label(declared: str) -> str:
    return declared if declared else "<root>"


if __name__ == "__main__":
    sys.exit(main())
