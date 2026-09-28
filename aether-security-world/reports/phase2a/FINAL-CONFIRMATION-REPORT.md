# Aether Security World — Phase 2A Final Confirmation Report

> run: `provider-run-003`（prompt v0.6 冻结，schema/ontology/mechanism/compiler/oracle/verifier/gates/fingerprint 全程未改）
> 数据源：`reports/phase2a/confirmation-100.{json,md}`、`go-no-go-confirmation.json`、
> `state/mechanism-selection-trace-provider-run-003.jsonl`、`state/phase2a-{progress,coverage}-provider-run-003.json`、
> `PHASE2A-FINAL-FREEZE.json`。

---

## ARCHITECTURE STATUS

与 Phase 2A 前次 run **完全同一套冻结合同**，本次未改任何一个字节：

| 组件 | 路径 | sha256 前 12 |
| --- | --- | --- |
| prompt v0.6 | `semantic_skeleton/prompts/v0.6.md` | `1c891e4b6f51` |
| skeleton schema | `semantic_skeleton/schemas/semantic-skeleton.schema.json` | `82bc9516e089` |
| ontology | `semantic_skeleton/ontology.py` | 见 `SHA256SUMS.txt` |
| mechanism registry | `semantic_skeleton/mechanisms.py` | 同上 |
| compiler | `semantic_skeleton/compiler/compiler.py` | 同上 |
| oracle | `security_world/oracle/oracle.py` | 同上 |
| coverage controller | `semantic_skeleton/coverage.py` | 同上 |
| fingerprint | `semantic_skeleton/fingerprint.py` | 同上 |
| provider client | `semantic_skeleton/generator/live.py` | 同上 |

本次唯一新增的是**仪表**，不是策略：`coverage.py` 抽出 `_selection()` 供 `directive()` 与
新的 `selection_record()` 共用（同一实现，杜绝两边漂移），runner 增加 `--run-id` 与
selection trace 落盘。8 条回归测试钉死"fallback 选最少用机制 / 被过度选用的机制不再被提议 /
directive 与 trace 一致"。

---

## PROVIDER STATUS

| 项 | 值 |
| --- | --- |
| 凭据 | 运行中方更新（brief §1 允许；key 只从环境读，未落盘） |
| 首次连通 | 第一次调用遇 SSL 瞬断（`UNEXPECTED_EOF_WHILE_READING`），重试 0 次后成功——Phase 1 实测过的故障类型，客户端按设计重试 |
| endpoint | `https://api.stepfun.com/step_plan/v1/chat/completions`（与文档逐字一致） |
| 旧凭据排查 | 前一 key 在两个兼容端点、三种 auth header 下均 `401 invalid_api_key`，已按 brief §5 记录但**未混入本次数据** |

---

## RUN SIZE

| 项 | 值 |
| --- | --- |
| run id | `provider-run-003`（新 run_id，未复用被 401 中断的目录） |
| batches | 25 |
| raw skeletons | 123 |
| accepted | 100 |
| rejected | 20 |
| quarantined | 3 |
| wallclock | 1655.4 s |

---

## ACCEPTANCE

| run | raw | accepted | acceptance rate |
| --- | --- | --- | --- |
| Phase 1 | 219 | 69 | 0.3151 |
| Phase 2A 前次 (`provider-run-002`) | 143 | 103 | 0.7203 |
| **Phase 2A confirmation (`provider-run-003`)** | **123** | **100** | **0.8130** |

拒绝原因：`duplicate_skeleton_id` 10、`HISTORY_INCONSISTENT` 5、`element_skeleton_rejected` 2、
`COUNTERFACTUAL_UNRESOLVABLE` 2、`CONTRADICTORY_EXPECTATION` 2、`UNKNOWN_SEMANTIC_TYPE` 1、
`semantic_near_duplicate` 3。

`duplicate_skeleton_id` 全部集中在前 3 批（模型整批照抄上一批的 5 个 id，黑名单已在 prompt
中列全但被忽略），第 4 批起自行止住，未修改 prompt（brief §4）。

---

## TOKEN ECONOMY

| 指标 | Phase 1 | Phase 2A 前次 | **本次** |
| --- | --- | --- | --- |
| output tokens | 11,809,745 | 265,426 | **222,119** |
| **accepted / 100k output** | **0.584** | **38.81** | **45.02** |
| accepted / 1M input | — | 371.5 | **402.7** |
| accepted / provider hour | — | 182.7 | **228.2** |
| output tokens / accepted world | 171,156 | 2,577 | **2,221** |
| improvement vs Phase 1 | — | 66.45x | **77.09x** |

效率**没有退化，反而提升 16%**。前 3 批的 id 重复造成约 10 个骨架的 token 浪费，即使如此
仍高于前次 run。

---

## STRUCTURAL CLUSTERS（本次首要指标）

| run | 结构簇数 | 最大簇占比 | >10% 模板数 |
| --- | --- | --- | --- |
| Phase 2A 前次 | 44 | **0.1068** ❌ | 1 |
| **本次** | **64** | **0.0400** ✅ | **0** |

**此前唯一未达标项现已通过**，且余量很大（4.00% vs 10% 阈值）。语义指纹同样健康：
100 个语义簇（每个世界一个），最大簇 1.00%，>10% 模板 0。

阈值未做任何事后修改，仍用 `go-no-go.json` 里冻结的 `< 10%`。

---

## MECHANISM DISTRIBUTION

| run | distinct mechanism families | 最大单一机制占比 |
| --- | --- | --- |
| Phase 2A 前次 | 27 / 46 | `post_disable_session` 10.68% |
| **本次** | **45 / 46** | **`horizontal_peer_access` 5%** |

`post_disable_session` 从 11 个降到 **2 个**。唯一未出现的机制是
`cross_service_tenant_propagation_delay` 之外的一个（见 `confirmation-100.json` 的
`mechanism_families` 全表）。distinct attack families 31，domains covered 19 / 20。

---

## MULTI-TENANT DIVERSITY

| run | multi_tenant accepted | distinct mt mechanisms |
| --- | --- | --- |
| Phase 1 | 0 | 0 |
| Phase 2A 前次 | 18 | 5 |
| **本次** | **29** | **13 / 13（注册表内全部）** |

brief §25 点名的十个机制**全部有 accepted**：

| mechanism | accepted |
| --- | --- |
| `stale_tenant_context` | 2 |
| `cross_tenant_cache` | 3 |
| `token_tenant_mismatch` | 1 |
| `service_account_tenant_crossover` | 1 |
| `delegated_tenant_access` | 2 |
| `resource_tenant_mismatch` | 2 |
| `tenant_switch_stale_session` | 1 |
| `cross_service_tenant_propagation_delay` | 3 |
| `tenant_identifier_collision` | 2 |
| `cached_authorization_cross_tenant_reuse` | 3 |

`go-no-go.json` 里没有定义 multi_tenant diversity gate，因此按 brief §8 将它作为
**diagnostic** 报告，没有事后新增第 15 个 gate。

---

## COUNTERFACTUAL RESULTS

| 家族 | 总数 | 结果 |
| --- | --- | --- |
| critical intervention (axis, probe) | 223 | verdict_flip 216（96.86%）；verdict_invariant 7 |
| 先验矛盾（按轴聚合） | — | **0** |
| irrelevant perturbation | 404 | 判决逐字节一致 **404/404 = 100%** |
| evidence masked | 934 | world_truth 不变 **934/934 = 100%** |

base 标签分布：attack 131 / insufficient_evidence 32 / safe 37（三类都有，不塌缩）。
7 个 verdict_invariant 是混合 base（同一轴在别的 probe 上已证实），按与 runner/G5 相同的
按轴聚合语义不计缺陷——前次 run 用同一把尺子量出 12 个，本次 7 个。

---

## LEAKAGE RESULTS

**0 findings**（1761 个 episode 全扫 `model_visible` 侧，G12 词表 + 标识符段匹配）。
前次 run 修复的机制族名泄漏消毒在本 run 的编译产物里继续生效。

---

## COMPILER / ORACLE RESULTS

| 项 | 值 |
| --- | --- |
| world-spec schema failures | **0** |
| compiler failures | 8 / 123 raw = 6.50% |
| **INTERNAL_COMPILER_ERROR** | **0** |
| **oracle failures** | **0** |
| verify failures | 0 |
| mechanism registry self-check | **46 / 46** |

编译器失败分布：`HISTORY_INCONSISTENT` 5、`COUNTERFACTUAL_UNRESOLVABLE` 2、
`UNKNOWN_SEMANTIC_TYPE` 1——全部是生成器语义层拒绝，没有一个是编译器自身缺陷。

---

## PROVIDER RELIABILITY

| 项 | 值 |
| --- | --- |
| 调用次数 | 25 |
| 传输层失败 | **0** |
| 重试 | 1（SSL 瞬断，首次连通时） |
| usage 缺失调用 | 0 |
| finish_reason | 全部 `stop`（无截断） |
| 累计 latency | 1577.3 s |

brief §38 的对策在本 run 全部生效：绝对墙钟上限、空闲时限、401 熔断、指数退避 + jitter、
幂等 key、响应 checkpoint、fail-closed 运行锁。凭据失效的那次排查中，熔断在 5 次连续 401 后
停止（Phase 1 同类故障是 1992 次重试）。

---

## 14 GO / NO-GO ITEMS

严格读取 `go-no-go.json` 的冻结标准，未新增/删除/修改任何 gate：

| # | 判据 | 实际 | 结果 |
| --- | --- | --- | --- |
| 1 | accepted >= 100 | 100 | PASS |
| 2 | acceptance rate >= 70% | 0.8130 | PASS |
| 3 | schema/shape failure < 10% raw | 0.0000（0/123） | PASS |
| 4 | compiler failure < 10% raw | 0.0650 | PASS |
| 5 | oracle failure = 0 | 0 | PASS |
| 6 | internal compiler error = 0 | 0 | PASS |
| 7 | critical intervention correctness = 100% | 0 mismatch | PASS |
| 8 | irrelevant invariance = 100% | 0 mismatch | PASS |
| 9 | evidence masking world_truth preserved = 100% | 0 mismatch | PASS |
| 10 | leakage findings = 0 | 0 | PASS |
| 11 | **largest structural cluster < 10%** | **0.0400** | **PASS** |
| 12 | multi_tenant >= 8 | 29 | PASS |
| 13 | accepted / 100k output tokens > 2 | 45.02 | PASS |
| 14 | provider 无未解决的系统性挂死 | 0 | PASS |

---

## LEAST-USED SCHEDULER 验证（brief §7）

`state/mechanism-selection-trace-provider-run-003.jsonl`：25 次选择，其中 **13 次走
fallback**（无类别缺口时）。fallback 的 least-used 序列：

```
cache_invalidation_failure → cache_invalidation_failure → owner_cache_lag
→ revocation_after_issue ×5 → service_account_tenant_crossover ×2
→ stale_snapshot_read ×3
```

即 **5 个不同机制轮换**，且 `post_disable_session` 从未居于首选。这直接证明：
无缺口时 fallback 不再固定选同一个机制，而是选当前用次最少的 eligible mechanism。
同一结论另有 8 条单测钉死（`semantic_skeleton/tests/test_least_used_scheduling.py`）。

---

## TESTS

| suite | 结果 |
| --- | --- |
| `tests/`（legacy） | **1229 passed / 0 failed** |
| `semantic_skeleton/tests/`（Phase 2A） | **163 passed / 0 failed** |

> 记录一个实测发现：`pyproject.toml` 的 `testpaths = ["tests"]` **不收集**
> `semantic_skeleton/tests/`，所以单跑 `pytest` 会静默漏掉 Phase 2A 全部 163 项。
> 本次 run 未改 testpaths（那会改变 brief 预设的 1229 基线），两个 suite 分别实跑并分别记录。
> 建议下一阶段把 `semantic_skeleton/tests` 加进 testpaths。

---

## FINAL FREEZE

```
PHASE2A-FINAL-FREEZE.json          15 个组件 sha256 + 测试结果 + GO 门结果
PHASE2A-FINAL-FREEZE.sha256        上一文件自身的摘要
SHA256SUMS.txt                     16 行，`sha256sum -c` 复算全部 OK
status: PHASE_2A_PRODUCTION_READY
```

---

## FINAL STATUS

# GO

14 / 14 项通过。Phase 2A 的语义骨架 + 确定性编译器架构在真实 provider 输出下达成全部
Go 判据，包括此前唯一未通过的 structural cluster（10.68% → 4.00%）。

按 brief §14，**当前 run 完成后 STOP，不自动进入 500-world production**。

### 下一阶段建议（需单独决定）

1. **把 `semantic_skeleton/tests` 加进 `testpaths`**——否则 `pytest` 会静默漏掉 163 项。
2. **Generator-OOD pilot**（brief §47）：用独立第二模型或完全不同的 prompt family 生成
   held-out worlds，检验安全推理模型是否只学了 Step 的生成指纹。Phase 2A 的
   `generator_id` / `generator_model` / `prompt_family` 槽位已预留。
3. **Production budget**：按本次 2,221 output tokens / accepted world 与 45 accepted/100k，
   500 accepted 约需 1.1M output tokens（≈24 批 × 5）。Phase 1 同规模是 85M。
4. **Release split strategy**：八种 OOD split 已在 Phase 1 实现，需为 500-world 规模
   重新校准比例与 group-key 分布。
5. **Episode expansion scale**：当前每 world 17.6 个 episode；Phase 2A GO 后才扩到
   100k episode 级。
6. **ASW v0.x freeze policy**：world-spec schema 自 Phase 1 起未变；500-world 前应明确
   schema 变更窗口与既有 203 个 accepted world（69 + 100 + 34 中间态）的兼容策略。
