# Phase 2A 审计 — smoke-10

## GENERATION
- raw skeletons: 20
- accepted: 18；rejected: 2；quarantined: 0
- acceptance rate: 0.9000

## SCHEMA
- world-spec schema failures: 0

## COMPILER
- total failures: 2
- INTERNAL_COMPILER_ERROR: 0（目标 0）
- distribution: {"UNKNOWN_SEMANTIC_TYPE": 2}

## ORACLE
- oracle failures: 0（目标 0）
- verify failures: 0

## COUNTERFACTUAL
- (axis, probe) 组合: 40
- verdict_flip: 39（rate 0.9750）
- verdict_invariant: 1（rate 0.0250）
- observable_downgrade: 0
- 先验矛盾（declared vs Oracle 轨迹）: 0

## DEDUP
- 结构簇: 15；最大簇占比: 0.1111；>10% 模板数: 3
- 语义簇: 18；最大簇占比: 0.0556；>10% 模板数: 0

## COVERAGE
- labels: {"authorization": 3, "cache_distributed": 8, "cross_flow_reuse": 5, "multi_tenant": 9, "session": 2, "token": 5, "trust_boundary": 7}
- shortfalls: {"authorization": {"have": 3, "target": 8}, "session": {"have": 2, "target": 8}, "token": {"have": 5, "target": 8}, "workflow": {"have": 0, "target": 10}, "trust_boundary": {"have": 7, "target": 8}, "temporal_history": {"have": 0, "target": 8}, "cross_flow_reuse": {"have": 5, "target": 8}}
- complexity: {"complex": 5, "medium": 7, "simple": 3, "very_complex": 3}
- distinct mechanism families: 13 / 46
- distinct attack families: 10
- domains covered: 10

## TOKEN ECONOMY
- input tokens: 29983；output tokens: 38647
- accepted / 100k output tokens: 46.575（Phase 1: 0.584）
- improvement factor: 79.75x
- accepted / 1M input tokens: 600.340
- accepted / provider hour: 162.146
- output tokens / accepted world: 2147

## PROVIDER
- calls: 4；transport errors: 0；retries: 1
- accumulated latency: 399.6s
- finish_reason: {"stop": 4}
- usage missing calls: 0

