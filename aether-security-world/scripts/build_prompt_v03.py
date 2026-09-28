"""构建 prompt v0.3 用的最小合法 world-spec 骨架，并写 generation/prompts/v0.3.md。

v0.2 把顶层形状修好了，但真实 batch 仍暴露契约盲区：event_type/causal_tag 枚举、
workflow transitions/instances 形状、sensitivity/actor_type 枚举、policy condition
写法。逐条枚举治丝不治本，v0.3 嵌入一个**最小但完整合法**的骨架（程序构造、
schema 校验通过后才允许写入），模型照形状填业务内容。v0.2 的字段契约与 v0.1 的
业务逻辑段落全部保留。
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
        "application": {"name": "ExampleShop", "description": "A tiny example shop used only to show shapes."},
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
                    {"instance_id": "WFI-001", "resource_id": "RES-001", "current_state": "paid",
                     "history": [{"from_state": "created", "to_state": "paid", "at": "2026-09-20T08:30:00Z", "actor_id": "ACT-001"}]},
                ],
            },
        ],
        "policies": [
            {
                "policy_id": "POL-ORDER-READ-OWNER", "action": {"operation": "read", "resource_type": "order"},
                "effect": "allow",
                "condition": {"op": "eq", "args": [{"op": "ref", "path": "action.actor.actor_id"}, {"op": "ref", "path": "resource.RES-001.owner"}]},
            },
            {
                "policy_id": "POL-DEFAULT-DENY", "action": {"operation": "read", "resource_type": "order"},
                "effect": "deny", "condition": {"op": "lit", "value": True}, "is_default_rule": True,
            },
        ],
        "invariants": [
            {
                "invariant_id": "INV-OWNERSHIP-001", "category": "ownership",
                "expr": {"op": "eq", "args": [{"op": "ref", "path": "action.actor.actor_id"}, {"op": "ref", "path": "resource.RES-001.owner"}]},
                "severity": "high", "applies_to": ["read"],
                "description": "Only the owner may read the order.",
            },
        ],
        "state_history": [
            {
                "snapshot_id": "SNAP-001", "at": "2026-09-20T08:00:00Z", "label": "order created",
                "resource_states": {"RES-001": {"state": "created", "owner": "ACT-001"}},
            },
        ],
        "current_state": {
            "snapshot_id": "SNAP-002", "at": "2026-09-20T09:00:00Z", "label": "order paid",
            "resource_states": {"RES-001": {"state": "paid", "owner": "ACT-001"}},
            "actor_states": {"ACT-001": {"authentication_state": "authenticated", "privilege_version": 1}},
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
        "origin": "step5_seed", "generator_model": "prompt-skeleton", "generator_model_version": "v0.3",
        "prompt_version": "0.3", "prompt_hash": "0" * 64, "generation_timestamp": "2026-09-21T00:00:00Z",
        "raw_generation_id": "skeleton", "decoding_parameters": {}, "validation_outcome": "accepted",
    }
    errors = schema_errors(stamped, "world-spec")
    if errors:
        print("SKELETON INVALID — 骨架没有过 schema，拒绝写入 prompt：")
        for error in errors[:20]:
            print("  ", error[:200])
        return 1

    skeleton = json.dumps(spec, ensure_ascii=False, separators=(",", ":"))
    v02 = (ROOT / "generation" / "prompts" / "v0.2.md").read_text(encoding="utf-8")
    header = (
        "# prompt_version: 0.3\n"
        "# output_format: json_array\n"
        "# schema_contract: world-spec.schema.json\n"
        "# default_batch_size: 5\n"
        "# max_output_tokens: 32768\n"
    )
    body = v02.split("\n", 6)[6]  # 去掉 v0.2 的 6 行头块（含空行）
    body = body.replace("## Field contract (v0.2;", "## Field contract (v0.3;", 1)

    additions = f"""## Minimal complete skeleton (shape reference ONLY)

The object below is a **complete, schema-valid world seed**. It exists so you can copy
the *shapes* — never its entities, names, numbers, or scenario. Replace every value with
your own business logic; do not rename-and-resubmit this example.

```json
{skeleton}
```

## Enum quick reference (values the model most often invents)

- `event_type`: login, logout, mfa_challenge, resource_created, resource_updated,
  permission_changed, role_changed, token_issued, token_used, token_revoked,
  privilege_downgraded, password_reset, account_disabled, account_enabled,
  session_revoked, workflow_transition, cache_populated, cache_invalidated,
  sensitive_operation, request, other.
- `causal_tag`: relevant | irrelevant.
- `actor_type`: user, administrator, support_agent, merchant, service_account,
  attacker_controlled_account, anonymous_principal, backend_service.
- `authentication_state` (actor): any short string you define, but keep it consistent
  with `auth_strength` on sessions: none, password, password_mfa, passkey,
  hardware_token, service_credential.
- `sensitivity`: public, internal, confidential, restricted.
- `token_type`: access, refresh, id, one_time_code, reset_token, invitation, csrf,
  api_key, session_binding.
- workflow `transitions` items: `{{"from_state", "to_state", "condition"?, "required_privileges"?, "reversible"?}}`
  — there is no `from`/`to`/`operation` key.
- workflow `instances` items: `{{"instance_id" (WFI-), "resource_id" (RES-), "current_state", "history"?}}`
  — there is no `workflow_instance_id` key.
- `*_states` objects inside snapshots map entity id -> **object** (e.g. `{{"state": "paid"}}`),
  never a bare string.
- `acl` items: `{{"grantee", "permissions", "grantee_type"?}}`.

## What changed in v0.3 (and why)

v0.2 fixed the top-level shapes; the second real batch then failed on deeper contract
gaps (event_type/causal_tag enums, workflow transition/instance keys, sensitivity and
actor_type enums, snapshot state-object form). v0.3 adds a minimal complete skeleton
plus the enum quick reference above.

"""

    out = header + "\n" + body.split("## What changed in v0.2 (and why)", 1)[0] + additions + "\n## What changed in v0.3 (and why)\n\nSee the section above; v0.1/v0.2 prose is otherwise unchanged.\n"
    (ROOT / "generation" / "prompts" / "v0.3.md").write_text(out, encoding="utf-8")
    print("written v0.3, skeleton bytes:", len(skeleton))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
