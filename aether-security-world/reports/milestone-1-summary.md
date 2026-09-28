# Milestone 1 汇总（accepted worlds；目标 100 未达成时如实标注）

- **目标达成度: 69/100 accepted（未达成：被 brief 预设停止线拦下，原因见 TOP FAILURES）**

## PROVIDER
- model: step-5-preview
- prompt_version: 0.12（sha256 3494a7eebac0488f54131a7a2ec5de701c9f02bfb33c6f46900acc57233c795a）
- schema_bundle_sha256: dc9c9be8b96e94b1cce6ead47eff654d4b09c84a280c417fd6afa79d5d8fa102
- compiler_version: 0.1.0 / oracle_version: 0.1.0
- batches: 271；input_tokens: 2217640；output_tokens: 11809745
- latency 合计: 135503.343s；retries: 31；usage 缺失调用: 0

## GENERATION
- raw: 219；accepted: 69；rejected: 96；quarantined: 56
- acceptance_rate: 0.3151；accepted/100k output tokens: 0.584

## QUALITY
- schema 失败: 0；compile 失败: 70；oracle 失败: 0
- 重复: 0；结构重复: 0
- 结构聚类数: 69；最大簇占比: 0.0145；>10% 模板数: 0
- 泄漏发现: 0（扫描 episode 1177 个）

## COUNTERFACTUAL
- critical intervention: {'total': 126, 'flip_expected': 61, 'flip_observed': 61, 'invariant_expected': 65, 'invariant_observed': 63, 'downgrade_expected': 0, 'downgrade_observed': 0, 'mismatches': [{'kind': 'verdict_invariant_expected_but_flipped', 'world_id': 'W-pm-001', 'episode_id': 'EP-ff7cf0fcb23d0365-http_request', 'variant_type': 'critical_intervention', 'intervention': {'intervention_variable': 'actor.ACT-101.authentication_state', 'before': 'authenticated', 'after': 'mfa_pending', 'expected_effect': 'verdict_invariant', 'actual_effect': 'verdict_flip'}, 'oracle_output': {'world_truth': 'attack', 'observable_decision': 'safe'}}, {'kind': 'verdict_invariant_expected_but_flipped', 'world_id': 'W-IOT-RACE-001', 'episode_id': 'EP-9a219e92fd4655b3-http_request', 'variant_type': 'critical_intervention', 'intervention': {'intervention_variable': 'workflow_instance.WFI-IOT-001.current_state', 'before': 'approved', 'after': 'deploying', 'expected_effect': 'verdict_invariant', 'actual_effect': 'verdict_flip'}, 'oracle_output': {'world_truth': 'attack', 'observable_decision': 'unauthorized'}}], 'flip_rate': 1.0, 'invariance_rate': 0.9692, 'downgrade_rate': None}
- irrelevant perturbation: {'total': 132, 'verdict_identical': 132, 'mismatches': [], 'verdict_identical_rate': 1.0}
- evidence masked: {'total': 210, 'insufficient_level': 67, 'insufficient_observable': 67, 'mismatches': [], 'masking_validity_rate': 1.0}

## COVERAGE
- 类别分布: {'workflow': 11, 'authorization': 10, 'temporal_history': 9, 'token': 8, 'session': 8, 'cross_flow_reuse': 8, 'cache_distributed': 8, 'trust_boundary': 7}
- 复杂度分布: {'medium': 37, 'complex': 24, 'simple': 7, 'very_complex': 1}
- 领域分布: {'e-commerce': 4, 'school_system': 4, 'finance_workflow': 4, 'cloud_storage': 4, 'logistics': 4, 'hr_system': 4, 'iam_system': 4, 'code_hosting': 4, 'industrial_management': 4, 'crm': 3, 'api_marketplace': 3, 'iot_management': 3, 'project_management': 3, 'content_platform': 3, 'subscription_system': 3, 'saas': 3, 'messaging': 3, 'healthcare_workflow': 3, 'devops_platform': 3, 'ticketing': 3}
- 唯一不变量族: 11；唯一工作流拓扑: 7；唯一 attack family: 19

## TOP FAILURES（拒绝/隔离原因 Top 10）
- element_rejected: 382
- batch_all_elements_rejected: 151
- axis_not_in_whitelist: 47
- gate_episode_gate_summary: 42
- duplicate_world_id: 26
- frame_decode_failed: 26
- gate_G3_policy_executability: 25
- dangling_ref: 23
- gate_G5_counterfactual_consistency: 15
- single_label_world_all_insufficient: 8
