"""生成 Phase 2A 的 generator prompt（brief §29：prompt 要大幅缩短）。

prompt 不是手写的：它由**活的注册表**拼装，因此 schema / 本体 / 机制族 / 原型 /
landmark 词表任何时候改了，prompt 都会跟着变——手写副本会漂移，而漂移的 prompt 正是
Phase 1 合同迭代 12 轮的根源。

用法::

    py -3 scripts/build_skeleton_prompt.py            # 写 semantic_skeleton/prompts/v0.1.md
    py -3 scripts/build_skeleton_prompt.py --check    # 只校验不写（CI 用）
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic_skeleton.compiler.archetypes import archetype_keys  # noqa: E402
from semantic_skeleton.mechanisms import MECHANISMS, mechanism_families  # noqa: E402
from semantic_skeleton.ontology import groups_summary  # noqa: E402
from semantic_skeleton.vocabularies import vocabulary_summary  # noqa: E402

PROMPT_VERSION = "0.6"
PROMPTS_DIR = ROOT / "semantic_skeleton" / "prompts"

#: landmark → 规范措辞（与 compiler.classify_history_line 的关键词表同源）。
LANDMARK_PHRASES: dict[str, str] = {
    "login": "the user authenticates against the identity service and a session is established",
    "mfa_challenge": "the identity service issues an mfa challenge to the user",
    "token_issued": "the identity service issues a one-time token for the requested flow",
    "token_used": "the client presents the token and the first use consumes the code",
    "token_revoked": "the identity service revokes the token",
    "role_changed": "the platform admin grants a role and bumps the privilege version",
    "permission_changed": "the policy is updated and the new state is committed",
    "password_reset": "the user resets the password and the credential is rotated",
    "account_disabled": "the platform disables the account",
    "account_enabled": "the platform re-enables the account",
    "session_revoked": "the platform revokes the session after an abuse report",
    "cache_populated": "the downstream service populates a cache entry from the authoritative record",
    "cache_invalidated": "the cache entry is invalidated after the state change",
    "workflow_transition": "the workflow moves toward the next state in the machine",
    "resource_created": "the resource record is created in the system of record",
    "resource_updated": "the resource record is updated by its owner",
    "privilege_downgraded": "the platform downgrades the privileges of the principal",
    "sensitive_operation": "the principal requests the sensitive operation on the target resource",
}

EXAMPLE_ONE = {
    "skeleton_id": "SK-EXAMPLE-001",
    "domain": "saas",
    "scenario_summary": (
        "A user changes active tenant while a downstream billing service retains a stale "
        "authorization context, so the billing decision is evaluated against the previous tenant."
    ),
    "mechanism_family": "stale_tenant_context",
    "complexity": "medium",
    "actor_types": ["ordinary_user", "api_gateway", "billing_service"],
    "resource_types": ["billing_record", "tenant_context"],
    "service_types": ["identity_service", "billing_service"],
    "security_goal": (
        "A billing resource may only be accessed under the caller's current authenticated tenant context."
    ),
    "critical_facts": ["authenticated_tenant", "cached_tenant", "resource_tenant"],
    "history": [
        "the user authenticates against the identity service in the previous tenant",
        "the user switches active context to the current tenant",
        "the identity layer commits the current tenant as active",
        "the billing service still holds the previous tenant-context cache",
        "the principal requests the sensitive operation on the target resource",
    ],
    "security_invariants": [
        {
            "type": "tenant_isolation",
            "rule": "the tenant used for authorization must equal the caller's current authenticated tenant",
        }
    ],
    "failure_mechanism": (
        "Billing authorization consults a cached tenant context that predates the tenant switch, "
        "so the decision is evaluated against the previous tenant."
    ),
    "required_evidence": ["authenticated_tenant", "cached_tenant", "resource_tenant"],
    "optional_evidence": ["current_role"],
    "untrusted_evidence": ["cached_tenant"],
    "irrelevant_facts": ["request_trace_id", "display_locale"],
    "counterfactuals": [
        {
            "target_fact": "cached_tenant",
            "change": "switch_tenant",
            "semantic_expectation": "violation_removed",
        },
        {
            "target_fact": "authenticated_tenant",
            "change": "switch_tenant",
            "semantic_expectation": "verdict_flip",
        },
    ],
    "evidence_masking_targets": ["cached_tenant", "resource_tenant"],
    "trust_relationships": [
        {"kind": "authoritative_for", "about": "authenticated_tenant"},
        {"kind": "derived_and_freshness_sensitive", "about": "cached_tenant"},
    ],
    "notes_for_compiler": [],
}

EXAMPLE_TWO = {
    "skeleton_id": "SK-EXAMPLE-002",
    "domain": "devops_platform",
    "scenario_summary": (
        "A one-time deployment code is consumed by the first release attempt and then replayed "
        "by a retry that the gateway still accepts."
    ),
    "mechanism_family": "one_time_token_reuse",
    "complexity": "simple",
    "actor_types": ["service_account", "api_gateway"],
    "resource_types": ["cluster_config"],
    "service_types": ["authorization_service"],
    "security_goal": "A one-time deployment code may be redeemed at most once.",
    "critical_facts": ["token_used", "token_one_time"],
    "history": [
        "the identity service issues a one-time token for the requested flow",
        "the client presents the token and the first use consumes the code",
        "the principal requests the sensitive operation on the target resource",
    ],
    "security_invariants": [
        {
            "type": "one_time_token",
            "rule": "a one-time token must not have been used before",
        }
    ],
    "failure_mechanism": (
        "The retry replays a code that the first attempt already consumed, and the gateway "
        "accepts it because the used flag is never re-checked."
    ),
    "required_evidence": ["token_used"],
    "optional_evidence": [],
    "untrusted_evidence": [],
    "irrelevant_facts": ["user_agent", "rendering_trace_id"],
    "counterfactuals": [
        {
            "target_fact": "token_used",
            "change": "unconsume",
            "semantic_expectation": "violation_removed",
        }
    ],
    "evidence_masking_targets": ["token_used"],
    "trust_relationships": [
        {"kind": "authoritative_for", "about": "token_used"}
    ],
    "notes_for_compiler": [],
}


def _ontology_block() -> str:
    lines: list[str] = []
    for group, names in groups_summary().items():
        lines.append(f"- {group}: {', '.join(names)}")
    return "\n".join(lines)


def _mechanism_block() -> str:
    from semantic_skeleton.effective import effective_changes

    lines: list[str] = []
    for item in sorted(MECHANISMS, key=lambda entry: entry.family):
        invariants = ", ".join(spec.archetype for spec in item.invariants)
        # 只列**有效改法**：编译器按该机制的基准状态算过哪些 (fact, change) 真的改变取值。
        # 列全会把生成器引向空干预——空干预会被拒，纯烧 token。
        effective = effective_changes(item.family)
        changes = "; ".join(
            f"{fact}→[{', '.join(valid)}]" for fact, valid in sorted(effective.items())
        ) or "（无有效改法）"
        needs_untrusted = any(
            spec.trust in ("untrusted", "derived") for spec in item.evidence
        )
        lines.append(
            f"- `{item.family}` ({item.category}; labels: {', '.join(item.coverage_labels)}) "
            f"— {item.summary} REQUIRED FACTS: {', '.join(item.required_facts)}. "
            f"REQUIRED LANDMARKS (in order): {', '.join(item.required_landmarks)}. "
            f"INVARIANTS: {invariants}. EFFECTIVE COUNTERFACTUALS: {changes}."
            + (" REQUIRES untrusted_evidence (its decisive evidence comes from an "
               "untrusted/derived source, so `untrusted_evidence` must be non-empty)."
               if needs_untrusted else "")
        )
    return "\n".join(lines)


def _vocabulary_block() -> str:
    summary = vocabulary_summary()
    return "\n".join(
        f"- {key}: {', '.join(values)}" for key, values in summary.items()
    )


def _landmark_block() -> str:
    return "\n".join(
        f"- `{name}` — e.g. \"{phrase}\"" for name, phrase in LANDMARK_PHRASES.items()
    )


def build_prompt() -> str:
    schema = json.loads(
        (ROOT / "semantic_skeleton" / "schemas" / "semantic-skeleton.schema.json").read_text(
            encoding="utf-8"
        )
    )
    required = ", ".join(schema["required"])
    return f"""# Aether Security World — Phase 2A semantic skeleton generator

You write **security semantics only**. You do NOT write the runtime world: entity IDs,
canonical fact paths, policy ASTs, resource_states, evidence IDs, verdicts, attack labels,
split assignments and hashes are all produced by a deterministic compiler. Your job is to
invent a NEW security mechanism, its history, its invariants, its evidence needs and its
counterfactuals — in as few tokens as possible.

## Output frame (strict)

One JSON object per line (JSONL). No markdown fences, no prose, no reasoning, no
explanation, no trailing commas. Each line must be a complete semantic skeleton with
exactly these keys: {required}.

## Hard rules

1. **Never emit an identifier.** No `ACT-…`, `RES-…`, `SES-…`, `TOK-…`, `WF-…`, `CF-…`,
   `EV-…`, `POL-…`, `TEN-…`, `SVC-…`, `CACHE-…`, or any 64-hex hash. The compiler derives
   every ID from a stable hash of your `skeleton_id`.
2. **Never emit a canonical fact path** (`actor.X.tenant`, `resource.X.owner`, …). Use the
   semantic fact names below; the FactPathCompiler resolves them.
3. **Never emit a verdict, an attack label, or a split.** `semantic_expectation` is the ONLY
   allowed expectation field, and it is a falsifiable prior — the oracle re-derives the
   final classification and rejects you if you contradict it.
4. **`security_invariants[].rule` is documentation.** Only `type` is compiled. Pick `type`
   from the archetype list; do not invent one.
5. **`notes_for_compiler` is recorded, never read.** Nothing you write there can change the
   compiled world.
6. **`mechanism_family` must be one of the registry keys below.** An unknown family is
   rejected, not guessed.
6a. **`domain` must be one of these twenty values, spelled exactly**: e-commerce,
   cloud_storage, saas, school_system, finance_workflow, ticketing, logistics,
   healthcare_workflow, hr_system, devops_platform, code_hosting, crm, iam_system,
   iot_management, industrial_management, api_marketplace, content_platform, messaging,
   project_management, subscription_system. Do NOT invent "fintech", "healthcare",
   "banking" or any other synonym — a value outside the list is rejected.
6c. **Never write the `mechanism_family` name, the attack family, or any verdict word into
   `scenario_summary`, `history`, `security_invariants[].rule` or `failure_mechanism`.**
   Those strings reach the model-visible observation, and the mechanism name encodes the
   attack family — writing it there is a label leak (G12 hard gate). Describe the business
   situation instead; the compiler also strips these tokens as a backstop.
6b. **Use ONLY the change kinds listed under `EFFECTIVE COUNTERFACTUALS` for that
   mechanism.** The compiler has already computed which (fact, change) pairs actually alter
   the value in that mechanism's base world; the reverse direction would leave the value
   unchanged and is rejected (`COUNTERFACTUAL_NOOP`), because an intervention that changes
   nothing makes the verdict-invariance test vacuous.
7. **`critical_facts` must cover the mechanism's REQUIRED FACTS**, and must not overlap
   `irrelevant_facts`.
8. **`irrelevant_facts` must be observation-surface facts** (`request_trace_id`,
   `user_agent`, `display_locale`, `rendering_trace_id`, `timestamp_format`,
   `display_name_case`, `request_header_order`) — never world state.
9. **`history` must contain the mechanism's landmarks, in order**, using the canonical
   phrasings below. 2–14 lines, each 10–300 characters.
10. **`counterfactuals[].change` must be one of the change kinds listed for that fact.**
10a. **At most one counterfactual per resolved fact path.** Two semantic facts can map to the
   same compiled path (for example `workflow_state`, `approval_state` and
   `transition_target_state` all land on the workflow instance's `current_state`); declaring
   counterfactuals for two of them is rejected as `COUNTERFACTUAL_UNRESOLVABLE`. Pick one.
10b. **`history` must contain the mechanism's REQUIRED LANDMARKS in order** (each mechanism
   lists them). Use the canonical phrasings below, or a close paraphrase — a semantically
   equivalent event satisfies a required landmark.

## Semantic fact ontology (the ONLY variable names you may use)

{_ontology_block()}

Surface facts (`request_trace_id`, `user_agent`, `display_locale`, `rendering_trace_id`,
`timestamp_format`, `display_name_case`, `request_header_order`) describe the observation
surface and may only appear in `irrelevant_facts`.

## Semantic type vocabularies

`actor_types` are **principals that act** (users, admins, service accounts, gateways);
`resource_types` are the things being acted on; `service_types` are the services that own
state. A name that appears in one list may also appear in another when it genuinely plays
both roles (e.g. `records_service`).

{_vocabulary_block()}

## Mechanism families

{_mechanism_block()}

## Invariant archetypes

{', '.join(archetype_keys())}

## History landmarks and their canonical phrasings

{_landmark_block()}

## Worked examples (do NOT imitate their business)

{json.dumps(EXAMPLE_ONE, ensure_ascii=False)}
{json.dumps(EXAMPLE_TWO, ensure_ascii=False)}

Now emit the requested skeletons as JSONL.
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="生成 Phase 2A generator prompt")
    parser.add_argument("--check", action="store_true", help="只校验，不写文件")
    args = parser.parse_args()
    text = build_prompt()
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    target = PROMPTS_DIR / f"v{PROMPT_VERSION}.md"
    if args.check:
        existing = target.read_text(encoding="utf-8") if target.is_file() else ""
        if existing != text:
            print(f"PROMPT DRIFT: {target} 与注册表现状不一致（重跑 build_skeleton_prompt.py）")
            return 1
        print(f"prompt v{PROMPT_VERSION} 一致（sha256 {digest[:16]}…）")
        return 0
    PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    meta = {
        "prompt_version": PROMPT_VERSION,
        "prompt_sha256": digest,
        "output_format": "jsonl",
        "mechanism_families": len(mechanism_families()),
        "semantic_facts": len(groups_summary()) and sum(len(v) for v in groups_summary().values()),
    }
    (PROMPTS_DIR / f"v{PROMPT_VERSION}.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"wrote {target} ({len(text)} chars, sha256 {digest})")
    print(json.dumps(meta, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
