# Phase 2A token economy 对比（brief §53）

| 指标 | Phase 1 | Phase 2A | 变化 |
| --- | --- | --- | --- |
| accepted | 69 | 100 | — |
| raw | 219 | 123 | — |
| acceptance rate | 0.3151 | 0.8130 | +158.0% |
| input tokens | 2217640 | 248317 | — |
| output tokens | 11809745 | 222119 | — |
| accepted / 100k output tokens | 0.584 | 45.021 | **77.09x** |
| accepted / 1M input tokens | — | 402.711 | — |
| accepted / provider hour | — | 228.241 | — |
| output tokens / accepted world | 171156 | 2221 | — |
| provider retries | 31 | 1 | — |

## 判据（brief §3 / §62）

- 最低门槛：accepted / 100k output tokens > 2。当前 45.021 ⇒ **达标**
- 目标区间：3～5。当前 45.021 ⇒ **高于目标区间**
- Phase 1 基线 0.584 的提升倍数：**77.09x**

## 构成解读

- 骨架平均输出 token 数远小于完整 world JSON：Phase 1 每个 world 平均 53926 output tokens（含全部被拒的），Phase 2A 每个骨架平均 1806。
- 结构性失败（resource_states / state_preconditions 形状）在 Phase 2A 由编译器承担，因此不再产生 shape 类拒绝；剩下的拒绝集中在语义层（未知事实/类型、空干预、近重复）。
