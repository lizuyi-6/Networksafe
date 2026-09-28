"""机制探针骨架（``effective_changes`` 与自检脚本共用同一张表）。

放在包里而不是 ``scripts/``：``semantic_skeleton.effective`` 需要它，而包内代码不应反向
依赖脚本目录。
"""
from __future__ import annotations

from typing import Any

DOMAINS = (
    "e-commerce", "cloud_storage", "saas", "school_system", "finance_workflow", "ticketing",
    "logistics", "healthcare_workflow", "hr_system", "devops_platform", "code_hosting", "crm",
    "iam_system", "iot_management", "industrial_management", "api_marketplace", "content_platform",
    "messaging", "project_management", "subscription_system",
)

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

RESOURCE_TYPES_BY_FAMILY = {
    "multi_tenant": "billing_record",
    "token": "api_key",
    "session": "user_profile",
    "workflow": "ticket",
    "cache_distributed": "permission_cache",
    "trust_boundary": "tenant_context",
    "temporal_history": "database_record",
    "cross_flow_reuse": "order",
    "authorization": "order",
}
SERVICE_TYPES_BY_FAMILY = {
    "multi_tenant": "identity_service",
    "token": "authorization_service",
    "session": "identity_service",
    "workflow": "records_service",
    "cache_distributed": "cache_service",
    "trust_boundary": "identity_service",
    "temporal_history": "records_service",
    "cross_flow_reuse": "identity_service",
    "authorization": "identity_service",
}


def probe_skeleton(family: str, *, index: int = 0) -> dict[str, Any]:
    """按机制族合成一个最小合法语义骨架。"""
    from ..mechanisms import mechanism

    item = mechanism(family)
    if item is None:
        raise KeyError(family)
    evidence_facts = [spec.fact for spec in item.evidence] or list(item.required_facts)
    return {
        "skeleton_id": f"SK-PROBE-{index:03d}",
        "domain": DOMAINS[index % len(DOMAINS)],
        "scenario_summary": (
            f"Probe world for mechanism {family}: {item.summary} "
            "The decisive condition is violated in the base state and restored by the "
            "declared counterfactual."
        ),
        "mechanism_family": family,
        "complexity": "medium",
        "actor_types": ["ordinary_user", "tenant_admin", "api_gateway"],
        "resource_types": [RESOURCE_TYPES_BY_FAMILY.get(item.category, "database_record")],
        "service_types": [SERVICE_TYPES_BY_FAMILY.get(item.category, "identity_service")],
        "security_goal": item.summary,
        "critical_facts": list(item.required_facts),
        "history": [LANDMARK_PHRASES[landmark] for landmark in item.required_landmarks],
        "security_invariants": [
            {"type": spec.archetype, "rule": f"{spec.archetype} must hold for {family}"}
            for spec in item.invariants
        ],
        "failure_mechanism": item.summary,
        "required_evidence": list(dict.fromkeys(evidence_facts)),
        "optional_evidence": [],
        "untrusted_evidence": [
            spec.fact for spec in item.evidence if spec.trust in ("untrusted", "derived")
        ],
        "irrelevant_facts": ["request_trace_id", "display_locale"],
        "counterfactuals": [
            {
                "target_fact": spec.fact,
                "change": spec.changes[0],
                "semantic_expectation": (
                    "verdict_invariant" if spec.changes[0] == "change_cosmetic" else "verdict_flip"
                ),
            }
            for spec in item.counterfactuals
        ],
        "evidence_masking_targets": list(dict.fromkeys(evidence_facts))[:2],
        "trust_relationships": [
            {"kind": "authoritative_for", "about": item.required_facts[0]},
        ],
        "notes_for_compiler": [],
    }


__all__ = ["DOMAINS", "LANDMARK_PHRASES", "probe_skeleton"]
