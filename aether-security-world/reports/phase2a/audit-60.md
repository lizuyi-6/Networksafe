# Phase 2A 审计 — audit-60

## GENERATION
- raw skeletons: 78
- accepted: 60；rejected: 6；quarantined: 12
- acceptance rate: 0.7692

## SCHEMA
- world-spec schema failures: 0

## COMPILER
- total failures: 4
- INTERNAL_COMPILER_ERROR: 0（目标 0）
- distribution: {"HISTORY_INCONSISTENT": 3, "UNKNOWN_SEMANTIC_TYPE": 1}

## ORACLE
- oracle failures: 0（目标 0）
- verify failures: 0

## COUNTERFACTUAL
- (axis, probe) 组合: 137
- verdict_flip: 131（rate 0.9562）
- verdict_invariant: 6（rate 0.0438）
- observable_downgrade: 0
- 先验矛盾（declared vs Oracle 轨迹）: 0

## DEDUP
- 结构簇: 36；最大簇占比: 0.0833；>10% 模板数: 0
- 语义簇: 60；最大簇占比: 0.0167；>10% 模板数: 0

## COVERAGE
- labels: {"authorization": 15, "cache_distributed": 16, "cross_flow_reuse": 8, "multi_tenant": 13, "session": 11, "temporal_history": 11, "token": 12, "trust_boundary": 8, "workflow": 16}
- shortfalls: {}
- complexity: {"complex": 17, "medium": 17, "simple": 13, "very_complex": 13}
- distinct mechanism families: 24 / 46
- distinct attack families: 19
- domains covered: 15

## TOKEN ECONOMY
- input tokens: 149737；output tokens: 152626
- accepted / 100k output tokens: 39.312（Phase 1: 0.584）
- improvement factor: 67.31x
- accepted / 1M input tokens: 400.703
- accepted / provider hour: 185.629
- output tokens / accepted world: 2544

## PROVIDER
- calls: 16；transport errors: 0；retries: 2
- accumulated latency: 1163.6s
- finish_reason: {"stop": 16}
- usage missing calls: 0

