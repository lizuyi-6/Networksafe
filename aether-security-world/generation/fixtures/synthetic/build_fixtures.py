"""Build the tracked synthetic replay fixtures used by the generation unit tests.

Real Step-5-pre recordings land in ``generation/fixtures/recorded/`` and are gitignored
(design §11.5). The unit tests and the batch-size stability probe need *some* recorded
batch to replay, and they must be able to run from a fresh clone — so this script
authors tiny, deterministic, fully valid recordings here, in the tracked
``generation/fixtures/synthetic/`` directory.

What it produces, for every batch size in ``SIZES`` and every class in ``CLASSES``:

* ``batch-<size>-normal.json``          — every element is a valid world spec;
* ``batch-<size>-truncated.json``       — the same text cut mid-array (frame corruption);
* ``batch-<size>-illegal.json``         — one element replaced by an unterminated fragment;
* ``batch-<size>-schema_invalid.json``  — well-formed frame, one element breaks the schema.

Token counts are synthetic: ``output_tokens`` is recorded as ``len(text)//4`` (the usual
chars-per-token heuristic) because no tokenizer exists offline. That is a *declared*
property of a synthetic recording, not an estimate the library performs at runtime —
``ReplayClient`` returns whatever the fixture recorded, and the GE metric uses it verbatim.

Run:  py -3 -m generation.fixtures.synthetic.build_fixtures     (from aether-security-world/)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:  # allow `py -3 <this file>` as well as -m
    sys.path.insert(0, str(PROJECT_ROOT))

from generation.prompts import load_prompt  # noqa: E402

FIXTURE_DIR = Path(__file__).resolve().parent
SIZES = (1, 2, 4, 8)
CLASSES = ("normal", "truncated", "illegal", "schema_invalid")
TRUNCATION_FRACTION = 0.55
ILLEGAL_ELEMENT_POSITION = "middle"

DOMAINS = (
    "e-commerce", "cloud_storage", "saas", "school_system", "finance_workflow", "ticketing",
    "logistics", "healthcare_workflow", "hr_system", "devops_platform", "code_hosting", "crm",
    "iam_system", "iot_management", "industrial_management", "api_marketplace", "content_platform",
    "messaging", "project_management", "subscription_system",
)
ATTACK_FAMILIES = ("idor_bola", "revoked_session_reuse", "token_replay", "workflow_bypass", "tenant_isolation_violation")


def make_spec(index: int) -> dict:
    """A small but complete, schema-valid world seed. Distinct per index."""
    world_id = f"W-{1000 + index}"
    domain = DOMAINS[index % len(DOMAINS)]
    family = ATTACK_FAMILIES[index % len(ATTACK_FAMILIES)]
    second_actor = index % 2 == 0
    return {
        "schema_version": "0.1",
        "world_id": world_id,
        "application_domain": domain,
        "seed": 20260920 + index,
        "application": {
            "name": f"Synthetic {domain} service {index}",
            "description": (
                f"A synthetic {domain} API used by the replay fixtures. Actor ACT-001 owns RES-001; "
                f"a second tenant exists so tenant isolation is expressible."
            ),
            "endpoints": [
                {"path": f"/api/{domain}/items/{{item_id}}", "method": "GET", "operation": "read", "resource_type": "file", "auth_required": True},
                {"path": f"/api/{domain}/items/{{item_id}}/share", "method": "POST", "operation": "share", "resource_type": "file", "auth_required": True},
            ],
        },
        "roles": [
            {"role_id": "ROLE-USER", "name": "user", "privileges": ["item.read.own"]},
        ],
        "actors": [
            {
                "actor_id": "ACT-001", "actor_type": "user", "display_name": f"Owner {index}",
                "identity": {"identity_id": "ID-001", "email": "owner@example.invalid", "verified": True},
                "roles": ["ROLE-USER"], "tenant": "TEN-001",
                "privileges": ["item.read.own"],
                "authentication_state": "authenticated", "privilege_version": 1,
            },
        ]
        + (
            [
                {
                    "actor_id": "ACT-002", "actor_type": "attacker_controlled_account",
                    "display_name": f"Stranger {index}",
                    "identity": {"identity_id": "ID-002", "email": "stranger@example.invalid", "verified": True},
                    "roles": ["ROLE-USER"], "tenant": "TEN-002",
                    "privileges": ["item.read.own"],
                    "authentication_state": "authenticated", "privilege_version": 0,
                }
            ]
            if second_actor
            else []
        ),
        "resources": [
            {
                "resource_id": "RES-001", "resource_type": "file", "display_name": f"Item {index}",
                "owner": "ACT-001", "tenant": "TEN-001",
                "sensitivity": "confidential", "state": "active",
                "attributes": {"revision": index},
            },
        ],
        "sessions": [
            {
                "session_id": "SES-001", "principal": "ACT-001",
                "created_at": "2026-09-19T08:00:00Z", "authenticated_at": "2026-09-19T08:00:05Z",
                "auth_strength": "password_mfa", "valid": True, "revoked": False,
                "expires_at": "2026-09-20T08:00:05Z",
                "privilege_snapshot": {"roles": ["ROLE-USER"], "privileges": ["item.read.own"], "privilege_version": 1},
                "flow_id": "FLOW-READ",
            },
        ],
        "workflows": [
            {
                "workflow_id": "WFL-ITEM", "name": "Item lifecycle",
                "states": ["draft", "published"],
                "initial_state": "draft",
                "transitions": [{"from_state": "draft", "to_state": "published"}],
                "instances": [
                    {
                        "instance_id": "WFI-001", "resource_id": "RES-001", "current_state": "published",
                        "history": [{"from_state": "draft", "to_state": "published", "at": "2026-09-19T09:00:00Z", "actor_id": "ACT-001"}],
                    }
                ],
            },
        ],
        "policies": [
            {
                "policy_id": "POL-ITEM-READ-OWNER",
                "description": "Reading an item requires the caller to be its owner.",
                "action": {"operation": "read", "resource_type": "file"},
                "effect": "allow",
                "condition": {
                    "op": "eq",
                    "args": [
                        {"op": "ref", "path": "action.actor.actor_id"},
                        {"op": "ref", "path": "action.resource.owner"},
                    ],
                },
                "priority": 100,
            },
            {
                "policy_id": "POL-DEFAULT-DENY",
                "description": "Closed-world default deny (never produces an attack label alone).",
                "action": {"operation": "*"},
                "effect": "deny",
                "condition": {"op": "lit", "value": True},
                "priority": -1,
                "is_default_rule": True,
            },
        ],
        "invariants": [
            {
                "invariant_id": "INV-OWNERSHIP-001", "category": "ownership", "applies_to": ["read"],
                "severity": "critical",
                "description": "A resource read must be by its owner.",
                "expr": {
                    "op": "eq",
                    "args": [
                        {"op": "ref", "path": "action.actor.actor_id"},
                        {"op": "ref", "path": "action.resource.owner"},
                    ],
                },
            },
            {
                "invariant_id": "INV-TENANT-ISOLATION-001", "category": "tenant_isolation",
                "applies_to": ["read", "share"], "severity": "critical",
                "description": "An actor may not touch a resource in another tenant.",
                "expr": {
                    "op": "eq",
                    "args": [
                        {"op": "ref", "path": "action.actor.tenant"},
                        {"op": "ref", "path": "action.resource.tenant"},
                    ],
                },
            },
        ],
        "state_history": [
            {
                "snapshot_id": "SNAP-000", "at": "2026-09-19T07:00:00Z", "label": "before publication",
                "actor_states": {"ACT-001": {"authentication_state": "authenticated", "privilege_version": 1, "roles": ["ROLE-USER"]}},
                "session_states": {"SES-001": {"valid": True, "revoked": False, "privilege_version": 1}},
                "workflow_states": {"WFI-001": {"current_state": "draft"}},
                "resource_states": {"RES-001": {"state": "draft", "owner": "ACT-001"}},
            },
        ],
        "current_state": {
            "snapshot_id": "SNAP-001", "at": "2026-09-19T09:00:00Z", "label": "current",
            "actor_states": {"ACT-001": {"authentication_state": "authenticated", "privilege_version": 1, "roles": ["ROLE-USER"]}},
            "session_states": {"SES-001": {"valid": True, "revoked": False, "privilege_version": 1}},
            "workflow_states": {"WFI-001": {"current_state": "published"}},
            "resource_states": {"RES-001": {"state": "published", "owner": "ACT-001"}},
        },
        "evidence": [
            {
                "evidence_id": "EV-OWN-001", "type": "ownership_record", "asserts_ref": "resource.RES-001.owner",
                "value": "ACT-001", "source": "item_db", "provenance": "system_of_record",
                "trust_level": "trusted", "timestamp": "2026-09-19T09:00:00Z", "freshness": "fresh",
                "attacker_controllable": False, "visible_in_observation": True,
            },
            {
                "evidence_id": "EV-TENANT-001", "type": "http_header", "asserts_ref": "actor.ACT-001.tenant",
                "value": "TEN-002", "source": "user_supplied_header:X-Tenant-Id", "provenance": "client_supplied",
                "trust_level": "untrusted", "timestamp": "2026-09-20T08:00:00Z", "freshness": "fresh",
                "attacker_controllable": True, "visible_in_observation": True,
            },
        ],
        "critical_state_variables": [
            "resource.RES-001.owner",
            "actor.ACT-001.privilege_version",
            "session.SES-001.revoked",
        ],
        "irrelevant_state_variables": [
            "observation.request.headers.User-Agent",
            "observation.rendering.trace_id",
        ],
        "attack_family": family,
        "hypotheses": {
            "attack_opportunities": [
                {
                    "opportunity_id": "OPP-001", "attack_family": family, "target_operation": "read",
                    "hypothesized_verdict": "attack",
                    "rationale": "A same-role actor in another tenant reads an item it does not own.",
                }
            ],
            "expected_counterfactual_axes": [
                {
                    "axis_id": "AXIS-001", "variable": "resource.RES-001.owner", "kind": "critical",
                    "before": "ACT-001", "after": "ACT-002", "expected_effect": "verdict_flip",
                    "rationale": "If the stranger owned the item the read would be authorised.",
                }
            ],
        },
        "episode_templates": [
            {
                "template_id": "TPL-001",
                "decision_event_index": 1,
                "events": [
                    {"event_type": "login", "actor_id": "ACT-001", "t_offset_ms": 0, "causal_tag": "relevant", "summary": "Owner signs in."},
                    {
                        "event_type": "request", "actor_id": "ACT-001", "t_offset_ms": 3600000,
                        "causal_tag": "relevant", "summary": "Decision request on RES-001.",
                        "binds": {"session_id": "SES-001", "resource_id": "RES-001", "operation": "read", "flow_id": "FLOW-READ"},
                    },
                ],
            }
        ],
        "notes": f"Synthetic replay seed #{index} for the generation unit tests (not a handcrafted world).",
    }


def render_array(elements: list[dict]) -> str:
    """Serialise a batch the way a model would: one JSON array, indented."""
    return "[\n" + ",\n".join(json.dumps(element, indent=2, ensure_ascii=False) for element in elements) + "\n]"


def build_output_text(size: int, klass: str) -> tuple[str, str]:
    """Return (output_text, note) for one (size, class) recording."""
    specs = [make_spec(index) for index in range(size)]
    normal = render_array(specs)
    if klass == "normal":
        return normal, "well-formed batch; every element validates against world-spec.schema.json"
    if klass == "truncated":
        cut = int(len(normal) * TRUNCATION_FRACTION)
        text = normal[:cut]
        _assert_undecodable(text, "truncated")
        return text, "output truncated mid-array; the frame decoder must reject the whole batch"
    if klass == "illegal":
        parts = [json.dumps(spec, indent=2, ensure_ascii=False) for spec in specs]
        position = len(parts) // 2 if ILLEGAL_ELEMENT_POSITION == "middle" else 0
        parts[position] = '{"world_id": "W-1000", "application_domain": '
        text = "[\n" + ",\n".join(parts) + "\n]"
        _assert_undecodable(text, "illegal")
        return text, "one element replaced by an unterminated fragment; no partial salvage is allowed"
    if klass == "schema_invalid":
        specs[len(specs) // 2]["application_domain"] = "not_a_real_domain"
        text = render_array(specs)
        return text, "well-formed frame, one element violates the schema enum; only that element is rejected"
    raise ValueError(f"unknown fixture class {klass!r}")


def _assert_undecodable(text: str, klass: str) -> None:
    try:
        json.loads(text)
    except json.JSONDecodeError:
        return
    raise AssertionError(
        f"fixture class '{klass}' produced decodable JSON - the corruption it is meant to "
        "demonstrate is not present"
    )


def build_fixture(size: int, klass: str, prompt_hash: str) -> dict:
    text, note = build_output_text(size, klass)
    return {
        "recorded_at": "2026-09-20T00:00:00Z",
        "provider": "replay",
        "model": "step5-pre-replay-synthetic",
        "model_version": "synthetic-0.1",
        "prompt_version": "0.1",
        "prompt_hash": prompt_hash,
        "prompt_sha256": prompt_hash,
        "batch_size": size,
        "decoding_parameters": {"temperature": 0.2, "top_p": 0.9, "max_output_tokens": 8192},
        "output_text": text,
        "output_tokens": max(1, len(text) // 4),
        "input_tokens": 900,
        "raw_generation_id": f"synthetic-{size:04d}-{klass}",
        "notes": (
            f"{note}. Synthetic recording authored by generation/fixtures/synthetic/build_fixtures.py; "
            "output_tokens is len(text)//4 because no tokenizer exists offline."
        ),
    }


def main() -> int:
    prompt_hash = load_prompt("0.1").prompt_hash
    written: list[str] = []
    for size in SIZES:
        for klass in CLASSES:
            fixture = build_fixture(size, klass, prompt_hash)
            path = FIXTURE_DIR / f"batch-{size:04d}-{klass}.json"
            path.write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            written.append(path.name)
    print(f"wrote {len(written)} synthetic fixtures to {FIXTURE_DIR}")
    for name in written:
        print(f"  {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
