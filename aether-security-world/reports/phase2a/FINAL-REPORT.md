# Aether Security World — Phase 2A 最终报告
## Semantic Skeleton → Deterministic Compiler → ASW World

> 数据来源：`reports/phase2a/{final-100,go-no-go,revalidate,phase1-regression,mechanism-selfcheck,smoke-10,audit-30,audit-60}.json` 与 `state/phase2a-{progress,coverage,frozen}*.json`。
> 所有数字均由脚本实测产出；凡未测到的如实写"未测/未达标"，不补推。

---

## === ARCHITECTURE ===

**旧**：LLM → 完整 world JSON（含 resource_states / state_preconditions / policy AST / 证据 ID / 轴 ID / verdict）。
**新**：LLM → 语义骨架（只写安全语义）→ 确定性编译器 → 完整 ASW world-spec → 既有 gates → Oracle。

实现状态（全部落盘、全部有测试）：

| 层 | 文件 | 状态 |
| --- | --- | --- |
| 语义骨架 schema | `semantic_skeleton/schemas/semantic-skeleton.schema.json` | 完成，24 必填字段，`additionalProperties:false` |
| 语义事实本体 | `semantic_skeleton/ontology.py` | 完成，65 个语义事实 / 9 分组（含 surface 分组） |
| 语义类型词表 | `semantic_skeleton/vocabularies.py` | 完成，actor/resource/service 三张表 → schema 枚举 |
| 机制族注册表 | `semantic_skeleton/mechanisms.py` | 完成，46 个机制 / 9 覆盖类别 / 13 个 multi_tenant |
| 不变量原型库 | `semantic_skeleton/compiler/archetypes.py` | 完成，27 个原型 |
| 确定性编译器 | `semantic_skeleton/compiler/compiler.py` | 完成，11 个阶段，每个失败带稳定 reason code |
| 装载与 §17 扫描 | `semantic_skeleton/skeleton.py` | 完成，ID/路径/hash/程序-owned 键/判决词五类扫描 |
| 先验复核器 | `semantic_skeleton/validators/verify.py` | 完成，按 oracle 轨迹重判 counterfactual 分类 |
| 语义指纹 | `semantic_skeleton/fingerprint.py` | 完成，骨架级近重复检测 |
| 覆盖控制器 | `semantic_skeleton/coverage.py` | 完成，硬配额 + 停顿检测 + 无缺口时按最少用机制铺开 |
| Provider 客户端 | `semantic_skeleton/generator/live.py` | 完成，绝对时限/空闲时限/401 熔断/jitter/幂等/checkpoint |
| Runner | `scripts/skeleton_run.py` | 完成，逐元素处理 + 运行锁 + 冻结校验 |
| Generator prompt | `semantic_skeleton/prompts/v0.6.md` | 完成，29,863 字符，由活注册表拼装 |

**编译器确定性**：同一骨架重复编译得到 canonical-json 逐字节相同的文档（测试
`test_compile_is_byte_stable` 钉死）。所有 ID 由 `stable_hash(skeleton_id, slot)` 派生，
无随机 UUID、无挂钟。

**LLM 不是真值来源**：`attack_family` 由机制派生（骨架里出现即拒）；
`semantic_expectation` 只是先验，最终分类由 Oracle 轨迹重判，矛盾即拒收
（`CONTRADICTORY_EXPECTATION`）——这正是 Phase 1 因果审计两个 mismatch 的处置。

---

## === REGRESSION ===

> 全量门禁实跑：`py -3 -m pytest -q` → **1229 passed / 0 failed**（880.59s）。
> 仓库守卫：`check-repository-hygiene` exit 0（No tracked generated artifacts found）、
> `check-project-structure` exit 0（project_contracts=passed / required_files=31 / absolute_user_paths=0）。

- 测试：**1229 passed / 0 failed**（880.59s 全量实跑；Phase 2A 新增 155 项，含 46 个机制族的编译+schema 参数化用例与 51 项有效反事实改法用例）。
- 机制族自检：`py -3 scripts/mechanism_selfcheck.py` → **46 / 46 passed**（每个机制都真的编译、过 world-spec schema、跑 Oracle、且至少一条反事实能翻转判决）。
- Phase 1 回归：`py -3 scripts/phase1_regression.py --limit 69` → 69 个 accepted 世界中
  **60 个抽出骨架、60 个编译成功、60 个 Oracle 可判、43 个 attack_family 保持、
  平均不变量族重合度 0.85**。未抽出的 9 个如实列在 `reports/phase2a/phase1-regression.json`
  （3 个是 `prompt_injection`/`ssrf`——引擎本来就无法判定 payload 类；6 个是不变量组合
  不对应任何机制，属新编译器覆盖面缺口）。
- Phase 1 数据未被动过：`worlds/accepted/milestone-1-100.jsonl`（69）与
  `worlds/raw/provider-run-001.jsonl`（219）保持原样，`state/phase1-frozen-snapshot.json`
  是开跑前的快照。

---

## === PROVIDER ===

| 指标 | 值 |
| --- | --- |
| run id | provider-run-002 |
| prompt 版本 | v0.5（最终 run）；v0.2/v0.3/v0.4 为合同迭代过程，已分别归档 |
| 调用次数 | 29（v0.5 run） |
| 传输层失败 | 0 |
| 重试 | 3 |
| usage 缺失调用 | 0 |
| 累计 latency | 2029.6 s（≈34 分钟） |
| finish_reason | 全部 `stop`（无截断） |

**故障对策核对**（brief §38）：Phase 1 的 85 分钟 keep-alive 滴漏挂死在 Phase 2A 的结构里
不可能再发生——`absolute_deadline_s`（默认 1800s）超时即取消，不等 per-op 超时。
401 熔断在最后一次 run 里**真的触发了**：凭据失效后客户端在 5 次连续失败后停止，
而 Phase 1 同类故障产生了 1992 次重试。

**运行锁**：`state/phase2a-run.lock`。Phase 2A 实测踩过一次并发事故（TaskStop 只杀掉了
shell 包装，python 子进程又跑了 4 批，帧文件里混进两种 prompt 版本）。锁是 fail-closed 的，
第二个实例直接退出；锁自检在 `scripts/skeleton_run.py` 内有对应断言。

---

## === GENERATION ===

| 指标 | 值 |
| --- | --- |
| raw skeletons | 143 |
| valid skeletons（编译+复核通过） | 103 |
| accepted | 103 |
| rejected | 16 |
| quarantined | 24 |
| acceptance rate | 0.7203 |
| 语义近重复（quarantine 主因） | 24 中的多数 |

拒绝原因分布（`state/phase2a-progress.json`）：`HISTORY_INCONSISTENT` 6、
`semantic_near_duplicate` 12、`CONTRADICTORY_EXPECTATION` 2、`UNKNOWN_SEMANTIC_TYPE` 1、
`element_skeleton_rejected` 2。

**重裁**：`scripts/revalidate_phase2a.py` 用修好 G12 泄漏后的编译器把 103 个骨架全部重编译，
**103/103 成功、103/103 语义等价**（不变量族/关键轴/无关轴/attack_family/策略与证据计数
逐项相同，唯一变化是 `events[].summary` 里的机制族名被中性词替换）。

---

## === EFFICIENCY ===

| 指标 | Phase 1 | Phase 2A | 变化 |
| --- | --- | --- | --- |
| accepted | 69 | 103 | — |
| raw | 219 | 143 | — |
| acceptance rate | 0.3151 | 0.7203 | +128.6% |
| output tokens | 11,809,745 | 265,426 | — |
| **accepted / 100k output tokens** | **0.584** | **38.806** | **66.45x** |
| accepted / 1M input tokens | — | 371.5 | — |
| accepted / provider hour | — | 182.7 | — |
| output tokens / accepted world | 171,156 | 2,577 | — |

brief §3 的最低门槛是 > 2 / 100k，目标区间 3～5。实测 **38.8**，高于目标区间 7.7 倍，
是 Phase 1 的 **66.45 倍**。这不是靠只生成简单世界换来的——复杂度分布
simple 23 / medium 31 / complex 25 / very_complex 24，与 brief §54 的目标区间
（15-20 / 40-45 / 30-35 / 5-10%）相比 medium 偏低、very_complex 偏高，如实记录。

---

## === COMPILER ===

- 失败分布：`HISTORY_INCONSISTENT` 6、`UNKNOWN_SEMANTIC_TYPE` 1（共 7 次 / 143 raw = 4.9%）。
- **INTERNAL_COMPILER_ERROR = 0**（brief §42 目标 0）。
- 机制族自检 46/46 通过，意味着注册表里没有"编译不出来"或"反事实空操作"的机制。

---

## === QUALITY ===

- Oracle 失败：**0**
- 泄漏发现：**0**（1827 个 episode 全扫；修复前是 180，全部是机制族名
  `invalid_state_transition` 泄进 timeline summary，已由编译器消毒 + prompt 禁止双管修复）
- 精确重复：0（skeleton_id 黑名单 + 语义指纹双挡）
- 结构多样性：44 个结构簇，最大簇占比 **0.1068**，>10% 模板数 1
- 语义多样性：**103 个语义簇（每个骨架一个）**，最大簇占比 0.0097，>10% 模板数 0
- 覆盖：9 类标签全部达到 brief §27 配额；multi_tenant **18**（Phase 1 = 0）

---

## === COUNTERFACTUAL ===

| 家族 | 总数 | 结果 |
| --- | --- | --- |
| critical intervention | 233 (axis, probe) 组合 | verdict_flip 221（94.85%）；verdict_invariant 12 |
| 先验矛盾（按轴聚合，与 runner/G5 同语义） | — | **0** |
| 混合 base（同轴在别的 probe 上证实） | 12 | 不计缺陷 |
| irrelevant perturbation | 414 | 判决逐字节一致 **414/414 = 100%** |
| evidence masked | 974 | world_truth 保持不变 **974/974 = 100%** |

base 标签分布：attack 132 / insufficient_evidence 44 / safe 30（三类都有，标签不塌缩）。

---

## === CAUSAL AUDIT ===

`reports/phase2a/counterfactual-causal-audit.md`：Phase 1 的两个
`verdict_invariant_expected_but_flipped` mismatch **全部**归到
`generator_mislabeled_critical_fact`——生成器把一条它自己列进 `critical_state_variables`、
且被作用域内不变量真正读到的轴，声明成 `expected_effect=verdict_invariant`。
编译器只改了声明的那一条路径（`changed_paths` 恒为单元素），Oracle 求值自洽。

审计过程中另外抓到并修掉一个**引擎缺陷**：
`analysis/pipeline.py` 的 `family_view_for_action` 用重盖后的 `episode_id` 去查
`expand_family` 的 `diffs`，每次 lookup 落空并回落到 `WorldDiff(())`——G6 的
"无关扰动不得改变世界状态"这一半检查因此**恒真**。已修（保留重盖前的原始 id 做键），
回归测试 `test_family_view_diffs_resolve_for_every_variant` 钉死（临时回退该修复会使它失败，已验证）。

---

## === COVERAGE ===

| 标签 | accepted | brief §27 目标 |
| --- | --- | --- |
| multi_tenant | 18 | 8 ✓ |
| authorization | 33 | 8 ✓ |
| session | 22 | 8 ✓ |
| token | 16 | 8 ✓ |
| workflow | 30 | 10 ✓ |
| cache_distributed | 24 | 8 ✓ |
| trust_boundary | 9 | 8 ✓ |
| temporal_history | 21 | 8 ✓ |
| cross_flow_reuse | 8 | 8 ✓ |

- distinct mechanism families：27 / 46
- distinct attack families：22
- domains covered：16 / 20

**multi_tenant 专项短板（如实报告）**：数量达标（18），但 brief §25 点名的十个机制只跑到
**5 个**（`cross_tenant_cache` 3、`horizontal_peer_access` 9、`resource_tenant_mismatch` 2、
`cross_service_tenant_propagation_delay` 2、`cached_authorization_cross_tenant_reuse` 2），
attack_family 只有 2 种。`stale_tenant_context` / `token_tenant_mismatch` /
`service_account_tenant_crossover` / `delegated_tenant_access` /
`tenant_switch_stale_session` / `tenant_identifier_collision` 六个机制 0 accepted。
根因是覆盖控制器在"无缺口"时落到固定清单，模型反复产同一批顺手机制。

---

## === TOKEN ECONOMY ===

见 EFFICIENCY 节。单 world 平均 2,577 output tokens（Phase 1：171,156）。

---

## === RISKS ===

1. **结构簇 10.68% 越过 10% 红线**（唯一未达标项）。根因明确：覆盖控制器无缺口时落到
   固定清单，`post_disable_session` 一个机制占了 11/103。**修复已实现**
   （`semantic_skeleton/coverage.py` 的 `directive()` 无缺口分支改为按最少用机制族排序），
   但**未经 provider run 验证**——修完后凭据失效，无法重跑。
2. **multi_tenant 机制多样性 5/10**。同一个根因，同一个未验证的修复。
3. **`HISTORY_INCONSISTENT` 6 次**（4.2%）：关键词分类器对生成器措辞的覆盖仍不完整。
   已加同义词表（v0.5）后从 8 次降到 6 次，但未归零。
4. **medium 复杂度占比 30%**，低于 brief §54 的 40-45% 目标；very_complex 24% 高于 5-10%。
   这是覆盖控制器按标签而非按复杂度调度的副作用。
5. **凭据失效**：StepFun key 在 Phase 2A 收尾阶段失效（401），最后一次 run 无法完成。
   熔断机制按设计停止，未产生重试风暴。

---

## === GO / NO-GO ===

**NO-GO（13/14 项通过）。**

通过的 13 项：accepted ≥ 100（103）、acceptance ≥ 70%（72.03%）、schema/shape 失败
< 10%（0/143 = 0）、compiler 失败 < 10%（4.9%）、oracle 失败 = 0、internal compiler
error = 0、critical intervention 无矛盾、irrelevant invariance 100%、evidence masking
100%、leakage = 0、multi_tenant ≥ 8（18）、accepted/100k > 2（38.8）、provider 无系统性挂死。

未通过的 1 项：**largest structural cluster < 10%**（实测 0.1068）。

按 brief §62"不要为了推进项目降低标准"，结论是 **不具备进入 500-world production**。
前置条件是那一个未达标项，而它的修复已经实现、有单测、只差一次 provider run 验证：

1. 用有效凭据重跑 `py -3 scripts/skeleton_run.py final --live`（prompt v0.6 已冻结，
   覆盖率控制器已改为按最少用机制铺开，编译器已消毒机制族名泄漏，skeleton_id 黑名单已
   改为基于全部已解析骨架）。
2. 重跑后若 structural cluster < 10% 且 multi_tenant 机制多样性 ≥ 8/10，即可 GO。

---

## 附：产物清单

```
semantic_skeleton/schemas/semantic-skeleton.schema.json
semantic_skeleton/prompts/v0.6.md (+ .json)
semantic_skeleton/{ontology,vocabularies,mechanisms,fingerprint,coverage,effective,skeleton}.py
semantic_skeleton/compiler/{__init__,errors,plan,archetypes,compiler}.py
semantic_skeleton/validators/{__init__,verify}.py
semantic_skeleton/generator/{__init__,live,parser}.py
semantic_skeleton/tests/（6 个测试模块，155 用例）
semantic_skeleton/fixtures/stale-tenant-context.json
worlds/skeletons/raw/provider-run-002.jsonl(.v05-run)          # 143 raw 骨架
worlds/skeletons/accepted/provider-run-002.jsonl               # 103 accepted（重裁后）
worlds/skeletons/rejected|quarantine/provider-run-002.jsonl.v05-run
worlds/compiled/accepted/phase2a-100.jsonl.v05-run             # 103 编译产物
reports/phase2a/{smoke-10,audit-30,audit-60,final-100}.{md,json}
reports/phase2a/{go-no-go,revalidate,phase1-regression,mechanism-selfcheck,causal-audit-cases}.json
reports/phase2a/{counterfactual-causal-audit,multi-tenant-coverage,efficiency-comparison,provider-reliability}.md
state/phase2a-frozen.json  state/phase2a-progress*.json  state/phase2a-coverage*.json
state/phase1-frozen-snapshot.json
provenance/provider-run-002.jsonl.v05-run  provenance/phase2a-checkpoints/
scripts/{skeleton_run,audit_phase2a,phase2a_final_audit,phase2a_reports,phase1_regression,
         revalidate_phase2a,mechanism_selfcheck,build_skeleton_prompt,causal_audit}.py
```
