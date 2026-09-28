# Phase 2A 审计 — audit-30

## GENERATION
- raw skeletons: 39
- accepted: 33；rejected: 4；quarantined: 2
- acceptance rate: 0.8462

## SCHEMA
- world-spec schema failures: 0

## COMPILER
- total failures: 3
- INTERNAL_COMPILER_ERROR: 0（目标 0）
- distribution: {"HISTORY_INCONSISTENT": 2, "UNKNOWN_SEMANTIC_TYPE": 1}

## ORACLE
- oracle failures: 0（目标 0）
- verify failures: 0

## COUNTERFACTUAL
- (axis, probe) 组合: 79
- verdict_flip: 77（rate 0.9747）
- verdict_invariant: 2（rate 0.0253）
- observable_downgrade: 0
- 先验矛盾（declared vs Oracle 轨迹）: 0

## DEDUP
- 结构簇: 21；最大簇占比: 0.1515；>10% 模板数: 1
- 语义簇: 33；最大簇占比: 0.0303；>10% 模板数: 0

## COVERAGE
- labels: {"authorization": 5, "cache_distributed": 11, "cross_flow_reuse": 6, "multi_tenant": 10, "session": 5, "temporal_history": 4, "token": 6, "trust_boundary": 7, "workflow": 7}
- shortfalls: {"authorization": {"have": 5, "target": 8}, "session": {"have": 5, "target": 8}, "token": {"have": 6, "target": 8}, "workflow": {"have": 7, "target": 10}, "trust_boundary": {"have": 7, "target": 8}, "temporal_history": {"have": 4, "target": 8}, "cross_flow_reuse": {"have": 6, "target": 8}}
- complexity: {"complex": 12, "medium": 9, "simple": 6, "very_complex": 6}
- distinct mechanism families: 17 / 46
- distinct attack families: 14
- domains covered: 14

## TOKEN ECONOMY
- input tokens: 72853；output tokens: 85327
- accepted / 100k output tokens: 38.675（Phase 1: 0.584）
- improvement factor: 66.22x
- accepted / 1M input tokens: 452.967
- accepted / provider hour: 203.713
- output tokens / accepted world: 2586

## PROVIDER
- calls: 8；transport errors: 0；retries: 0
- accumulated latency: 583.2s
- finish_reason: {"stop": 8}
- usage missing calls: 0

