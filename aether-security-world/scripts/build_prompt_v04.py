"""构建 prompt v0.4：v0.3 骨架升级 + 剩余枚举/形状补齐。

v0.3 真实 batch：5 元素中 1 个过 schema（但 compile 时因 application.endpoints 缺失
被 applies_to_unknown_operation 拒），其余 4 个的剩余缺口全部狭窄且已定位：
authentication_state / resource_type 两个枚举、*_states 对象形状、
privilege_snapshot/audience/scope 的类型、application.endpoints 未声明。
v0.4 把这些写进契约与骨架，不逐条枚举到天荒地老。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from security_world.model.schemas import schema_errors  # noqa: E402


def minimal_spec() -> dict:
    return {
        "schema_version": "0.1",
        "world_id": "W-example-001",
        "application_domain": "e-commerce",
        "seed": 1001,
        "application": {
            "name": "ExampleShop",
            "description": "A tiny example shop used only to show shapes.",
            "endpoints": [
                {"path": "/api/orders/{id}", "method": "GET", "operation": "read", "resource_type": "order"},
            ],
        },
        "roles": [
            {"role_id": "ROLE-BUYER", "name": "buyer", "privileges": ["order.read.own"]},
            {"role_id": "ROLE-SUPPORT", "name": "support_agent", "privileges": ["order.read.any"]},
        ],
        "actors": [
            {
                "actor_id": "ACT-001", "actor_type": "user",
                "identity": {"identity_id": "ID-001", "email": "buyer@example.invalid", "verified": True},
                "roles": ["ROLE-BUYER"], "tenant": "TEN-001",
                "authentication_state": "authenticated", "privilege_version": 1,
            },
            {
                "actor_id": "ACT-002", "actor_type": "support_agent",
                "identity": {"identity_id": "ID-002", "email": "support@example.invalid", "verified": True},
                "roles": ["ROLE-SUPPORT"], "tenant": "TEN-001",
                "authentication_state": "authenticated", "privilege_version": 1,
            },
        ],
        "resources": [
            {
                "resource_id": "RES-001", "resource_type": "order", "owner": "ACT-001",
                "tenant": "TEN-001", "sensitivity": "confidential", "state": "paid",
            },
        ],
        "workflows": [
            {
                "workflow_id": "WFL-ORDER", "name": "order_lifecycle",
                "states": ["created", "paid", "refund_pending", "refunded"],
                "initial_state": "created",
                "transitions": [
                    {"from_state": "created", "to_state": "paid"},
                    {"from_state": "paid", "to_state": "refund_pending", "reversible": False},
                    {"from_state": "refund_pending", "to_state": "refunded"},
                ],
                "instances": [
                    {
                        "instance_id": "WFI-001", "resource_id": "RES-001", "current_state": "paid",
                        "history": [
                            {"from_state": "created", "to_state": "paid", "at": "2026-09-20T08:30:00Z", "actor_id": "ACT-001"},
                        ],
                    },
                ],
            },
        ],
        "sessions": [
            {
                "session_id": "SES-001", "principal": "ACT-002", "created_at": "2026-09-20T08:00:00Z",
                "authenticated_at": "2026-09-20T08:00:05Z", "auth_strength": "password_mfa",
                "valid": True, "revoked": False, "expires_at": "2026-09-20T16:00:00Z",
                "privilege_snapshot": {"roles": ["ROLE-SUPPORT"], "privileges": ["order.read.any"], "privilege_version": 1},
                "flow_id": "FLOW-READ",
            },
        ],
        "tokens": [
            {
                "token_id": "TOK-001", "token_type": "one_time_code", "issuer": "ExampleShop",
                "subject": "ACT-001", "audience": ["ExampleShop"], "scope": ["password.reset"],
                "created_at": "2026-09-20T08:00:00Z", "expires_at": "2026-09-20T09:00:00Z",
                "one_time": True, "used": False, "parent_token": None, "flow_id": "FLOW-RESET",
                "privilege_version": 1,
            },
        ],
        "policies": [
            {
                "policy_id": "POL-ORDER-READ-OWNER", "action": {"operation": "read", "resource_type": "order"},
                "effect": "allow",
                "condition": {
                    "op": "or",
                    "args": [
                        {"op": "eq", "args": [{"op": "ref", "path": "action.actor.actor_id"}, {"op": "ref", "path": "resource.RES-001.owner"}]},
                        {"op": "in", "args": [{"op": "ref", "path": "action.actor.roles"}, {"op": "lit", "value": ["ROLE-SUPPORT"]}]},
                    ],
                },
            },
            {
                "policy_id": "POL-DEFAULT-DENY", "action": {"operation": "read", "resource_type": "order"},
                "effect": "deny", "condition": {"op": "lit", "value": True}, "is_default_rule": True,
            },
        ],
        "invariants": [
            {
                "invariant_id": "INV-OWNERSHIP-001", "category": "ownership",
                "expr": {
                    "op": "eq",
                    "args": [{"op": "ref", "path": "action.actor.actor_id"}, {"op": "ref", "path": "resource.RES-001.owner"}],
                },
                "severity": "high", "applies_to": ["read"],
                "description": "Only the owner may read the order.",
            },
        ],
        "state_history": [
            {
                "snapshot_id": "SNAP-001", "at": "2026-09-20T08:00:00Z", "label": "order created",
                "resource_states": {"RES-001": {"state": "created", "owner": "ACT-001"}},
                "actor_states": {"ACT-001": {"authentication_state": "authenticated", "privilege_version": 1}},
            },
        ],
        "current_state": {
            "snapshot_id": "SNAP-002", "at": "2026-09-20T09:00:00Z", "label": "order paid",
            "resource_states": {"RES-001": {"state": "paid", "owner": "ACT-001"}},
            "actor_states": {"ACT-001": {"authentication_state": "authenticated", "privilege_version": 1}},
            "session_states": {"SES-001": {"valid": True, "revoked": False, "privilege_version": 1}},
            "token_states": {"TOK-001": {"used": False, "valid": True}},
        },
        "evidence": [
            {
                "evidence_id": "EV-001", "type": "ownership_record",
                "asserts_ref": "resource.RES-001.owner", "value": "ACT-001",
                "source": "orders_db", "provenance": "system_of_record", "trust_level": "trusted",
                "freshness": "fresh", "attacker_controllable": False, "visible_in_observation": True,
            },
            {
                "evidence_id": "EV-002", "type": "http_header",
                "asserts_ref": "actor.ACT-001.tenant", "value": "TEN-001",
                "source": "X-Tenant-Id header", "provenance": "client_supplied", "trust_level": "untrusted",
                "freshness": "fresh", "attacker_controllable": True, "visible_in_observation": True,
            },
        ],
        "critical_state_variables": ["resource.RES-001.owner", "actor.ACT-001.privilege_version"],
        "irrelevant_state_variables": ["observation.request.headers.User-Agent"],
        "attack_family": "idor_bola",
        "hypotheses": {
            "attack_opportunities": [
                {
                    "opportunity_id": "OPP-001", "attack_family": "idor_bola",
                    "target_operation": "read", "hypothesized_verdict": "attack",
                    "rationale": "A non-owner reading the order should violate ownership.",
                },
            ],
            "expected_counterfactual_axes": [
                {
                    "axis_id": "AXIS-001", "variable": "resource.RES-001.owner", "kind": "critical",
                    "before": "ACT-001", "after": "ACT-002", "expected_effect": "verdict_flip",
                },
                {
                    "axis_id": "AXIS-002", "variable": "observation.request.headers.User-Agent",
                    "kind": "irrelevant", "before": "curl/8.0", "after": "browser/2.0",
                    "expected_effect": "verdict_invariant",
                },
            ],
        },
        "episode_templates": [
            {
                "template_id": "TPL-001", "decision_event_index": 2,
                "events": [
                    {"event_type": "login", "actor_id": "ACT-002", "t_offset_ms": 0, "causal_tag": "relevant"},
                    {
                        "event_type": "request", "actor_id": "ACT-002", "t_offset_ms": 60000,
                        "causal_tag": "relevant",
                        "binds": {"resource_id": "RES-001", "operation": "read", "flow_id": "FLOW-READ"},
                        "summary": "support agent reads someone else's order",
                    },
                    {
                        "event_type": "sensitive_operation", "actor_id": "ACT-002", "t_offset_ms": 61000,
                        "causal_tag": "relevant",
                        "binds": {"resource_id": "RES-001", "operation": "read", "flow_id": "FLOW-READ"},
                    },
                ],
            },
        ],
    }


def main() -> int:
    spec = minimal_spec()
    stamped = dict(spec)
    stamped["provenance"] = {
        "origin": "step5_seed", "generator_model": "prompt-skeleton", "generator_model_version": "v0.4",
        "prompt_version": "0.4", "prompt_hash": "0" * 64, "generation_timestamp": "2026-09-21T00:00:00Z",
        "raw_generation_id": "skeleton", "decoding_parameters": {}, "validation_outcome": "accepted",
    }
    errors = schema_errors(stamped, "world-spec")
    if errors:
        print("SKELETON INVALID — 拒绝写入 prompt：")
        for error in errors[:20]:
            print("  ", error[:200])
        return 1

    skeleton = json.dumps(spec, ensure_ascii=False, separators=(",", ":"))
    v03 = (ROOT / "generation" / "prompts" / "v0.3.md").read_text(encoding="utf-8")
    header = (
        "# prompt_version: 0.4\n"
        "# output_format: json_array\n"
        "# schema_contract: world-spec.schema.json\n"
        "# default_batch_size: 5\n"
        "# max_output_tokens: 32768\n"
    )
    body = v03.split("\n", 6)[6]
    body = body.replace("## Field contract (v0.3;", "## Field contract (v0.4;", 1)

    # 用 v0.4 骨架替换 v0.3 的骨架块
    start = body.index("## Minimal complete skeleton")
    end = body.index("## Enum quick reference")
    new_skeleton_section = (
        "## Minimal complete skeleton (shape reference ONLY)\n\n"
        "The object below is a **complete, schema-valid world seed**. Copy the *shapes* —\n"
        "never its entities, names, numbers, or scenario. Replace every value with your own\n"
        "business logic; do not rename-and-resubmit this example.\n\n"
        "```json\n" + skeleton + "\n```\n\n"
    )
    body = body[:start] + new_skeleton_section + body[end:]

    additions = """## v0.4 additions (found by the third real batch)

- `application.endpoints` is **required in practice**: every operation named by a policy
  rule, an invariant `applies_to`, or an event `binds.operation` must appear as an
  endpoint `{"path", "method", "operation", "resource_type"?}`. An operation that is not
  declared there is a compile error, not a warning.
- `authentication_state` (actor) enum: unauthenticated, authenticated, mfa_pending,
  mfa_complete, disabled, locked, password_reset_pending.
- `resource_type` enum: file, order, invoice, message, ticket, secret, api_key,
  user_profile, database_record, cloud_resource.
- snapshot `*_states` values are **objects**, never bare strings:
  `actor_states: {"ACT-001": {"authentication_state": "authenticated", "privilege_version": 1}}`,
  `resource_states: {"RES-001": {"state": "paid", "owner": "ACT-001"}}`,
  `session_states: {"SES-001": {"valid": true, "revoked": false, "privilege_version": 1}}`,
  `token_states: {"TOK-001": {"used": false, "valid": true}}`,
  `workflow_states: {"WFI-001": {"current_state": "paid"}}`.
- `session.privilege_snapshot` is an object `{"roles": [...], "privileges": [...], "privilege_version": <int>}`.
- `token.audience` and `token.scope` are **arrays of strings**.

"""
    marker = "## What changed in v0.3 (and why)"
    if marker in body:
        body = body[: body.index(marker)]
    out = header + "\n" + body + additions + "\n## What changed in v0.4 (and why)\n\nSee the section above; v0.1–v0.3 prose is otherwise unchanged.\n"
    (ROOT / "generation" / "prompts" / "v0.4.md").write_text(out, encoding="utf-8")
    print("written v0.4, skeleton bytes:", len(skeleton))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
