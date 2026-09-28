# Aether Security World — Phase 1 交付报告

| | |
| --- | --- |
| 文档 | `docs/PHASE1-REPORT.md` |
| 对应设计 | `docs/design-v0.1.md` v0.1-r1，§12.1 里程碑 M0–M5 |
| 日期 | 2026-09-21 |
| 范围 | Phase 1：**只建数据工厂能力 + 录播自测**。未做任何模型训练、未发生任何真实 API 调用、未生成 500-world 规模语料 |

**本报告的验证分级**：凡标注"本 ask 实跑"的检查，均为本报告撰写过程中亲自执行并记录输出；标注"素材提供"的来自各实现子代理的交付记录（本 ask 的输入材料），未由本 ask 重跑。测试轮次 1（1063 passed / 5 failed）属素材提供；轮次 2（1068 passed / exit 0）由本 ask 重跑复现，见 §4。

---

## 1. 建成了什么（模块地图与一行职责）

设计 §3.1 的七层单向依赖（L0→L7，DAG）已全部落盘。地图按层给出，职责一行；每个模块的实际文件见 `security_world/`、`generation/`、`worlds/`、`analysis/` 源码树。

### L0 契约层（架构师所有，实现者只读，未改动）

| 路径 | 职责 |
| --- | --- |
| `schemas/*.schema.json`（8 个 draft 2020-12） | world-spec / world / action / episode / evidence / policy / oracle-output / release 的契约；`world.schema.json` 结构上禁止 `ground_truth`/`label`/`verdict` 字段（设计 §4.1） |
| `schemas/examples/` | 5 个正夹具 + 7 个负夹具；负夹具的"拒绝路径 = 声明路径"由 `validate_schemas.py` 反向验证（设计 §19 B4/B13） |
| `configs/default.json` | 质量门阈值、`critical_axes_whitelist`、masking level 映射、group keys、投影白名单等全部引擎参数 |
| `docs/design-v0.1.md` + `docs/brief.md` | 设计与需求逐字副本 |
| `scripts/validate_schemas.py` | schema 元校验 + 正/负夹具验收（bootstrap 门） |

### L1 `security_world/model/` — 语义内核（Agent A）

| 模块 | 职责 |
| --- | --- |
| `canonical.py` | `canonical_json`（sort_keys + 紧凑分隔符 + `ensure_ascii=False` + `allow_nan=False`）、`stable_hash`、`derive_family_id`——全仓序列化与哈希的唯一出口 |
| `rng.py` / `clock.py` | `make_rng`/`derive_seed(s)`/`shuffled`（只接受显式非负整数种子）；`Clock` 协议 + `FixedClock`/`MutableClock`、`parse_instant`/`compare_instants`/`instant_delta_ms`/`is_within` |
| `entities.py` / `documents.py` | 19 个实体/文档 frozen dataclass + schema 枚举唯一权威表（20 类不变量、41 类攻击族假设、20 domain） |
| `refs.py` | §4.3 唯一 BNF、`ReferenceRegistry`（实体 id 按最长已知 id 切分，非正则贪婪）、action 视图展开、DSL 文档遍历 |
| `world.py` / `events.py` / `episode.py` | `WorldInstance`/`WorldSpec`/`Episode`/`Event`/`StateFragment`；`Episode.serialize_for_model()` 构造期排除 `decision_metadata` 与 `oracle_output` |
| `compile.py` / `loader.py` / `schemas.py` / `config.py` / `errors.py` | `compile_spec` 五步契约（引用完整性/ref 全域/token 环/policy 非空洞/时间单调/applies_to/轴白名单，全带稳定 reason_code）；`load_world`/`load_world_spec`/`load_episode`/`load_action`；jsonschema 注册表 |

### L2 `security_world/policy|invariants|workflows` — 语义引擎（Agent B）

| 模块 | 职责 |
| --- | --- |
| `policy/ast.py` + `parser.py` | 27 个 op 的 AST（`ALL_OPS` 钉死数量）与 `parse_expr`（未知 op/arity/路径违规/超深嵌套 ⇒ `DslError`） |
| `policy/evaluator.py` + `context.py` | `eval_expr` 短路求值、类型严格（`eq(lit 1, lit true) is False`）、UNKNOWN 永不放行；`EvalContext.consulted_refs` 动态台帐 |
| `policy/matching.py` | `decide_policy`：priority desc + policy_id asc + 首条为真 + 闭世界 deny（设计 §7.3） |
| `invariants/templates.py` + `registry.py` + `scope.py` | 17 个模板覆盖设计 §7.4 的 Phase 1 七类；三分划完备且不交（`partition_is_complete`） |
| `workflows/machine.py` + `types.py` | `WorkflowMachine` 与 §15.3 的 `state_is`/`transition_allowed`；`required_privileges` 缺失即不允许（fail-closed） |

### L3 `security_world/oracle/` — 确定性 oracle（Agent C）

| 模块 | 职责 |
| --- | --- |
| `oracle/oracle.py` | `run_oracle` 两趟算法：truth 趟在完整世界上算 `world_truth`；observable 趟只凭已建立事实重跑同一套规则 |
| `oracle/overlay.py` | 把已建立事实覆盖到世界副本上重跑（fixpoint 保证"重跑读到的每个事实都已建立"） |
| `oracle/evidence_view.py` | `EvidenceView`/`Fact`/`FactTable`/`build_fact_table` 的**参考实现**——`security_world/evidence/` 未落盘前的替身，`run_oracle` 只依赖结构协议（见 §5 未实现清单） |

### L4 `security_world/expansion/` — 反事实与渲染（Agent D）

| 模块 | 职责 |
| --- | --- |
| `diff.py` + `counterfactual.py` | `diff_worlds`（只比最大可寻址路径、排除已注册实体容器路径）与 `critical_intervention`；`changed_paths == (intervention_variable,)` 机械断言 |
| `perturbation.py` | 7 个无关轴（UA / X-Request-Id / header 键序 / rendered_text 行序 / trace id / 时间戳格式 / 展示名大小写）；空扰动即抛 |
| `masking.py` | 7 个 masking level 按 §9.4 写死映射构造并逐条复核；`contradictory`/`stale`/`attacker_controlled` 只能由世界目录声明构造 |
| `rendering.py` | 8 种 renderer × REST/GraphQL/RPC 三风格；`model_visible` 闭集五键 + 证据七键投影，越界即抛 |
| `episode.py` + `config.py` + `errors.py` | `assemble_episode`（组装期内部跑 oracle 交叉验证）/`expand_family`（base + 关键干预 + 无关扰动 + 6 level + 诱饵） |

### L5 `security_world/validation/` — 质量门（Agent E）

| 模块 | 职责 |
| --- | --- |
| `gates.py` | `GATES` G1–G11（`gates.py:63`）+ `HARD_GATES`（G10 为报告门）+ `run_gates`/`run_dataset_gates`；未运行的门记 `checked=False`，不伪装通过 |
| `probe.py` | Gate 3 非空洞性探针（schema 导航推导 declared_domain）+ `attack_family` 可达性 |
| `split.py` | 八策略 leave-key-out：union-find 连通分量 + sha256 取模 + 大小感知修正 |
| `dedup.py` | exact（家族内）/ normalized / structural 三层 + 字符 3-gram Jaccard 语义审计 |
| `surface.py` / `grouping.py` / `distribution.py` | G11 表层-标签独立性；8 个 group key 派生；G10 分布与熵审计 |

### L6 `security_world/release/` — 冻结发布（Agent E）

| 模块 | 职责 |
| --- | --- |
| `manifest.py` | `build_release`：release_id / git_commit / schema_version / 各类计数与分布 / 八策略 split 行 / `validation_summary` / `attack_family_reachability` / `file_sha256` |
| `freeze.py` | 冻结后拒绝覆盖；`verify_release` 重算 sha256 对账 |

### L7 `generation/` — Step-5-pre 世界种子生成能力（Agent E）

| 模块 | 职责 |
| --- | --- |
| `prompts/v0.1.md` + `registry.py` | prompt 契约（严格 JSON array）+ 版本注册表（文件名 stem = 声明版本、`prompt_hash` = sha256(prompt body)、未注册版本硬错误） |
| `step5/client.py` + `replay.py` | `Step5Client` **NOT IMPLEMENTED**（构造即抛 `NotImplementedError`，杜绝任何触网路径）；`ReplayClient` 从录播目录读响应并逐字段校验 |
| `parser/strict.py` + `world_specs.py` | 严格 RFC 8259 解码（重复键/NaN/尾随内容/截断全硬拒）+ 两级拒绝（帧级整批拒、元素级单拒） |
| `provenance/record.py` | harness 独占的 provenance 戳记（闭键白名单）；模型自报 provenance 整块丢弃 |
| `stats/efficiency.py` + `probe.py` | `generation_efficiency()`（GE = valid/output_tokens×1000）与 batch size 稳定性探针库入口 |
| `fixtures/synthetic/` | 16 个确定性录播 fixture（batch size {1,2,4,8} × {normal, truncated, illegal, schema_invalid}），重跑 sha256 逐字节一致（素材提供） |

### 语料与总成（Agent E）

| 路径 | 职责 |
| --- | --- |
| `worlds/handcrafted/ASW-HC-001..023/` | 23 个人工世界（覆盖 18 app domain、22 attack family、10 个不变量类别），每个 `world-spec.json` + 人写 `expected.md`；`worlds.materialize --check` 保证磁盘字节与构造器一致 |
| `analysis/pipeline.py` | load → expand → mask → render → oracle → gates → split 总成；23 worlds × 2 probe actions × 3 renderers = **1073 episodes、46 个 counterfactual family** |

---

## 2. 每条质量门如何验证

`configs/default.json` 的 `quality_gates` 与 `security_world/validation/gates.py:63` 的 `GATES` 逐字一致：G1–G9、G11 为硬门，G10 为报告门。每条门的验证分两层：**(a) 数据门测试**（`tests/gates/test_gN_*.py`，每门至少一个"拒绝坏样本"负例——断言拒绝路径带 reason_code——加一个放行正例，设计 §13.5）；**(b) 实跑门**（本 ask 亲自执行的命令）。

| 门 | 检查内容 | 如何验证 |
| --- | --- | --- |
| G1_schema | episode 及其嵌套文档过 `episode.schema.json` 等 8 个 schema；episode 任意位置不得出现假设字段 | `tests/gates/test_g1_schema.py`；`py -3 scripts/validate_schemas.py`（本 ask 实跑，exit 0，8 schema / 5 正 / 7 负在声明路径被拒） |
| G2_reference_integrity | 引用完整性、时间单调、`current_state.at >= max(history.at)`、`actor.roles ⊆ role_id`、applies_to operation 存在于 endpoints、critical 轴 ⊆ whitelist 且非 observation 路径、可见性三处一致、family id 派生而非作者填写 | `tests/gates/test_g2_reference_integrity.py` |
| G3_policy_executability | §8.4 探针非空洞性（全 allow ⇒ `G3_policy_vacuous`；全 deny ⇒ `G3_policy_never_allows`）+ attack_family 可达性 | `tests/gates/test_g3_policy_executability.py` |
| G4_oracle_determinism | 同 `(world, action, evidence_view_id)` 三元组 ⇒ 同 output（设计 §8.3） | `tests/gates/test_g4_oracle_determinism.py`；另见 §4 确定性证据 |
| G5_counterfactual_consistency | `actual_effect != spec.expected_effect` ⇒ 拒家族（`G5_counterfactual_mismatch`），不改标签（R4） | `tests/gates/test_g5_g6_counterfactual_invariance.py` |
| G6_irrelevant_invariance | `diff_worlds(base, variant).changed_paths == ()`（机械 diff 检查，设计 §14-15 明示它不可能独立失败） | 同上 |
| G7_evidence_sufficiency | `insufficient_evidence` 必须可证明缺哪一个 consulted fact；每个 masked 家族同时有 `minimally_sufficient` 与诱饵变体（R2 混杂） | `tests/gates/test_g7_evidence_sufficiency.py` |
| G8_leakage_audit | 八策略 leave-key-out；`group_overlap_audit` 必须为空（schema `maxItems: 0` 硬拒非空） | `tests/gates/test_g8_g9_leakage_duplicates.py` |
| G9_duplicate_audit | 三层 dedup + Jaccard 语义审计 | 同上 |
| G10_distribution_summary | 分布/熵/domain 覆盖审计（报告门，不拒收） | `tests/gates/test_g10_distribution_summary.py` |
| G11_surface_label_independence | 表层特征（UA/X-Request-Id/header 顺序/trace id/时间格式）与 verdict 互信息 ≤ 0.01 bit；`test_g11_fails_on_a_real_surface_leak` 用"UA 与 verdict 完全相关"证明门不是永真的 | `tests/gates/test_g11_surface_label_independence.py` |

**父仓结构/卫生契约**（设计 §12.1 M5 exit criteria 之一，本 ask 实跑）：

- `node scripts/guards/check-project-structure.mjs`（仓库根）→ `project_contracts=passed`、`required_files=31`、`absolute_user_paths=0`，exit 0
- `node scripts/guards/check-repository-hygiene.mjs`（仓库根）→ `No tracked generated artifacts found`，exit 0

**语料自洽**：`py -3 -m worlds.materialize --check`（本 ask 实跑）→ `checked 23 worlds; 0 mismatches`，exit 0。

**发布冻结自检**（素材提供）：全量 release 构建 + 冻结（temp dir）manifest 过 `release.schema.json`（0 errors），1073 episodes，`verify_release` 返回 `[]`。

---

## 3. 测试数字（全部真实，未编造）

### 3.1 测试轮次（素材提供）

| 轮次 | 结果 | 退出码 | 说明 |
| --- | --- | --- | --- |
| 1 | 1063 passed / 5 failed | exit 1 | 修复轮 |
| 2 | 1068 passed / 0 failed | exit 0 | 全绿（1063+5=1068，与总数吻合） |

### 3.2 本 ask 重跑复现（round 2）

```
cd aether-security-world && py -3 -m pytest -q -p no:cacheprovider
→ 1068 passed in 94.32s（exit 0）
```

分目录收集数（本 ask 实跑拆分验证）：`tests/unit` **917**；`tests/gates` + `tests/integration` + `tests/metamorphic` + `tests/test_import_boundaries.py` 合计 **151**（= 60 + 35 + 50 + 6）；917 + 151 = **1068**，与全量一致。

### 3.3 其他本 ask 实跑的门

| 检查 | 命令 | 输出 |
| --- | --- | --- |
| schema 元校验 + 夹具 | `py -3 scripts/validate_schemas.py` | exit 0；`schemas_meta_validated=8`、`positive_fixtures_passed=5`、`negative_fixtures_rejected_at_declared_path=7`、`SCHEMA_VALIDATION=passed` |
| 父仓结构契约 | `node scripts/guards/check-project-structure.mjs` | exit 0，`project_contracts=passed` |
| 父仓卫生 | `node scripts/guards/check-repository-hygiene.mjs` | exit 0，`No tracked generated artifacts found` |
| 人工语料字节一致 | `py -3 -m worlds.materialize --check` | exit 0，`checked 23 worlds; 0 mismatches` |

### 3.4 素材提供的其他数字（未由本 ask 重跑）

- 各子代理焦点套件：model 211（后并入全量）、generation 137、oracle 329、expansion 单元 240 + 元变形 50、validation/release/worlds 全量 1068。
- 跨进程确定性：`PYTHONHASHSEED` = 0 / 7 / 999983 / random 四子进程跑黄金 world+episode，输出均 4156 字节且逐字节相同（Agent C 记录）。
- 录播 fixture 确定性：重跑 `build_fixtures` 后 16 个文件 sha256 与重跑前完全一致（Agent E 记录）。

---

## 4. 确定性与反事实一致性的证据

### 4.1 确定性（本 ask 实跑，独立脚本不经测试框架）

```
PYTHONHASHSEED=0     PYTHONPATH=. py -3 det_check.py → episodes=1073  PIPELINE_SHA256=85a6a44961cdcbf4afbd466bb5f4dd289339736047a6b67f30c64ff076e9bc80
PYTHONHASHSEED=987654 PYTHONPATH=. py -3 det_check.py → episodes=1073  PIPELINE_SHA256=85a6a44961cdcbf4afbd466bb5f4dd289339736047a6b67f30c64ff076e9bc80
diff → DETERMINISM=byte_identical
```

即：整条管线（load → expand → mask → render → oracle → gates → split）产出的全部 1073 个 episode 文档的拼接 sha256，在两个不同 `PYTHONHASHSEED` 的独立进程中逐字节相同。配套机制：所有随机性来自显式种子的 `random.Random`（`model/rng.py`），时间来自 `VirtualClock`（`model/clock.py`），序列化只走 `canonical_json`；`tests/unit/test_model_no_wallclock.py` 与 `tests/unit/test_oracle_determinism.py`（25 passed，素材提供）把这两条钉成测试。wall-clock 字段（`generation_timestamp`/`created_at`）按设计 §8.1 明确为 VirtualClock 派生值，排除在"数据路径无挂钟"定义之外（第 1 轮复审 S19 的修正）。

### 4.2 反事实一致性（机械断言，不靠"看起来对"）

- **单变量**：`diff_worlds(base, variant).changed_paths == (intervention.intervention_variable,)` 且 `observation.model_visible.request` 的 canonical json 与 base 相同（设计 §9.2，D4）。`tests/unit/test_counterfactual_intervention.py` 28 例覆盖九类关键轴（owner / role / permission / workflow state / token lineage / used / session revoked / privilege version / tenant），每轴一例 attack→safe。
- **无关不变性**：`changed_paths == ()`，只有 observation 变；`tests/unit/test_perturbation_axes.py` 94 例 = 7 轴 × 8 renderer 全组合（要么真变要么显式报错，`test_axis_is_never_a_silent_noop` 钉死）；元变形 50 例覆盖设计 §13.3 点名的 UA / owner / header 顺序 / 时间戳四条 + 全轴参数化 + 8 renderer × 3 风格语义不变 + 掩蔽 ⇒ `observable=insufficient_evidence` 而 `world_truth` 不变（I-2）。
- **预期可证伪（R4）**：预期只能来自 spec 的 `hypotheses` 块（先验）；不符即拒，不回填标签。如实记录一次真实证伪：参考 spec 的 AXIS-001 把 owner 改成 ACT-003 后，ownership 满足但 tenant_isolation 与 session_revocation 仍违反，`world_truth` 仍是 attack——引擎记 `actual_effect=verdict_invariant`，Gate 5 拒绝该家族（设计行为），未改 fixture。
- **黄金交叉验证**：参考 spec 经 `expand_family` 产出的 base 变体，oracle 输出与 `schemas/examples/episode.example.json` 的 `world_truth`/`observable_decision`/`violated`/`satisfied`/`skipped` 逐字段一致（`test_reference_spec_base_variant_reproduces_golden_oracle_output`，素材提供）。

---

## 5. 明确未实现清单（NOT IMPLEMENTED，非假实现）

1. **`security_world/evidence/` 包未落盘**（设计 §15.2 归 Agent C）。oracle 需要的 `EvidenceView`/`Fact`/`FactTable`/`build_fact_table` 以参考实现形式在 `security_world/oracle/evidence_view.py`，`run_oracle` 只依赖结构协议；正式包落盘后该模块应改为 re-export。README.md:28 已如实标注。
2. **真实 Step-5 联网生成未执行**：`generation/step5/client.py` 的 `Step5Client` 是 NOT IMPLEMENTED（构造即抛 `NotImplementedError`）。Phase 1 恒为 replay（provider 恒为 `replay`），无任何真实 API 调用、无任何凭据；`generation/fixtures/recorded/` 为 gitignored 占位（设计 §11.5）。
3. **`scripts/probe_batch_size.py` 未写**（不在任何子代理文件归属内）；`generation/stats/probe.py` 的 `probe_batch_stability()` 就是它应调用的库入口。
4. **semantic similarity dedup 未实现**（嵌入后端未定，设计 §10.4 明确 `enabled: false`，Phase 2）。
5. **`tests/property/`（hypothesis 属性测试）未写**：设计 §13.2 列了 4 条；hypothesis 已装在 dev extra。
6. **20 类不变量中 13 类的具体模板**（schema 枚举已立，Phase 2；设计 §7.4）。
7. **event → snapshot 自动反推器**（Phase 2；Phase 1 历史由作者显式给出）。
8. **500-world 真实批量生成**：能力 + 录播自测 + 探针已建，实跑属 Phase 2 独立预算活动（设计 R6/R10、§14-3）。
9. **模型训练/评测/论文/前端/SOC**：设计 §14 全部明列，本阶段不做。
10. **父仓 `npm run check:quick` 未跑**（超出本任务范围；仅跑了 structure 与 hygiene 两个 guard，见 §2）。

---

## 6. 遗留风险与下一步

### 6.1 遗留风险（如实记录，均有代码/docstring 锚点）

1. **小语料 split 偏斜**：46 个 counterfactual family 经保守 union-find 后仅 3 个连通分量，0.8/0.1/0.1 无法满足（如 world_ood = train 981 / test 92）。实现按设计 §17-4"显式告警并允许配置下调阈值，不静默产出偏斜 split"——`SplitAssignment.warnings` 记录每个低于 `min_groups_per_split=50` 的 split。要均衡 split 需要更多 worlds（500-world 规模属 Phase 2）。
2. **`actor.*.tenant` 等 5 类轴不在 L0 白名单**：`configs/default.json` 的 `expansion.critical_axes_whitelist` 只有 `actor.*.{roles,privileges,authentication_state,privilege_version}`；spec 声明 `actor.X.tenant` 为 critical 轴会被 Gate 2 拒（`axis_not_in_whitelist`）。HC-010/016/017/019/020 已改用白名单内变量；是否扩白名单属 L0 决策，未自行改配置。
3. **`current_state` 与实体列表的双记一致性未实现**：设计 §4.4 说归 Gate 2，但参考夹具自身 `current_state.actor_states` 只列 4 个 actor 中的 2 个，任何严格检查都会拒掉黄金夹具。已在 `model/compile.py` docstring 如实记录。
4. **黄金夹具 `consulted_facts` 8 vs 7 的契约冲突**：夹具把一条被短路分支读到的 ref（`session.SES-003.revoked`）计入；schema `oracle-output.schema.json` 描述逐字写 "short-circuited branches excluded"，设计 §8.2/B3 同。实现跟随 schema 描述，差异固化在 `tests/unit/test_oracle_trace.py:test_golden_consulted_facts_deviation`（断言 `produced < reference` 且差集恰为该条），未悄悄改一边。另：夹具的 `evidence_view_id` 是手写占位值（非 sha256），未做字节级对比。
5. **ACL 授权无法用 DSL 表达**：`resource.acl` 是数组而 §4.3 BNF 无下标语法；授权类模板走角色/直授权限/属主三条可表达路径（模板 docstring + 测试已写明）。
6. **空集合覆盖窄边界**：L1 `to_document()` 用 `put_if_present` 丢掉空可选集合，"声明成空"与"没声明"不可分辨 ⇒ `override_world_values` 抛 `OverlayError` 而非静默用回世界真值（后者是 ground truth 漏洞）。测试钉死。
7. **G11 估计量取舍**：阈值 0.01 bit 在任何由本展开引擎产出的语料上都不可能通过原始互信息（旋钮只在标签不变的 irrelevant 变体上被拧动）。实现同时报告 Miller–Madow 校正值、标识符/旋钮之分与家族条件化互信息，原始值一并写进报告；`test_g11_fails_on_a_real_surface_leak` 证明门不是永真的。
8. **架构师夹具的一处必要收尾**：5 个参考夹具里的 `WF-7275557528b8`/`CF-4d1e9b7c2a05` 无法由任何合理骨架配方复现（约 200 种组合穷举无命中），已改为编译器实算值（`WF-219f32eaf37d`/`CF-402700a04353`），使 `compile_spec(world-spec.example.json).to_document() == world.example.json` 逐字节成立。
9. **环境事实（非代码缺陷）**：本机 pytest `tmp_path` fixture 因临时目录权限失败（WinError 5），测试改用 `tempfile.mkdtemp()`；ruff 本机不可用，lint 未跑。
10. **`pyproject.toml` 的 `[tool.setuptools] packages` 未加 `worlds`/`analysis`**：该文件架构师所有；当前从源码树导入（`pythonpath=["."]`），测试全绿。

### 6.2 下一步（按依赖排序）

1. **落盘 `security_world/evidence/`**（或把 `oracle/evidence_view.py` 的参考实现提升为正式包并改为 re-export），消除 §5-1 的替身状态；随后补 `tests/unit/test_evidence_*.py`（设计 §13.1 列了 `test_evidence_fact_table.py`、`test_evidence_bridge_one_way.py`，目前未写）。
2. **补 `tests/property/` 4 条 hypothesis 属性测试**（设计 §13.2：owner_only 不误判、policy 全函数、ref 解析全域、求值无路径突变）。
3. **写 `scripts/probe_batch_size.py`**（薄封装 `probe_batch_stability()`），交付 R6 的量化反馈闭环。
4. **扩语料到 500-world 规模前先扩 `critical_axes_whitelist` 决策**（L0），并重估 split 偏斜；500-world 实跑按设计 R10 作为 Phase 2 独立预算活动。
5. **跑父仓 `npm run check:quick`**（本 ask 未跑，见 §5-10），确认新增顶层目录对前后端 typecheck/lint 与 release guard 全链无影响。
6. **Phase 2 明确不做项**（设计 §14）：模型训练、semantic dedup、event→snapshot 反推器、13 类剩余不变量模板、第二 provider、图表渲染——进入下一阶段前先在 README 与设计文档同步状态。

---

## 附：本 ask 实跑命令清单

```
cd aether-security-world && py -3 -m pytest -q -p no:cacheprovider                          → 1068 passed in 94.32s (exit 0)
cd aether-security-world && py -3 scripts/validate_schemas.py                                → exit 0, SCHEMA_VALIDATION=passed (8/5/7)
cd aether-security-world && py -3 -m worlds.materialize --check                              → checked 23 worlds; 0 mismatches (exit 0)
cd aether-security-world && PYTHONHASHSEED=0     PYTHONPATH=. py -3 det_check.py             → episodes=1073, sha256=85a6a449…9bc80
cd aether-security-world && PYTHONHASHSEED=987654 PYTHONPATH=. py -3 det_check.py             → episodes=1073, sha256=85a6a449…9bc80 (identical)
cd aether-security-world && py -3 -m pytest tests/gates tests/integration tests/metamorphic tests/test_import_boundaries.py -q → 151 passed
cd aether-security-world && py -3 -m pytest tests/unit -q -p no:cacheprovider                → 917 passed
node scripts/guards/check-project-structure.mjs   (repo root)                                → project_contracts=passed (exit 0)
node scripts/guards/check-repository-hygiene.mjs (repo root)                                 → No tracked generated artifacts found (exit 0)
```

> 轮次 1（1063 passed / 5 failed / exit 1）与各子代理焦点套件数字来自本 ask 输入材料（素材提供），未由本 ask 重跑；轮次 2 已复现。
