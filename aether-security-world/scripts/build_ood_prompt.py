"""生成 Generator-OOD Engineering Pilot 的 clean-room prompt（Phase 2B brief §13）。

这个 prompt 与 production prompt v0.7 **不是同一个 prompt family**——这是刻意为之。
brief §13 要求第二生成器拿到"相同 semantic contract / 相同 ontology / 相同 mechanism
registry / 相同 safety boundaries"，但**不要**给它：

* Step 的历史输出；
* Step-specific 的失败样例（v0.5/v0.6 run 的拒绝画像）；
* Step 的语言模版（v0.6 的规则列表体 + 两个 worked example 的行文）。

所以这里换一套**文档结构**（规格表/表单范式，而不是规则清单范式）、换一套行文寄存器、
换两个全新手写的参考实例。程序派生的契约内容（本体、机制注册表、原型、landmark 词表）
仍然直接由活注册表拼装——那部分不是 Step 的，是项目的。

两个参考实例在生成时会被**真的编译一遍**（schema + §17 + 编译器 + Oracle 复核）。
示例本身编不过就不许发车：否则整个 pilot 测的是"我的示例写错了"，不是生成器的鲁棒性。

用法::

    py -3 scripts/build_ood_prompt.py            # 写 semantic_skeleton/prompts/ood-pilot-v1.md
    py -3 scripts/build_ood_prompt.py --check    # 只校验
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic_skeleton import SemanticSkeletonCompiler, CompileContext, load_skeleton  # noqa: E402
from semantic_skeleton.compiler import CompileContext as _Ctx  # noqa: E402,F811
from semantic_skeleton.skeleton import PRODUCTION_SCHEMA_PATH  # noqa: E402
from semantic_skeleton.validators import verify_compiled_world  # noqa: E402

PROMPT_VERSION = "ood-pilot-v2"
PROMPTS_DIR = ROOT / "semantic_skeleton" / "prompts"

# --------------------------------------------------------------------------- #
# 参考实例：为这个 prompt 家族新写的，不抄 Step 的行文
# --------------------------------------------------------------------------- #
OOD_EXAMPLE_ONE = {
    "domain": "iot_management",
    "scenario_summary": (
        "A device enrolment credential carries an expiry that has already passed by the time a "
        "field technician replays it against the enrolment service, and the service accepts the "
        "replay because the expiry comparison is never re-evaluated."
    ),
    "mechanism_family": "expiry_window_violation",
    "complexity": "medium",
    "actor_types": ["service_account", "tenant_admin"],
    "resource_types": ["device_record"],
    "service_types": ["identity_service"],
    "security_goal": "A device enrolment credential must not be honoured once its expiry has passed.",
    "critical_facts": ["expiry_time", "current_time"],
    "history": [
        "the identity service issues a one-time token for the requested flow",
        "the principal requests the sensitive operation on the target resource",
    ],
    "security_invariants": [
        {"type": "token_not_expired", "rule": "a credential must not be honoured after its expiry"}
    ],
    "failure_mechanism": (
        "The enrolment service trusts the recorded expiry without comparing it to the current "
        "clock, so a credential that is already expired still passes."
    ),
    "required_evidence": ["expiry_time"],
    "optional_evidence": ["current_time"],
    "untrusted_evidence": [],
    "irrelevant_facts": ["request_trace_id", "user_agent"],
    "counterfactuals": [
        {"target_fact": "expiry_time", "change": "extend_into_future",
         "semantic_expectation": "verdict_flip"}
    ],
    "evidence_masking_targets": ["expiry_time"],
    "trust_relationships": [{"kind": "authoritative_for", "about": "expiry_time"}],
    "notes_for_compiler": [],
}

OOD_EXAMPLE_TWO = {
    "domain": "ticketing",
    "scenario_summary": (
        "A support ticket is pushed straight from intake to closure while the mandatory triage "
        "step has never run, because the workflow engine only checks that the target state is "
        "reachable in principle."
    ),
    "mechanism_family": "skipping_required_step",
    "complexity": "simple",
    "actor_types": ["support_agent", "workflow_service"],
    "resource_types": ["ticket"],
    "service_types": ["records_service"],
    "security_goal": "A ticket may only reach closure after the triage step has been completed.",
    "critical_facts": ["workflow_state", "approval_state"],
    "history": [
        "the resource record is created in the system of record",
        "the workflow moves toward the next state in the machine",
        "the principal requests the sensitive operation on the target resource",
    ],
    "security_invariants": [
        {"type": "workflow_state_in", "rule": "the workflow must occupy a declared state"}
    ],
    "failure_mechanism": (
        "The engine advances the ticket to closure without the triage transition ever having "
        "been recorded, so a state that should be unreachable is accepted."
    ),
    "required_evidence": ["workflow_state"],
    "optional_evidence": [],
    "untrusted_evidence": [],
    "irrelevant_facts": ["display_locale", "timestamp_format"],
    "counterfactuals": [
        {"target_fact": "workflow_state", "change": "advance_to_required",
         "semantic_expectation": "verdict_flip"}
    ],
    "evidence_masking_targets": ["workflow_state"],
    "trust_relationships": [{"kind": "authoritative_for", "about": "workflow_state"}],
    "notes_for_compiler": [],
}

OOD_EXAMPLES = (OOD_EXAMPLE_ONE, OOD_EXAMPLE_TWO)


def _registry_blocks() -> dict[str, str]:
    """程序派生的契约内容（与 v0.7 同源，不是 Step 的产物）。"""
    from semantic_skeleton.effective import effective_changes
    from semantic_skeleton.mechanisms import MECHANISMS
    from semantic_skeleton.ontology import groups_summary
    from semantic_skeleton.vocabularies import vocabulary_summary

    ontology = "\n".join(
        f"- {group}: {', '.join(names)}" for group, names in groups_summary().items()
    )
    vocabulary = "\n".join(
        f"- {key}: {', '.join(values)}" for key, values in vocabulary_summary().items()
    )
    mechanisms: list[str] = []
    for item in sorted(MECHANISMS, key=lambda entry: entry.family):
        invariants = ", ".join(spec.archetype for spec in item.invariants)
        effective = effective_changes(item.family)
        changes = "; ".join(
            f"{fact}→[{', '.join(valid)}]" for fact, valid in sorted(effective.items())
        ) or "（无有效改法）"
        needs_untrusted = any(spec.trust in ("untrusted", "derived") for spec in item.evidence)
        mechanisms.append(
            f"- `{item.family}` ({item.category}; labels: {', '.join(item.coverage_labels)}) "
            f"— {item.summary} REQUIRED FACTS: {', '.join(item.required_facts)}. "
            f"REQUIRED LANDMARKS (in order): {', '.join(item.required_landmarks)}. "
            f"INVARIANTS: {invariants}. EFFECTIVE COUNTERFACTUALS: {changes}."
            + (" REQUIRES untrusted_evidence." if needs_untrusted else "")
        )
    from semantic_skeleton.compiler.archetypes import archetype_keys

    return {
        "ontology": ontology,
        "vocabulary": vocabulary,
        "mechanisms": "\n".join(mechanisms),
        "archetypes": ", ".join(archetype_keys()),
    }


def build_prompt() -> str:
    blocks = _registry_blocks()
    return f"""# Aether Security World — OOD pilot specification sheet

You are filling in a **structured security-test specification**. Each specification describes
one security-relevant situation: which facts decide the outcome, how the situation unfolds,
which property must hold, how it is defeated, and which observations are needed to judge it.

A deterministic compiler turns your specification into a complete executable world. You never
write the executable world itself: identifiers, canonical fact paths, policies, state
snapshots, evidence identifiers, verdicts, labels and hashes are all derived by code.

## Response format

Strict JSONL: one specification object per line, no fences, no prose, no commentary, no
trailing commas. Emit exactly the number of objects requested at the end of this sheet.

## Field contract

| # | field | type | constraint |
| --- | --- | --- | --- |
| 1 | `domain` | string | exactly one of: e-commerce, cloud_storage, saas, school_system, finance_workflow, ticketing, logistics, healthcare_workflow, hr_system, devops_platform, code_hosting, crm, iam_system, iot_management, industrial_management, api_marketplace, content_platform, messaging, project_management, subscription_system |
| 2 | `scenario_summary` | string | 10–600 chars, business framing only |
| 3 | `mechanism_family` | string | a key from MECHANISM REGISTRY below |
| 4 | `complexity` | enum | simple / medium / complex / very_complex |
| 5 | `actor_types` | string[] | 1–6 unique names from ACTOR TYPES |
| 6 | `resource_types` | string[] | 1–6 unique names from RESOURCE TYPES |
| 7 | `service_types` | string[] | 1–6 unique names from SERVICE TYPES |
| 8 | `security_goal` | string | 10–600 chars |
| 9 | `critical_facts` | string[] | 1–24 unique semantic fact names; must cover the mechanism's REQUIRED FACTS; must not overlap `irrelevant_facts` |
| 10 | `history` | string[] | 2–14 entries, 10–300 chars each, in order, containing the mechanism's REQUIRED LANDMARKS |
| 11 | `security_invariants` | object[] | 1–6 × {{`type`: archetype key from INVARIANT ARCHETYPES, `rule`: 8–400 chars}} |
| 12 | `failure_mechanism` | string | 10–600 chars, how the property is defeated, no tutorial |
| 13 | `required_evidence` | string[] | 1–16 unique semantic fact names |
| 14 | `optional_evidence` | string[] | 0–16 unique semantic fact names |
| 15 | `untrusted_evidence` | string[] | 0–16 unique semantic fact names |
| 16 | `irrelevant_facts` | string[] | 2–12 unique observation-surface facts only |
| 17 | `counterfactuals` | object[] | 1–8 × {{`target_fact`, `change`, `semantic_expectation`}} |
| 18 | `evidence_masking_targets` | string[] | 1–12 unique semantic fact names |
| 19 | `trust_relationships` | object[] | 1–8 × {{`kind`, `about`}} |
| 20 | `notes_for_compiler` | string[] | 0–8 entries, recorded and never read |
| 21 | `new_semantic_fact_candidates` | object[] | 0–6 × {{`name`, `meaning`, `why_required`}}; quarantines the specification, use only when unavoidable |

`semantic_expectation` ∈ {{violation_removed, violation_created, verdict_flip,
verdict_invariant, observable_downgrade}}. It is a **falsifiable prior**: an oracle re-derives
the real classification from the compiled world and a specification that contradicts it is
rejected. Never treat it as the answer.

## Must not appear anywhere in your output

- any identifier shape: `ACT-…`, `RES-…`, `SES-…`, `TOK-…`, `WFI-…`, `WFL-…`, `CF-…`, `EV-…`,
  `POL-…`, `INV-…`, `SNAP-…`, `TPL-…`, `TEN-…`, `SVC-…`, `CACHE-…`, `CRED-…`, `TB-…`, `ROLE-…`
- any 64-character hexadecimal string
- any canonical fact path (`actor.X.tenant`, `resource.X.owner`, …); use the semantic fact
  names from SEMANTIC FACT ONTOLOGY
- any verdict, attack-family or split vocabulary outside `semantic_expectation`
- the `mechanism_family` name, the attack family, or any verdict word inside
  `scenario_summary`, `history`, `security_invariants[].rule` or `failure_mechanism`
- any id field of your own invention (no `skeleton_id`, no `provider_claimed_id`, no handles)

## Additional constraints

- `mechanism_family` must be a registry key; an unknown key is rejected, not guessed.
- `irrelevant_facts` may only use observation-surface facts.
- At most one counterfactual per resolved fact path.
- Include sessions / tokens / caches / trust boundaries only when the mechanism needs them.
- Every specification must be independently formalisable on its own.

## SEMANTIC FACT ONTOLOGY (the only variable names available)

{blocks['ontology']}

## TYPE VOCABULARIES

{blocks['vocabulary']}

## MECHANISM REGISTRY

{blocks['mechanisms']}

## INVARIANT ARCHETYPES

{blocks['archetypes']}

## EVENT VOCABULARY (landmarks and how they read in prose)

- `login` — e.g. "the user authenticates against the identity service and a session is established"
- `mfa_challenge` — e.g. "the identity service issues an mfa challenge to the user"
- `token_issued` — e.g. "the identity service issues a one-time token for the requested flow"
- `token_used` — e.g. "the client presents the token and the first use consumes the code"
- `token_revoked` — e.g. "the identity service revokes the token"
- `role_changed` — e.g. "the platform admin grants a role and bumps the privilege version"
- `permission_changed` — e.g. "the policy is updated and the new state is committed"
- `password_reset` — e.g. "the user resets the password and the credential is rotated"
- `account_disabled` — e.g. "the platform disables the account"
- `account_enabled` — e.g. "the platform re-enables the account"
- `session_revoked` — e.g. "the platform revokes the session after an abuse report"
- `cache_populated` — e.g. "the downstream service populates a cache entry from the authoritative record"
- `cache_invalidated` — e.g. "the cache entry is invalidated after the state change"
- `workflow_transition` — e.g. "the workflow moves toward the next state in the machine"
- `resource_created` — e.g. "the resource record is created in the system of record"
- `resource_updated` — e.g. "the resource record is updated by its owner"
- `privilege_downgraded` — e.g. "the platform downgrades the privileges of the principal"
- `sensitive_operation` — e.g. "the principal requests the sensitive operation on the target resource"

## Two filled-in reference specifications (structure only; do not reuse their business)

{json.dumps(OOD_EXAMPLE_ONE, ensure_ascii=False)}
{json.dumps(OOD_EXAMPLE_TWO, ensure_ascii=False)}
"""


def _examples_compile() -> None:
    """参考实例必须真的能编过：否则 pilot 测的是我的示例写错了。"""
    from semantic_skeleton.compiler import SkeletonCompileError
    from semantic_skeleton.identity import canonical_skeleton_id

    compiler = SemanticSkeletonCompiler()
    for index, example in enumerate(OOD_EXAMPLES, start=1):
        document = dict(example)
        try:
            load_skeleton(document, schema_path=PRODUCTION_SCHEMA_PATH)
        except Exception as exc:  # noqa: BLE001
            raise SystemExit(f"OOD 参考实例 {index} 过不了 schema/§17: {exc}") from exc
        try:
            result = compiler.compile_with_plan(
                document,
                context=_Ctx(canonical_skeleton_id=canonical_skeleton_id(document)),
            )
        except SkeletonCompileError as exc:
            raise SystemExit(f"OOD 参考实例 {index} 编译失败: {exc.code} {exc.failure.detail}") from exc
        report = verify_compiled_world(
            result.spec, skeleton=document, plan=result.plan,
            config_path=ROOT / "configs" / "phase2a.json",
        )
        if not report.compiled:
            raise SystemExit(
                f"OOD 参考实例 {index} Oracle 复核失败: {report.error_code} {report.error_detail}"
            )
        if report.contradictions:
            raise SystemExit(f"OOD 参考实例 {index} 先验矛盾: {report.contradictions}")
        print(f"OOD 参考实例 {index}: compile OK, oracle OK, episodes={report.episodes}")


def main() -> int:
    parser = argparse.ArgumentParser(description="生成 Generator-OOD pilot 的 clean-room prompt")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    text = build_prompt()
    payload = text.encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()
    target = PROMPTS_DIR / f"{PROMPT_VERSION}.md"
    if args.check:
        existing = target.read_bytes() if target.is_file() else b""
        if existing != payload:
            print(f"OOD PROMPT DRIFT: {target} 与现状不一致（重跑 build_ood_prompt.py）")
            return 1
        _examples_compile()
        print(f"ood prompt 一致（sha256 {digest[:16]}…），参考实例编译通过")
        return 0
    _examples_compile()
    target.write_bytes(payload)
    meta = {
        "prompt_version": PROMPT_VERSION,
        "prompt_sha256": digest,
        "family": "clean-room specification-sheet family (NOT the v0.6/v0.7 rules-list family)",
        "why": "Phase 2B brief §13: the OOD generator gets the same contract but none of Step's "
               "historical outputs, failure examples or language templates",
        "examples": "hand-written for this family and compile-verified by the builder",
    }
    (PROMPTS_DIR / f"{PROMPT_VERSION}.json").write_bytes(
        (json.dumps(meta, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    )
    print(f"wrote {target.relative_to(ROOT)} ({len(payload)} bytes, sha256 {digest})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
