# Generator-OOD Engineering Pilot — 审计（brief §14）

- run_id: `provider-ood-benchmark-001`
- provider batches: 18，raw skeletons: 84
- accepted: **60** / rejected 24 / quarantined 0
- tokens: in 162323 / out 270669，retries 4，provider errors 0
- provider 撞 id（只记录，不拒收，brief §29）: 0

## Compiler compatibility（重点，brief §14）

- frame success rate: 100.00%（0 帧失败）
- element schema success rate: 92.86%（6 条 schema 拒绝；未知机制 0）
- compile success rate: **75.00%**（21 次编译失败）
- internal compiler errors: 0
- oracle failures: 0，先验矛盾拒收: 3
- 编译失败码: {'HISTORY_INCONSISTENT': 8, 'MISSING_CRITICAL_FACT': 1, 'UNKNOWN_SEMANTIC_TYPE': 7, 'UNSUPPORTED_INVARIANT': 5}
- 本体覆盖: 55 个不同语义事实，accepted 里出现本体外的名字: （无）

## 反事实 / 掩蔽

- critical intervention: 66 次，符合预期 64，mismatch 2
- irrelevant perturbation: 142 次，判决逐字节一致 142，不一致 0
- evidence masked: 281 次，world_truth 保持 281，改变 0
- leakage findings: 0
- base labels: {'attack': 45, 'insufficient_evidence': 12, 'safe': 18}
- episodes: 549

## 去重 / 多样性

- 语义簇: 60（accepted 里近重复 0），近重复隔离 0
- 结构簇: 46，最大簇 5.00%，>10% 模板 0
- distinct mechanism families: 36/46
- domains: {'api_marketplace': 5, 'cloud_storage': 8, 'code_hosting': 1, 'crm': 1, 'devops_platform': 2, 'e-commerce': 1, 'finance_workflow': 10, 'healthcare_workflow': 5, 'hr_system': 1, 'iam_system': 9, 'iot_management': 1, 'project_management': 6, 'saas': 9, 'ticketing': 1}
- complexity: {'complex': 12, 'medium': 25, 'simple': 12, 'very_complex': 11}

## 经济性

- accepted rate: 71.43%（不要求达到 Step 的 81.3%，brief §14）
- accepted / 100k output tokens: 22.167

## 拒绝明细

- rejected: {'compile_error': 21, 'contradictory_expectation': 3, 'element_skeleton_rejected': 6}
- quarantined: （无）
