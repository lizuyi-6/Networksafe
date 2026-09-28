# Aether Security World — OOD pilot specification sheet

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
| 11 | `security_invariants` | object[] | 1–6 × {`type`: archetype key from INVARIANT ARCHETYPES, `rule`: 8–400 chars} |
| 12 | `failure_mechanism` | string | 10–600 chars, how the property is defeated, no tutorial |
| 13 | `required_evidence` | string[] | 1–16 unique semantic fact names |
| 14 | `optional_evidence` | string[] | 0–16 unique semantic fact names |
| 15 | `untrusted_evidence` | string[] | 0–16 unique semantic fact names |
| 16 | `irrelevant_facts` | string[] | 2–12 unique observation-surface facts only |
| 17 | `counterfactuals` | object[] | 1–8 × {`target_fact`, `change`, `semantic_expectation`} |
| 18 | `evidence_masking_targets` | string[] | 1–12 unique semantic fact names |
| 19 | `trust_relationships` | object[] | 1–8 × {`kind`, `about`} |
| 20 | `notes_for_compiler` | string[] | 0–8 entries, recorded and never read |
| 21 | `new_semantic_fact_candidates` | object[] | 0–6 × {`name`, `meaning`, `why_required`}; quarantines the specification, use only when unavoidable |

`semantic_expectation` ∈ {violation_removed, violation_created, verdict_flip,
verdict_invariant, observable_downgrade}. It is a **falsifiable prior**: an oracle re-derives
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

- cache: cache_freshness, cache_source_of_truth, cached_owner, cached_policy_version, cached_privilege_version, cached_role, cached_tenant, cached_tenant_context_version, current_policy_version, current_tenant_context_version, replica_cached_value
- identity: authenticated_principal, authenticated_tenant, authentication_state, credential_status, current_privileges, current_role, identity_verified, peer_principal, privilege_version
- resource: resource_owner, resource_sensitivity, resource_state, resource_tenant, resource_type
- session: mfa_state, session_auth_strength, session_expiry, session_principal, session_privilege_version, session_revoked, session_valid
- surface: display_locale, display_name_case, rendering_trace_id, request_header_order, request_trace_id, timestamp_format, user_agent
- temporal: cache_populated_at, current_time, expiry_time, issue_time, revocation_time
- token: token_audience, token_bound_resource, token_expiry, token_flow, token_lineage, token_lineage_root_flow, token_one_time, token_privilege_version, token_scope, token_subject, token_used
- trust: authority_source, boundary_crossing_requirement, service_consistency, service_trust_boundary, signature_valid, source_trust
- workflow: approval_state, transition_target_state, workflow_instance_id, workflow_state

## TYPE VOCABULARIES

- actor_types: anonymous_principal, api_gateway, attacker_controlled_account, audit_service, authorization_service, billing_service, downstream_worker, gateway_service, identity_service, merchant, metrics_service, notification_service, ordinary_user, platform_admin, records_service, search_service, service_account, storage_service, support_agent, tenant_admin, workflow_service
- resource_types: api_key, billing_record, cloud_resource, cluster_config, database_record, device_record, document, file, invoice, message, order, permission_cache, secret, tenant_context, ticket, user_profile
- service_types: audit_service, authorization_service, billing_service, cache_service, document_service, edge_service, gateway_service, identity_service, llm_service, media_service, message_queue, metrics_service, notification_service, object_store, payment_service, records_service, search_service, signing_service, storage_service, workflow_service

## MECHANISM REGISTRY

- `boundary_crossing_without_required_assertion` (trust_boundary; labels: trust_boundary, session) — 跨信任边界的会话缺少边界声明要求的断言。 REQUIRED FACTS: session_principal, boundary_crossing_requirement, authenticated_principal. REQUIRED LANDMARKS (in order): login, sensitive_operation. INVARIANTS: session_bound_to_principal. EFFECTIVE COUNTERFACTUALS: session_principal→[bind_to_acting_principal].
- `cache_invalidation_failure` (cache_distributed; labels: cache_distributed) — 状态变更后缓存没有被标记失效。 REQUIRED FACTS: cache_freshness, cached_policy_version, current_policy_version. REQUIRED LANDMARKS (in order): cache_populated, permission_changed, sensitive_operation. INVARIANTS: cache_matches_authority. EFFECTIVE COUNTERFACTUALS: cached_policy_version→[align_with_authoritative]; current_policy_version→[align_with_cached_value].
- `cached_authorization_cross_tenant_reuse` (multi_tenant; labels: multi_tenant, cache_distributed) — A 租户的授权结论被缓存后直接复用到 B 租户的同类请求。 REQUIRED FACTS: cached_tenant_context_version, current_tenant_context_version, authenticated_tenant. REQUIRED LANDMARKS (in order): cache_populated, permission_changed, sensitive_operation. INVARIANTS: cache_matches_authority. EFFECTIVE COUNTERFACTUALS: cached_tenant_context_version→[align_with_authoritative]; current_tenant_context_version→[align_with_cached_value].
- `cross_service_tenant_propagation_delay` (multi_tenant; labels: multi_tenant, cache_distributed, trust_boundary) — 租户上下文在服务间最终一致传播，下游读到旧值。 REQUIRED FACTS: authenticated_tenant, cached_tenant, service_consistency. REQUIRED LANDMARKS (in order): login, cache_populated, sensitive_operation. INVARIANTS: tenant_isolation. EFFECTIVE COUNTERFACTUALS: cached_tenant→[switch_tenant].
- `cross_tenant_cache` (multi_tenant; labels: multi_tenant, cache_distributed) — 授权缓存把 A 租户的决策结果复用给了 B 租户的请求。 REQUIRED FACTS: cached_tenant, authenticated_tenant, cached_privilege_version. REQUIRED LANDMARKS (in order): login, cache_populated, sensitive_operation. INVARIANTS: tenant_isolation. EFFECTIVE COUNTERFACTUALS: cached_tenant→[switch_tenant].
- `delegated_tenant_access` (multi_tenant; labels: multi_tenant, token, trust_boundary) — 委派访问令牌的目标租户不是被委派的租户。 REQUIRED FACTS: authenticated_tenant, resource_tenant, token_scope. REQUIRED LANDMARKS (in order): login, token_issued, sensitive_operation. INVARIANTS: token_scope_carries_tenant. EFFECTIVE COUNTERFACTUALS: token_scope→[carry_current_tenant].
- `derived_summary_overrides_system_of_record` (trust_boundary; labels: trust_boundary, cache_distributed) — 派生摘要与系统记录冲突，授权按派生摘要放行。 REQUIRED FACTS: cached_owner, resource_owner, source_trust. REQUIRED LANDMARKS (in order): cache_populated, sensitive_operation. INVARIANTS: cache_matches_authority, decisive_fact_established_by_trusted_evidence. EFFECTIVE COUNTERFACTUALS: cached_owner→[align_with_authoritative]. REQUIRES untrusted_evidence.
- `eventual_consistency_read_before_write_visible` (trust_boundary; labels: trust_boundary, cache_distributed, temporal_history) — 最终一致存储上，读发生在写传播到达之前。 REQUIRED FACTS: cached_owner, replica_cached_value, service_consistency. REQUIRED LANDMARKS (in order): cache_populated, permission_changed, sensitive_operation. INVARIANTS: replicas_agree. EFFECTIVE COUNTERFACTUALS: cached_owner→[align_with_authoritative].
- `expiry_window_violation` (temporal_history; labels: temporal_history, token) — 凭证已过到期时刻仍被接受。 REQUIRED FACTS: expiry_time, current_time. REQUIRED LANDMARKS (in order): token_issued, sensitive_operation. INVARIANTS: token_not_expired. EFFECTIVE COUNTERFACTUALS: expiry_time→[extend_into_future, move_into_past].
- `horizontal_peer_access` (authorization; labels: authorization, multi_tenant) — 同租户内的平级主体读取他人资源：属主不同但租户相同。 REQUIRED FACTS: authenticated_principal, peer_principal, resource_owner, authenticated_tenant. REQUIRED LANDMARKS (in order): login, sensitive_operation. INVARIANTS: ownership. EFFECTIVE COUNTERFACTUALS: resource_owner→[reassign_to_peer].
- `invalid_state_transition` (workflow; labels: workflow) — 状态机里没有声明这条转移。 REQUIRED FACTS: workflow_state, transition_target_state. REQUIRED LANDMARKS (in order): resource_created, workflow_transition, sensitive_operation. INVARIANTS: workflow_transition_declared. EFFECTIVE COUNTERFACTUALS: workflow_state→[rewind_to_declared_predecessor, advance_to_required].
- `irreversible_state_reversal` (workflow; labels: workflow, temporal_history) — 把已标记为不可逆的状态回退。 REQUIRED FACTS: workflow_state, resource_state. REQUIRED LANDMARKS (in order): resource_created, workflow_transition, sensitive_operation. INVARIANTS: workflow_state_in. EFFECTIVE COUNTERFACTUALS: workflow_state→[advance_to_required].
- `one_time_token_reuse` (token; labels: token, workflow) — 一次性凭证已被消费，重放它再次通过校验。 REQUIRED FACTS: token_used, token_one_time. REQUIRED LANDMARKS (in order): token_issued, token_used, sensitive_operation. INVARIANTS: one_time_token_unused. EFFECTIVE COUNTERFACTUALS: token_used→[unconsume].
- `owner_cache_lag` (authorization; labels: authorization, cache_distributed) — 属主在系统里已变更，授权缓存仍持旧属主，按旧属主放行。 REQUIRED FACTS: cached_owner, resource_owner. REQUIRED LANDMARKS (in order): cache_populated, permission_changed, sensitive_operation. INVARIANTS: cache_matches_authority. EFFECTIVE COUNTERFACTUALS: cached_owner→[align_with_authoritative].
- `ownership_boundary_crossing` (authorization; labels: authorization) — 调用方不是资源属主却读到了它：属主比较是唯一的决定性条件。 REQUIRED FACTS: authenticated_principal, resource_owner. REQUIRED LANDMARKS (in order): login, sensitive_operation. INVARIANTS: ownership. EFFECTIVE COUNTERFACTUALS: resource_owner→[reassign_to_peer].
- `permission_cache_staleness` (cache_distributed; labels: cache_distributed, authorization) — 权限缓存落后于权威权限版本，授权按缓存放行。 REQUIRED FACTS: cached_privilege_version, privilege_version. REQUIRED LANDMARKS (in order): cache_populated, permission_changed, sensitive_operation. INVARIANTS: cache_matches_authority. EFFECTIVE COUNTERFACTUALS: cached_privilege_version→[align_with_authoritative].
- `post_disable_session` (session; labels: session) — 账号被停用后会话仍有效。 REQUIRED FACTS: session_valid, authentication_state. REQUIRED LANDMARKS (in order): login, account_disabled, sensitive_operation. INVARIANTS: session_active, authentication_state_required. EFFECTIVE COUNTERFACTUALS: authentication_state→[restore_principal]; session_valid→[invalidate].
- `post_password_reset_session` (session; labels: session, temporal_history) — 密码重置后旧会话未被吊销，仍可继续操作。 REQUIRED FACTS: session_valid, credential_status. REQUIRED LANDMARKS (in order): login, password_reset, sensitive_operation. INVARIANTS: session_active, credential_active. EFFECTIVE COUNTERFACTUALS: session_valid→[invalidate].
- `privilege_version_drift` (authorization; labels: authorization, temporal_history) — 权限在主体侧已升级，但会话仍持旧版本快照，授权按旧版本放行。 REQUIRED FACTS: privilege_version, session_privilege_version. REQUIRED LANDMARKS (in order): login, role_changed, sensitive_operation. INVARIANTS: session_privilege_version_matches_actor. EFFECTIVE COUNTERFACTUALS: privilege_version→[align_with_session_snapshot]; session_privilege_version→[align_with_authoritative].
- `race_sensitive_state` (temporal_history; labels: temporal_history, workflow, token) — 两个动作竞争同一个消耗性状态，校验与使用之间状态被改写。 REQUIRED FACTS: token_used, workflow_state. REQUIRED LANDMARKS (in order): token_issued, token_used, workflow_transition, sensitive_operation. INVARIANTS: one_time_token_unused. EFFECTIVE COUNTERFACTUALS: token_used→[unconsume].
- `repeated_operation` (workflow; labels: workflow, token) — 同一消耗性凭证被用于第二次同类操作。 REQUIRED FACTS: token_used, workflow_state. REQUIRED LANDMARKS (in order): token_issued, token_used, workflow_transition, sensitive_operation. INVARIANTS: one_time_token_unused. EFFECTIVE COUNTERFACTUALS: token_used→[unconsume].
- `replica_divergence` (cache_distributed; labels: cache_distributed, trust_boundary) — 两个副本对同一份快照给出不同答案。 REQUIRED FACTS: cached_owner, replica_cached_value. REQUIRED LANDMARKS (in order): cache_populated, sensitive_operation. INVARIANTS: replicas_agree. EFFECTIVE COUNTERFACTUALS: cached_owner→[align_with_authoritative].
- `resource_tenant_mismatch` (multi_tenant; labels: multi_tenant) — 资源所属租户与主体租户不同（最典型的跨租户读取）。 REQUIRED FACTS: authenticated_tenant, resource_tenant. REQUIRED LANDMARKS (in order): login, sensitive_operation. INVARIANTS: tenant_isolation. EFFECTIVE COUNTERFACTUALS: authenticated_tenant→[switch_tenant]; resource_tenant→[switch_tenant].
- `revocation_after_issue` (temporal_history; labels: temporal_history, session) — 撤销时刻晚于签发时刻但早于使用时刻，旧凭证仍在窗口内被用。 REQUIRED FACTS: revocation_time, issue_time, session_revoked. REQUIRED LANDMARKS (in order): token_issued, session_revoked, sensitive_operation. INVARIANTS: revocation_before_use. EFFECTIVE COUNTERFACTUALS: session_revoked→[unrevoke].
- `revocation_not_propagated` (cache_distributed; labels: cache_distributed, session) — 撤销已在权威侧生效，副本缓存仍认为有效。 REQUIRED FACTS: cache_freshness, session_revoked. REQUIRED LANDMARKS (in order): cache_populated, session_revoked, sensitive_operation. INVARIANTS: cache_not_stale_when_revoked. EFFECTIVE COUNTERFACTUALS: cache_freshness→[mark_stale].
- `revoked_session_reuse` (session; labels: session) — 会话已被撤销，攻击方仍拿它执行敏感操作。 REQUIRED FACTS: session_revoked, authenticated_principal. REQUIRED LANDMARKS (in order): login, session_revoked, sensitive_operation. INVARIANTS: session_not_revoked. EFFECTIVE COUNTERFACTUALS: session_revoked→[unrevoke].
- `service_account_tenant_crossover` (multi_tenant; labels: multi_tenant, trust_boundary) — 服务账号的租户上下文越界到另一个租户的资源。 REQUIRED FACTS: authenticated_tenant, resource_tenant. REQUIRED LANDMARKS (in order): login, sensitive_operation. INVARIANTS: tenant_isolation. EFFECTIVE COUNTERFACTUALS: authenticated_tenant→[switch_tenant]; resource_tenant→[switch_tenant].
- `session_principal_swap` (session; labels: session, multi_tenant) — 会话绑定的主体与当前行动主体不同（会话嫁接）。 REQUIRED FACTS: session_principal, authenticated_principal. REQUIRED LANDMARKS (in order): login, sensitive_operation. INVARIANTS: session_bound_to_principal. EFFECTIVE COUNTERFACTUALS: session_principal→[bind_to_acting_principal].
- `session_privilege_snapshot_stale` (session; labels: session, temporal_history) — 会话快照的权限版本落后于主体当前版本，授权按旧快照放行。 REQUIRED FACTS: session_privilege_version, privilege_version. REQUIRED LANDMARKS (in order): login, role_changed, sensitive_operation. INVARIANTS: session_privilege_version_matches_actor. EFFECTIVE COUNTERFACTUALS: session_privilege_version→[align_with_authoritative].
- `session_reused_across_flow` (cross_flow_reuse; labels: cross_flow_reuse, session) — 会话在另一个 flow 里被复用，绕过该 flow 的既定顺序。 REQUIRED FACTS: session_principal, token_flow. REQUIRED LANDMARKS (in order): login, token_issued, sensitive_operation. INVARIANTS: session_bound_to_principal, token_same_flow. EFFECTIVE COUNTERFACTUALS: token_flow→[align_with_current_flow].
- `skipping_required_step` (workflow; labels: workflow) — 跳过了状态机里必经的提交/审批环节。 REQUIRED FACTS: workflow_state, approval_state. REQUIRED LANDMARKS (in order): resource_created, workflow_transition, sensitive_operation. INVARIANTS: workflow_state_in. EFFECTIVE COUNTERFACTUALS: workflow_state→[advance_to_required].
- `stale_snapshot_read` (temporal_history; labels: temporal_history, cache_distributed) — 读取发生在缓存填充之后、权威状态变更之前，读到过期快照。 REQUIRED FACTS: cache_populated_at, cached_owner, resource_owner. REQUIRED LANDMARKS (in order): cache_populated, permission_changed, sensitive_operation. INVARIANTS: cache_matches_authority. EFFECTIVE COUNTERFACTUALS: cached_owner→[align_with_authoritative].
- `stale_tenant_context` (multi_tenant; labels: multi_tenant, cache_distributed) — 用户切换了活动租户，下游授权缓存仍持上一个租户的上下文。 REQUIRED FACTS: authenticated_tenant, cached_tenant, resource_tenant. REQUIRED LANDMARKS (in order): login, cache_populated, sensitive_operation. INVARIANTS: tenant_isolation. EFFECTIVE COUNTERFACTUALS: authenticated_tenant→[switch_tenant]; cached_tenant→[switch_tenant].
- `tenant_identifier_collision` (multi_tenant; labels: multi_tenant, trust_boundary) — 两个租户的标识在同一命名空间里碰撞，授权按标识而非按租户放行。 REQUIRED FACTS: authenticated_tenant, resource_tenant, current_role. REQUIRED LANDMARKS (in order): login, sensitive_operation. INVARIANTS: tenant_isolation. EFFECTIVE COUNTERFACTUALS: resource_tenant→[switch_tenant].
- `tenant_switch_stale_session` (multi_tenant; labels: multi_tenant, session) — 租户切换后旧会话仍持原租户上下文。 REQUIRED FACTS: authenticated_tenant, session_principal, resource_tenant. REQUIRED LANDMARKS (in order): login, permission_changed, sensitive_operation. INVARIANTS: tenant_isolation, session_bound_to_principal. EFFECTIVE COUNTERFACTUALS: authenticated_tenant→[switch_tenant].
- `token_audience_mismatch` (token; labels: token, trust_boundary) — token 的受众不含接收服务，跨服务呈递被拒。 REQUIRED FACTS: token_audience, authority_source. REQUIRED LANDMARKS (in order): token_issued, sensitive_operation. INVARIANTS: token_audience_includes_service. EFFECTIVE COUNTERFACTUALS: token_audience→[align_with_authoritative].
- `token_bound_to_other_resource` (cross_flow_reuse; labels: cross_flow_reuse, token, authorization) — token 绑定的是另一个资源，却被呈递到本资源上。 REQUIRED FACTS: token_bound_resource, resource_owner. REQUIRED LANDMARKS (in order): token_issued, sensitive_operation. INVARIANTS: token_bound_to_action_resource. EFFECTIVE COUNTERFACTUALS: token_bound_resource→[align_with_action_resource].
- `token_lineage_confusion` (token; labels: token, cross_flow_reuse) — token 的血缘根不在本次 flow，跨 flow 血缘混用。 REQUIRED FACTS: token_lineage, token_lineage_root_flow. REQUIRED LANDMARKS (in order): token_issued, sensitive_operation. INVARIANTS: token_root_flow_is. EFFECTIVE COUNTERFACTUALS: token_lineage→[detach_from_parent].
- `token_privilege_version_stale` (token; labels: token, temporal_history) — token 签发时的权限版本已落后于主体当前版本。 REQUIRED FACTS: token_privilege_version, privilege_version. REQUIRED LANDMARKS (in order): token_issued, role_changed, sensitive_operation. INVARIANTS: token_privilege_version_matches_actor. EFFECTIVE COUNTERFACTUALS: token_privilege_version→[align_with_authoritative].
- `token_reused_across_flow` (cross_flow_reuse; labels: cross_flow_reuse, token) — token 在它不是为此签发的 flow 里被使用。 REQUIRED FACTS: token_flow, token_subject. REQUIRED LANDMARKS (in order): token_issued, sensitive_operation. INVARIANTS: token_same_flow. EFFECTIVE COUNTERFACTUALS: token_flow→[align_with_current_flow].
- `token_scope_overreach` (token; labels: token, authorization) — token 的范围不包含目标操作所需的范围。 REQUIRED FACTS: token_scope. REQUIRED LANDMARKS (in order): token_issued, sensitive_operation. INVARIANTS: token_scope_subset. EFFECTIVE COUNTERFACTUALS: token_scope→[align_with_required].
- `token_tenant_mismatch` (multi_tenant; labels: multi_tenant, token) — token 声明的租户与主体当前租户不一致。 REQUIRED FACTS: authenticated_tenant, token_scope. REQUIRED LANDMARKS (in order): login, token_issued, sensitive_operation. INVARIANTS: token_scope_carries_tenant. EFFECTIVE COUNTERFACTUALS: token_scope→[carry_current_tenant].
- `untrusted_source_establishes_decisive_fact` (trust_boundary; labels: trust_boundary, multi_tenant) — 决定性事实的唯一证据来自客户端可控输入，决策实际建立在不可信来源上。 REQUIRED FACTS: authenticated_tenant, resource_tenant, source_trust. REQUIRED LANDMARKS (in order): login, sensitive_operation. INVARIANTS: tenant_isolation, decisive_fact_established_by_trusted_evidence. EFFECTIVE COUNTERFACTUALS: authenticated_tenant→[switch_tenant]; resource_tenant→[switch_tenant]. REQUIRES untrusted_evidence.
- `vertical_privilege_escalation` (authorization; labels: authorization) — 主体缺少特权角色却执行了特权操作。 REQUIRED FACTS: current_role, authenticated_principal. REQUIRED LANDMARKS (in order): login, sensitive_operation. INVARIANTS: role_required. EFFECTIVE COUNTERFACTUALS: current_role→[grant_privileged_role].
- `workflow_instance_reused_across_flow` (cross_flow_reuse; labels: cross_flow_reuse, workflow) — 同一工作流实例被两个 flow 同时推进，状态归属混乱。 REQUIRED FACTS: workflow_state, token_flow. REQUIRED LANDMARKS (in order): resource_created, token_issued, workflow_transition, sensitive_operation. INVARIANTS: token_same_flow. EFFECTIVE COUNTERFACTUALS: token_flow→[align_with_current_flow].
- `workflow_state_bypass` (workflow; labels: workflow, authorization) — 工作流未走到允许的状态就被推进到下一步。 REQUIRED FACTS: workflow_state, approval_state. REQUIRED LANDMARKS (in order): resource_created, workflow_transition, sensitive_operation. INVARIANTS: workflow_state_in. EFFECTIVE COUNTERFACTUALS: workflow_state→[advance_to_required, rewind_to_initial].

## INVARIANT ARCHETYPES

authentication_state_required, cache_matches_authority, cache_not_stale_when_revoked, credential_active, decisive_fact_established_by_trusted_evidence, one_time_token_unused, owner_or_privileged, ownership, privilege_required, replicas_agree, revocation_before_use, role_required, session_active, session_bound_to_principal, session_not_revoked, session_privilege_version_matches_actor, tenant_isolation, token_audience_includes_service, token_bound_to_action_resource, token_not_expired, token_privilege_version_matches_actor, token_root_flow_is, token_same_flow, token_scope_carries_tenant, token_scope_subset, workflow_state_in, workflow_transition_declared

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

{"domain": "iot_management", "scenario_summary": "A device enrolment credential carries an expiry that has already passed by the time a field technician replays it against the enrolment service, and the service accepts the replay because the expiry comparison is never re-evaluated.", "mechanism_family": "expiry_window_violation", "complexity": "medium", "actor_types": ["service_account", "tenant_admin"], "resource_types": ["device_record"], "service_types": ["identity_service"], "security_goal": "A device enrolment credential must not be honoured once its expiry has passed.", "critical_facts": ["expiry_time", "current_time"], "history": ["the identity service issues a one-time token for the requested flow", "the principal requests the sensitive operation on the target resource"], "security_invariants": [{"type": "token_not_expired", "rule": "a credential must not be honoured after its expiry"}], "failure_mechanism": "The enrolment service trusts the recorded expiry without comparing it to the current clock, so a credential that is already expired still passes.", "required_evidence": ["expiry_time"], "optional_evidence": ["current_time"], "untrusted_evidence": [], "irrelevant_facts": ["request_trace_id", "user_agent"], "counterfactuals": [{"target_fact": "expiry_time", "change": "extend_into_future", "semantic_expectation": "verdict_flip"}], "evidence_masking_targets": ["expiry_time"], "trust_relationships": [{"kind": "authoritative_for", "about": "expiry_time"}], "notes_for_compiler": []}
{"domain": "ticketing", "scenario_summary": "A support ticket is pushed straight from intake to closure while the mandatory triage step has never run, because the workflow engine only checks that the target state is reachable in principle.", "mechanism_family": "skipping_required_step", "complexity": "simple", "actor_types": ["support_agent", "workflow_service"], "resource_types": ["ticket"], "service_types": ["records_service"], "security_goal": "A ticket may only reach closure after the triage step has been completed.", "critical_facts": ["workflow_state", "approval_state"], "history": ["the resource record is created in the system of record", "the workflow moves toward the next state in the machine", "the principal requests the sensitive operation on the target resource"], "security_invariants": [{"type": "workflow_state_in", "rule": "the workflow must occupy a declared state"}], "failure_mechanism": "The engine advances the ticket to closure without the triage transition ever having been recorded, so a state that should be unreachable is accepted.", "required_evidence": ["workflow_state"], "optional_evidence": [], "untrusted_evidence": [], "irrelevant_facts": ["display_locale", "timestamp_format"], "counterfactuals": [{"target_fact": "workflow_state", "change": "advance_to_required", "semantic_expectation": "verdict_flip"}], "evidence_masking_targets": ["workflow_state"], "trust_relationships": [{"kind": "authoritative_for", "about": "workflow_state"}], "notes_for_compiler": []}
