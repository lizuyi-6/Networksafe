# Aether Security World — 设计审查与 v0.1 设计

| | |
| --- | --- |
| 文档 | `docs/design-v0.1.md` |
| 状态 | **设计阶段完成，代码未实现**（`security_world/**` 全部 NOT IMPLEMENTED） |
| 版本 | **v0.1-r1**（第 1 轮独立复审后修订；修订记录见 §19） |
| 需求来源 | `docs/brief.md`（逐字副本，sha256 `ed4b1c2056a3f5089edb689c17bdce694d5cbc40c0b730e4e005bf00e652e2b4`，34274 字节） |
| 父仓约定 | 仓库根 `AGENTS.md`；本目录是 Networksafe 仓内**唯一新增顶层目录**，未改动仓库其他任何文件 |
| Python | `py -3`（3.12.10 实跑验证），依赖仅 `jsonschema` + `referencing`（测试期加 `pytest` + `hypothesis`） |
| Schema | **8 个** draft 2020-12 文件：需求列 4 个、任务列 6 个，本文档新增 `world-spec.schema.json` 与 `action.schema.json`（理由见 D1、D7） |

> 第 1 轮复审提出 20 条阻塞发现与 19 条参考意见，全部已在 schema、fixture、配置与本文档中处理。
> **每条的处理方式记录在 §19「修订记录」**，包含"改了什么、在哪、如何验证"。

---

## 0. 阅读指南与本文档的边界

本文档按需求 §31 的 14 项输出组织（§1–§14），另加：

- **§15 模块地图与接口契约**：五名实现子代理的文件归属与签名级接口，保证互不改对方文件也能拼装。
- **§16 设计自检**：逐条回答需求 §29 的十个质疑。
- **§17 需求本身的方法学缺陷与修正**。
- **§18 本文档作者实际执行过的验证**。
- **§19 修订记录**：第 1 轮复审发现逐条处理台账。

**边界声明**：本文档只做设计 + Schema + 脚手架。文中出现的所有函数签名是**契约**，不是已实现代码；任何"已实现"的声称只出现在 §18。其余一律 NOT IMPLEMENTED。

---

## 1. 对项目目标准确理解（需求输出 #1）

### 1.1 一句话

构建一个**可执行的状态化安全数据工厂**：把"一个安全事件"从 `HTTP Request` 升级为
`Episode = {world, actors, resources, policies, workflow, state_history, current_state, observations, request, available_evidence, hidden_evidence, evidence_provenance, oracle_decision}`，
并让其中每一个标签都由程序计算，从而训练/评估下一代 **Stateful Security Reasoning Model**。

### 1.2 三个不可协商的核心不变量

| # | 不变量 | 违反它的后果 |
| --- | --- | --- |
| I-1 | **真值程序拥有**：`safe / attack` 只能由 oracle 执行 policy+invariant 产生；LLM 可以提议世界结构、策略假设、反事实预期，但任何 LLM 输出都不得成为标签 | 形成 AI self-labeling loop，benchmark 失去意义 |
| I-2 | **`world_truth` 与 `observable_decision` 分离**：前者在完整世界上计算，后者只在可见证据上计算；两者不同恰是证据不足/矛盾/过期/攻击者可控 | 无法训练 abstention，模型把"看不到"硬猜成"安全" |
| I-3 | **反事实家族不可跨 split**：同一 `counterfactual_family_id` 的样本只能全在 train 或全在 test | 泄漏使所有指标虚高，且不可事后修复 |

### 1.3 要训练出的四种能力

1. **causal sensitivity**：改 `owner` 必须改 verdict（`critical_intervention` 变体）。
2. **irrelevant invariance**：改 `User-Agent`/`X-Request-Id`/header 顺序/trace id/时间格式不得改 verdict（`irrelevant_perturbation` 变体）。
3. **abstention**：决策关键事实不可观测 ⇒ `insufficient_evidence`，且必须**可证明**缺的是哪一个。
4. **history dependence**：T6 的攻击归因到 T3+T4+T5（Episode `timeline` + `relevant_history`）。

### 1.4 本研究问题与"payload token → attack"的区别

现有模型学 `payload token → attack`；本项目的样本里，**同一个请求字符串**在不同世界状态下必须得到不同 verdict。
实现上靠一条硬规则保证：**oracle 从不解析渲染文本**（§3 D2）。因此请求里出现 `' OR 1=1` 本身永远不足以定罪——
它只有在世界声明了"该入参流向未参数化 sink"时才构成攻击（§8.5 的 sink 模型）。

### 1.5 明确不做什么

模型微调 / QLoRA / SFT·RL Trainer / RLVR / 论文 LaTeX 与写作 / 最终模型 / 产品前端 / SOC 控制台 / Networksafe 产品功能 / 自动攻击真实系统。
另外本项目**只写不读**：训练项目只能读取冻结 release，不得回写数据生成逻辑。

---

## 2. 最危险的 10 个研究/工程风险及缓解（需求输出 #2）

每条给出：风险 → 为什么致命 → **可证伪的检测手段** → 缓解 → 归属模块。

### R1 — AI 悄悄成为 ground truth（最高危）

- **形态**：需求 §4 说"LLM 可以建议一个世界应该包含什么规则"。但 policy/invariant 一旦由 AI 编写，**安全语义的定义权就交给了 AI**。
- **检测**：`test_llm_cannot_influence_labels`（把 generator client monkeypatch 成"恶意"实现，让其 spec 的 `hypothesized_verdict` 与 oracle 结论相反，跑完整管线，断言 `oracle_output` 与 client 返回垃圾时逐字节相同）；`test_vacuous_policy_rejected`（Gate 3 探针世界）。
- **缓解**：AI 只能从**人工不变量目录**选择并参数化；policy 必须可执行且非空洞；`hypotheses` 块被 `compile_spec` 整体丢弃（记录在 `compile.dropped_hypothesis_fields`），且 `episode.provenance.generator_provenance` 是**闭键白名单**，假设字段结构上进不了 release。
- **归属**：`security_world/policy`、`security_world/invariants`、`security_world/validation`、`generation/`。

### R2 — `insufficient_evidence` 被表层捷径化

- **形态**：若 masking 是"随机隐藏一个字段"，"缺 ownership 证据"与 `insufficient_evidence` 完全相关，模型只需检测"字段不在"即可拿到 abstention 标签。**比误报更隐蔽的第二条路径**（第 1 轮复审发现）：oracle 的分类元数据若出现在模型可见侧，abstention 标签可直接从元数据解码。
- **检测**：`test_insufficiency_is_confounded`（每个 masked 家族必须同时有 `minimally_sufficient` 与**诱饵掩蔽**变体）；`test_model_visible_boundary`（conftest fixture，断言 `model_visible` 不含 22 个 oracle 分类键）。
- **缓解**：三层。(a) masking 层级配额固定，**永不按模型表现调整**（需求 §26）；(b) `observation` 拆成 `model_visible` / `decision_metadata`（§5.2）；(c) `contradictory` / `attacker_controlled` / `stale` 三类不可表层检测的层级。
- **归属**：`security_world/expansion/masking.py`、`security_world/validation`。

### R3 — 泄漏与 generator fingerprint

- **形态**：同一反事实家族样本分到 train/test；同一 AI 世界模板的轻微变体跨 split；renderer 的固定噪声模式与标签相关。
- **检测**：`test_no_family_straddles_split`；`test_surface_features_label_independent`（表层特征与 verdict 的互信息 ≤ 0.01 bit，**G11 硬门**）。
- **缓解**：§10 的 group-key split + 三层 dedup；irrelevant 扰动的采样分布与 verdict **独立**。
- **归属**：`security_world/validation/leakage.py`。

### R4 — Gate 5（反事实一致性）空洞化

- **形态**：若 `expected_effect` 由"先在干预后世界上跑 oracle 得到 verdict，再回填预期"产生，Gate 5 恒真。
- **检测**：`test_expected_effect_is_falsifiable`——构造一个**故意写错**预期的 spec，断言 Gate 5 拒绝它。
- **缓解**：预期只能来自 spec 的 `hypotheses` 块（先验声明）；不符即拒，**不得**反向改标签。
- **归属**：`security_world/expansion/counterfactual.py` + Gate 5。

### R5 — policy 空洞 / 永真 / 恒拒

- **形态**：AI 生成的策略结构合法但语义退化（`allow if true`），标签单一化。
- **检测**：`test_policy_non_vacuity`（探针世界集上必须既有 allow 也有 deny）；`test_label_entropy_floor`。
- **缓解**：Gate 3 非空洞性检查（探针算法见 §8.4）+ 每家族 verdict 多样性下限。
- **归属**：`security_world/validation`。

### R6 — Step-5-pre 吞吐与 500-world 的真实成本

- **事实**（需求 §19）：~30 output tokens/s。500 worlds × 约 2k output tokens ≈ **1M output tokens ≈ 9.3 小时**纯生成。
- **检测**：`scripts/probe_batch_size.py` 用录播 fixture 测 JSON 损坏率/重复率/schema 违反率随 batch size 的变化；`generation_efficiency()` 输出 GE。
- **缓解**：Phase 1 **只建能力 + 录播自测**；batch size 由稳定性探针决定。
- **归属**：`generation/`。

### R7 — 非确定性渗入标签

- **形态**：`dict` 迭代序、`set` 哈希随机化、`time.time()`、全局 `random`、并发顺序进入数据路径。
- **检测**：`test_determinism_byte_identical`；`test_no_wallclock_in_data_path`；`test_pythonhashseed_stable`（子进程不同 `PYTHONHASHSEED`）。
- **缓解**：所有随机性来自局部 `random.Random(seed)`；时间用 `VirtualClock`；序列化只走 `canonical_json()`；**§8.1 明确 wall-clock 字段（`generation_timestamp`/`created_at`）是 VirtualClock 派生值，不属于"数据路径"**（第 1 轮复审指出二者原本冲突）。
- **归属**：`security_world/model/canonical.py`。

### R8 — 传统 payload 类标签退回字符串匹配

- **形态**：对 SQLi/XSS 用正则判定，等于把"payload token → attack"从后门重新引回来。
- **检测**：`test_payload_verdict_ignores_string`——同一 payload 文本在"已参数化 sink"世界判 `safe`，在"未参数化 sink"世界判 `attack`。
- **缓解**：§8.5 的声明式 sink 模型：`services[].sinks[] = {kind, parameterized, sanitized}` + action 的 `tainted_inputs` 结构化列表。
- **归属**：`security_world/invariants`（sink 类别）+ `security_world/oracle`。

### R9 — 数据过于人工，模型只学模板特征

- **形态**：所有世界同一个句式、同一批角色名，模型靠模板猜标签。
- **检测**：`test_domain_coverage_floor`；`test_structural_dedup_catches_templates`；`test_renderer_projection_allowlist`。
- **缓解**：domain 白名单 20 类强制配额；renderer 8 种；结构 dedup 硬门；renderer 投影白名单（§3 D7）。
- **归属**：`worlds/`、`security_world/expansion/rendering.py`。

### R10 — 需求内部的规模/指标冲突

- **形态**：需求 §27 G 要求"500-world generator 能力"，§18 要求"不要一上来生成 10k"，§30 说第一阶段 KPI 是语义丰富/oracle 正确/反事实正确/防泄漏/可复现——**都不是数量**。
- **检测**：Phase 1 exit criteria（§12）不含任何"已生成 N 个 AI 世界"的硬指标。
- **缓解**：Phase 1 交付"能力 + 录播 fixture 自测 + 探针脚本"；实跑是 Phase 2 的独立预算活动。
- **归属**：`generation/`、`scripts/`。

> 附带风险（不进前十但有专人盯）：**hidden evidence / 决策元数据泄漏进模型输入**。由 §5.2 的 schema 级拆分 + `test_model_visible_boundary` + `test_hidden_evidence_not_serialized` 共同封死。

---

## 3. 推荐总体架构（需求输出 #3）

### 3.1 分层与单向依赖

```
L7  generation/        Step-5 prompt、parser、provenance、replay fixture、GE 指标
                       （唯一允许出现网络的一层；Phase 1 恒为 replay）
L6  security_world/release/     manifest、freeze、统计
L5  security_world/validation/  G1..G11、group split、dedup、分布审计
L4  security_world/expansion/   instantiate、counterfactual、masking、perturbation、rendering、episode 组装
L3  security_world/oracle/      确定性 oracle（两趟求值）
     security_world/evidence/   evidence 视图、trust 规则、事实表、充分性
L2  security_world/policy/      DSL AST + 求值器 + 策略匹配
     security_world/invariants/ 20 类不变量目录（Phase 1 实现 7 类）
     security_world/workflows/  状态机求值
L1  security_world/model/       WorldInstance/WorldSpec 类型、canonical json、ref 解析、spec 编译
L0  schemas/ + configs/ + docs/ 契约（架构师所有，实现者只读）
```

**依赖必须是 DAG**：`L7 → L6 → L5 → L4 → L3 → L2 → L1 → L0`，且 **oracle(L3) 不得依赖 L4/L5/L7**。由 `tests/test_import_boundaries.py` 静态断言。

### 3.2 数据流

```
WorldSpec (人工 | AI)                ← 世界结构 + 关键/无关变量 + 反事实预期（**不含标签**）
   │  compile_spec()                 引用完整性 + ref 解析 + policy 编译 + 非空洞性 + family id 派生
   ▼                                 + 丢弃 hypotheses 块
WorldInstance                        ← 可执行世界（oracle 的唯一输入，结构上无标签字段）
   │  instantiate / critical_intervention / irrelevant_perturbation / mask_evidence
   ▼
Episode（action + timeline + observation{model_visible, decision_metadata}）
   │  run_oracle(world, action, evidence_view)
   ▼
OracleOutput {world_truth, observable_decision, violated/satisfied/skipped, required/missing, decision_trace}
   │  run_gates()  G1..G11
   ▼
accepted / rejected（带 reason code）
   │  assign_splits() + dedup()
   ▼
Frozen Release（manifest + split_assignments + file_sha256）→ 只读交给训练项目
```

### 3.3 七个关键架构决策

| # | 决策 | 理由 | 锁死它的测试 |
| --- | --- | --- | --- |
| D1 | **`WorldSpec` 与 `WorldInstance` 分成两个 schema** | 需求 §4/§7 的"世界种子"与"oracle 消费的世界"是两个东西。混在一个 schema 里，AI 写的假设就和程序状态同层，I-1 失守 | `test_world_instance_has_no_label_field` + `spec_instance_pair` fixture |
| D2 | **oracle 只吃结构化世界，从不解析渲染文本**；renderer 是单向投影 | 把"读状态"与"读字符串"分开的唯一可靠办法 | `test_renderer_never_consults_oracle`、`test_payload_verdict_ignores_string` |
| D3 | **`evidence.asserts_ref` 是证据↔事实的唯一映射键**，且与 `decision_facts` 共用同一套 ID 视图路径 | 第 1 轮复审发现 `required_refs`（action 视图）与 `asserts_ref`（ID 视图）零命中，黄金 fixture 的 verdict 无法由文档算法推出。现在 `compile_spec` 把 action 绑定视图**展开成实例路径**，两边逐字可比 | `test_fact_table_keys_match_asserts_ref` |
| D4 | **单变量反事实由 `diff_worlds()` 强制** | 需求 §29-5 必须是机械断言 | `test_critical_intervention_changes_exactly_one_path` |
| D5 | **split 用 union-find 连通分量**，分量为最小不可分单位 | 多个 group key 同时约束时逐 key 判断会漏 | `test_union_find_groups_are_closed` |
| D6 | **内部表示用 frozen dataclass + 显式校验函数，不用 pydantic 隐式 coerce** | 数据工厂最怕"字符串被悄悄转成数字" | `test_no_implicit_coercion` |
| D7 | **`observation` 拆成 `model_visible` / `decision_metadata`，且 `model_visible` 的子 schema 是闭集** | 第 1 轮复审的头号阻塞：oracle 的 trust/freshness/required/availability/causal 标注原先全在模型可见侧，abstention 标签可被元数据直接解码。现在 schema 层就不可能把这些键放进 `model_visible` | `test_model_visible_boundary`（conftest fixture） |

---

## 4. World Schema v0.1（需求输出 #4）

### 4.1 两个文档，两种所有权，一个真实编译关系

**`WorldSpec`（种子，人或 AI 写，可含假设）** —— `schemas/world-spec.schema.json`：

```
world_id, application_domain, seed, provenance, attack_family(假设),
application, roles, actors, resources, sessions, tokens, credentials,
workflows, services, caches, trust_boundaries,
policies, invariants,                        # DSL AST，见 §7
state_history, current_state, evidence,      # REVISION 1: spec 完整决定 instance
critical_state_variables[],                  # REVISION 1: 模式限定为 ID 视图状态路径
irrelevant_state_variables[],                # REVISION 1: 模式限定为 observation.* 表面路径
hypotheses{ attack_opportunities[], expected_counterfactual_axes[] },   # 假设，非标签
episode_templates[{ events[{ ..., binds{session_id,token_id,workflow_instance_id,resource_id,operation,flow_id} }] }
```

**`WorldInstance`（编译产物，程序拥有）** —— `schemas/world.schema.json`：
在 spec 的全部实体之上增加派生的 `world_family_id` 与 `compile` 审计块，并**结构上禁止**任何 `ground_truth`/`label`/`verdict` 字段（`additionalProperties: false` + `schemas/examples/world.invalid.json` 证明带 `ground_truth` 的世界被拒，且拒因就是该键）。

**`compile_spec` 契约**（第 1 轮复审要求给出可依据样例，现已满足）：

```
输入 WorldSpec，输出 WorldInstance：
  1. 逐字复制 spec 的全部实体/状态/证据字段
  2. 派生 world_family_id = "WF-" + stable_hash(结构骨架)[:12]
     （结构骨架 = 标识符抽象为类型占位后的 entities+policies+invariants）
  3. 删除 hypotheses、attack_family（记入 compile.dropped_hypothesis_fields）
  4. 写 compile{compiler_version, source_spec_id, derived_world_family_id, dropped_hypothesis_fields, reason_codes}
  5. 校验：引用完整性 / ref 全域可解析 / policy 非空洞 / state_history 单调 /
           current_state.at >= max(history.at) / actor.roles ⊆ roles[].role_id /
           applies_to 的 operation 存在于 endpoints / critical 轴 ⊆ whitelist 且非 observation 路径
```

`schemas/examples/world-spec.example.json` → `schemas/examples/world.example.json` 是该契约的**成对样例**，`conftest.spec_instance_pair` fixture 断言二者满足上述关系。

### 4.2 实体字段（与需求 §4 的映射）

| 需求要求的字段 | v0.1 落点 |
| --- | --- |
| Actor | `actors[]`（另加 `privilege_version`；`roles` 存 **role_id**，编译期断言 ⊆ `roles[].role_id`） |
| Resource | `resources[]` |
| Session | `sessions[]`（另加 `bound_to` 支持 session binding） |
| Token | `tokens[]`（另加 `bound_resource`、`token_type`） |
| Workflow | `workflows[]`（`transitions[].condition` 是 DSL expr ⇒ conditional transition；`workflow_id` 前缀 `WFL-`，避免与 `world_family_id` 的 `WF-` 撞命名空间） |
| Policy | `policies[]`（§7） |
| trust_boundaries / caches / services / state_history / current_state / evidence / invariants | 同名顶层字段 |

### 4.3 引用路径的唯一 BNF（第 1 轮复审：原先有三套互不通约的语法）

```
path      := id_view | action_view | context
id_view   := <entity_type> "." <entity_id> ("." <field>)+
entity_type := actor | resource | session | token | workflow | workflow_instance
             | cache | service | credential | role
action_view := "action." (actor|resource|session|token|workflow_instance|parameters|request) ("." <field>)*
context   := "current_flow." <field> | "current_time"
```

四类规则：

1. **ID 视图**是唯一的事实键命名空间。`evidence.asserts_ref`、`decision_facts()` 的返回值、`cache_entry.cached_subject`、`critical_state_variables` 全部用它。
2. **action 绑定视图只在 DSL 里出现**，`compile_spec` 在编译期把它展开成实例路径（`action.resource.owner` → `resource.RES-001.owner`）。展开后 `decision_facts()` 与 `asserts_ref` 逐字可比——这是 D3 的落地。
3. **证据视图没有 ref 路径**。`evidence_view.<id>.*` 已从 DSL 删除（第 1 轮复审：它让 policy 能直读 untrusted 证据值，推翻"单向桥"声称）。唯一入口是 `establishing_evidence_exists(fact_key)`。
4. **`diff_worlds().changed_paths` 用同一套 ID 视图路径**，因此 `intervention.intervention_variable` 与 `changed_paths` 可直接 `==` 比较。

### 4.4 已知限制

- `current_state` 与实体列表存在**双记**风险：实体列表是权威，`current_state` 是从 episode 事件序列派生的投影。编译器必须校验二者一致（Gate 2）。
- `state_history` 由作者显式给出；**单调性 JSON Schema 表达不了**，由 Gate 2 强制（`state_history[i].at <= state_history[i+1].at`、`current_state.at >= max(history.at)`、`timeline.at` 与 `t_index` 同序）。两个黄金 fixture 在第 1 轮修订前都是非单调的，已修正。
- event → snapshot 自动反推器是 Phase 2 能力。

---

## 5. Episode Schema v0.1（需求输出 #5）

`schemas/episode.schema.json`。

### 5.1 顶层结构

```
episode_id, world_id, world_family_id(派生), counterfactual_family_id(派生),
variant_type: base | critical_intervention | irrelevant_perturbation | evidence_masked,
split, split_assignments[{strategy, group_key, split}],   # 八种策略各一行
intervention{intervention_variable, before, after, expected_effect, actual_effect},
action: Action,                        # REVISION 1: 必填，见 §5.3
timeline[], current_event,
observation{ model_visible, decision_metadata },   # REVISION 1: 拆分，见 §5.2
oracle_output, provenance
```

三条 schema 级约束：

1. **`intervention` 条件必填**（`allOf` + `if/then`）：`variant_type ∈ {critical_intervention, irrelevant_perturbation}` 而无 `intervention` ⇒ 拒绝。第 1 轮复审实测原先该约束不存在（负 fixture 只因根级 `$comment` 被拒），现已由 `episode.invalid.json` 在 `<root>` 路径上证明。
2. **`split_assignments`**：需求 §16 的八种 OOD split 全部可从冻结 release 复现。
3. **`provenance.generator_provenance` 是闭键白名单**（`model`/`model_version`/`prompt_version`/`prompt_hash`/`raw_generation_id`/`decoding_parameters`）。原先它是无约束对象，AI 假设可经此进入 release；而通过 Gate 3/5 筛后存活的假设在构造上与标签一致，等于交给评估方一个标签预测器。

### 5.2 `model_visible` / `decision_metadata` 拆分（D7，头号阻塞发现的修正）

```
observation.model_visible          ← 模型唯一可读的部分
  renderer, current_time,
  request{method, path, query, headers, body, rendered_text},
  evidence: [EvidenceObservation]   # 闭集七键：evidence_id/type/asserts_ref/value/source/provenance/timestamp
  timeline: [EventObservation]      # 无 causal_tag

observation.decision_metadata      ← 只有 oracle 与 gate 可读
  evidence_classification: [EvidenceItem]   # 含 trust_level/freshness/attacker_controllable/contradicts/visible_in_observation
  hidden_evidence_ids[], evidence_availability_level,
  relevant_history[], irrelevant_history[], causal_tags{}
```

**为什么恰好是这七键**：`provenance`（"这个值来自用户提交的 header"）和 `timestamp` 是真实分析师可见的信息，从 provenance 推断可信度正是要训练的能力；而 `trust_level` 是 **oracle 的分类结论**，`attacker_controllable` 是 **oracle 的风险标注**，`required_for_decision` 是 **oracle 的闭包计算**，`freshness` 可由 `timestamp` 对 `current_time` 推出，`evidence_availability_level` / `relevant_history` / `causal_tag` 是**答案键**。把这些交给模型等于直接发放 abstention 与 history-reasoning 标签。

子 schema `evidence_observation` / `event_observation` 都是 `additionalProperties: false`，所以** schema 层就不可能**把分类键放进 `model_visible`。`conftest.model_visible_boundary` fixture 提供可执行断言（22 个禁键 + 投影精确性 + hidden id 一致性）。

### 5.3 `action`（第 2 个阻塞发现：oracle 的输入原先没有 schema）

`schemas/action.schema.json`，episode 必填：

```
action_id, operation, actor, resource?, session?, token?, workflow_instance?,
flow_id, at, parameters{}, request{}
```

三个可空绑定（`session`/`token`/`workflow_instance`）是故意的：它们使"撤销 session 复用""跨 flow token 复用""workflow bypass"可表达；**未绑定时对应不变量记 `skipped_out_of_scope`（reason `unbound_subject`），绝不静默当成满足**。第 1 轮复审指出参考世界里一个 actor 持有两个 session（一有效一撤销），绑定原先只能靠猜——现在 `episode_templates[].events[].binds` 显式声明。

### 5.4 `relevant_history` / `irrelevant_history` 是声明，不是修辞

`causal_tag: "irrelevant"` 的事件，其 `state_after` 引用的任何 ref 都不得出现在决策闭包里，否则 Gate 6 失败。

---

## 6. Evidence Schema v0.1（需求输出 #6）

`schemas/evidence.schema.json`。每条证据是**对一个世界状态路径的断言**：

```
evidence_id, type(15 类枚举), asserts_ref, value, source,
provenance: system_of_record|replicated_cache|client_supplied|log_pipeline|llm_derived|heuristic_classifier|human_attested,
trust_level: trusted|semi_trusted|untrusted|derived,
timestamp(虚拟时钟), freshness: fresh|stale|expired|unknown,
attacker_controllable, visible_in_observation, contradicts[], notes
```

**REVISION 1：`required_for_decision` 已从本 schema 删除。** 第 1 轮复审发现它有三个互相矛盾的所有者（spec 的 `required_evidence`、oracle 的 `required_refs`、证据目录里的该字段），且注释说"由 oracle 计算"却又是作者可填。现在"决策需要什么"只有一个所有者：`oracle_output.required_evidence[].decision_fact`，由 oracle 从 ref 闭包计算。spec 侧的 `required_evidence` / `potentially_missing_evidence` 也一并删除。

**信任规则（需求 §10 的四种 trust_level 落地）**：

- `TRUSTED_ESTABLISHES = {trusted, semi_trusted}`（与 `configs/default.json` 一致）**可以建立**决策关键事实；
- `untrusted` 与 `derived` **只能佐证或矛盾**，不能建立；
- 决策关键事实的唯一可见证据全是 untrusted/derived ⇒ `unverifiable` ⇒ `observable_decision = insufficient_evidence`，而 `world_truth` 仍是 `attack`。

`attacker_controllable` 与 `trust_level` 是**两个独立维度**：一条来自系统日志但可被攻击者间接影响（如被注入的日志行）是 `semi_trusted + attacker_controllable`。

**可见性的权威来源**：`world.evidence[].visible_in_observation` 是权威；`EvidenceView` 与 `observation.model_visible.evidence` 是它的投影；Gate 2 断言三者一致（第 1 轮复审发现原先三处各自独立、可互相矛盾）。

---

## 7. Policy / Invariant 表达方式（需求输出 #7）

### 7.1 设计立场

需求 §4 明确"不要一开始设计复杂通用编程语言"。v0.1 是一个**封闭的、无副作用的、可静态分析的表达式 AST**：无循环、无函数定义、无 import、无 IO、无字符串插值路径、**无证据值读取**。共 **27 个 op**。

### 7.2 op 目录（`schemas/policy.schema.json` 的 `$defs.expr`）

| 类别 | op |
| --- | --- |
| 字面/引用 | `lit`、`ref` |
| 比较 | `eq`、`ne`、`lt`、`le`、`gt`、`ge` |
| 集合 | `in`、`not_in`、`subset_of`、`intersects`、`disjoint`、`is_empty` |
| 布尔 | `and`、`or`、`not` |
| 字符串 | `contains`、`not_contains` |
| 时间 | `before`、`after`、`within`（均在虚拟时钟上） |
| 状态机 | `state_is`、`transition_allowed`（**均恰好 2 参**：`from_state` 取绑定实例的当前态，不作为第三参传入） |
| 血缘 | `lineage_depth`、`lineage_root`（编译期拒环，故为全函数） |
| 证据桥 | `establishing_evidence_exists(fact_key)` |

`establishing_evidence_exists` 是**唯一**从证据视图进入决策视图的桥，且**单向**：只能把 verdict 降级为 `insufficient_evidence`，永远不能把 verdict 变成 `attack`。第 1 轮复审指出原 `trusted_evidence_exists` 的注释写"只信 {trusted}"而 config 写 `{trusted, semi_trusted}`，存在两套语义——现已统一为 `TRUSTED_ESTABLISHES = {trusted, semi_trusted}`，op 改名以消除"trusted"一词的歧义。

### 7.3 策略匹配算法

```
1. 收集 action_pattern 匹配的 policy（operation 相等或 "*"，resource_type 相等或省略）
2. 按 (priority desc, policy_id asc) 排序      # 确定性 tie-break
3. 取第一条 condition 求值为 true 的 policy，其 effect 即决策
4. 无匹配 ⇒ default_effect = deny（封闭世界，fail-closed）
```

需求 §4 的两个示例在 `schemas/examples/policy.example.json` 里已按此算法完整写出。

### 7.4 不变量：20 类目录，Phase 1 实现 7 类

| 优先级 | category | Phase 1 |
| --- | --- | --- |
| 必须 | `ownership` | ✅ |
| 必须 | `authorization` | ✅ |
| 必须 | `session_validity`（= `session_revocation` + `authentication_state`） | ✅ |
| 必须 | `token_lineage` | ✅ |
| 必须 | `workflow_transition` | ✅ |
| 伸缩 | `tenant_isolation` | ✅ |
| 伸缩 | `one_time_token` | ✅ |
| 推迟 | 其余 13 类 | ❌ Phase 2（op 已在 DSL 里，缺的只是具体 expr 模板） |

**`applies_to` 作用域规则（第 1 轮复审修正）**：

- `applies_to` 是**必填**的 operation 列表，`["*"]` 表示对所有 operation 生效。
- 不在列表里的 operation ⇒ `skipped_out_of_scope`，**既不进 satisfied 也不进 violated**，且必须出现在 trace 里。
- **`["*"]` 的语义是对该 action 实际绑定的实体求值，未绑定即 `skipped_out_of_scope`（reason `unbound_subject`）**。第 1 轮复审指出原设计要求的"`["*"]` 不变量必须对世界中每一个 action 全域可解（编译器静态检查）"**不可判定**——世界的 action 集合编译期不存在，且绑定可空；参考 fixture 本身就违反该规则。该表述已删除，取而代之的是运行期的未绑定跳过 + trace 留痕。
- 编译期只验证：`applies_to` 中的 operation 存在于 `application.endpoints`。
- 断言：`violated ∪ satisfied ∪ skipped == 全部不变量`，且三者两两不交（`test_invariant_scope_never_silently_skipped`）。

**`severity` 降为只读报告字段**：见 §8.2。

---

## 8. Oracle 设计（需求输出 #8）

### 8.1 签名与硬性质

```python
def run_oracle(world: WorldInstance, action: Action,
               evidence_view: EvidenceView, *, version: str = "0.1.0") -> OracleOutput
```

纯函数、无 LLM、无网络、无随机；同样入参 ⇒ `canonical_json` 逐字节相同。
**wall-clock 字段（`provenance.generation_timestamp` / `provenance.created_at`）是 VirtualClock 派生值，明确排除在"数据路径无挂钟"定义之外**（第 1 轮复审指出 `test_no_wallclock_in_data_path` 与这些必填字段原本直接冲突）。

### 8.2 两趟算法与新的聚合规则

**Truth 趟（完整世界）**

```
for invariant in world.invariants:
    if invariant.applies_to != ["*"] and action.operation not in invariant.applies_to:
        record skipped(out_of_scope); continue
    if invariant reads action.<binding> and that binding is None:
        record skipped(unbound_subject); continue
    satisfied = eval_expr(invariant.expr, ctx(world, action))
    record satisfied/violated + trace
policy_decision = decide_policy(world, action)
```

**聚合规则（REVISION 1，第 2 个阻塞发现的修正）**：

```
world_truth = "attack"          iff  (policy deny 来自非 default 规则)  OR  (任一不变量被违反)
world_truth = "unauthorized"    iff  (policy deny 仅来自 is_default_rule 规则)  AND  (无不变量被违反)
world_truth = "safe"            otherwise
```

- **`severity` 不参与聚合**。原规则"只有 critical 违规才算 attack"把标签权威交给一个作者可写的枚举：AI 把某条不变量标成 `high`，其违反就不再产生 attack 标签。`ATTACK_CATEGORIES` 是引擎私有常量且等于全部 20 类——**被违反的安全不变量就是攻击**。
- **default-deny 单独命中不产生 attack**。原规则下，作者漏写某 operation 的 allow 规则就能批量制造 `violated_invariants` 为空的 attack 样本。`policy_rule.is_default_rule` 是该规则的显式标记。
- `test_violated_invariant_implies_attack_truth`：对每个 category 构造违反样本，断言 `world_truth == "attack"`。

**Observable 趟（只可见证据）**

```
consulted_facts = {}                      # 动态记录：求值过程中实际读到的 ID 视图路径
for invariant/policy in scope:
    for ref actually read during evaluation (short-circuited branches EXCLUDED):
        consulted_facts.add(expand_to_instance_path(ref))
for fact in consulted_facts:
    E = evidence_view.visible_items_asserting(fact)
    T = [e for e in E if e.trust_level in TRUSTED_ESTABLISHES]
    if not E:                       status = MISSING       (not_rendered)
    elif len({e.value for e in T}) > 1: status = CONTRADICTORY
    elif T:                         status = ESTABLISHED   (value = 最高 trust 的 e.value)
    else:                           status = UNVERIFIABLE  (attacker_controlled_only / derived_only / untrusted_source)
    if freshness in {stale, expired} and any in-scope policy.requires_fresh: status = STALE
if any status != ESTABLISHED:
    observable_decision = "insufficient_evidence"; missing_evidence = [...]
else:
    observable_decision = world_truth_if_policies_held_over_established_values
```

**REVISION 1：`required_refs` 改为求值期动态 `consulted_facts`**（第 3 个阻塞发现的修正）。原设计用静态闭包，把被拒绝分支/短路分支读到的 ref 也算成必需，导致黄金 fixture 自相矛盾（`action.actor.tenant` 的唯一证据是 untrusted header，静态算法会判 insufficient，fixture 却写 attack；若改 fixture，则所有非 support 的读操作都变成 insufficient）。现在短路分支不计入，`decision_trace` 的 `evidence.sufficiency` 步骤带 `consulted_facts`，可与 fixture 逐条比对。

最后一步是关键：**observable 趟在"已建立事实表"上重跑同一套策略**，所以"陈旧缓存说 owner=Alice、真值是 Bob"会让 `observable_decision=safe` 而 `world_truth=attack`。

### 8.3 `decision_trace` 与 `evidence_view_id`

`decision_trace` 是结构化记录 `[{step, rule, operands, result}]`，`rule` 取值为 `policy.match` / `policy.evaluate` / `policy.default` / `invariant.evaluate` / `invariant.skip` / `verdict.aggregate` / `evidence.sufficiency` / `verdict.observable`。schema 强制 `minItems: 1`。

**`evidence_view_id = sha256(world_id, action_id, canonical visible evidence)`**（第 1 轮复审修正：原定义只哈希可见证据集，却断言"同 id 同决策"，而 `observable_decision` 是 `(world, action, evidence_view)` 的函数，该断言不可满足）。Gate 4 的确定性断言相应地改为"同 `(world, action, evidence_view_id)` 三元组 ⇒ 同 output"。

`skipped_invariants` 是 oracle 输出的一等字段，使"越界不变量不计入 satisfied"成为可断言性质（第 1 轮复审发现黄金 fixture 把越界不变量记进 `satisfied_invariants`，已修正）。

### 8.4 Gate 3 非空洞性探针算法（第 10 个阻塞发现的修正）

第 1 轮复审指出探针世界生成器原先完全未定义，而它是"AI 可写 policy 不过分宽松"的唯一防线。现写死为：

```
for each policy P in world.policies:
    refs = static_refs(P.condition)                        # ID 视图路径
    domains = {}
    for r in refs:
        domains[r] = declared_domain(r)                    # 从 schema 推导：
                                                            #   enum -> 枚举值
                                                            #   id 模式 -> 世界中同类型实体 id
                                                            #   bool -> {true,false}
                                                            #   integer -> {0,1,2,max_seen}
    # 对 domains 做有界笛卡尔采样（每 ref 最多 4 值，总量上限 config.probe.max_worlds）
    for each assignment A in sample(domains):
        probe_world = world with refs overridden by A
        d = decide_policy(probe_world, probe_action)
        record d
    if all(d.effect == "allow" for d in records): reject(P, "G3_policy_vacuous")
    if all(d.effect == "deny"  for d in records): reject(P, "G3_policy_never_allows")
```

`declared_domain` 从 schema 的类型信息推导，不猜。探针世界只用于求值，永不进入数据集。

### 8.5 传统 payload 类的 sink 模型（R8 的落地）

```
services[].sinks[] = {sink_id, kind: sql|shell|path|html|ssrf|deserialization|llm_prompt,
                      parameterized: bool, sanitized: bool, reachable_from: [operation]}
action.parameters.tainted_inputs = [{input_id, value, reaches_sink: sink_id, sanitized_on_path: bool}]
```

判定：`payload_class != benign` 且存在 tainted input 到达 `parameterized == false` 且 `sanitized_on_path == false` 的 sink ⇒ 攻击。**oracle 从不检查 payload 字符串本身**，因此同一文本在参数化 sink 世界判 `safe`。如实声明：这是**漏洞模型**，不是真实执行。

---

## 9. Counterfactual Engine 设计（需求输出 #9）

### 9.1 家族结构

一个 `counterfactual_family_id` 下挂 4 类变体（`configs/default.json` 默认每世界 1+3+3+**6**=13 个变体；`evidence_masked` 由 3 提到 6，第 1 轮复审指出 §9.4 要求六类而配置只有 3 个）：

| variant_type | 改什么 | 必须保持 | 期望效应 |
| --- | --- | --- | --- |
| `base` | — | — | 基准 verdict |
| `critical_intervention` | `critical_state_variables` 中**恰好一个** | 请求字节不变 | `verdict_flip`（与 spec 的 `expected_effect` 比对，不符 ⇒ Gate 5 拒绝） |
| `irrelevant_perturbation` | `irrelevant_state_variables`（UA / X-Request-Id / header 顺序 / trace id / 时间格式 / 装饰性名称大小写） | **世界状态零变化** | `verdict_invariant`（Gate 6 断言） |
| `evidence_masked` | 证据可见性（7 种 level） | 世界状态与请求不变 | `observable_downgrade` |

### 9.2 单变量由 `diff_worlds()` 机械强制

```python
def diff_worlds(a: WorldInstance, b: WorldInstance) -> WorldDiff   # .changed_paths: tuple[str, ...]
```

- `critical_intervention`：`diff_worlds(base, variant).changed_paths == (intervention.intervention_variable,)`，且 `observation.model_visible.request` 的 canonical json 与 base 相同。字段名统一为 `intervention_variable`（第 1 轮复审发现 schema 用 `intervention_variable` 而设计契约用 `variable`，Agent D 与 Agent E 会互相拒绝）。
- `irrelevant_perturbation`：`changed_paths == ()`（世界状态零变化），只有 observation 变。**`display_name.case` 已从无关轴中移除**——它是实体字段即世界状态，扰动它必然产生 changed path，使 Gate 6 永真失败；现改为 render-time-only 轴 `observation.rendering.display_name_case`。
- `evidence_masked`：`changed_paths == ()`，request 相同，只有 `evidence_view.visible` 变。

### 9.3 `expected_effect` 的可证伪性（R4 的落地）

预期只能来自 spec 的 `hypotheses.expected_counterfactual_axes`（先验声明）。Gate 5：

```
actual = verdict(variant); expected = spec.expected_effect
if actual != expected: reject(family, reason="G5_counterfactual_mismatch")   # 不改标签、不悄悄修正
```

### 9.4 Masking 的混杂设计与 level → 隐藏集合映射（第 8 个阻塞发现的修正）

`configs/default.json` 的 `evidence_masking.level_to_hidden_set` 现在**写死映射**，`test_masking_levels.py` 有确定期望。记 `H(f)` = 断言事实 `f` 的可见证据集合：

| level | 隐藏集合判定 |
| --- | --- |
| `complete` | 所有 `visible_in_observation=true` 的证据都渲染 |
| `partially_missing` | ≥1 个**非** consulted 证据被隐藏；每个 consulted 事实仍保留 ≥1 个可见 establishing 项 |
| `minimally_sufficient` | 每个 consulted 事实恰好保留 1 个可见 establishing 项，其余全隐藏 |
| `insufficient` | ≥1 个 consulted 事实 `H(f) == ∅` |
| `contradictory` | ≥1 个 consulted 事实有 ≥2 个可见项取值不同，且其中至少一个 establishing |
| `stale` | ≥1 个 consulted 事实的唯一可见 establishing 项 `freshness ∈ {stale, expired}` 且某 in-scope policy `requires_fresh=true` |
| `attacker_controlled` | ≥1 个 consulted 事实的可见项全部 `attacker_controllable=true` 且无一在 `TRUSTED_ESTABLISHES` |

每个 masked 家族强制同时产出 `minimally_sufficient`、`insufficient`、**诱饵变体**（隐藏 1 个**非** consulted 证据，verdict 必须仍可判定）、`contradictory`、`stale`、`attacker_controlled`（R2 的混杂要求）。

### 9.5 干预轴词汇表统一（第 9 个阻塞发现的修正）

原设计有三套互不兼容的轴词汇（spec 用具体 ID 路径、config 白名单用 glob、irrelevant 混观察路径与世界路径），且无人断言 `critical ⊆ whitelist`。现在：

- **一种路径语法**：§4.3 的 BNF。
- **schema 层**：`critical_state_variables` 的 items 必须匹配 ID 视图状态路径模式；`irrelevant_state_variables` 的 items 必须匹配 `^observation\.(request|rendering)\.` 模式。二者互斥由模式保证。
- **编译期断言**（Gate 2）：`set(critical_state_variables)` 中的每一个都匹配 `configs.expansion.critical_axes_whitelist` 的某个 glob；且无一以 `observation.` 开头。
- `schemas/examples/world-spec.invalid.json` 现在**真正**因为"critical 轴指向 `observation.request.headers.User-Agent`"被拒（第 1 轮复审实测原先该规则不存在，拒绝来自 `actors/0.tenant`）。

---

## 10. Leakage-control 方案（需求输出 #10）

### 10.1 group key 与派生规则（第 5 个阻塞发现的修正）

8 个 group key：`counterfactual_family_id`、`world_family_id`、`policy_graph_hash`、`workflow_template_hash`、`attack_family`、`semantic_scenario_signature`、`app_domain`、`generator_id`（后两个第 1 轮复审发现 config 里缺失，导致 `app_ood`/`generator_ood` 无法实现）。

**两个 family id 由编译器派生，禁止作者填写**：

```
world_family_id          = "WF-" + stable_hash(结构骨架)[:12]        # 标识符抽象为类型占位
counterfactual_family_id = "CF-" + stable_hash((world_family_id, world_id, seed, sorted(critical axes)))[:12]
```

schema 用模式 `^WF-[0-9a-f]{12,64}$` / `^CF-[0-9a-f]{12,64}$` 钉死形式。原设计两者都是作者可写自由字符串：AI 全填同一个 id 会把整个数据集并成一个连通分量（`world_ood` 不可分），每世界填唯一 id 则"同一 world 的表面变体不得跨 split"静默失效。`test_family_ids_are_derived_not_authored` 与 `test_constant_family_id_rejected` 覆盖。

### 10.2 分配算法

```
1. 每个 episode 收集其 group key 值集合
2. union-find：共享任意一个 key 值 ⇒ 同一连通分量（最小不可分单位）
3. 分量按 (strategy 指定的 holdout key, 分量大小 desc) 排序
4. 每分量用 sha256(canonical_json(分量代表) + seed) 取模落入 train/validation/test，
   带大小感知的分层修正；低于 min_groups_per_split 时显式告警并允许配置下调阈值，不静默产出偏斜 split
5. 断言：任何 key 值不出现在两个 split（G8）
```

### 10.3 八种 split 策略 = leave-key-out

| strategy | holdout key |
| --- | --- |
| `iid` | `counterfactual_family_id` |
| `world_ood` | `world_family_id` |
| `app_ood` | `app_domain` |
| `workflow_ood` | `workflow_template_hash` |
| `policy_ood` | `policy_graph_hash` |
| `attack_ood` | `attack_family` |
| `evidence_ood` | `semantic_scenario_signature` |
| `generator_ood` | `generator_id` |

统一断言：`values(holdout_key, test) ∩ values(holdout_key, train) == ∅`。`assign_splits` 断言 `(strategy → group_key)` 映射与本表一致；`release.schema.json` 的 `split_statistics.group_overlap_audit` 带 **`maxItems: 0`**（第 1 轮复审实测原先无约束，"Must be empty"只写在 description 里），且 `split_assignments` 数组为八种策略各存一行。

### 10.4 三层 dedup + 一层审计

| 层 | 归一化 | Phase 1 |
| --- | --- | --- |
| exact | canonical json 的 sha256，**作用域为 counterfactual family 内** | ✅ |
| normalized | 大小写/空白/URL 编码/header 顺序归一后再 hash | ✅ |
| structural | AST 骨架 hash（标识符抽象为类型占位） | ✅ |
| semantic similarity | 嵌入相似度 | ❌ **NOT IMPLEMENTED** |

**REVISION 1：exact dedup 改为 family 内作用域。** 第 1 轮复审发现 `observation.request.headers` 是 JSON object，`canonical_json(sort_keys=True)` 抹掉键序，于是"header 顺序"扰动既产不出不同字节，又会与 base 一起被 exact dedup 折叠——「无关不变性」少一类可训练样本。现在 header 顺序承载到 `rendered_text`（字符串，顺序可保留），且 dedup 在家族内进行、跨家族才全局去重。

### 10.5 `attack_family` 可达性门禁

`release.schema.json` 的 `attack_family_reachability` 记录每个声明攻击族的 `declared_worlds` 与 `reachable_samples`；`reachable_samples == 0` 是硬发布失败（世界声明了一个它表达不出来的攻击）。

---

## 11. Step-5-pre generator 设计（需求输出 #11）

### 11.1 prompt 契约

输出必须是**严格 JSON array**（或 JSONL，在 `prompt_version` 里钉死），每个元素是一个 `WorldSpec`。禁止自然语言解释、禁止枚举 HTTP 请求、禁止输出 oracle 标签长文。prompt 由 `generation/prompts/v0.1.md` 承载。

**信息密度原则**：AI 只产出"逻辑结构"——domain、实体关系、状态机、策略、不变量选择、关键/无关变量、反事实预期；ID 替换、ownership/session/token 变化、状态迁移、掩蔽、扰动、HTTP 序列化、header 排列、URL 编码、JSON 字段变化、噪声、**打标**全部由程序做。目标 1 seed → 20~200 实例。

### 11.2 输出契约的强制点

- `parse_world_specs(raw)` 只接受能通过 `world-spec.schema.json` 的元素；坏元素进 `rejected/` 并记 reason code，**不尝试修复**。
- `hypotheses` 块的字段是**假设**，进入 Gate 3/5 被证伪或证实；`compile_spec` 将其从 instance 中删除，`episode.provenance.generator_provenance` 是闭键白名单——**任何情况下假设字段进不了 release**。

### 11.3 provenance

`generator_model` / `generator_model_version` / `generation_timestamp` / `prompt_version` / `prompt_hash` / `raw_generation_id` / `decoding_parameters` / `validation_outcome`，落在 `WorldSpec.provenance` 与 `release.schema.json` 的 `generator_models[]`（含 `provider: replay|live`，用于区分录播指标与真实吞吐）。

### 11.4 效率指标

```
GE = accepted_unique_worlds / output_tokens * 1000
```

### 11.5 Phase 1 的联网边界

- `provider` 恒为 `replay`。
- `ReplayClient` 从 `generation/fixtures/recorded/` 读录播响应（fixture 本身 gitignore）。
- `Step5Client` 标注 **NOT IMPLEMENTED**，`test_no_network_in_tests` 在整个测试会话内 monkeypatch `socket.socket` 抛异常。
- batch size 由 `scripts/probe_batch_size.py` 在录播上测定。

---

## 12. 第一阶段开发计划（需求输出 #12）

### 12.1 里程碑

| 里程碑 | 交付 | exit criteria（可执行） |
| --- | --- | --- |
| **M0 设计** | 本文档 + 8 schema + 脚手架 | `py -3 scripts/validate_schemas.py` exit 0；本文档 14 项 + §15 契约齐全 |
| **M1 语义内核** | `model` + `policy` + `invariants` + `workflows` + `evidence` + `oracle`，跑通参考世界 | `py -3 -m pytest tests/unit -q` 全绿；`test_determinism_byte_identical`、`test_world_instance_has_no_label_field`、`test_violated_invariant_implies_attack_truth` 绿 |
| **M2 反事实与渲染** | `expansion` | `test_critical_intervention_changes_exactly_one_path`、`test_irrelevant_axis_never_touches_state`、8 个 renderer golden、`test_model_visible_boundary` 全绿 |
| **M3 门禁与发布** | `validation`（G1–G11）+ `release` + leakage split | `test_gates_reject_bad_family`、`test_no_family_straddles_split`、`test_split_mode_leave_key_out`、`test_renderer_projection_allowlist` 全绿；manifest 样例通过 `release.schema.json` |
| **M4 生成器能力** | `generation` | `test_llm_cannot_influence_labels`、`test_no_network_in_tests`、`test_expected_effect_is_falsifiable` 全绿；**未发生任何真实 API 调用** |
| **M5 语料与收口** | 10–30 个人工 worlds + 全套测试 + Phase-1 报告 | `py -3 -m pytest -q` 全绿（含 property/metamorphic）；父仓 `npm run check:quick` 不受影响 |

### 12.2 10–30 个人工 worlds 清单（M5 交付物，`worlds/handcrafted/`）

每个世界一个目录 `worlds/handcrafted/ASW-HC-NNN/{world-spec.json, expected.md}`；`expected.md` 记录**人工预期**，由 Gate 5 与 oracle 比对（不一致 ⇒ 人工世界写错了，修 spec，不是修 oracle）。

| ID | domain | 主测不变量 | 攻击族 |
| --- | --- | --- | --- |
| HC-001 | e-commerce | ownership | idor_bola |
| HC-002 | e-commerce | ownership + workflow | workflow_bypass |
| HC-003 | saas | authorization | horizontal_privesc |
| HC-004 | iam_system | authorization | vertical_privesc |
| HC-005 | iam_system | session_validity | revoked_session_reuse |
| HC-006 | hr_system | session_validity | session_after_account_disable |
| HC-007 | ticketing | token_lineage | cross_workflow_token_reuse |
| HC-008 | logistics | token_lineage | token_lineage_confusion |
| HC-009 | finance_workflow | one_time_token + workflow | one_time_token_reuse |
| HC-010 | cloud_storage | tenant_isolation | tenant_isolation_violation |
| HC-011 | code_hosting | ownership + authorization | stale_authorization |
| HC-012 | healthcare_workflow | session_validity + workflow | session_after_password_reset |
| HC-013 | devops_platform | token_lineage | scope_mismatch |
| HC-014 | api_marketplace | workflow | invalid_state_transition |
| HC-015 | messaging | ownership | cross_account_session_misuse |
| HC-016 | subscription_system | workflow | repeated_operation |
| HC-017 | school_system | ownership + tenant | tenant_mismatch |
| HC-018 | crm | authorization | privilege_version_mismatch |
| HC-019 | industrial_management | session_validity | stale_session_privilege |
| HC-020 | iot_management | token_lineage | cross_resource_token_reuse |
| HC-021 | project_management | workflow | skipping_required_step |
| HC-022 | content_platform | ownership | owner_mismatch |
| HC-023 | cloud_storage | cache（Phase 2 预告） | stale_permission_cache |
| HC-024 | saas | payload-sink 模型 | sql_injection（**探针世界**：证明同一 payload 在参数化 sink 下 safe） |

**HC-001..HC-020 是 Phase 1 硬下限**（覆盖 5 类必须不变量 × 4 个以上 domain）。HC-018 的 `privilege_version_mismatch` 现在能正确产出 attack——第 1 轮复审指出按原聚合规则该世界（不变量 severity=high）会被标成 safe。

### 12.3 每阶段的工作律

`run tests → inspect failures → fix → continue`；禁止占位实现；未实现的模块在 `README.md` 与模块 docstring 里显式写 `NOT IMPLEMENTED`。

---

## 13. 需要新增的测试（需求输出 #13）

### 13.1 单元测试（`tests/unit/`）

| 文件 | 覆盖 |
| --- | --- |
| `test_model_canonical.py` | `canonical_json` 键序/转义稳定；`stable_hash` 跨进程稳定 |
| `test_model_refs.py` | 三类视图解析与 BNF；未知路径抛 `RefResolutionError`；action 绑定展开成实例路径 |
| `test_model_compile.py` | spec→instance；悬空引用/环/双记不一致/角色悬空/轴越界全部拒绝并给 reason code |
| `test_policy_eval.py` | **27 个 op 全量正/反例**；未知 op 抛 `DslError`；`establishing_evidence_exists` 单向性 |
| `test_policy_match.py` | priority + tie-break；无匹配 ⇒ deny；`"*"` 语义；`is_default_rule` |
| `test_invariants_ownership.py` | owner==principal 不判违规；跨租户 support 的边界 |
| `test_invariants_authorization.py` | 水平/垂直越权 |
| `test_invariants_session.py` | revoked / valid=false / expires_at 过期 / 密码重置后 / 账户 disabled |
| `test_invariants_token_lineage.py` | flow 不匹配、`lineage_root`、环拒绝、`one_time && used` |
| `test_invariants_workflow.py` | allowed / forbidden / conditional transition；`applies_to` 作用域（`skipped_out_of_scope` 必记录，越界不计 satisfied） |
| `test_evidence_fact_table.py` | 六类 status；trust 两维独立；`asserts_ref` 分组 |
| `test_evidence_bridge_one_way.py` | `establishing_evidence_exists` 不能把 verdict 变成 attack |
| `test_oracle_two_pass.py` | world_truth vs observable_decision 分离；stale cache 造成二者分歧 |
| `test_oracle_aggregate.py` | default-deny 单独命中 ⇒ `unauthorized` 而非 `attack`；任一违反 ⇒ `attack`（每 category 一例） |
| `test_oracle_trace.py` | trace 非空、可复算、无自然语言；`consulted_facts` 与 `asserts_ref` 逐字可比 |
| `test_renderer_golden.py` | 8 个 renderer 各 1 个 golden（fixture 入库） |
| `test_renderer_payload_agnostic.py` | 同一 payload 在不同 sink 模型下 verdict 不同；改写编码不变 |
| `test_counterfactual_diff.py` | `diff_worlds` 精确性；`changed_paths == (intervention_variable,)` |
| `test_masking_levels.py` | 7 个 level 按 §9.4 映射的确定期望 |
| `test_perturbation_axes.py` | 每个无关轴不改状态 |
| `test_schemas_meta.py` | 8 个 schema 自身合法 + 正/负 fixture（镜像 `scripts/validate_schemas.py`） |

### 13.2 属性测试（`tests/property/`，hypothesis）

- `test_owner_only_never_flags_owner`：`principal == owner` ∧ owner_only ∧ 其他条件满足 ⇒ ownership 不变量不判违规（需求 §22 原例）。
- `test_policy_total_function`：任意策略 + 任意动作 ⇒ 决策是 allow/deny 之一，不抛异常。
- `test_ref_resolution_total`：编译通过的世界，所有 in-scope ref 均可解析。
- `test_no_path_mutation`：求值前后世界的 canonical json 不变。

### 13.3 元变形测试（`tests/metamorphic/`）

- `test_user_agent_change_holds_verdict`（需求 §22 原例）。
- `test_owner_change_may_flip_verdict`。
- `test_header_order_and_key_order_hold_verdict`（header 顺序经 `rendered_text` 承载）。
- `test_timestamp_format_holds_verdict`。

### 13.4 确定性、边界与泄漏测试（`tests/`）

- `test_determinism_byte_identical`、`test_pythonhashseed_stable`、`test_no_wallclock_in_data_path`（VirtualClock 字段除外）。
- `test_model_visible_boundary`（conftest fixture，22 禁键 + 投影精确 + hidden id 一致）。
- `test_hidden_evidence_not_serialized`。
- `test_family_ids_are_derived_not_authored`、`test_constant_family_id_rejected`。
- `test_no_family_straddles_split`、`test_split_mode_leave_key_out`、`test_union_find_groups_are_closed`。
- `test_renderer_projection_allowlist`（8 个 renderer 的输出不得含 `attack_family` 枚举值、`POL-`/`INV-`/`OPP-`/`AXIS-` id 前缀、`metadata`/`provenance`/`seed`/`policies`/`invariants` 键）。
- `test_surface_features_label_independent`（G11 硬门，MI ≤ 0.01 bit）。
- `test_llm_cannot_influence_labels`、`test_no_network_in_tests`、`test_import_boundaries`。
- `test_vacuous_policy_rejected`、`test_label_entropy_floor`、`test_domain_coverage_floor`、`test_insufficiency_is_confounded`。
- `test_gate2_temporal_monotonic`（`state_history` / `timeline` 单调 + `current_state.at >= max(history.at)`）。
- `test_spec_instance_pair`（conftest fixture：参考 spec 确实编译成参考 instance）。
- `test_evidence_visibility_projection_consistent`（三处可见性表示一致）。

### 13.5 数据门禁测试（`tests/gates/`）

每个 Gate 一个"拒绝坏样本"负例 + 一个"放行好样本"正例，共 22 个；坏样本用与 `schemas/examples/*.invalid.json` 同款手法构造（并且**断言拒绝路径**，不只是断言被拒）。

---

## 14. 第一阶段明确不做什么（需求输出 #14）

**明确 NOT IMPLEMENTED（Phase 2+）**：

1. 模型微调 / QLoRA / SFT·RL Trainer / RLVR / 任何训练代码。
2. 论文 LaTeX 与写作、评测论文实验。
3. 500 worlds 的真实批量生成（只建能力 + 录播自测 + 探针脚本）。
4. `Step5Client` 真实联网调用；任何真实 API 凭据；`.env` 提交。
5. semantic similarity dedup（嵌入后端未定，`enabled: false`）。
6. 20 类不变量中的 13 类具体模板（schema 枚举已立，实现未做）。
7. event → snapshot 自动反推器（Phase 1 历史由作者显式给出）。
8. 图表渲染——Phase 1 只产 JSON/CSV。
9. 真实漏洞数据导入器。
10. 产品前端、SOC 控制台、任何 Networksafe 产品功能。
11. 多语言 renderer。
12. `GENERATOR-OOD` 的第二种生成器（需要第二个 provider）。
13. Postgres/对象存储后端——Phase 1 产物就是文件系统 + JSONL + sha256。
14. 并发生成调度器。
15. `G6_irrelevant_invariance` 的"独立失败能力"——它被明确定义为机械 diff 检查（`changed_paths == ()`），不可能独立失败；真正有信息量的表层-标签独立性审计是 **G11**，已列入硬门。

**明确禁止（任何阶段）**：自动扫描公网、自动测试未授权目标、真实凭据采集、真实 token 获取、对外攻击执行器、自动利用真实第三方服务；把 unknown 生成得"容易识别"以迎合某个模型弱点（需求 §26）；按模型结果改测试集。

---

## 15. 模块地图与接口契约（五子代理并行实现）

### 15.1 目录布局（权威版）

```
aether-security-world/
├── pyproject.toml  README.md  .gitignore  conftest.py     # 架构师
├── configs/default.json                                    # 架构师
├── docs/{brief.md, design-v0.1.md}                         # 架构师
├── schemas/                                                # 架构师（实现者只读）
│   ├── world-spec  world  action  episode  evidence
│   ├── policy  oracle-output  release   (8 个 .schema.json)
│   └── examples/*.example.json  *.invalid.json
├── scripts/validate_schemas.py                             # 架构师（bootstrap 验收）
├── scripts/probe_batch_size.py                             # Agent E
├── security_world/
│   ├── model/        # Agent A
│   ├── policy/       # Agent B
│   ├── invariants/   # Agent B
│   ├── workflows/    # Agent B
│   ├── evidence/     # Agent C
│   ├── oracle/       # Agent C
│   ├── expansion/    # Agent D
│   ├── validation/   # Agent E
│   └── release/      # Agent E
├── generation/       # Agent E
├── worlds/handcrafted/  # Agent E
├── datasets/         # 产物，gitignore
├── analysis/         # Agent E
└── tests/{unit,property,metamorphic,gates,integration}/
```

### 15.2 文件归属与"互不改对方文件"规则

| 子代理 | 独占目录 | 测试目录 | 不得触碰 |
| --- | --- | --- | --- |
| **A（模型内核）** | `security_world/model/` | `tests/unit/test_model_*.py` | 其他一切 |
| **B（语义引擎）** | `security_world/policy/`、`security_world/invariants/`、`security_world/workflows/` | `tests/unit/test_policy_*.py`、`test_invariants_*.py` | 其他一切 |
| **C（oracle+证据）** | `security_world/oracle/`、`security_world/evidence/` | `tests/unit/test_oracle_*.py`、`test_evidence_*.py` | 其他一切 |
| **D（展开+渲染）** | `security_world/expansion/` | `tests/unit/test_renderer_*.py`、`test_counterfactual_*.py`、`test_masking_*.py`、`test_perturbation_*.py` | 其他一切 |
| **E（门禁/发布/生成/语料/集成）** | `security_world/validation/`、`security_world/release/`、`generation/`、`worlds/`、`analysis/`、`scripts/probe_batch_size.py`、`tests/integration/`、`tests/test_import_boundaries.py`、`tests/metamorphic/`、`tests/property/`、`tests/gates/` | 同上 | 其他 agent 的 `security_world/*` 子包 |

**三条硬规则**：

1. 跨包只经包级公共 API（`from security_world.policy import decide_policy`），**禁止**深导入——由 `tests/test_import_boundaries.py` 断言。
2. 每个包的 `__init__.py` 用 `__all__` 显式导出 §15.3 列出的契约符号。
3. 文件命名前缀即归属：`test_<pkg>_*`。两名 agent 想加同名测试文件 ⇒ 命名冲突即设计错误。

> 负载提示：Agent E 偏重。若 M3–M4 排队，**自然的切法是把 `generation/` 连带 `tests/metamorphic|property|gates` 的一部分拆给第六名 agent**，边界仍是目录级。

### 15.3 接口契约（签名级；REVISION 1 已与 8 个 schema 对齐）

```python
# ---------- L1  security_world/model  (Agent A) ----------
def canonical_json(obj: Any) -> str            # sort_keys=True, separators=(",",":"), ensure_ascii=False
def stable_hash(obj: Any) -> str               # sha256(canonical_json)

@dataclass(frozen=True)
class WorldInstance:                           # world.schema.json
    world_id: str; world_family_id: str; application_domain: str; seed: int
    provenance: Mapping[str, Any]; compile: Mapping[str, Any]
    roles: tuple[Role, ...]; actors: tuple[Actor, ...]; resources: tuple[Resource, ...]
    sessions: tuple[Session, ...]; tokens: tuple[Token, ...]; credentials: tuple[Credential, ...]
    workflows: tuple[Workflow, ...]; services: tuple[Service, ...]; caches: tuple[CacheEntry, ...]
    trust_boundaries: tuple[TrustBoundary, ...]
    policies: tuple[PolicyRule, ...]; invariants: tuple[Invariant, ...]
    state_history: tuple[StateSnapshot, ...]; current_state: StateSnapshot
    evidence: tuple[EvidenceItem, ...]
    def resolve(self, path: str) -> Any                    # §4.3 BNF；未知路径抛 RefResolutionError
    def ref_universe(self) -> frozenset[str]               # 全部可解析 ID 视图路径（Gate 2/3）
    def expand_action_view(self, path: str, action: "Action") -> str   # action.resource.owner -> resource.RES-001.owner

@dataclass(frozen=True)
class WorldSpec: ...                            # world-spec.schema.json（含 hypotheses/episode_templates/axes）
class RefResolutionError(ValueError): ...
class CompileError(ValueError):
    reason_code: str        # dangling_ref | cycle | state_mismatch | vacuous_policy | axis_not_in_whitelist |
                           # role_dangling | history_non_monotonic | applies_to_unknown_operation | ...

def load_world(path: Path) -> WorldInstance
def load_world_spec(path: Path) -> WorldSpec
def compile_spec(spec: WorldSpec, *, seed: int) -> WorldInstance     # §4.1 的 5 步契约
def validate_world_document(doc) -> list[str]
def validate_world_spec_document(doc) -> list[str]

# ---------- L2  security_world/policy  (Agent B) ----------
@dataclass(frozen=True)
class Expr:                                     # AST 节点，.op 判别（27 个 op）
    op: str; args: tuple["Expr", ...] = (); path: str | None = None; value: Any = None

def parse_expr(node: Mapping[str, Any]) -> Expr  # 未知 op / arity / 路径违规 ⇒ DslError
class DslError(ValueError): ...

@dataclass(frozen=True)
class EvalContext:
    world: WorldInstance
    action: "Action | None" = None
    evidence_view: "EvidenceView | None" = None     # None ⇒ truth 趟
    now: str = ""                                   # VirtualClock
    current_flow_id: str = ""
    consulted_refs: set[str] = field(default_factory=set)   # 动态记录实际读到的 ref

def eval_expr(expr: Expr, ctx: EvalContext) -> Any
def static_refs(expr: Expr) -> frozenset[str]

@dataclass(frozen=True)
class Action:                                   # action.schema.json
    action_id: str; operation: str; actor: str
    resource: str | None = None; session: str | None = None
    token: str | None = None; workflow_instance: str | None = None
    flow_id: str = ""; at: str = ""
    parameters: Mapping[str, Any] = field(default_factory=dict)
    request: Mapping[str, Any] = field(default_factory=dict)

@dataclass(frozen=True)
class PolicyDecision:
    effect: Literal["allow", "deny"]
    matched_policy_id: str | None
    is_default_rule: bool                        # True ⇒ 不能单独产生 attack
    evaluated: tuple[tuple[str, str], ...]

def decide_policy(world, action, *, default_effect="deny") -> PolicyDecision

# ---------- L2  security_world/invariants  (Agent B) ----------
class InvariantScope(Enum): EVALUATED; SKIPPED_OUT_OF_SCOPE; SKIPPED_UNBOUND_SUBJECT

@dataclass(frozen=True)
class InvariantResult:
    invariant_id: str; category: str; severity: str      # severity 只进报告
    scope: InvariantScope; satisfied: bool; trace: tuple[dict, ...]

ATTACK_CATEGORIES: frozenset[str]        # 引擎私有常量 = 全部 20 类；不随 author 输入变化

def evaluate_invariants(world, action, *, ctx=None) -> tuple[InvariantResult, ...]
    # 保证 violated ∪ satisfied ∪ skipped == world.invariants，且三者两两不交
def decision_facts(world, action) -> frozenset[str]      # 返回 ID 视图路径（action 视图已展开）

# ---------- L2  security_world/workflows  (Agent B) ----------
def transition_allowed(workflow, instance_id, to_state, ctx) -> bool   # from_state 取实例当前态
def state_is(workflow, instance_id, state) -> bool

# ---------- L3  security_world/evidence  (Agent C) ----------
TRUSTED_ESTABLISHES: frozenset[str] = frozenset({"trusted", "semi_trusted"})

@dataclass(frozen=True)
class EvidenceView:
    visible: tuple[EvidenceItem, ...]
    hidden: tuple[EvidenceItem, ...]
    def asserting(self, fact_key: str) -> tuple[EvidenceItem, ...]     # 仅 visible，按 asserts_ref 精确匹配
    def view_id(self, world_id: str, action_id: str) -> str            # sha256(world_id, action_id, visible)

class FactStatus(Enum):
    ESTABLISHED; MISSING; UNVERIFIABLE; CONTRADICTORY; STALE

@dataclass(frozen=True)
class Fact:
    fact_key: str; status: FactStatus; value: Any = None
    evidence_ids: tuple[str, ...] = (); reason: str | None = None

@dataclass(frozen=True)
class FactTable:
    facts: Mapping[str, Fact]
    def established(self, fact_key: str) -> Any
    @property
    def sufficient(self) -> bool

def build_fact_table(world, action, view, *, consulted_facts: frozenset[str],
                     trusted=TRUSTED_ESTABLISHES) -> FactTable
    # consulted_facts 来自求值期动态记录，不是静态闭包（§8.2）

# ---------- L3  security_world/oracle  (Agent C) ----------
ORACLE_VERSION: str = "0.1.0"

@dataclass(frozen=True)
class OracleOutput:                             # oracle-output.schema.json
    world_truth: Literal["safe", "attack", "unauthorized"]
    observable_decision: Literal["safe", "attack", "insufficient_evidence", "unauthorized"]
    violated_invariants: tuple[str, ...]
    satisfied_invariants: tuple[str, ...]
    skipped_invariants: tuple[dict, ...]        # [{invariant_id, reason}]
    required_evidence: tuple[dict, ...]         # [{evidence_id, decision_fact, asserts_ref, observable, trust_level, contradicted}]
    missing_evidence: tuple[dict, ...]          # [{evidence_id?, decision_fact, reason}]
    decision_trace: tuple[dict, ...]            # 含 evidence.sufficiency 步骤的 consulted_facts
    evidence_view_id: str
    oracle_version: str
    def to_document(self) -> dict
    def render_trace(self) -> list[str]         # 人读，仅调试用

def run_oracle(world, action, evidence_view, *, version=ORACLE_VERSION) -> OracleOutput

# ---------- L4  security_world/expansion  (Agent D) ----------
@dataclass(frozen=True)
class ExpansionConfig:
    variants_per_world: Mapping[str, int]       # base/critical_intervention/irrelevant_perturbation/evidence_masked
    critical_axes_whitelist: tuple[str, ...]    # glob
    irrelevant_axes: tuple[str, ...]            # observation.* 路径
    masking_levels: tuple[str, ...]
    level_to_hidden_set: Mapping[str, str]
    renderer: str
    seed: int

@dataclass(frozen=True)
class WorldDiff:
    changed_paths: tuple[str, ...]              # ID 视图路径
    def is_single(self, path: str) -> bool      # changed_paths == (path,)
    def is_empty(self) -> bool

def diff_worlds(a: WorldInstance, b: WorldInstance) -> WorldDiff

@dataclass(frozen=True)
class Intervention:
    intervention_variable: str; before: Any; after: Any
    expected_effect: str; actual_effect: str | None = None

@dataclass(frozen=True)
class Observation:                              # observation.model_visible 的内存形态
    renderer: str; current_time: str
    request: Mapping[str, Any]
    evidence: tuple[dict, ...]                  # 七键投影
    timeline: tuple[dict, ...]                  # 无 causal_tag

@dataclass(frozen=True)
class ExpansionResult:
    family_id: str
    variants: tuple["Episode", ...]
    diffs: Mapping[str, WorldDiff]

def instantiate(spec: WorldSpec, *, seed: int) -> WorldInstance
def critical_intervention(world, *, intervention_variable: str, after: Any, seed: int) -> tuple[WorldInstance, Intervention]
def irrelevant_perturbation(world, observation: Observation, *, axis: str, seed: int) -> Observation
    # 只允许 observation.* 轴；不得改动世界状态
def mask_evidence(view: EvidenceView, *, level: str, seed: int,
                  consulted_facts: frozenset[str]) -> EvidenceView
def render(world, action, *, renderer: str, seed: int,
           allowlist: Mapping[str, Any]) -> Observation
    # allowlist 来自 configs.rendering.projection_allowlist；越界投影即抛
def assemble_episode(*, world: WorldInstance, spec: WorldSpec, family_id: str,
                     variant_type: str, action: Action,
                     timeline: tuple["Event", ...], observation: Observation,
                     oracle_output: OracleOutput) -> "Episode"
    # 内部调用 C.run_oracle；D → C 是唯一允许的跨包调用方向（除 E 的胶水）

# ---------- L5  security_world/validation  (Agent E) ----------
@dataclass(frozen=True)
class GateResult:
    gate: str; passed: bool; detail: str = ""
@dataclass(frozen=True)
class GateReport:
    results: tuple[GateResult, ...]
    @property
    def passed(self) -> bool
    @property
    def failures(self) -> tuple[GateResult, ...]

GATES: tuple[str, ...]      # G1..G11

def run_gates(episode, *, family=None, config) -> GateReport
    # G2 含：state_history/timeline 单调、current_state.at >= max(history.at)、
    #       actor.roles ⊆ role_id、applies_to operation 存在于 endpoints、
    #       critical 轴 ⊆ whitelist 且非 observation 路径、可见性三处一致
    # G3 含：§8.4 探针非空洞性 + attack_family 可达性
    # G11：表层特征与 verdict 的互信息 ≤ 阈值（硬门）

@dataclass(frozen=True)
class SplitAssignment:
    strategy: str; group_key: str
    assignments: Mapping[str, str]              # episode_id -> split
    def groups_for(self, split: str) -> frozenset[str]

STRATEGY_TO_GROUP_KEY: Mapping[str, str]        # §10.3 表；assign_splits 断言一致

def assign_splits(episodes, *, strategy: str, ratios: Mapping[str, float],
                  seed: int) -> SplitAssignment
def group_overlap_audit(assignment, group_key_of) -> list[dict]   # 必须为空
def dedup(episodes, *, scope="counterfactual_family_id") -> tuple[list["Episode"], dict]
def distribution_summary(episodes) -> dict

# ---------- L6  security_world/release  (Agent E) ----------
def build_release(episodes, *, out_dir: Path, config, git_commit: str,
                  schema_versions: Mapping[str, str]) -> "ReleaseManifest"
    # manifest 含 split_assignments（八策略）、attack_family_reachability、G11 结果
def freeze(out_dir: Path) -> None               # 已冻结则拒绝覆盖；修改必须是新 release_id

# ---------- L7  generation/  (Agent E) ----------
class WorldSeedClient(Protocol):
    def generate(self, prompt: str, *, batch_size: int, max_output_tokens: int) -> RawGeneration: ...

@dataclass(frozen=True)
class RawGeneration:
    raw_generation_id: str; model: str; model_version: str
    prompt_version: str; prompt_hash: str
    decoding_parameters: Mapping[str, Any]
    output_text: str; output_tokens: int; input_tokens: int

class ReplayClient:                             # Phase 1 默认；零网络
    def __init__(self, fixture_dir: Path): ...
class Step5Client:                              # NOT IMPLEMENTED（Phase 1 不得被调用）

def parse_world_specs(raw: RawGeneration) -> tuple[list[WorldSpec], list[dict]]
def probe_batch_stability(fixture_dir: Path, sizes: Sequence[int]) -> list[dict]
def generation_efficiency(accepted_unique_worlds: int, output_tokens: int) -> float
```

### 15.4 拼装顺序

A（无内部依赖）→ B/C 并行（都只依赖 A 的 `WorldInstance`）→ D（依赖 B/C）→ E（依赖全部）。任何 agent 在依赖未就绪时，用 `schemas/examples/*.json` 作为契约夹具写测试（`conftest.py` 的 `validators` / `reference_*` / `model_visible_boundary` / `spec_instance_pair` fixture 已提供）。

---

## 16. 设计自检：需求 §29 十问

| # | 问题 | 回答 |
| --- | --- | --- |
| 1 | 标签究竟是谁产生的？ | 只有 `security_world/oracle/run_oracle`。`test_llm_cannot_influence_labels` 证明 |
| 2 | AI 有没有偷偷参与 ground truth？ | 四道堵截：(a) AI 只选/参数化**人工不变量目录**；(b) policy 非空洞性探针（§8.4）；(c) `hypotheses` 块被 `compile_spec` 删除；(d) `generator_provenance` 闭键白名单 |
| 3 | 这个 verdict 是否可以程序证明？ | 可以：verdict = 非 default 规则否定 ∨ 任一不变量违反；`decision_trace` 可复算；空 trace 被 schema 拒绝；**`action` 在 episode 里必填，第三方可独立重放** |
| 4 | 这个 unknown 是否真的因为 evidence 不足？ | Gate 7 要求**证明**至少一个 `consulted_fact` 不可观测；`required_evidence[].decision_fact` 由 oracle 计算，与 `asserts_ref` 逐字可比 |
| 5 | counterfactual 是否只改变一个关键变量？ | `diff_worlds().changed_paths == (intervention_variable,)` 机械断言，且请求字节不变 |
| 6 | test 是否可能泄漏到 train？ | union-find 连通分量 + 8 种 leave-key-out + `group_overlap_audit` 必须为空（schema `maxItems: 0` 硬拒非空） |
| 7 | 一个模型是否能仅靠模板特征猜标签？ | 三类对抗：无关扰动轴与 verdict 独立采样；结构 dedup 硬门；domain 覆盖下限 |
| 8 | 是否存在 generator fingerprint？ | 同上；另加 `generator_ood` 策略与 `generator_id` group key |
| 9 | 数据是否过于人工、缺少业务语义？ | **已知的主要残余风险**（§17-6）。缓解只有部分：20 个 domain 强制配额、8 种 renderer、episode 级历史。语义密度靠 AI seed 的逻辑结构密度（GE 指标监控） |
| 10 | 我们是否浪费了 Step-5 token 做程序就能完成的事情？ | prompt 契约显式禁止；`probe_batch_size` + GE 指标提供量化反馈 |

---

## 17. 需求本身的方法学缺陷与修正

### 17-1 `real_world_truth` 的提法在认识论上不成立 → 改为"程序世界真值"

需求 §4 用 `real_world_truth = ATTACK` 描述"真实世界"，但本项目世界是**声明的合成世界**。保留该词会诱导读者以为标签对应现实攻击。**修正**：字段名 `world_truth`，语义明确为"在声明的完整世界上由程序判定的安全结论"。

### 17-2 "insufficient_evidence 是第三类"是数据设计陷阱 → 混杂 + 可证明

见 R2。**修正**：每个 masked 家族强制配 `minimally_sufficient` 与**诱饵掩蔽**变体；配比固定不随模型调整；Gate 7 要求可证明；`model_visible`/`decision_metadata` 拆分防止元数据解码。

### 17-3 `expected_effect` 若由程序回填，Gate 5 自证空洞 → 先验声明 + 证伪即拒

见 R4。

### 17-4 group split 会让 test 集过小/有偏

**修正**：`assign_splits` 输出分量数与每 split 世界数，低于 `min_groups_per_split` 时**显式告警并允许配置下调阈值**，不静默产出偏斜 split；Phase 1 的 split 断言只验性质（无重叠），不验比例精度。

### 17-5 "500-world Step-5 generator"与第一阶段 KPI 冲突 → 能力与实跑分离

见 R6/R10。

### 17-6 残余风险（无法在本阶段消除，如实记录）

- **语义真实性上限**：业务语义由 AI 提供，程序只保证结构一致。
- **payload 类是漏洞模型而非真实执行**：`parameterized/sanitized` 是声明。
- **结构 dedup 不等于语义 dedup**：语义相似度审计未实现。
- **不变量目录的人工性**：7/20 类实现，未覆盖类别在 schema 可声明但引擎会显式拒绝执行。

---

## 18. 本文档作者实际执行过的验证（evidence）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 需求逐字副本 | `py -3` + `shutil.copyfile` 后字节比对 | **通过**：源与目标均 34274 字节，sha256 同为 `ed4b1c20…652e2b4`，`identical True` |
| 8 个 schema 元校验 + 跨文件 `$ref` + 5 正 fixture + 7 负 fixture **（断言拒绝路径）** | `cd aether-security-world && py -3 scripts/validate_schemas.py` | **通过（exit 0）**：`schemas_meta_validated=8`、`positive_fixtures_passed=5`、`negative_fixtures_rejected_at_declared_path=7`、`SCHEMA_VALIDATION=passed`。每个负 fixture 都额外通过"修复声明路径后必须变为合法"的反向验证 |
| `model_visible` 边界（22 禁键 + 七键投影精确 + hidden id 一致） | 内存校验脚本（见 §19 B1 条目） | **通过**：`model_visible forbidden-key hits: NONE`、`projection exact: True`、`hidden ids == classification invisible: True` |
| 黄金 fixture 内部一致性（consulted_facts ⊆ asserts_ref、不变量三分划完备且不交、时间线单调） | 内存校验脚本 | **通过**：`consulted_facts all have an asserting evidence item: True`、`invariant partition complete: True / disjoint: True`、`timeline monotonic: True` |
| spec → instance 编译关系 | `conftest.spec_instance_pair` fixture 逻辑 | **通过**：instance 与 spec 在共享字段上逐字相同，`world_family_id` 为 `WF-`+12hex 派生形式，`hypotheses`/`attack_family` 已被丢弃 |
| Python/工具链 | `py -3 --version`、`py -3 -m pytest --version`、`py -3 -c "import jsonschema, referencing, hypothesis"` | `3.12.10` / `pytest 8.3.5` / `jsonschema 4.26.0` + `hypothesis 6.153.0` |
| 空 testpaths 的 pytest 退出码 | `py -3 -m pytest -q -p no:cacheprovider; echo $?` | **exit 1**（`filterwarnings=["error"]` 把 `PytestConfigWarning` 升级为错误）；加 `-W ignore::pytest.PytestConfigWarning` 后为 **exit 5**。§18 如实记录为 1，不是 5 |
| 父仓结构契约不受影响 | 读 `scripts/guards/check-project-structure.mjs`（只校验 requiredFiles 存在性与 package.json 脚本，无顶层目录白名单）；`grep -n "topLevel\|allowedDirs" scripts/guards/check-repository-hygiene.mjs` 无命中 | **结论**：新增 `aether-security-world/` 不会破坏现有 guard；**未实跑** `npm run check:quick`（超出本任务范围） |

未做的事（明确声明）：`security_world/**` 全部未实现；10–30 个人工 worlds 未落盘（仅列出清单与命名规范）；`py -3 -m pytest -q` 目前因 `tests/` 不存在而 exit 1（见上表最后两行），属预期。

---

## 19. 修订记录（第 1 轮独立复审，20 阻塞 + 19 参考意见逐条处理）

格式：**发现 → 处理 → 落点 → 验证**。

### 19.1 阻塞发现

**B1 模型输入边界未定义，observation 携带 oracle 级标注**
处理：`observation` 拆成 `model_visible`（闭集七键证据投影 + 无 `causal_tag` 的时间线）与 `decision_metadata`（trust/freshness/attacker_controllable/contradicts/visible_in_observation/availability_level/relevant+irrelevant_history/causal_tags/hidden ids）。`evidence_observation` 与 `event_observation` 子 schema 均 `additionalProperties: false`，**schema 层即不可能**把分类键放进模型侧。`required_for_decision` 从 evidence schema 删除（oracle 独占）。`conftest.model_visible_boundary` fixture 提供可执行断言。
落点：`schemas/episode.schema.json`、`schemas/evidence.schema.json`、`conftest.py`、设计 §5.2。
验证：内存校验 `model_visible forbidden-key hits: NONE`、`projection exact: True`、`hidden ids == classification invisible: True`。

**B2 world_truth 聚合被作者可写的 severity 把持**
处理：聚合规则改为与作者输入无关——`attack` iff（非 default 规则否定）∨（任一不变量违反）；`ATTACK_CATEGORIES` 为引擎私有常量且等于全部 20 类；`severity` 在 schema 注释中显式降为"报告字段，不参与聚合"；新增 `unauthorized` 判决值给"仅 default-deny 命中"的情形。新增 `test_violated_invariant_implies_attack_truth`。
落点：`schemas/oracle-output.schema.json`、`schemas/policy.schema.json`、设计 §8.2、§13.1。
验证：黄金 fixture 的 `INV-PRIVILEGE-VERSION-001`（severity=high）现在正确产生 attack 路径；HC-018 的攻击族可达。

**B3 静态 required_refs 闭包过度近似，三类字段三方不一致**
处理：`required_refs` 改为求值期**动态 `consulted_facts`**（短路分支不计入），记入 `decision_trace` 的 `evidence.sufficiency` 步骤；`required_for_decision` 从 evidence schema 删除；spec 侧 `required_evidence`/`potentially_missing_evidence` 删除。"决策需要什么"现在只有 oracle 一个所有者。
落点：`schemas/evidence.schema.json`、`schemas/world-spec.schema.json`、`schemas/oracle-output.schema.json`、设计 §8.2。
验证：黄金 fixture 的 `consulted_facts`（8 个 ID 视图路径）全部能在 `asserts_ref` 中找到对应证据（`True`），且不含唯一证据为 untrusted 的 `actor.ACT-001.tenant`。

**B4 两个声称由 schema 强制的守卫实际不存在（validate_schemas.py 假通过）**
处理：(a) `episode.schema.json` 增加 `allOf` + `if/then`，`variant_type ∈ {critical_intervention, irrelevant_perturbation}` 必填 `intervention`；(b) `release.schema.json` 的 `split_statistics.group_overlap_audit` 与 `split_assignments[].group_overlap_audit` 均加 `maxItems: 0`；(c) `validate_schemas.py` 重写——现在对每个负 fixture **断言拒绝路径等于声明路径**，并且**反向验证**（修复声明路径后必须变为合法），杜绝"因无关错误被拒"的假通过；(d) 所有负 fixture 删除根级 `$comment`，同时在 6 个 schema 根显式声明 `$comment` 属性。
落点：上述 3 个 schema + `scripts/validate_schemas.py` + 7 个负 fixture。
验证：`negative_fixtures_rejected_at_declared_path=7`，输出逐条打印 `rejected ... at '<path>' and only there`。

**B5 world_family_id / counterfactual_family_id 语义未定义且作者可写**
处理：二者改为**编译器派生**（`"WF-"+stable_hash(结构骨架)[:12]`、`"CF-"+stable_hash((world_family_id, world_id, seed, sorted(critical axes)))[:12]`），schema 用 `^WF-[0-9a-f]{12,64}$` / `^CF-[0-9a-f]{12,64}$` 钉死形式；`world_family_id` 从 spec 的 required 中删除；新增 `test_family_ids_are_derived_not_authored`、`test_constant_family_id_rejected`；Gate 2 增加 `family_ids_are_derived_not_authored` 检查。
落点：`schemas/world.schema.json`、`schemas/episode.schema.json`、`schemas/world-spec.schema.json`、`configs/default.json`、设计 §10.1。
验证：`spec_instance_pair` fixture 断言 `world_family_id` 为 15 字符 `WF-`+12hex 派生形式。

**B6 oracle 的真正输入 Action 没有 schema、不在 episode 工件里**
处理：新增 `schemas/action.schema.json`（8 个 schema 之一）；`action` 成为 episode **必填**字段；`assemble_episode` 签名加入 `action: Action`；`evidence_view_id` 改定义为 `sha256(world_id, action_id, visible)`；release 的 `file_sha256` 覆盖含 action 的 episodes。
落点：`schemas/action.schema.json`、`schemas/episode.schema.json`、`schemas/oracle-output.schema.json`、设计 §5.3、§15.3。
验证：黄金 episode 的 `action` 完整绑定 actor/session/resource/flow，oracle 输入可从工件重放。

**B7 AI 假设字段可经 generator_provenance 进入冻结 release**
处理：`provenance.generator_provenance` 改为**闭键白名单**（`model`/`model_version`/`prompt_version`/`prompt_hash`/`raw_generation_id`/`decoding_parameters`）；spec 的两个假设字段合并为 `hypotheses` 块并由 `compile_spec` 整体丢弃（记录在 `compile.dropped_hypothesis_fields`）；`attack_family` 从 instance 移到 spec 侧（作为假设）；Gate 1 增加"episode 任意位置不得出现假设字段"断言。
落点：`schemas/episode.schema.json`、`schemas/world-spec.schema.json`、`schemas/world.schema.json`、设计 §11.2。
验证：黄金 fixture 的 `generator_provenance` 只含 4 个白名单键；`spec_instance_pair` 断言 instance 无 `hypotheses`/`attack_family`。

**B8 masking 变体数量与 §9.4 强制清单矛盾，level→隐藏集合映射未定义**
处理：`configs/default.json` 的 `variants_per_world.evidence_masked` 由 3 提到 **6**，并新增 `per_world_level_quota`（complete/minimally_sufficient/insufficient/contradictory/stale/attacker_controlled 各 1）+ `decoy_masking_per_world: 1`；`level_to_hidden_set` **写死 7 个 level 的判定函数**（§9.4 表）。
落点：`configs/default.json`、设计 §9.1、§9.4。
验证：`per_world_level_quota` 求和 = 6，与 `variants_per_world.evidence_masked` 一致。

**B9 干预轴三套词汇表 + display_name.case 与"世界状态零变化"矛盾**
处理：统一为 §4.3 的唯一路径 BNF；schema 层给 `critical_state_variables` 加 ID 视图状态路径模式、给 `irrelevant_state_variables` 加 `^observation\.(request|rendering)\.` 模式（二者互斥由模式保证）；`display_name.case` 改为 render-time-only 轴 `observation.rendering.display_name_case`；Gate 2 增加 `critical_axes_match_whitelist` 与 `no_critical_axis_is_observation_path`。
落点：`schemas/world-spec.schema.json`、`configs/default.json`、设计 §9.5。
验证：`world-spec.invalid.json` 现在**真正**因 critical 轴指向 `observation.request.headers.User-Agent` 被拒（拒绝路径 `critical_state_variables/0`，修复后合法）。

**B10 Gate 3 非空洞性探针生成器未定义；default-deny 可独自产出 attack**
处理：§8.4 写死探针算法（`declared_domain` 从 schema 类型信息推导：enum→枚举值、id 模式→同类型实体 id、bool→{true,false}、integer→{0,1,2,max_seen}；有界笛卡尔采样；全 allow 或全 deny 即拒）；`policy_rule.is_default_rule` 新字段；聚合规则要求 attack 必须来自非 default 规则否定或不变量违反。
落点：`schemas/policy.schema.json`、`schemas/oracle-output.schema.json`、`configs/default.json`、设计 §8.2、§8.4。
验证：黄金 fixture 的 `POL-DEFAULT-DENY` 带 `is_default_rule: true`；trace step 3 记录 `is_default_rule: true`。

**B11 release/episode 工件只能表达 8 种 split 策略中的一种**
处理：`release.schema.json` 新增 `split_assignments` 数组（`minItems: 1`，每策略一组 `{strategy, group_key, counts, group_overlap_audit}`）；episode 也带 `split_assignments`；release 的 `file_sha256` 增加 `splits.jsonl`。
落点：上述 2 个 schema + 黄金 fixtures。
验证：黄金 release 的 `split_assignments` 含 8 行，每行 `group_overlap_audit: []`。

**B12 renderer 投影范围无约束，world.metadata.attack_family 可能进入观测**
处理：`world.schema.json` 的 `metadata`（`additionalProperties: true`，可塞 `verdict` 键）**整体删除**；`attack_family` 移到 spec 侧作为假设；`configs/default.json` 新增 `rendering.projection_allowlist`（world 侧允许 12 类实体/状态字段、禁止 9 类字段、禁止 38 个 attack_family 枚举值模式与 `POL-`/`INV-`/`OPP-`/`AXIS-` id 前缀）；`render()` 签名加入 `allowlist` 参数，越界投影即抛；新增 `test_renderer_projection_allowlist`。
落点：`schemas/world.schema.json`、`schemas/world-spec.schema.json`、`configs/default.json`、设计 §3 D7、§13.4。
验证：黄金 world 已无 `metadata` 键；`world.invalid.json` 证明带 `ground_truth` 的世界被拒。

**B13 三个负 fixture 因意外错误被拒（验收给出假信心）**
处理：见 B4 (c)(d)。7 个负 fixture 全部重写，每个只按其声明理由被拒，且修复该理由后必须合法。
落点：`scripts/validate_schemas.py` + 7 个负 fixture。
验证：`negative_fixtures_rejected_at_declared_path=7`，且每条都通过反向修复验证。

**B14 黄金 episode 的 oracle 输出无法由文档算法推出（required_refs 与 asserts_ref 命名空间不连通）**
处理：§4.3 定义唯一 BNF；`compile_spec` 把 action 绑定视图**展开成实例路径**；黄金 episode 的 `consulted_facts` 全部改写为 ID 视图路径并与 `asserts_ref` 逐字对应；`required_evidence[].decision_fact` 与 `asserts_ref` 同时携带。
落点：`schemas/episode.schema.json`、`schemas/oracle-output.schema.json`、设计 §4.3、§8.2。
验证：`consulted_facts all have an asserting evidence item: True | missing: []`。

**B15 episode/event schema 无法表达 action 绑定的 session/token/workflow_instance**
处理：`action.schema.json` 提供三个可空绑定；`episode_templates[].events[]` 新增 `binds{session_id, token_id, workflow_instance_id, resource_id, operation, flow_id}`；编译期绑定缺失时不变量记 `skipped_out_of_scope`（`unbound_subject`）而非猜。
落点：`schemas/action.schema.json`、`schemas/world-spec.schema.json`、设计 §5.3、§7.4。
验证：黄金 spec 的决策事件显式 `binds: {session_id: "SES-003", resource_id: "RES-001", operation: "read", flow_id: "FLOW-READ"}`。

**B16 `applies_to:["*"]` 引用可选绑定，"全域可解"静态检查不可判定**
处理：删除不可判定的"静态全域检查"表述；`["*"]` 语义改为"对该 action 实际绑定的实体求值，未绑定即 `skipped_out_of_scope` 并留 trace"；编译期只验证 `applies_to` 的 operation 存在于 `endpoints`。
落点：`schemas/policy.schema.json`、设计 §7.4。
验证：黄金 world 的 `INV-TOKEN-LINEAGE-001`/`INV-ONE-TIME-TOKEN-001`/`INV-WORKFLOW-TRANSITION-001` 在 read 动作上记 `skipped_out_of_scope`（trace step 8-10）。

**B17 黄金 episode 把越界不变量记进 satisfied_invariants**
处理：黄金 fixture 修正——三个 refund-only 不变量从 `satisfied_invariants` 移入 `skipped_invariants`（reason `out_of_scope`）；`skipped_invariants` 成为 oracle 输出的一等字段；`test_invariant_scope_never_silently_skipped` 断言三分划完备且不交。
落点：`schemas/oracle-output.schema.json`、黄金 episode fixture、设计 §8.3。
验证：`invariant partition complete: True / disjoint: True`。

**B18 WorldInstance 保留 metadata.attack_family 与自由文本，与 D1 冲突**
处理：见 B12（metadata 整体删除，attack_family 移到 spec 侧，notes 只在 spec 侧）。
落点：`schemas/world.schema.json`。
验证：`world.example.json` 已无 `metadata`；`spec_instance_pair` 断言 instance 不含 `attack_family`。

**B19 policy schema 的 ref 视图 (4) `evidence_view.<id>.*` 让策略可直读证据值**
处理：从 DSL 的三类视图中**删除** `evidence_view.*`；`ref` 的 `path` 加正则模式，只允许 ID 视图 / action 绑定视图 / `current_flow.*` / `current_time`；唯一证据入口是 `establishing_evidence_exists(fact_key)`，且其参数也受同一模式约束；`test_evidence_bridge_is_one_way` 断言单向性。
落点：`schemas/policy.schema.json`、设计 §4.3、§7.2。
验证：黄金 policy bundle 无 `evidence_view.` 前缀路径；`policy.invalid.json` 证明未知 op 被拒（拒绝路径 `policies/0/condition`）。

**B20 参考 world-spec 与 world 不成编译关系**
处理：spec 增补 `state_history`/`current_state`/`evidence`（以及 credentials/services/caches/trust_boundaries/ACT-004/RES-002/TOK-002/POL-ORDER-READ-SUPPORT/4 条不变量），使其**完整决定** instance；§4.1 写死 `compile_spec` 的 5 步契约；`conftest.spec_instance_pair` fixture 断言共享字段逐字相同 + 派生字段正确 + 假设字段已丢弃。
落点：`schemas/world-spec.schema.json`、`schemas/examples/world-spec.example.json`、`schemas/examples/world.example.json`、`conftest.py`、设计 §4.1。
验证：fixture 实跑通过（见 §18 "spec → instance 编译关系"一行）。

### 19.2 参考意见

**S1 Gate 6 不可能失败 → 增设 G11 硬门**
处理：`configs.default.json` 的 `quality_gates` 增加 `G11_surface_label_independence` 入 `hard_fail`，并显式声明 `G6_semantics.kind = "mechanical_diff"`、`can_fail_independently: false`；G11 定义特征集（UA/X-Request-Id/header 顺序/trace id/时间格式）、指标（互信息）、阈值（≤0.01 bit）、最小样本数（200）。设计 §14-15 与 §13.4 同步。
落点：`configs/default.json`、设计 §13.4、§14。
验证：`hard_fail` 列表实跑输出含 `G11_surface_label_independence`。

**S2/S11 evidence_view_id 的"同 id 同决策"断言不可满足**
处理：`evidence_view_id = sha256(world_id, action_id, canonical visible evidence)`；schema 注释与 Gate 4 断言改为"同 `(world, action, evidence_view_id)` 三元组 ⇒ 同 output"。
落点：`schemas/oracle-output.schema.json`、设计 §8.3。

**S3 时间线非单调 + 6/7 schema 计数错误 + transition_allowed 元数注释错误**
处理：两个黄金 fixture 的时间线改为严格单调（EVT-000 08:00 → EVT-001 08:30 → EVT-002 09:00 → EVT-003 次日 08:00；SNAP-000 07:00 → SNAP-001 08:30 → SNAP-002 09:00 → current 次日 08:00）；schema 计数统一为 **8**；`transition_allowed` 注释改为与 `two_args` 一致（`from_state` 取绑定实例当前态）；Gate 2 增加 `state_history_monotonic` / `timeline_monotonic_with_t_index` / `current_state_at_ge_max_history_at` 检查。
落点：黄金 fixtures、`schemas/policy.schema.json`、`configs/default.json`、设计 §4.4、§13.4。
验证：`timeline monotonic: True`。

**S4 三套路径语法互不通约（cache/evidence 示例与规范相悖）**
处理：§4.3 定义唯一 BNF；`cache_entry.cached_subject` 加正则模式并用规范值 `actor.ACT-001.privilege_version`（原为裸 `ACT-001.privilege_version`，无法解析）；`evidence.asserts_ref` 加同一模式并修正注释示例；`diff_worlds().changed_paths` 与 `intervention_variable` 明确使用同一路径空间。
落点：`schemas/world.schema.json`、`schemas/evidence.schema.json`、黄金 fixtures、设计 §4.3。

**S5 时间顺序只有注释级约定**
处理：同 S3（Gate 2 三条硬检查 + 修正 fixtures）。JSON Schema 无法表达顺序，已在设计 §4.4 如实说明"由 Gate 2 强制"而非假装 schema 已强制。

**S6 actor.roles 存 role_id 还是 name 无约定，两个 fixture 冲突**
处理：`actor.roles` 的 items 加 `^ROLE-` 模式；两个 fixture 统一为 role_id（`["ROLE-SUPPORT"]`，原先 `policy.example.json` 用 name `"support_agent"`）；Gate 2 增加 `actor_roles_subset_of_declared_role_ids`（悬空即 `dangling_ref`）；DSL 若需角色名须用显式 `ref`（`role.<id>.name`）而非裸字面量。
落点：`schemas/world.schema.json`、黄金 fixtures、`configs/default.json`、设计 §4.2。

**S7 证据可见性有三份互相独立的表示，无权威来源**
处理：声明 `world.evidence[].visible_in_observation` 为**权威**；`EvidenceView` 与 `observation.model_visible.evidence` 是投影；`hidden_evidence_ids` 只存 **id 不存值**（防止泄漏隐藏值）；Gate 2 增加 `evidence_visibility_projection_consistent`；`conftest.model_visible_boundary` 断言投影精确与 hidden id 一致。
落点：`schemas/evidence.schema.json`、`schemas/episode.schema.json`、`conftest.py`、设计 §6。

**S8/S21 release.example.json 的 world_ood 配错 group_key**
处理：黄金 release 改为 `strategy: "world_ood"` + `group_key: "world_family_id"`；`configs.default.json` 新增 `strategy_to_group_key` 映射表；`assign_splits` 断言映射一致。
落点：`schemas/examples/release.example.json`、`configs/default.json`、设计 §10.3。
验证：黄金 release 实跑通过 `release.schema.json`。

**S9 intervention 字段名不一致（variable vs intervention_variable）**
处理：统一为 `intervention_variable`（schema、设计 §5、§15.3 的 `Intervention` dataclass、`diff_worlds().changed_paths` 比较全部一致）。
落点：`schemas/episode.schema.json`、设计 §5.1、§9.2、§15.3。

**S10 WF- 前缀被 world_family_id 与 workflow_id 同时占用**
处理：`workflow_id` 前缀改为 `WFL-`；`world_family_id` 保持 `WF-`（且模式收紧为 `WF-`+12hex）；schema 注释说明 ID 命名空间全局唯一。
落点：`schemas/world.schema.json`、黄金 fixtures（`WFL-ORDER`）。

**S12 脚手架三处小问题（pyproject 漏打包、default.json 重复键、pytest 空 testpaths）**
处理：`pyproject.toml` 的 `packages` 显式列出 `security_world` 全部 9 个子包 + 顶层 `generation`（原为 `["security_world"]`，wheel 会静默缺包）；`configs/default.json` 删除 `generation` 对象内重复的 `$comment` 键；§18 如实记录 pytest 空 testpaths 的退出码是 **1**（`filterwarnings=["error"]` 升级 `PytestConfigWarning`），不是原先写的 5。
落点：`pyproject.toml`、`configs/default.json`、设计 §18。
验证：实跑 `py -3 -m pytest -q -p no:cacheprovider; echo $?` → `PYTEST_EXIT=1`；加 `-W ignore::pytest.PytestConfigWarning` → `PYTEST_EXIT=5`。

**S13 5 个负 fixture 都因多余的 $comment 被拒**
处理：同 B4 (c)(d)。

**S14 WorldInstance 的 metadata 是自由对象**
处理：同 B12/B18（metadata 整体删除）。

**S15 config 的 irrelevant_axes 含 display_name.case**
处理：同 B9。

**S16 "header 顺序"扰动在 canonical_json 下不可分辨且会被 exact dedup 删掉**
处理：header 顺序承载到 `rendered_text`（字符串，顺序可保留）；`configs.default.json` 的 `irrelevant_axes` 增加 `observation.rendering.header_order`；dedup 改为 **family 内作用域**（`leakage_control.family_scoped_dedup.scope = "counterfactual_family_id"`），跨家族才全局去重。
落点：`configs/default.json`、设计 §9.2、§10.4。

**S17 trusted_evidence_exists 的信任集与 config/§6 不一致**
处理：op 改名 `establishing_evidence_exists`，建立集合统一为 `TRUSTED_ESTABLISHES = {trusted, semi_trusted}`，与 `configs.default.json` 的 `evidence_masking.trusted_establishes` 同源；schema 注释不再硬编码第二套语义。
落点：`schemas/policy.schema.json`、`configs/default.json`、设计 §7.2。

**S18 world_truth 聚合依赖 severity + 缺 attack_family 可达性门禁**
处理：同 B2 + §10.5 的 `attack_family_reachability`（`reachable_samples == 0` 是硬发布失败）。
落点：`schemas/release.schema.json`、设计 §10.5。

**S19 必需 wall-clock 字段与 R7 的"数据路径无挂钟"测试冲突**
处理：§8.1 明确 `provenance.generation_timestamp` / `provenance.created_at` 是 **VirtualClock 派生值**，排除在"数据路径无挂钟"定义之外；三个 schema 的对应字段注释同步说明。
落点：设计 §8.1、`schemas/world.schema.json`、`schemas/world-spec.schema.json`、`schemas/episode.schema.json`。

**S20 config 的 group_keys 少了 app_domain 与 generator_id**
处理：`leakage_control.group_keys` 补足 8 个；episode 与 world 文档均可提供这两个值（`app_domain` 在 world 顶层，`generator_id` 由 `provenance.generator_model` 派生）。
落点：`configs/default.json`、设计 §10.1。

**S22 spec 与 instance 的 required 集合不对称**
处理：§15.3 的 `compile_spec` 契约写明默认注入（`sessions`/`tokens`/`credentials`/`services`/`caches`/`trust_boundaries` 缺省 `[]`）；`world.schema.json` 的 `world_family_id` 设为 required；spec 不再要求 `world_family_id`。
落点：设计 §4.1、§15.3、两个 schema。

**S23 §13.1 的「22 个 op」与实际 27 个不符；M0 写「6 schema」**
处理：测试计划改为 **27 个 op 全量正/反例**；全文 schema 计数统一为 **8**（§0 表头、§12.1 M0、§13.1、§18）。
落点：设计 §13.1、§12.1、§0。

**S24 §18 声称 pytest 空 testpaths 报 exit 5，实际 exit 1**
处理：§18 改为如实记录 **exit 1**（并给出得到 exit 5 的确切命令）。
落点：设计 §18。

---

## 20. REVISION 2：第 2 轮任务书（8 项设计债 + 工程卫生，2026-09-21）

第 2 轮任务书提出 8 项设计债（A1–A8）与 1 项工程卫生（B）。逐项记录：**原实现
是什么 → 补了什么 → 如何验证**。所有修改遵守文件所有权（``configs/default.json``、
``schemas/``、``security_world/**``、``tests/**``、``conftest.py``、``.gitignore``、
本文件、项目根两个草稿文件）；``generation/step5/``、``scripts/``、``worlds/``、
``reports/``、``state/`` 未触碰。

### A1 表层/标签泄漏防护：G11 之外新增 G12 词法硬门

**原有实现**：G11（``security_world/validation/surface.py``，Miller–Madow 偏差
校正 + 标识符/旋钮之分 + 家族条件化互信息）度量**统计**泄漏；
``tests/unit/test_perturbation_axes.py`` 与 ``tests/metamorphic/
test_expansion_metamorphic.py`` 已覆盖"扰动必须真的改字节 + verdict 不变"。

**补了什么**：

* 新模块 ``security_world/validation/lexical.py`` + 新硬门
  **G12_lexical_label_leakage**（``gates.py`` 的 ``GATES`` / ``HARD_GATES`` /
  ``EPISODE_SCOPED_GATES`` + ``configs.default.json`` 的 ``quality_gates.
  hard_fail``）。规则：扫描 ``observation.model_visible`` 的**键与字符串值**
  （含 ``request.rendered_text``），出现判决线索词即失败；``decision_metadata``
  侧豁免（那些词本就属于 oracle/gate 侧）。无最小样本量——词法泄漏不是采样噪声。
  匹配必须**独立成词**：紧邻 ``.``/``@``/``_``/字母数字（机器 token 粘合字符）
  不算命中，否则合成语料全员使用的 ``*.example.invalid`` 保留域名会让全数据集
  假失败；``-`` 与 ``/`` 是词分隔符（``X-Attack-Flag``、``/api/idor`` 命中）。
* **确定性扰动验证补强**：``tests/gates/test_g5_g6`` 新增组装级核验（每个
  irrelevant_perturbation 变体：model_visible/请求面/rendered_text 都必须变、
  oracle 输出逐字节相同、世界零变化）；``tests/metamorphic`` 新增同种子重放
  逐字节相同 + 不同种子必须不同。
* **如实记录的残留**：实证扫描（23 世界 × 8 renderer × 2800 episode）发现
  ``attacker`` 一词合法地出现在模型可见侧——``application.name`` 被 slug 化成
  Host 头、事件 ``summary`` 的自由文本（HC-019 的 "Order API With
  Attacker-Controlled Ownership Header"）。它是**角色描述**（"谁"）而非判决词
  （"判决是什么"），且任务书要求的 13 个词一个不少，因此默认词表不含
  ``attacker``/``attacks``，理由逐字写在 ``lexical.py`` 与 config 的
  ``$comment`` 里，测试 ``test_the_default_list_excludes_actor_role_descriptors``
  钉死这个取舍。语料属主应把标题/摘要的风味文本移出模型可见侧，届时可从 config
  加回这两个词（不需要改代码）。

**验证**：``tests/gates/test_g12_lexical_label_leakage.py``（27 例：真泄漏必须
失败 ×3、干净语料必须通过 ×2、粘合规则 ×10、配置增补、词表覆盖）；全语料 G12
零命中（``test_the_full_pipeline_is_lexically_clean``）。

### A2 时间单调：t_index 严格 + at 允许显式并列

**原有实现**：Gate 2 的 ``state_history_monotonic`` / ``timeline_monotonic_with_
t_index`` / ``current_state_at_ge_max_history_at``（``gates.py`` 的
``_g2_reference_integrity`` / ``_g2_world_checks``），但 ``t_index`` 用
``sorted()`` 比较（重复索引可过），且缺 ``current_state < max(history)`` 的测试。

**补了什么**：``t_index`` 改为**严格**递增（重复或回退的索引意味着两条事件被钉在
同一序位）；``at`` 单调不减，**同一 logical timestamp（逐字相同的 at）是显式允许
的并列**，任何回退即失败；``state_history`` 同样只禁回退（并列允许）、
``current_state.at >= max(history.at)`` 取等合法。顺带修了一个既有缺陷：world
缺失时 G2 的早退把**已运行检查的失败**吞成 ``checked=False``（显示成"未运行"
而非失败）——现在有失败就报失败，``checked=False`` 只留给"真的没跑"。

**验证**：``tests/gates/test_g2_reference_integrity.py`` 新增 6 例（重复 t_index、
递减 t_index、t_index 有序而 at 回退、显式并列放行、current_state 早于历史被拒、
current_state 取等放行）。

### A3 Fact Path BNF：全仓一套语法 + round-trip 性质

**原有实现**：``security_world/model/refs.py`` 是唯一 BNF（IdView /
parse_id_view / classify_path / expand_action_view / ReferenceRegistry），
``tests/unit/test_model_refs.py`` 有解析与展开测试。

**补了什么**：实证发现**两处第二表示法**并修正——

* ``schemas/world-spec.schema.json`` 的 ``critical_state_variables`` 模式少了
  ``workflow`` 与 ``role`` 两类实体（合法轴在 schema 层被静默拒绝）——改为与
  canonical BNF 逐字相同；
* ``schemas/episode.schema.json`` 的 ``evidence_observation.asserts_ref`` 与
  ``schemas/oracle-output.schema.json`` 的 ``required_evidence`` /
  ``missing_evidence`` 的 ``asserts_ref`` / ``decision_fact`` 原本无模式约束——
  补上同一 BNF。

新增 round-trip 性质测试（``parse(format(x)) == x``，含全部 ``ref_universe``
路径）与"每个 schema 路径字段与 ``refs.ID_VIEW_PATTERN`` 逐字相同"的单一 BNF
测试（7 个字段逐一断言）。

**验证**：``tests/unit/test_model_refs.py``（+17 例）；
``py -3 scripts/validate_schemas.py`` exit 0（5 正夹具 / 7 负夹具逐个断言拒绝路径）。

### A4 role_id：policy 只认 canonical role_id

**原有实现**：Gate 2 的 ``actor_roles_subset_of_declared_role_ids``（S6 修订）；
``actor.roles`` 的 schema 模式 ``^ROLE-``。

**补了什么**：新测试文件 ``tests/unit/test_role_id_canonical.py`` 钉死三条规则：
policy 条件与 role_id 字面量比较才命中、与 role **name** 字面量比较恒为假
（不抛错、不蒙混）、role name 只能经显式 ref ``role.<id>.name`` 读取；角色
**name** 或未声明 id 出现在 ``actor.roles`` 里时 Gate 2 拒收。

**验证**：4 例全绿。

### A5 Evidence Visibility：唯一权威链补齐最后一环

**原有实现**：设计 §6 / S7 声明 ``world.evidence[].visible_in_observation`` 为
权威；Gate 2 的 ``evidence_visibility_projection_consistent`` 断言
``hidden_evidence_ids`` 与 ``model_visible.evidence`` 同 ``evidence_classification``
一致（episode 内部三处）。

**补了什么**：权威链**缺了"权威本身与世界目录一致"这一环**——世界说
visible=true 而 episode 把它藏起来（或反之）原先查不出来。新增
``_g2_evidence_catalog_problems``，分两个方向、两种强度：

* 普适（所有 variant_type）：分类不得**复活**世界声明不可见的证据，id 集合必须
  逐一对应（不得发明、不得遗漏）；
* 仅非掩蔽变体：分类必须**逐条等于**世界目录——``evidence_masked`` 变体按设计
  （§9.4）在视图层继续隐藏世界可见证据，对它要求相等会连坐合法掩蔽。

权威归属在设计 §6 与 ``gates.py`` 注释里钉死：``world.evidence[]`` 描述"世界中
存在什么"，Episode Observation/EvidenceView 是模型可见性的唯一权威，其他可见性
字段必须由其派生。

**验证**：``tests/gates/test_g2_reference_integrity.py`` 新增 5 例（base 逐条
投影放行、世界可见被藏拒、复活世界隐藏项拒、发明证据 id 拒、掩蔽变体隐藏合法）。

### A6 Category Reachability：witness 级族可达性 + 诚实 coverage

**原有实现**：``security_world/validation/probe.py`` 的
``attack_family_reachability``（§10.5：声明攻击族的 declared_worlds /
reachable_samples，0 样本硬失败）。

**补了什么**：新增 ``family_reachability`` / ``FamilyCoverage`` /
``FamilyReachabilityResult``（probe.py），把可达性细化到 **(world, family)**
粒度并补上不变量族：

* invariant 族（世界声明的不变量类别）：witness = episode 里该不变量**真的被求值
  过**（进 satisfied/violated，而不是 skipped_out_of_scope）；
* failure 族（spec 声明的攻击族）：witness = attack 样本且被违反类别能映射到该族
  （spec 声明优先）。

**没有 witness 的族标记 unsupported 并在 coverage/report 里如实列出，绝不计入
"已支持"**——这是它与硬门的区别：unsupported 不拒收数据（语料可以合法地携带
故意越界的不变量来训练 skipped 路径），但必须出现在 manifest 的
``family_coverage``（schema 新增该字段与 ``family_reachability_row`` 定义）里。
实证：全语料只有一个 unsupported 族——HC-017 故意携带的越界 ownership 不变量
（语料注释明言 "must land in skipped, never satisfied"），测试逐字钉住它。

**验证**：``tests/gates/test_g3_family_reachability.py``（6 例）；
``tests/integration/test_release_freeze.py`` 新增 manifest coverage 断言。

### A7 OOD Group Metadata：12 个 group key + 组装期盖章 + Gate 2 存在性

**原有实现**：``configs.default.json`` 的 ``leakage_control.group_keys`` 8 个键；
派生在 L5 ``validation/grouping.py``；episode 文档不携带 key 值。

**补了什么**：

* **group key 派生下沉 L1**（新模块 ``security_world/model/grouping.py``）：
  派生是纯文档函数，而 L4 的 ``assemble_episode`` 必须在组装期盖章（Gate 2 查存
  在性），L4 不能 import L5（分层 DAG）。``validation/grouping.py`` 改为兼容转
  发层（公共 API 与 ValidationError 类型不变，L1 的 ``GroupingError`` 原样转报）。
  **只有一个实现**——两套派生规则会让盖章值与 split 实际值悄悄漂移。
* **补齐命名**：``group_keys`` 增至 **12** 个（原有 8 个 + ``generator_model_family``
  / ``policy_family_id`` / ``workflow_family_id`` / ``invariant_family_id``）。
  四个新族 id 与对应 hash **严格同源**（``policy_family_id`` 就是
  ``"PF-" + policy_graph_hash[:12]``，测试钉死 1:1）；``generator_model_family``
  取模型家族段（``deepseek-v4-flash@2026-08-01`` → ``deepseek``）。
  ``strategy_to_group_key`` 的 8 种策略**不变**（episode.split_assignments 的八
  行契约不动），四个新键的映射用途说明写在 config 的 ``group_key_purposes``。
* **episode 携带 key 值**：``schemas/episode.schema.json`` 新增可选
  ``group_keys``（12 键闭集 + 模式约束），``assemble_episode`` 组装期盖章；
  ``schemas/examples/episode.example.json`` 同步真实派生值。Gate 2 断言
  (a) 12 键全部存在且非空 (b) 世界可得时每个声明无关 key 等于重新派生的值
  （两个 family id 与 attack_family 除外：前者会被管线按 probe 收窄、后者依赖
  spec 声明，Gate 2 看不到声明）。

**验证**：``tests/unit/test_model_grouping.py``（13 例：配置一致、同源 1:1、
家族段规则、跨 PYTHONHASHSEED 稳定、缺世界宁可失败）；
``tests/gates/test_g2_reference_integrity.py`` 新增 5 例（盖章放行、整体缺失拒、
缺一键拒、篡改值拒、无 world 时存在性仍查）。

### A8 VirtualClock：重放逐字节相同 + 守卫扩到全引擎

**原有实现**：``security_world/model/clock.py``（Clock 协议 + FixedClock /
MutableClock，无 sleep、可显式回拨）；``tests/unit/test_model_no_wallclock.py``
的 AST 守卫只覆盖 ``security_world/model/**``。

**补了什么**：守卫范围扩展到**整个引擎**（policy/invariants/workflows/oracle/
expansion/validation/release——world/episode 的每条程序化生成路径都在这些包里）；
实证全引擎零命中（唯一 ``time.monotonic`` 在 ``generation/step5/live.py`` 的
provider 计时，不是数据路径）。新增重放测试：同一 VirtualClock 值 ⇒ 时间字段
（action.at / timeline[*].at / current_time / provenance.created_at / 证据 timestamp）
逐字节相同；换时钟值必须变；``MutableClock`` 的显式操作序列可重放；真实
generation timestamp 只进 provenance（S19 的可证伪断言）。

**验证**：``tests/unit/test_model_rng_clock.py``（+4 例）、
``tests/unit/test_model_no_wallclock.py``（+2 例）。

### B 工程卫生

* ``_patch_corpus.py`` / ``_swap_axes.py``：核实为针对 ``worlds/corpus.py`` 的
  一次性补丁草稿（其 ``old`` 字符串与当前语料已不匹配——HC-010 块后来被重写），
  移至新建 ``scratch/`` 并加入项目 ``.gitignore``（``/scratch/``），不再留在
  package 路径。
* ``.pytest_cache/``：项目 ``.gitignore`` 第 19 行**已有**该条目，
  ``git check-ignore -v`` 实证命中（父仓 .gitignore 没有它，项目内优先的策略
  本就满足）。
* 验证：``node scripts/guards/check-repository-hygiene.mjs`` exit 0；
  ``node scripts/guards/check-project-structure.mjs`` exit 0；
  ``npm run check:release-guards``（10 个 guard）exit 0；
  ``cd aether-security-world && py -3 -m pytest -q`` 全绿。

### REVISION 2 的边界与未做项

* ``README.md`` 仍在文件所有权之外（任务书未授权），其中 "Gate 1–11" 的计数
  与 L5/L6 表格未同步——应由架构师在下一次允许改动时更新为 G1–G12。
* ``attacker``/``attacks`` 词表残留（见 A1）：语料属主决策，代码侧已留好 config
  入口。
* 四个新 group key 没有对应 split 策略（八策略契约不动）；``generator_model_family``
  是审计/聚合维度，出现第二个生成器家族后可升级为策略。
* 语义相似度去重（``semantic_similarity.enabled: false``）仍是 Phase 1 明确不做
  项，本轮未触碰。

