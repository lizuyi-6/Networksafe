# 反事实现实核查（≥30 accepted worlds）

- 审计 world 数: 30

## critical intervention
- 总数: 126
- verdict_flip: 预期 61 / 实际翻转 61（rate 1.0）
- verdict_invariant: 预期 65 / 实际不变 63（rate 0.9692）
- observable_downgrade: 预期 0 / 实际降级 0
- 不匹配案例: 2

## irrelevant perturbation
- 总数: 132；判决逐字节一致: 132（rate 1.0）
- 不匹配案例: 0

## evidence masking
- masked 变体总数: 210；level=insufficient: 67；其中 observable=insufficient_evidence: 67（rate 1.0）
- 不匹配案例: 0

## 失败案例（保存具体案例，brief M）
- verdict_invariant_expected_but_flipped | W-pm-001 | EP-ff7cf0fcb23d0365-http_request | {'world_truth': 'attack', 'observable_decision': 'safe'}
- verdict_invariant_expected_but_flipped | W-IOT-RACE-001 | EP-9a219e92fd4655b3-http_request | {'world_truth': 'attack', 'observable_decision': 'unauthorized'}
