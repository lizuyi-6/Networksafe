# Phase 2A 审计 — final-100

## GENERATION
- raw skeletons: 143
- accepted: 103；rejected: 16；quarantined: 24
- acceptance rate: 0.7203

## SCHEMA
- world-spec schema failures: 0

## COMPILER
- total failures: 7
- INTERNAL_COMPILER_ERROR: 0（目标 0）
- distribution: {"HISTORY_INCONSISTENT": 6, "UNKNOWN_SEMANTIC_TYPE": 1}

## ORACLE
- oracle failures: 0（目标 0）
- verify failures: 0

## COUNTERFACTUAL
- (axis, probe) 组合: 233
- verdict_flip: 221（rate 0.9485）
- verdict_invariant: 12（rate 0.0515）
- observable_downgrade: 0
- 先验矛盾（declared vs Oracle 轨迹）: 0

## DEDUP
- 结构簇: 44；最大簇占比: 0.1068；>10% 模板数: 1
- 语义簇: 103；最大簇占比: 0.0097；>10% 模板数: 0

## COVERAGE
- labels: {"authorization": 33, "cache_distributed": 24, "cross_flow_reuse": 8, "multi_tenant": 18, "session": 22, "temporal_history": 21, "token": 16, "trust_boundary": 9, "workflow": 30}
- shortfalls: {}
- complexity: {"complex": 25, "medium": 31, "simple": 23, "very_complex": 24}
- distinct mechanism families: 27 / 46
- distinct attack families: 22
- domains covered: 16

## TOKEN ECONOMY
- input tokens: 277243；output tokens: 265426
- accepted / 100k output tokens: 38.806（Phase 1: 0.584）
- improvement factor: 66.45x
- accepted / 1M input tokens: 371.515
- accepted / provider hour: 182.698
- output tokens / accepted world: 2577

## PROVIDER
- calls: 0；transport errors: 0；retries: 3
- accumulated latency: 2029.6s
- finish_reason: {}
- usage missing calls: 0

