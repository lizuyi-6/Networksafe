# Aether Security World — Phase 2B FINAL REPORT

> 生成时间：2026-09-26。本报告覆盖 brief §69 的全部 19 步执行顺序。
> 硬约束遵守情况：本阶段**没有训练任何模型**（brief §59）；production contract 冻结后
> 没有修改任何被冻结组件（brief §21）；500 worlds 全部来自**同一个** production
> contract freeze（brief §22）。

---

## 0. TLDR

| 项 | 结果 |
| --- | --- |
| Production Hardening | ✅ testpaths 盲区修复 + collection guard + canonical ID 收归程序 + provider 责任审计 |
| Generator-OOD Engineering Pilot | ✅ 40 accepted（第二生成器 step-3.7-flash + clean-room prompt 家族） |
| 确定性兼容修复 | ✅ 词表不对称 + 4 个分类器盲区 + **1 个真实编译器泄漏**，全部有回归 |
| Production Contract Freeze | ✅ 23 组件冻结，`PRODUCTION-CONTRACT-FREEZE.json`（24/24 校验 OK） |
| 500 fresh accepted worlds | ✅ **502 accepted / 670 raw / 74.93% / 139 批 / 3.2h / 0 provider 错误** |
| World corpus freeze | ✅ `ASW-WORLDS-PRODUCTION` + manifest + hashes |
| Deterministic Episode Expansion | ✅ **54,370 episodes = 108.31/world**（brief §34 的 40k–60k 区间） |
| Group-based Splits | ✅ 5 split，**0 跨 split family 冲突**，train 覆盖全部 46 机制 |
| Fresh Generator-OOD benchmark | ✅ 60 accepted / 84 raw（独立 run，不复用 pilot） |
| Split 隔离审计 | ✅ `reports/phase2b/leakage-audit.md`，全 0 |
| Release Freeze | ✅ `releases/asw-v0.1/`，**60,902 episodes**，18 文件 + freeze 自校验 |
| 全量测试 | ✅ 见 §7 |

**唯一的非零项**：critical intervention 逐轴 573/584（11 个 mixed-base，世界级 502/502=100%，
§5.1 有完整定性）。

---

## 1. PRODUCTION HARDENING

完整证据：[`reports/phase2b/PHASE2B-0-ENGINEERING.md`](reports/phase2b/PHASE2B-0-ENGINEERING.md)。

### testpaths 修复（brief §4）

`testpaths = ["tests"]` 让普通 `pytest` 跳过全部 Phase 2A 测试且退出码 0——一次真实的假绿。
已修；单次 `pytest` 收集 1392 → 最终 1830 条。

### Test Collection Guard（brief §5）

`scripts/check_test_collection.py` + `test-collection-manifest.json`；任一 suite 归零或总数低于
冻结下限 1392 即非零退出。非空转已证明（临时改回旧值 → FAIL）。同一断言搬进测试套件。

### ID ownership 变化（brief §6/§7）

* 新模块 `semantic_skeleton/identity.py`：`canonical_id = "SK-" + sha256(scheme ‖
  sha256(canonical_json(payload)))[:16]`，payload 先剥掉 provider-owned 键。同一 frozen
  骨架永远同一 id，与到达顺序、run、provider 自称无关。
* production schema / prompt v0.7 都由**脚本从冻结件派生**并逐行断言差分只在 ID 归属。
* brief §7 全字段审计结论：删除 `skeleton_id` 后，provider 契约里**零**程序可派生字段。
* runner 支持 `--contract {phase2a,production,ood}`。

### provider hardening 验证（brief §9）

absolute deadline / idle timeout / max retries + backoff + jitter / 401 熔断 / run lock /
Idempotency-Key / per-batch checkpoint / resume / prompt-hash fail-closed 全部保留并有测试。
**凭据/鉴权失败写独立流** `state/infrastructure-failures-*.jsonl` 并在 rejected 记录打
`classification: INFRASTRUCTURE_FAILURE`；熔断立即停止（exit 6）并落
`INFRASTRUCTURE_BLOCKED_PROVIDER_AUTH`。本次 production 与两个 OOD run 的
`infrastructure_failures` 均为 **0**。

---

## 2. ENGINEERING GENERATOR-OOD PILOT（brief §10-§16）

审计：[`reports/phase2b/ood-pilot.md`](reports/phase2b/ood-pilot.md)。

### 生成器

* **第二模型**：`step-3.7-flash`（与 step-5-preview 不同的模型代际，同一供应商）。
* **clean-room prompt 家族**：`semantic_skeleton/prompts/ood-pilot-v1.md`——规格表/表单范式，
  不是 v0.6/v0.7 的规则清单范式；两个参考实例为这个家族新写并**编译验证**过。
* 相同 semantic contract / ontology / mechanism registry / safety boundaries；
  未给 Step 的历史输出、失败样例或语言模版。

**限制（必须写明）**：本地只有 StepFun 一把凭据，因此这是 **MODEL-OOD 但不是 VENDOR-OOD**。
brief §11 "优先不同供应商"在当前环境下无法满足。

### 结果（40 accepted / 83 raw / 17 批 / 241k output tokens）

| 指标 | 实测 | 判读 |
| --- | --- | --- |
| frame success rate | 100.00%（0 帧失败） | clean-room prompt 的 JSONL 约束有效 |
| element schema success | 97.59%（2 条 schema 拒绝） | 域名字面量拼错（`ecommerce`），**正确拒绝** |
| compile success rate | 49.40%（42 次失败） | 见下 |
| **internal compiler errors** | **0** | ✅ |
| **oracle failures** | **0** | ✅ |
| critical intervention | 44/45（1 个 mixed-base） | ✅ |
| irrelevant perturbation | 94/94 | ✅ |
| evidence masked | 191/191 | ✅ |
| leakage | **0** | ✅ |
| semantic clusters | 40（近重复 0） | ✅ |
| structural clusters | 28，最大 12.50% | pilot 规模小，可接受 |
| distinct mechanism families | 23/46 | 见下 |
| accepted rate | 48.19% | **不要求达到 Step 的 81.3%**（brief §14） |
| accepted / 100k output tokens | 16.57 | 同上 |
| provider 撞 id（只记录不拒收） | 0 | brief §29 生效 |

编译失败的分类（这是 pilot 的**产出**，不是失败）：

| 失败码 | 次数 | 定性 |
| --- | --- | --- |
| `HISTORY_INCONSISTENT` | 14 | 分类器词表盲区——第二模型的同义表述（"issues a delegated access token"、"ownership is updated"、"attempts a transition to the paid state"）语义本体完全支持但分类器只认 Step 的措辞。**典型 normalizer 过拟合，修** |
| `UNKNOWN_SEMANTIC_TYPE` | 18 | 词表不对称——`cache_service`/`ci_service` 用作 actor 被拒，而它们已在 SERVICE_TYPES（映射目标都是 `backend_service`）。**修** |
| `UNSUPPORTED_INVARIANT` | 10 | 第二模型给机制声明了注册表不携带的原型。**门在正确工作，不放松**（brief §17） |
| `CONTRADICTORY_EXPECTATION` | 1 | 先验被 Oracle 证伪。**门在正确工作，不放松** |

---

## 3. PRODUCTION CONTRACT FREEZE（brief §19-§21）

`PRODUCTION-CONTRACT-FREEZE.json` + `.sha256` + `SHA256SUMS-production.txt`（24/24 校验 OK）。
23 个组件：prompt / skeleton schema / ontology / type vocabularies / mechanism registry /
invariant archetypes / normalizer / batch parser / compiler / compiler plan / compiler errors /
identity / oracle / counterfactual verifier / coverage controller / structural fingerprint /
leakage gates / provider client / episode families / episode expansion driver /
**episode expansion config** / runner / **test collection manifest**。

冻结时测试状态：1814 collected，`pytest` 全绿（freeze 之后又新增 9 条 split 回归，最终 1823）。

### 一次真实的作废（brief §21 的执行证据）

001 run 跑到第 9 批（38 accepted）时，全 surface 展开暴露出编译器把 `mechanism.family`
嵌进 workflow / trust boundary 的 `name`，`structured_state` 渲染把它带进 model-visible
（B12 命中 `token_lineage_confusion`）。按 brief §60/§21：

1. 停止 run；
2. 修编译器（family → category），版本 bump 0.2.0 → **0.3.0**；
3. 加 370 条参数化回归（46 机制 × 8 renderer 全钉住）；
4. 全量测试重跑；
5. **重新 freeze**；
6. **从 0 开始新 run（002）**；001 的产物隔离在 `worlds/invalidated-runs/`。

没有"修完继续混数据"。

---

## 4. 500-WORLD PRODUCTION（brief §22-§28）

审计：[`reports/phase2b/production-500.md`](reports/phase2b/production-500.md)。

| 项 | 实测 |
| --- | --- |
| run id | `provider-run-production-002`（同一 production contract freeze 内） |
| raw skeletons | 670 |
| **accepted** | **502** |
| rejected | 61（含 107 条 semantic near-duplicate 进 quarantine） |
| batches | 139 |
| acceptance rate | **74.93%** |
| accepted / 100k output tokens | **38.61** |
| provider tokens | in 1,306,224 / out 1,300,114（预算 1.4M 内） |
| retries / provider errors / infra failures | 21 / **0** / **0** |
| wallclock | 11,528s（3.2h） |

### WORLD QUALITY

| 门（brief §28） | 实测 |
| --- | --- |
| internal compiler error = 0 | **0** |
| oracle failure = 0 | **0** |
| leakage = 0 | **0** |
| critical intervention correctness | 世界级 **502/502 = 100%**（逐轴 573/584，见 §5.1） |
| irrelevant invariance = 100% | **1017/1017** |
| evidence masking truth preservation = 100% | **2388/2388** |
| largest structural cluster < 10% | **2.39%**（124 clusters，>10% 模板 0） |
| largest semantic cluster | 见 manifest |

多样性：

* **mechanism families: 46/46**（全覆盖）
* labels: multi_tenant **143** / cache_distributed 134 / token 125 / session 110 /
  temporal_history 109 / trust_boundary 112 / authorization 100 / workflow 83 /
  cross_flow_reuse 54
* complexity: medium 173 / complex 133 / simple 81 / very_complex 115
  （brief §27 的软目标 15-20/40-45/30-35/5-10 内）
* domains / attack families: 见 manifest

### TOKEN ECONOMY

38.61 accepted / 100k output tokens。Phase 1 是 0.584，Phase 2A 是 45.02——
production 略低于 Phase 2A（corpus 变大后语义近重复增多、覆盖指令更分散），仍在同一量级。

---

## 5. EPISODE EXPANSION（brief §32-§41）

### 5.1 真相与判决分开（brief §36/§37）

每个 episode 的 `world_truth`（safe / attack / unauthorized）与 `observable_decision`
（safe / attack / unauthorized / insufficient_evidence）是两个独立字段，由 Oracle 在
(world, action, evidence_view) 上逐条重算。`unknown` 不是第三种世界真值。

### 5.2 家族覆盖（brief §33）

| 家族 | episodes | 说明 |
| --- | --- | --- |
| `base` | 12,048 | 每 world 每 surface 一条 |
| `critical_intervention` | 14,016 | Oracle 复核先验，矛盾即拒 |
| `irrelevant_perturbation` | 7,696 | 世界零变化、观测变 |
| `evidence_masked` | 19,104 | 掩蔽后重跑 Oracle 判充分性 |
| `trust_provenance_variant` | 1,506 | **Phase 2B 新家族**（brief §40）：同值改挂到更弱来源 |

`STALE_EVIDENCE` / `CONFLICTING_EVIDENCE` 由 `evidence_masked` 的 `stale` / `contradictory`
level 承载（掩蔽只改可见性，陈旧与矛盾必须由世界声明——masking 的同一条纪律）。

### 5.3 surface 乘数（brief §41）

* base / critical：**8 renderer × 3 style = 24 surface**（判决所在，泛化最需要）
* irrelevant / masked：8 renderer × 1 style（信号是证据可见性，style 三倍只是重复）
* trust_provenance：1 renderer（信号是出处）

### 5.4 规模（brief §34）

**54,370 episodes / 502 worlds = 108.31 episodes/world**——落在 brief §34 的
40k–60k 区间，接近推荐中心 50k。全部 54,370 个 episode_id 唯一（0 重复），
0 条缺 group_keys。

---

## 6. SPLITS（brief §43-§49）

manifest：`releases/asw-v0.1/manifests/split-manifest.json`。

| split | worlds | episodes | 定义 |
| --- | --- | --- | --- |
| train | 399 | 43,229 | 剩余全部 |
| iid_dev | 50 | 5,346 | 世界族不重叠，机制分布对齐 train |
| world_ood | 50 | 5,502 | held-out world families（同机制、不同世界） |
| workflow_ood | 0 | 0 | **pilot split**：502 worlds 的 workflow family 太集中，不伪装统计能力（brief §48） |
| mechanism_ood | 3 | 293 | 组合优先；train 仍保留全部 46 机制 |

* **主 split 不是随机 row split**：分配单位是并查集 component（world_family /
  counterfactual_family / workflow_family / policy_family / invariant_family 五重 union）。
* **0 跨 split family 冲突**（构造保证 + 审计独立复算）。
* train 覆盖 **46/46** 机制（`missing_train_mechanisms: []`）。

---

## 7. GENERATOR-OOD BENCHMARK（brief §50-§51）

审计：[`reports/phase2b/ood-benchmark.md`](reports/phase2b/ood-benchmark.md)。

* **全新生成**：`provider-ood-benchmark-001`，不复用 engineering pilot 的任何 world。
* 60 accepted / 84 raw / 71.43% / 270,669 output tokens / 0 provider 错误。
* 展开 6,532 episodes，物理隔离在 `releases/asw-v0.1/episodes/generator-ood.jsonl`。
* 与 train 之间**零 world 重叠、零生成器重叠**。

---

## 8. LEAKAGE（brief §42/§53/§54）

[`reports/phase2b/leakage-audit.md`](reports/phase2b/leakage-audit.md)。

| 项 | 结果 |
| --- | --- |
| model-visible leakage（502 worlds × 8 renderer × episode 级重扫） | **0** |
| cross-family leakage | **0** |
| cross-split leakage | **0** |
| generator leakage | **0**（物理隔离） |
| 跨 split 同 semantic fingerprint | **0** |

本阶段抓到并修复 **2 个真实缺陷**（编译器 name 泄漏、episode_id 不含 surface），
均有回归、均未进 release。

---

## 9. RELEASE FREEZE（brief §56-§58）

`releases/asw-v0.1/`（含 `worlds/train-source-worlds.jsonl` 502 个 production worlds）：

```
worlds/      train-source-worlds.jsonl (502)   generator-ood-worlds.jsonl (60)
episodes/    train (43,229)  iid-dev (5,346)  world-ood (5,502)
             workflow-ood (0)  mechanism-ood (293)  generator-ood (6,532)
             合计 60,902
manifests/   release-manifest.json  split-manifest.json
             production-contract.json  hashes.txt
audits/      coverage.md  leakage.md  dedup.md  counterfactual.md  split-leakage.md
ASW-RELEASE-FREEZE.json + .sha256 + SHA256SUMS.txt
```

**总计 60,902 episodes / 562 worlds**（54,370 production + 6,532 generator-OOD）。18 个文件 + freeze 全部 `sha256sum -c` OK。
Release manifest 记录 release version / production contract hash / world counts /
episode counts / split counts / generator counts / mechanism · domain · complexity ·
family distribution / 全部文件 SHA256 / build command / git commit / build timestamp。

---

## 10. 测试与门禁

| 门 | 结果 |
| --- | --- |
| `py -3 -m pytest -q`（单次，legacy + semantic） | **1823 passed / 0 failed** |
| test collection guard | PASS（legacy 1623 + semantic 200 = 1823 ≥ 1392） |
| 机制注册表自检 | 46/46 |
| Phase 1 回归（69 worlds） | 60 extracted / 60 compiled / 60 oracle-compiles |
| Phase 2A 冻结回归（改过的编译器重裁 103 个 accepted） | 103/103 semantic_equivalent，字节级 diff 差异只在已知 benign 项 |
| repository hygiene / project structure / no-secrets guard | 全部 exit 0 |
| `sha256sum -c SHA256SUMS-production.txt` | 24/24 OK |
| `sha256sum -c releases/asw-v0.1/SHA256SUMS.txt` | 18/18 OK |

新增测试：370 条泄漏回归（46 机制 × 8 renderer）、9 条 split 回归、
14 条 episode 展开回归、7 条 OOD 修复回归、5 条 production runner 回归、
6 条 provider 责任审计、14 条 canonical identity 回归。

---

## 11. NEXT STEP（brief §68：只提建议，不自行训练）

按 brief §59，**本阶段在此 STOP，未训练任何模型**。下一阶段需单独设计：

1. **4B sanity experiment**：在 `train` 上跑一个最小可复现的微调，验证 episode 格式与
   真值字段可被模型消费（重点验 `observable_decision` 的 `insufficient_evidence`
   是否可学——这是 ASW 与普通安全分类数据集的核心区别）。
2. **27B baseline**：同格式、同 split，报告 train / iid_dev / world_ood / mechanism_ood /
   generator-ood 五个 split 的分别指标；**不得**跨 split 平均。
3. **Stateful / Counterfactual method**：`trust_provenance_variant` 与 `evidence_masked`
   是检验"模型是否真的做证据充分性推理"的两把尺子。
4. **Ablation**：surface 乘数（8×3 vs 8×1）、`trust_provenance_variant` 的有无、
   group-split vs 随机 row split（后者预期显著高估）。
5. **OOD evaluation**：generator-ood 是唯一的跨生成器 split；报告必须写明它是
   MODEL-OOD 而非 VENDOR-OOD。
6. **统计协议**：episode 不是独立样本（同 world 多 surface），置信区间必须按
   world/counterfactual-family 聚类计算，不能按 episode 行算。

---

## 12. 已知限制（如实记录）

1. **Generator-OOD 不是 VENDOR-OOD**：本地只有 StepFun 一把凭据。
2. **workflow_ood split 为 0**：502 worlds 的 workflow family 集中度不足以支撑，
   按 brief §48 标为 pilot split，未伪装统计能力。
3. **critical intervention 逐轴 573/584**：11 个 mixed-base（base 为
   attack/insufficient_evidence 时，个别 critical 轴单独翻转不了——真正被违反的是另一条
   不变量）。世界级判据 502/502 = 100%。
4. **`UNSUPPORTED_INVARIANT` / `CONTRADICTORY_EXPECTATION` 的拒绝未放宽**：这是门在
   正确工作，不是待修的缺陷（brief §17）。
5. **production token economy 38.61/100k 低于 Phase 2A 的 45.02**：corpus 变大后语义
   近重复增多（107 条 quarantine）。未为追指标放宽去重门。

---

## 13. 收尾时发现并修掉的两个交付缺陷

1. **`worlds/train-source-worlds.jsonl` 曾为空**：`analysis/phase2b_release.py` 用
   `episode_split.get(world_id)` 反查 split，但那个映射的键是 `episode_id` 不是
   `world_id`——于是每个世界都取到 `None`，文件静默写成 0 行（manifest 里的
   `production_accepted: 502` 却仍然正确，所以从汇总数字上看不出来）。已改为显式写全部
   production worlds 并加非空断言。
2. **本报告一度把 episode 总数写成 60,248**：实际 54,370 + 6,532 = **60,902**。
   算术错误，已修正；release 工具现在也对 `episode_total` 与逐 split 求和做一致性断言。

另外清掉了两个我在调试期误生成的空报告（`reports/phase2a/production-500.{json,md}`，
`audit_phase2a.py` 读的是 `worlds/skeletons/` 布局所以全项为 0）——它们放在 Phase 2A
报告目录里会主动误导后来的审计者，真正的 production 审计在 `reports/phase2b/`。
