# Production 500-world 审计（brief §28/§62/§63）

- run: `provider-run-production-002`（contract=production, compiler 0.3.0）
- raw 670 → accepted **502** /
  rejected 61 / quarantined 107
  （canonical-id 重复 0，语义近重复 107）
- batches 139

## 质量门（brief §28）

| 门 | 实测 |
| --- | --- |
| internal compiler error = 0 | 0 |
| oracle failure = 0 | 0 |
| leakage = 0 | 0 |
| critical intervention 100% | 573/584（mismatch 11） |
| irrelevant invariance 100% | 1017/1017 |
| evidence masking 真值保持 100% | 2388/2388 |
| largest structural cluster < 10% | 2.39%（>10% 模板 0） |
| largest semantic cluster | 0.20% |

- 重新展开失败（accepted 世界重跑 expand_family 失败）: 0
- 先验矛盾拒收: 8
- base labels: {'attack': 400, 'insufficient_evidence': 69, 'safe': 145}
- episodes（默认 renderer）: 4491

## 多样性

- distinct mechanism families: 46/46
- labels: {'authorization': 100, 'cache_distributed': 134, 'cross_flow_reuse': 54, 'multi_tenant': 143, 'session': 110, 'temporal_history': 109, 'token': 125, 'trust_boundary': 112, 'workflow': 83}
- complexity: {'complex': 133, 'medium': 173, 'simple': 81, 'very_complex': 115}
- domains: 20 个
- attack families: 31 个

## 经济性 / provider

- acceptance rate: 74.93%
- accepted / 100k output tokens: 38.612
- tokens: in 1306224 / out 1300114
- retries 21，provider errors 0，
  infrastructure failures 0
- provider 撞 id（只记录不拒收）: 0
- wallclock: Nones
