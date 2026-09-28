"""Shared pytest fixtures for Aether Security World.

Architect-owned bootstrap: the five implementation subagents add their own
``conftest.py`` inside their own package test directories and must NOT edit this
file, so that a fixture here stays a stable contract for everybody.

REVISION 1: added ``model_visible_boundary`` and ``spec_instance_pair`` fixtures.
The first encodes the model-visible / decision-metadata split as an executable
assertion (the reviewer found that the split existed only in prose, so every
abstention sample could be decoded straight from oracle metadata). The second
asserts that the reference spec really compiles to the reference instance.

What this file guarantees, and is itself tested against:
  * every ``*.schema.json`` in ``schemas/`` is a valid draft 2020-12 schema;
  * the cross-file ``$ref`` graph resolves inside a single registry;
  * the ``schemas/examples/*.example.json`` fixtures validate, and the
    ``*.invalid.json`` fixtures are rejected AT THEIR DECLARED PATH.

The last two are enforced by ``scripts/validate_schemas.py`` (exit 0 == pass) and
mirrored here as fixtures so any test can validate an artefact it just built.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

PROJECT_ROOT = Path(__file__).resolve().parent
SCHEMAS_DIR = PROJECT_ROOT / "schemas"
EXAMPLES_DIR = SCHEMAS_DIR / "examples"
CONFIGS_DIR = PROJECT_ROOT / "configs"

# Keys that may appear ONLY in observation.decision_metadata (oracle/gate side).
# A model-visible observation containing any of them lets the abstention classes be
# decoded from metadata instead of reasoned about - see design §5.2.
MODEL_VISIBLE_FORBIDDEN_KEYS = frozenset({
    "trust_level", "attacker_controllable", "required_for_decision", "freshness",
    "contradicts", "visible_in_observation", "evidence_availability_level",
    "relevant_history", "irrelevant_history", "causal_tag", "hidden_evidence",
    "hypothesized_verdict", "expected_effect", "rationale", "attack_family",
    "world_truth", "observable_decision", "violated_invariants", "satisfied_invariants",
    "skipped_invariants", "missing_evidence", "decision_trace",
})

# The seven keys a model may read about a piece of evidence (design §5.2).
EVIDENCE_OBSERVATION_KEYS = frozenset({
    "evidence_id", "type", "asserts_ref", "value", "source", "provenance", "timestamp",
})


def _load_schemas() -> dict[str, dict]:
    schemas: dict[str, dict] = {}
    for path in sorted(SCHEMAS_DIR.glob("*.schema.json")):
        schemas[path.stem.replace(".schema", "")] = json.loads(path.read_text(encoding="utf-8"))
    return schemas


def build_registry() -> Registry:
    """One registry holding every schema, so cross-file $refs resolve."""
    resources = [
        (schema["$id"], Resource.from_contents(schema, default_specification=DRAFT202012))
        for schema in _load_schemas().values()
    ]
    return Registry().with_resources(resources)


def _walk_keys(obj, path: str = ""):
    """Yield (json_path, key) for every dict key in a document."""
    if isinstance(obj, dict):
        for key, value in obj.items():
            yield f"{path}/{key}", key
            yield from _walk_keys(value, f"{path}/{key}")
    elif isinstance(obj, list):
        for index, value in enumerate(obj):
            yield from _walk_keys(value, f"{path}/{index}")


@pytest.fixture(scope="session")
def project_root() -> Path:
    return PROJECT_ROOT


@pytest.fixture(scope="session")
def schemas_dir() -> Path:
    return SCHEMAS_DIR


@pytest.fixture(scope="session")
def examples_dir() -> Path:
    return EXAMPLES_DIR


@pytest.fixture(scope="session")
def schema_registry() -> Registry:
    return build_registry()


@pytest.fixture(scope="session")
def validators() -> dict[str, Draft202012Validator]:
    registry = build_registry()
    out: dict[str, Draft202012Validator] = {}
    for name, schema in _load_schemas().items():
        Draft202012Validator.check_schema(schema)  # a broken schema is a hard error
        out[name] = Draft202012Validator(schema, registry=registry)
    return out


@pytest.fixture(scope="session")
def default_config() -> dict:
    return json.loads((CONFIGS_DIR / "default.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def reference_world() -> dict:
    return json.loads((EXAMPLES_DIR / "world.example.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def reference_world_spec() -> dict:
    return json.loads((EXAMPLES_DIR / "world-spec.example.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def reference_episode() -> dict:
    return json.loads((EXAMPLES_DIR / "episode.example.json").read_text(encoding="utf-8"))


@pytest.fixture()
def model_visible_boundary():
    """Assert an episode's model-visible side carries no oracle classification.

    Usage::

        def test_x(reference_episode, model_visible_boundary):
            model_visible_boundary(reference_episode)

    Any test that builds an episode should run it before asserting on labels.
    """

    def _assert(episode: dict) -> None:
        observation = episode["observation"]
        assert set(observation) == {"model_visible", "decision_metadata"}, (
            f"observation must be split into model_visible/decision_metadata, got {sorted(observation)}"
        )
        leaks = [
            (path, key)
            for path, key in _walk_keys(observation["model_visible"])
            if key in MODEL_VISIBLE_FORBIDDEN_KEYS
        ]
        assert not leaks, f"oracle-classified keys leaked into model_visible: {leaks}"

        classification = observation["decision_metadata"]["evidence_classification"]
        visible = [e for e in classification if e.get("visible_in_observation") is True]
        projected = [
            {k: e[k] for k in EVIDENCE_OBSERVATION_KEYS if k in e} for e in visible
        ]
        assert observation["model_visible"]["evidence"] == projected, (
            "model_visible.evidence must be the exact seven-key projection of the visible "
            "classification (design §5.2)"
        )
        hidden_ids = [e["evidence_id"] for e in classification if e.get("visible_in_observation") is False]
        assert sorted(observation["decision_metadata"].get("hidden_evidence_ids", [])) == sorted(hidden_ids), (
            "hidden_evidence_ids must equal the ids of the invisible classification items"
        )

    return _assert


@pytest.fixture(scope="session")
def spec_instance_pair(reference_world_spec, reference_world) -> dict:
    """Assert the reference spec really determines the reference instance.

    The reviewer found the two reference documents described different entity sets,
    so ``compile_spec`` had no worked example. This fixture asserts the subset
    relation that the compiler must preserve and the two fields it must add.
    """
    spec, instance = reference_world_spec, reference_world
    shared = [k for k in spec if k not in {
        "hypotheses", "attack_family", "notes", "$comment", "application_domain",
        "episode_templates", "critical_state_variables", "irrelevant_state_variables", "seed",
    }]
    mismatched = [k for k in shared if spec[k] != instance.get(k)]
    assert not mismatched, f"instance differs from spec on {mismatched} - compile_spec must copy these verbatim"
    assert instance["world_family_id"].startswith("WF-") and len(instance["world_family_id"]) == 15, (
        "world_family_id must be a derived 'WF-' + 12 hex form, not authored"
    )
    assert instance["compile"]["derived_world_family_id"] is True
    assert "hypotheses" not in instance and "attack_family" not in instance, (
        "the compiler must drop the hypothesis block; no AI assumption may reach an instance"
    )
    return {"spec": spec, "instance": instance}
