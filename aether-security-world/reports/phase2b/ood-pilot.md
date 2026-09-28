# Generator-OOD Engineering Pilot — 审计（brief §14）

- run_id: `provider-ood-pilot-001`
- provider batches: 17，raw skeletons: 83
- accepted: **40** / rejected 43 / quarantined 0
- tokens: in 152212 / out 241393，retries 3，provider errors 0
- provider 撞 id（只记录，不拒收，brief §29）: 0

## Compiler compatibility（重点，brief §14）

- frame success rate: 100.00%（0 帧失败）
- element schema success rate: 97.59%（2 条 schema 拒绝；未知机制 0）
- compile success rate: **49.40%**（42 次编译失败）
- internal compiler errors: 0
- oracle failures: 0，先验矛盾拒收: 1
- 编译失败码: {'HISTORY_INCONSISTENT': 14, 'UNKNOWN_SEMANTIC_TYPE': 18, 'UNSUPPORTED_INVARIANT': 10}
- 本体覆盖: 43 个不同语义事实，accepted 里出现本体外的名字: （无）

## 反事实 / 掩蔽

- critical intervention: 45 次，符合预期 44，mismatch 1
- irrelevant perturbation: 94 次，判决逐字节一致 94，不一致 0
- evidence masked: 191 次，world_truth 保持 191，改变 0
- leakage findings: 0
- base labels: {'attack': 31, 'insufficient_evidence': 4, 'safe': 19}
- episodes: 370

## 去重 / 多样性

- 语义簇: 40（accepted 里近重复 0），近重复隔离 0
- 结构簇: 28，最大簇 12.50%，>10% 模板 1
- distinct mechanism families: 23/46
- domains: {'api_marketplace': 1, 'cloud_storage': 5, 'code_hosting': 1, 'crm': 2, 'devops_platform': 2, 'finance_workflow': 9, 'hr_system': 3, 'iam_system': 6, 'project_management': 4, 'saas': 4, 'school_system': 2, 'subscription_system': 1}
- complexity: {'complex': 9, 'medium': 13, 'simple': 7, 'very_complex': 11}

## 经济性

- accepted rate: 48.19%（不要求达到 Step 的 81.3%，brief §14）
- accepted / 100k output tokens: 16.57

## 拒绝明细

- rejected: {'compile_error': 42, 'contradictory_expectation': 1, 'element_skeleton_rejected': 2}
- quarantined: （无）
