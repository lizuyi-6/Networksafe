# Provider Smoke（第一批真实生成）

- model: step-5-preview；raw_generation_id: provider-run-001-b034
- input_tokens: 7343；output_tokens: 34965；latency: 462.468s；retries: 0
- 解析出 worlds: 2；元素级拒绝: 0
- 帧哈希: prompt_sha256=3494a7eebac0488f54131a7a2ec5de701c9f02bfb33c6f46900acc57233c795a schema_bundle=dc9c9be8b96e94b1cce6ead47eff654d4b09c84a280c417fd6afa79d5d8fa102

## 本批 worlds
- W-iam-001 | iam_system | cross_workflow_token_reuse | complexity=medium
- W-code-002 | code_hosting | stale_object_reference | complexity=medium

## 累积状态
- raw=219 accepted=69 quarantined=56 rejected=96
- 拒绝原因: {'axis_not_in_whitelist': 47, 'batch_all_elements_rejected': 151, 'dangling_ref': 23, 'duplicate_world_id': 26, 'element_rejected': 382, 'frame_decode_failed': 26, 'gate_G12_lexical_label_leakage': 6, 'gate_G3_policy_executability': 25, 'gate_G5_counterfactual_consistency': 15, 'gate_episode_gate_summary': 42, 'provider_transport_error': 5, 'single_label_world_all_insufficient': 8}
