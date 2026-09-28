# Phase 2A 审计 — confirmation-100

## GENERATION
- raw skeletons: 123
- accepted: 100；rejected: 20；quarantined: 3
- acceptance rate: 0.8130

## SCHEMA
- world-spec schema failures: 0

## COMPILER
- total failures: 8
- INTERNAL_COMPILER_ERROR: 0（目标 0）
- distribution: {"COUNTERFACTUAL_UNRESOLVABLE": 2, "HISTORY_INCONSISTENT": 5, "UNKNOWN_SEMANTIC_TYPE": 1}

## ORACLE
- oracle failures: 0（目标 0）
- verify failures: 0

## COUNTERFACTUAL
- (axis, probe) 组合: 223
- verdict_flip: 216（rate 0.9686）
- verdict_invariant: 7（rate 0.0314）
- observable_downgrade: 0
- 先验矛盾（declared vs Oracle 轨迹）: 0

## DEDUP
- 结构簇: 64；最大簇占比: 0.0400；>10% 模板数: 0
- 语义簇: 100；最大簇占比: 0.0100；>10% 模板数: 0

## COVERAGE
- labels: {"authorization": 20, "cache_distributed": 25, "cross_flow_reuse": 12, "multi_tenant": 29, "session": 20, "temporal_history": 21, "token": 26, "trust_boundary": 21, "workflow": 19}
- shortfalls: {}
- complexity: {"complex": 25, "medium": 31, "simple": 23, "very_complex": 21}
- distinct mechanism families: 45 / 46
- distinct attack families: 31
- domains covered: 19

## TOKEN ECONOMY
- input tokens: 248317；output tokens: 222119
- accepted / 100k output tokens: 45.021（Phase 1: 0.584）
- improvement factor: 77.09x
- accepted / 1M input tokens: 402.711
- accepted / provider hour: 228.241
- output tokens / accepted world: 2221

## PROVIDER
- calls: 25；transport errors: 0；retries: 1
- accumulated latency: 1577.3s
- finish_reason: {"stop": 25}
- usage missing calls: 0

