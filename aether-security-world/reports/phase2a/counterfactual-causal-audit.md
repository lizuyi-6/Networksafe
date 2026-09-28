# Phase 2A 反事实 mismatch 最小因果审计（brief §34）

- 方法：A 记录 base 轨迹 → B 只改动声明变量重跑 Oracle → C diff 世界路径/被咨询事实/不变量/判决，再归因。**不改任何期望值**，先归因再决定改哪里。
- 案例来源：Phase 1 counterfactual-audit-100 的两个 `verdict_invariant_expected_but_flipped`。

## 结论

- 审计的 (轴, probe) 组合数: 13；归因分布: `consistent`×11, `generator_mislabeled_critical_fact`×2
- 真正的 mismatch 数（声明不变、实际翻转）: 2

两个 mismatch **全部**归到 `generator_mislabeled_critical_fact`：生成器把一条它自己列进 `critical_state_variables`、且被作用域内不变量真正读到的轴，声明成`expected_effect=verdict_invariant`。编译器只改了声明的那一条路径（`changed_paths` 恒为单元素），Oracle 的求值自身自洽——**不是引擎缺陷，是生成器的先验自相矛盾**。

处置：Phase 2A 的语义骨架里，`semantic_expectation` 不再是真值来源——Compiler/Oracle 按 oracle 轨迹重新判定（brief §35），因此这类自相矛盾在编译期就会被判`CONTRADICTORY_EXPECTATION` 而拒收，而不是带着错标签进数据集。

## 审计中发现的引擎缺陷（已修）

- **`family_view_for_action` 的 `diffs` 键空间与重盖后的 `episode_id` 不一致**（`analysis/pipeline.py`）：``qualify_episode_id`` 先给 id 追加 `-renderer`，随后仍用重盖后的 id 去查 ``expand_family`` 的 ``diffs``，每次 lookup 落空并回落到``WorldDiff(())``。后果是 G6 的"无关扰动不得改变世界状态"这一半检查**恒真**（每个扰动都读到空 diff），而关键干预本该有的非空 diff 也被一并抹平。修复：保留重盖前的原始 id 做键。回归测试 `tests/gates/test_g5_g6_counterfactual_invariance.py::test_family_view_diffs_resolve_for_every_variant` 钉死（临时回退该修复会使它失败，已验证）。

## W-pm-001（repeated_operation）

- 声明的 critical_state_variables: token.TOK-201.used, actor.ACT-101.roles, actor.ACT-101.authentication_state

### 轴 `token.TOK-201.used`（probe 1，operation=create_task）

- 干预: `True` → `False`；generator 声明 kind=critical expected_effect=verdict_flip
- 变化的世界路径（应恰好 1 条）: ['token.TOK-201.used']

| | base | intervention |
| --- | --- | --- |
| world_truth | attack | safe |
| observable_decision | attack | attack |
| policy_decision | deny | None |
| violated_invariants | ['INV-TASK-IDEMPOTENCY-001'] | [] |
| skipped_invariants | [] | [] |
| consulted_facts 数 | 3 | 4 |

- consulted_facts 增量: ['token.TOK-201.scope']
- violated_invariants 增量: （无）
- 判决是否翻转: True

**归因（high）**: `consistent` —— 轴 'token.TOK-201.used'：声明 verdict_flip，实际 verdict_changed=True

### 轴 `actor.ACT-101.roles`（probe 1，operation=create_task）

- 干预: `['ROLE-MEMBER']` → `['ROLE-VIEWER']`；generator 声明 kind=critical expected_effect=verdict_invariant
- 变化的世界路径（应恰好 1 条）: ['actor.ACT-101.roles']

| | base | intervention |
| --- | --- | --- |
| world_truth | attack | attack |
| observable_decision | attack | attack |
| policy_decision | deny | deny |
| violated_invariants | ['INV-TASK-IDEMPOTENCY-001'] | ['INV-TASK-IDEMPOTENCY-001'] |
| skipped_invariants | [] | [] |
| consulted_facts 数 | 3 | 3 |

- consulted_facts 增量: （无）
- violated_invariants 增量: （无）
- 判决是否翻转: False

**归因（high）**: `consistent` —— 轴 'actor.ACT-101.roles'：声明 verdict_invariant，实际 verdict_changed=False

### 轴 `actor.ACT-101.authentication_state`（probe 1，operation=create_task）

- 干预: `'authenticated'` → `'mfa_pending'`；generator 声明 kind=critical expected_effect=verdict_invariant
- 变化的世界路径（应恰好 1 条）: ['actor.ACT-101.authentication_state']

| | base | intervention |
| --- | --- | --- |
| world_truth | attack | attack |
| observable_decision | attack | attack |
| policy_decision | deny | deny |
| violated_invariants | ['INV-TASK-IDEMPOTENCY-001'] | ['INV-TASK-AUTH-001', 'INV-TASK-IDEMPOTENCY-001'] |
| skipped_invariants | [] | [] |
| consulted_facts 数 | 3 | 3 |

- consulted_facts 增量: （无）
- violated_invariants 增量: ['INV-TASK-AUTH-001']
- 判决是否翻转: False

**归因（high）**: `consistent` —— 轴 'actor.ACT-101.authentication_state'：声明 verdict_invariant，实际 verdict_changed=False

### 轴 `actor.ACT-101.roles`（probe 2，operation=read_task）

- 干预: `['ROLE-MEMBER']` → `['ROLE-VIEWER']`；generator 声明 kind=critical expected_effect=verdict_invariant
- 变化的世界路径（应恰好 1 条）: ['actor.ACT-101.roles']

| | base | intervention |
| --- | --- | --- |
| world_truth | safe | safe |
| observable_decision | safe | safe |
| policy_decision | None | None |
| violated_invariants | [] | [] |
| skipped_invariants | ['INV-TASK-IDEMPOTENCY-001'] | ['INV-TASK-IDEMPOTENCY-001'] |
| consulted_facts 数 | 2 | 2 |

- consulted_facts 增量: （无）
- violated_invariants 增量: （无）
- 判决是否翻转: False

**归因（high）**: `consistent` —— 轴 'actor.ACT-101.roles'：声明 verdict_invariant，实际 verdict_changed=False

### 轴 `actor.ACT-101.authentication_state`（probe 2，operation=read_task）

- 干预: `'authenticated'` → `'mfa_pending'`；generator 声明 kind=critical expected_effect=verdict_invariant
- 变化的世界路径（应恰好 1 条）: ['actor.ACT-101.authentication_state']

| | base | intervention |
| --- | --- | --- |
| world_truth | safe | attack |
| observable_decision | safe | safe |
| policy_decision | None | None |
| violated_invariants | [] | ['INV-TASK-AUTH-001'] |
| skipped_invariants | ['INV-TASK-IDEMPOTENCY-001'] | ['INV-TASK-IDEMPOTENCY-001'] |
| consulted_facts 数 | 2 | 2 |

- consulted_facts 增量: （无）
- violated_invariants 增量: ['INV-TASK-AUTH-001']
- 判决是否翻转: True

**归因（high）**: `generator_mislabeled_critical_fact` —— 轴 'actor.ACT-101.authentication_state' 出现在 critical_state_variables=True，且干预后 violated_invariants 增加 ['INV-TASK-AUTH-001']、consulted_facts 增加 []，判决随之翻转；generator 却声明 expected_effect=verdict_invariant

### 轴 `token.TOK-201.used`（probe 3，operation=create_task）

- 干预: `True` → `False`；generator 声明 kind=critical expected_effect=verdict_flip
- 变化的世界路径（应恰好 1 条）: ['token.TOK-201.used']

| | base | intervention |
| --- | --- | --- |
| world_truth | attack | safe |
| observable_decision | attack | attack |
| policy_decision | deny | None |
| violated_invariants | ['INV-TASK-IDEMPOTENCY-001'] | [] |
| skipped_invariants | [] | [] |
| consulted_facts 数 | 3 | 4 |

- consulted_facts 增量: ['token.TOK-201.scope']
- violated_invariants 增量: （无）
- 判决是否翻转: True

**归因（high）**: `consistent` —— 轴 'token.TOK-201.used'：声明 verdict_flip，实际 verdict_changed=True

### 轴 `actor.ACT-101.roles`（probe 3，operation=create_task）

- 干预: `['ROLE-MEMBER']` → `['ROLE-VIEWER']`；generator 声明 kind=critical expected_effect=verdict_invariant
- 变化的世界路径（应恰好 1 条）: ['actor.ACT-101.roles']

| | base | intervention |
| --- | --- | --- |
| world_truth | attack | attack |
| observable_decision | attack | attack |
| policy_decision | deny | deny |
| violated_invariants | ['INV-TASK-IDEMPOTENCY-001'] | ['INV-TASK-IDEMPOTENCY-001'] |
| skipped_invariants | [] | [] |
| consulted_facts 数 | 3 | 3 |

- consulted_facts 增量: （无）
- violated_invariants 增量: （无）
- 判决是否翻转: False

**归因（high）**: `consistent` —— 轴 'actor.ACT-101.roles'：声明 verdict_invariant，实际 verdict_changed=False

### 轴 `actor.ACT-101.authentication_state`（probe 3，operation=create_task）

- 干预: `'authenticated'` → `'mfa_pending'`；generator 声明 kind=critical expected_effect=verdict_invariant
- 变化的世界路径（应恰好 1 条）: ['actor.ACT-101.authentication_state']

| | base | intervention |
| --- | --- | --- |
| world_truth | attack | attack |
| observable_decision | attack | attack |
| policy_decision | deny | deny |
| violated_invariants | ['INV-TASK-IDEMPOTENCY-001'] | ['INV-TASK-AUTH-001', 'INV-TASK-IDEMPOTENCY-001'] |
| skipped_invariants | [] | [] |
| consulted_facts 数 | 3 | 3 |

- consulted_facts 增量: （无）
- violated_invariants 增量: ['INV-TASK-AUTH-001']
- 判决是否翻转: False

**归因（high）**: `consistent` —— 轴 'actor.ACT-101.authentication_state'：声明 verdict_invariant，实际 verdict_changed=False

## W-IOT-RACE-001（race_sensitive_state）

- 声明的 critical_state_variables: token.TOK-IOT-001.used, workflow_instance.WFI-IOT-001.current_state

### 轴 `token.TOK-IOT-001.used`（probe 1，operation=transition）

- 干预: `True` → `False`；generator 声明 kind=critical expected_effect=verdict_flip
- 变化的世界路径（应恰好 1 条）: ['token.TOK-IOT-001.used']

| | base | intervention |
| --- | --- | --- |
| world_truth | attack | unauthorized |
| observable_decision | attack | attack |
| policy_decision | deny | deny |
| violated_invariants | ['INV-IOT-ONE-TIME'] | [] |
| skipped_invariants | ['INV-IOT-SESSION-LIVE'] | ['INV-IOT-SESSION-LIVE'] |
| consulted_facts 数 | 5 | 5 |

- consulted_facts 增量: （无）
- violated_invariants 增量: （无）
- 判决是否翻转: True

**归因（high）**: `consistent` —— 轴 'token.TOK-IOT-001.used'：声明 verdict_flip，实际 verdict_changed=True

### 轴 `workflow_instance.WFI-IOT-001.current_state`（probe 1，operation=transition）

- 干预: `'approved'` → `'deploying'`；generator 声明 kind=critical expected_effect=verdict_invariant
- 变化的世界路径（应恰好 1 条）: ['workflow_instance.WFI-IOT-001.current_state']

| | base | intervention |
| --- | --- | --- |
| world_truth | attack | attack |
| observable_decision | attack | attack |
| policy_decision | deny | deny |
| violated_invariants | ['INV-IOT-ONE-TIME'] | ['INV-IOT-ONE-TIME', 'INV-IOT-WF-STATE'] |
| skipped_invariants | ['INV-IOT-SESSION-LIVE'] | ['INV-IOT-SESSION-LIVE'] |
| consulted_facts 数 | 5 | 5 |

- consulted_facts 增量: （无）
- violated_invariants 增量: ['INV-IOT-WF-STATE']
- 判决是否翻转: False

**归因（high）**: `consistent` —— 轴 'workflow_instance.WFI-IOT-001.current_state'：声明 verdict_invariant，实际 verdict_changed=False

### 轴 `workflow_instance.WFI-IOT-001.current_state`（probe 2，operation=transition）

- 干预: `'approved'` → `'deploying'`；generator 声明 kind=critical expected_effect=verdict_invariant
- 变化的世界路径（应恰好 1 条）: ['workflow_instance.WFI-IOT-001.current_state']

| | base | intervention |
| --- | --- | --- |
| world_truth | unauthorized | attack |
| observable_decision | unauthorized | unauthorized |
| policy_decision | deny | deny |
| violated_invariants | [] | ['INV-IOT-WF-STATE'] |
| skipped_invariants | ['INV-IOT-ONE-TIME', 'INV-IOT-SESSION-LIVE'] | ['INV-IOT-ONE-TIME', 'INV-IOT-SESSION-LIVE'] |
| consulted_facts 数 | 4 | 4 |

- consulted_facts 增量: （无）
- violated_invariants 增量: ['INV-IOT-WF-STATE']
- 判决是否翻转: True

**归因（high）**: `generator_mislabeled_critical_fact` —— 轴 'workflow_instance.WFI-IOT-001.current_state' 出现在 critical_state_variables=True，且干预后 violated_invariants 增加 ['INV-IOT-WF-STATE']、consulted_facts 增加 []，判决随之翻转；generator 却声明 expected_effect=verdict_invariant

### 轴 `token.TOK-IOT-001.used`（probe 3，operation=transition）

- 干预: `True` → `False`；generator 声明 kind=critical expected_effect=verdict_flip
- 变化的世界路径（应恰好 1 条）: ['token.TOK-IOT-001.used']

| | base | intervention |
| --- | --- | --- |
| world_truth | attack | safe |
| observable_decision | attack | attack |
| policy_decision | deny | None |
| violated_invariants | ['INV-IOT-ONE-TIME'] | [] |
| skipped_invariants | [] | [] |
| consulted_facts 数 | 6 | 6 |

- consulted_facts 增量: （无）
- violated_invariants 增量: （无）
- 判决是否翻转: True

**归因（high）**: `consistent` —— 轴 'token.TOK-IOT-001.used'：声明 verdict_flip，实际 verdict_changed=True

### 轴 `workflow_instance.WFI-IOT-001.current_state`（probe 3，operation=transition）

- 干预: `'approved'` → `'deploying'`；generator 声明 kind=critical expected_effect=verdict_invariant
- 变化的世界路径（应恰好 1 条）: ['workflow_instance.WFI-IOT-001.current_state']

| | base | intervention |
| --- | --- | --- |
| world_truth | attack | attack |
| observable_decision | attack | attack |
| policy_decision | deny | deny |
| violated_invariants | ['INV-IOT-ONE-TIME'] | ['INV-IOT-ONE-TIME', 'INV-IOT-WF-STATE'] |
| skipped_invariants | [] | [] |
| consulted_facts 数 | 6 | 6 |

- consulted_facts 增量: （无）
- violated_invariants 增量: ['INV-IOT-WF-STATE']
- 判决是否翻转: False

**归因（high）**: `consistent` —— 轴 'workflow_instance.WFI-IOT-001.current_state'：声明 verdict_invariant，实际 verdict_changed=False

