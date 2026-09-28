# Phase 2B 泄漏审计（brief §42 / §54）

> 三层扫描：world-level（Phase 2B-0 已做）、rendered-episode-level（brief §42）、
> cross-split-level（brief §54）。数字来自 `reports/phase2b/production-500.json`、
> `reports-staging/splits/split-manifest.json`、`releases/asw-v0.1/manifests/release-manifest.json`。

## 1. Rendered-episode-level leakage（brief §42）

扫描器：`security_world.validation.lexical.scan_model_visible`——只扫
`observation.model_visible` 的键与字符串值（数字/布尔/None 不审）。

| 检查 | 502 production worlds | 说明 |
| --- | --- | --- |
| explicit label words | **0** | 判决词表（world_truth / observable_decision / attack …）不出现在 model_visible |
| mechanism name leakage | **0** | 机制族名（= 攻击族名）不出现在 model_visible |
| attack family leakage | **0** | 同上；修复前的缺陷见 §4 |
| template-label correlation | 见 `production-500.json` 的 `base_labels` | base 标签由 Oracle 逐条重算，不由模板决定 |
| metadata projection | **0** | `trust_level` / 判决 / split / group key 不在七键投影内（D7） |
| counterfactual marker leakage | **0** | `intervention` 只在 episode 文档层，不进 observation |

**这个扫描曾经抓到过一个真实的编译器泄漏**（见 §4），这就是它存在的理由。

## 2. Cross-split leakage（brief §54）

扫描器：`analysis/phase2b_split.py audit()` + `tests/integration/test_phase2b_split.py`
的合成语料回归。五个 family key 全部参与并查集，split 之间重叠由构造保证为零，
审计步骤独立复算（不信任构造）：

```
cross_split_family_conflicts: 0
```

| family key | 参与 union | 结果 |
| --- | --- | --- |
| `world_family_id` | ✅ | 0 冲突 |
| `counterfactual_family_id` | ✅ | 0 冲突 |
| `workflow_family_id` | ✅ | 0 冲突 |
| `policy_family_id` | ✅ | 0 冲突 |
| `invariant_family_id` | ✅ | 0 冲突 |

**主 split 不是随机 row split**（brief §43）：分配单位是并查集 component，一个
component 的全部 world（因而其全部 episode）永远在同一个 split。
`tests/integration/test_phase2b_split.py` 用合成语料钉死这一点。

## 3. Generator leakage（brief §51）

| split | 生成器 | 文件 |
| --- | --- | --- |
| train / iid_dev / world_ood / workflow_ood / mechanism_ood | step-5-preview（production contract 冻结） | `episodes/*.jsonl` |
| generator_ood | step-3.7-flash（fresh benchmark run，不复用 engineering pilot） | `episodes/generator-ood.jsonl` |

两个生成器之间**没有任何 world 重叠**：pilot 的 40 个世界与 benchmark 的世界是两次
独立 run 的产物，且都物理隔离在 `worlds/ood/` 与 `worlds/production/`。

## 4. 抓到的两个真实泄漏（以及为什么它们没进 release）

### 4.1 workflow / trust boundary 名称嵌攻击族名（release blocker，已修）

`semantic_skeleton/compiler/compiler.py` 曾把 `mechanism.family` 写进 workflow 的
`name`（`"{family} lifecycle"`）和 trust boundary 的 `name`（`"{family} boundary"`）。
族名就是攻击族名，`structured_state` renderer 把 `name` 带进 model-visible，
B12 投影白名单在渲染时命中 `token_lineage_confusion`。

发现路径：Generator-OOD pilot 的**全 surface 展开**（8 renderer × 3 style）——
Phase 2A 的审计只扫 http_request 面，所以它从 Phase 1 活到 Phase 2B。

处置：按 brief §60/§21，**停止 production run（001 已跑 9 批/38 accepted）、修编译器、
版本 bump 到 0.3.0、重新 freeze、从 0 开始新 run（002）**。001 的产物隔离在
`worlds/invalidated-runs/provider-run-production-001/`，没有混进 500。

回归：`tests/integration/test_phase2b_leak_fix.py` 把 **46 机制 × 8 renderer** 全钉住
（370 参数化用例），同类泄漏不再有藏身之处。

### 4.2 `episode_id` 不含 surface（pilot 阶段抓到，已修）

engine 的 `_derive_episode_id` 只哈希 (world, family, variant_type, action,
intervention, variant_key)，**不含 renderer/style**。Phase 1/2A 每族只用一个
renderer 所以从没撞过；铺满 surface 后同一个 base 变体拿到 8 个一模一样的 id
（实测 304 条 episode 只有 49 个不同 id）。修复：release 层 id 补上 surface，
驱动内硬断言唯一性（`analysis/phase2b_expand.py`）。

## 5. Dedup（brief §53）

四层去重在 split 前后各做一次，结果见 `releases/asw-v0.1/audits/dedup.md`：

| 层 | 口径 | 结果 |
| --- | --- | --- |
| exact | spec 全文档 | 0 重复 |
| normalized | 剥 domain/名字/摘要后的结构 | 见 manifest `dedup` |
| semantic | `semantic_fingerprint` | 见 manifest `dedup` |
| structural | 编译形状签名 | 502 worlds → 见 manifest |

跨 split 同 fingerprint：**0**。若出现，按 brief §53 修 split（族分配），
**不删单条 episode**——family 完整性优先。

## 6. 结论

| 项 | 状态 |
| --- | --- |
| rendered-episode-level leakage | **0** |
| cross-split family leakage | **0** |
| generator leakage | **0**（物理隔离） |
| cross-split semantic fingerprint | **0** |
| 已抓到的 2 个真实缺陷 | 均已修复、有回归、未进 release |
