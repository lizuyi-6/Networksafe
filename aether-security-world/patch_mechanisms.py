import pathlib

p = pathlib.Path('semantic_skeleton/mechanisms.py')
t = p.read_text(encoding='utf-8')
subs = []

subs.append((
    '''        invariants=(_inv("tenant_isolation", authority="cache"), _inv("cache_matches_authority", subject="cached_privilege_version")),
        counterfactuals=(_cf("cached_tenant", "switch_tenant"),),''',
    '''        # 只留一条决定性不变量：两条都读缓存的世界里，改一个缓存值修不好另一条，
        # 反事实就翻转不了判决（自检抓到过）。
        invariants=(_inv("tenant_isolation", authority="cache"),),
        counterfactuals=(_cf("cached_tenant", "switch_tenant"),),''',
))

subs.append((
    '''        invariants=(_inv("tenant_isolation", authority="actor"), _inv("token_scope_carries_tenant")),
        counterfactuals=(_cf("resource_tenant", "switch_tenant"),),''',
    '''        invariants=(_inv("token_scope_carries_tenant"),),
        counterfactuals=(_cf("token_scope", "carry_current_tenant"),),''',
))

subs.append((
    '''        invariants=(
            _inv("tenant_isolation", authority="cache"),
            _inv("cache_matches_authority", subject="cached_tenant_context_version"),
        ),
        counterfactuals=(
            _cf("cached_tenant_context_version", "align_with_authoritative"),
            _cf("current_tenant_context_version", "diverge_from_authoritative"),
        ),''',
    '''        # 授权结论是在旧版租户上下文上算出来的：版本不等即复用。一条不变量读两个缓存，
        # 任一侧的反事实都能翻转它。
        invariants=(_inv("cache_matches_authority", subject="cached_tenant_context_version"),),
        counterfactuals=(
            _cf("cached_tenant_context_version", "align_with_authoritative"),
            _cf("current_tenant_context_version", "diverge_from_authoritative"),
        ),''',
))

subs.append((
    '''        required_facts=("cache_freshness", "cached_policy_version"),
        entities=("actor", "resource", "cache", "workflow", "service"),
        slot_facts={
            "cache_entry": "cache_freshness",
            "second_cache": "cached_policy_version",
        },
        landmarks=("cache_populated", "permission_changed", "sensitive_operation"),
        trajectory=(
            StateStep("cache_populated", (("cache_entry.cached_value", 1), ("cache_entry.fresh", True),)),
            StateStep("permission_changed", (("second_cache.cached_value", 4),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("cache_matches_authority", subject="cached_policy_version"),),
        counterfactuals=(_cf("cache_freshness", "mark_stale"),),
        evidence=(_ev("cache_freshness"), _ev("cached_policy_version")),
        cache_source="SVC-IAM",''',
    '''        required_facts=("cache_freshness", "cached_policy_version", "current_policy_version"),
        entities=("actor", "resource", "cache", "workflow", "service"),
        slot_facts={
            "cache_entry": "cached_policy_version",
            "second_cache": "current_policy_version",
        },
        landmarks=("cache_populated", "permission_changed", "sensitive_operation"),
        trajectory=(
            StateStep("cache_populated", (("cache_entry.cached_value", 1),)),
            StateStep("permission_changed", (("second_cache.cached_value", 4),)),
            StateStep("sensitive_operation", ()),
        ),
        invariants=(_inv("cache_matches_authority", subject="cached_policy_version"),),
        counterfactuals=(
            _cf("cached_policy_version", "align_with_authoritative"),
            _cf("current_policy_version", "diverge_from_authoritative"),
        ),
        evidence=(_ev("cached_policy_version"), _ev("current_policy_version")),
        cache_source="SVC-IAM",''',
))

subs.append((
    '''        invariants=(_inv("token_scope_carries_tenant"),),
        counterfactuals=(_cf("token_scope", "switch_tenant", "align_with_authoritative"),),''',
    '''        invariants=(_inv("token_scope_carries_tenant"),),
        counterfactuals=(_cf("token_scope", "carry_current_tenant", "diverge_from_required"),),''',
))

subs.append((
    '''        counterfactuals=(
            _cf("session_privilege_version", "align_with_authoritative"),
            _cf("privilege_version", "diverge_from_authoritative"),
        ),''',
    '''        counterfactuals=(
            _cf("session_privilege_version", "align_with_authoritative"),
            # 权威侧回落到会话快照的版本：两条轴从两侧把同一条等式修好/破坏。
            _cf("privilege_version", "align_with_session_snapshot"),
        ),''',
))

subs.append((
    '''        counterfactuals=(_cf("workflow_state", "rewind_to_initial", "advance_to_required"),),''',
    '''        counterfactuals=(_cf("workflow_state", "rewind_to_declared_predecessor", "advance_to_required"),),''',
))

subs.append((
    '''        invariants=(_inv("token_same_flow"),),
        counterfactuals=(_cf("workflow_state", "rewind_to_initial"),),
        evidence=(_ev("workflow_state"),),''',
    '''        invariants=(_inv("token_same_flow"),),
        # 轴必须是**被不变量读到**的那个事实：workflow_state 没有任何读者，展开期记
        # axis_skipped_no_reader，整条轴被静默丢掉。
        counterfactuals=(_cf("token_flow", "align_with_current_flow"),),
        evidence=(_ev("workflow_state"),),''',
))

for old, new in subs:
    assert old in t, old[:80]
    t = t.replace(old, new, 1)
p.write_text(t, encoding='utf-8')
print("mechanisms ok:", len(subs))
