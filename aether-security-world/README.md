# Aether Security World (ASW)

**可执行的状态化安全数据工厂。** 仅 Phase 1 范围：数据生成、清洗与校验。
不做模型训练、不做 RL、不写论文、不做产品。

> 本项目要回答的需求原文逐字保存在 [`docs/brief.md`](docs/brief.md)
> （字节级副本，sha256 `ed4b1c2056a3f5089edb689c17bdce694d5cbc40c0b730e4e005bf00e652e2b4`）。
> 回答它的设计在 [`docs/design-v0.1.md`](docs/design-v0.1.md)，当前 **v0.1-r1**，
> 已按一轮独立复审的 20 条阻塞发现 + 19 条参考意见修订（台账见设计 §19）。
> 两者冲突时 **`brief.md` 是需求，赢**。

## 一句话论点

真值是**算出来的**，不是生成出来的：LLM 可以发明世界，但每个样本的标签都是
确定性 oracle 在一个结构化世界上执行封闭 policy/invariant DSL 的输出。

## 现状（Phase 1）

| 路径 | 状态 |
| --- | --- |
| `docs/brief.md` | 需求逐字副本（完成） |
| `docs/design-v0.1.md` | 完整设计 + 模块地图 + 签名级接口契约 + 修订台账（完成） |
| `schemas/*.schema.json` | **8** 个 draft 2020-12 schema，元校验通过，并用 5 个正夹具 / 7 个负夹具（**逐个断言拒绝路径**）验证（完成） |
| `scripts/validate_schemas.py` | schema 验收检查，exit 0 == 通过（完成，通过） |
| `configs/default.json` | Phase 1 引擎读取的每一个旋钮，含掩蔽 level→隐藏集合映射与 renderer 投影白名单（完成） |
| `conftest.py` | 共享 fixture：schema 注册表、`model_visible_boundary` 可执行边界、`spec_instance_pair` 编译关系断言（完成） |
| `security_world/model/**` | **L1 语义内核已实现**（Agent A）：世界/剧集/实体的类型化模型、`canonical_json` + `stable_hash`、可播种 RNG + 可注入虚拟时钟、引用注册表、`load_world` / `load_world_spec` / `compile_spec`。见下文「L1 已实现什么」 |
| `security_world/policy` `invariants` `workflows` `oracle` `expansion` | 已由对应实现子代理落盘（Agent B / C / D）。`security_world.evidence` **仍未落盘**——`oracle/evidence_view.py` 提供参考实现并让 `run_oracle` 只依赖结构协议（见该模块 docstring 的落地边界） |
| `security_world/validation/**` | **L5 质量门禁已实现**（Agent E）：Gate 1–12、group-key split（八策略）、三层去重 + 确定性语义审计、分布摘要。见下文「L5 已实现什么」 |
| `security_world/release/**` | **L6 发布层已实现**（Agent E）：`build_release` / `freeze` / `verify_release`，manifest 过 `release.schema.json`，冻结后拒绝覆盖 |
| `worlds/**` + `analysis/**` | **人工语料与总成管线**（Agent E）：23 个手写世界（HC-001..HC-023，`worlds/handcrafted/`，每个带人写预期 verdict）+ `analysis.pipeline.run_pipeline()` 把 load → expand → mask → render → oracle → gates → split 串成一条链 |
| `generation/**` | Step-5-pre 世界种子**能力**（Phase 1，仅 replay）：prompt v0.1 + 版本注册表、`ReplayClient`（零网络）、严格批量解析（整批/逐元素拒绝）、harness 侧 provenance、token 记账 + Generation Efficiency、batch size 稳定性探针。`Step5Client`（真实 provider）**NOT IMPLEMENTED**——见 [`generation/README.md`](generation/README.md) |

没有占位实现：一个还不存在的目录是诚实的，一个声称自己是引擎的空 `__init__.py` 不是。

## L1 已实现什么（`security_world/model/`）

设计 §15.3 的 L1 契约，外加本层必须自带的确定性与引用完整性机制：

| 模块 | 内容 |
| --- | --- |
| `canonical.py` | `canonical_json`（`sort_keys` + 紧凑分隔符 + `ensure_ascii=False`）、`stable_hash`、`derive_family_id`；拒绝 `NaN`/非字符串键/未知类型 |
| `rng.py` | `make_rng` / `derive_seed` / `derive_seeds` / `shuffled`；**只接受显式非负整数种子** |
| `clock.py` | `Clock` 协议 + `FixedClock` / `MutableClock`；`parse_instant` / `compare_instants` / `is_within`（供 DSL 时间 op 与 Gate 2 单调性共用） |
| `documents.py` | `Document` 基类 + 全部 `require_*` 严格校验助手（**无隐式 coerce**，`bool` 不当 `int`） |
| `entities.py` | `Actor` / `Resource` / `Session` / `Token` / `Credential` / `Role` / `Workflow` / `WorkflowInstance` / `Service` / `Sink` / `CacheEntry` / `TrustBoundary` / `Application` / `Endpoint` / `EvidenceItem` / `PolicyRule` / `Invariant` / `StateSnapshot` / `CompileRecord` / `WorldProvenance`，以及 schema 枚举的唯一权威表 |
| `refs.py` | §4.3 的唯一路径 BNF、`ReferenceRegistry`（解析 / `ref_universe`）、`expand_action_view`、DSL 文档遍历 |
| `world.py` | `WorldInstance` / `WorldSpec`、结构骨架与两个 family id 的派生 |
| `events.py` / `episode.py` | `Event` / `StateFragment` / `Episode`、`model_visible` 与 `serialize_for_model` 边界 |
| `schemas.py` | schema 注册表（跨文件 `$ref`）与 `validate_*_document` |
| `compile.py` | `compile_spec` 五步契约 + 引用完整性 / 非空洞 / 单调性 / 轴白名单检查 |
| `loader.py` | `load_world` / `load_world_spec` / `load_episode` / `load_action` |
| `config.py` | 读 `configs/default.json`，取关键轴白名单 |

设计取舍（都写在对应 docstring 里）：

* **dataclass 而不是 TypedDict/pydantic**：frozen dataclass 给结构 + `__post_init__`
  里建只读注册表，字段级显式校验避免"字符串被悄悄转成数字"（设计 §3 D6）；
  TypedDict 只是 dict 别名，做不到这两点。
* **`PolicyRule.condition` / `Invariant.expr` 存原始 DSL 文档**：`parse_expr` /
  `eval_expr` 是 L2 `security_world/policy` 的公共符号，L1 不重复实现，只保证
  文档形态合法、可遍历（`iter_document_ref_paths`）。
* **`Action` 与 `OracleOutput` 不是本包的数据类**（分属 L2 / L3）：本包只声明
  `ActionLike` / `OracleOutputLike` 结构协议，避免两个包导出同名符号。
* **`Episode.observation` 以文档形态存放**：两个子块分别由 L4 renderer 与 L3
  oracle 生成，L1 只负责拆分与序列化时的边界。

## 命令

```bash
# schema 验收（唯一今天就跑的架构师检查）
py -3 scripts/validate_schemas.py

# L1 单元测试（Agent A 负责的部分）
py -3 -m pytest tests/unit/test_model_canonical.py tests/unit/test_model_refs.py \
    tests/unit/test_model_compile.py tests/unit/test_model_loader.py \
    tests/unit/test_model_entities.py tests/unit/test_model_rng_clock.py \
    tests/unit/test_model_no_wallclock.py tests/unit/test_model_episode.py -q

# 全部已落盘的测试（慢档 test_pipeline_full_scale 约 1 分钟，-m "not slow" 跳过）
py -3 -m pytest -q
py -3 -m pytest -q -m "not slow"

# 人工语料：重新物化 / 只比对字节（退出码 0 == 磁盘与 worlds/corpus.py 一致）
py -3 -m worlds.materialize
py -3 -m worlds.materialize --check
```

`pyproject.toml` 的 `[tool.pytest.ini_options]` 含 `testpaths=["tests"]` 与
`pythonpath=["."]`：未 `pip install -e` 的 checkout 也能 `import security_world`。
`worlds` / `analysis` 同理从源码树导入（语料的 JSON 在 `worlds/handcrafted/`，
是磁盘上的权威副本）。

## L5 已实现什么（`security_world/validation/`）

设计 §15.3 的 L5 契约，外加两处**有理由的估计量修正**（都写在模块 docstring 里，
并把原始统计量一起报告，审阅者能自己复核）：

| 模块 | 内容 |
| --- | --- |
| `gates.py` | `GateResult` / `GateReport` / `GATES`（G1–G12）、`run_gates`（单 episode + 家族上下文）、`run_dataset_gates`（全集 + 数据集级 G8/G9/G10/G11/G12）。没跑的门记 `checked=False`，**不伪装成通过** |
| `probe.py` | §8.4 非空洞性探针：`declared_domain` 从 schema 导航推导取值域，并对血缘 op 额外变父链、对 action 绑定额外变替代实体（否则合法策略会被误判成空洞/死规则） |
| `split.py` | 八策略 leave-key-out：union-find（共享任意 key ⇒ 同一连通分量）+ hash 取模 + 大小感知修正（只在降低总偏差时搬） |
| `dedup.py` | exact（家族内）/ normalized / structural（跨家族）三层 + 字符 3-gram Jaccard 的确定性语义审计（无外部模型调用） |
| `surface.py` | G11：Miller–Madow 偏差校正 + 标识符/旋钮之分 + 家族条件化互信息 |
| `grouping.py` / `distribution.py` | 12 个 group key 的确定性派生（L1 `security_world/model/grouping.py`，L5 兼容转发） / 分布摘要与熵、域覆盖审计 |

## L6 已实现什么（`security_world/release/`）

| 模块 | 内容 |
| --- | --- |
| `manifest.py` | `build_release`：八策略 split 行、逐门 `validation_summary`、`attack_family_reachability`、`file_sha256`（只索引数据文件——manifest 自指无解） |
| `freeze.py` | `freeze`（已冻结则拒绝覆盖）/ `verify_release`（重算 sha256 对账）/ `load_manifest` / `load_episodes` |

## 不可协商项

1. **ground truth 里没有 LLM。** 标签只来自 `security_world/oracle/`。
   `test_llm_cannot_influence_labels` 用"假设与 oracle 结论相反"的世界证明它。
2. **没有网络。** Phase 1 生成只 replay 录播 fixture；任何测试打开 socket 即失败。
3. **没有真实凭据、没有真实目标。** 只有合成数据。
4. **`world_truth` 与 `observable_decision` 是两个字段。** 前者在完整状态上算，
   后者只在可见证据上算。`severity` 是报告字段，永远不移动 verdict。
5. **反事实家族不跨 split。** release 期由 `group_overlap_audit`（schema 里
   `maxItems: 0`）与 `G8_leakage_audit` 强制。
6. **模型看不到 oracle 的分类。** `observation` 拆成 `model_visible`（闭集七键
   证据投影）与 `decision_metadata`；`test_model_visible_boundary` 断言它。
7. **确定性。** 同一世界 + 同种子 ⇒ 字节级相同的工件。生成路径上禁止无种子
   `random` 与 `time.time()`（`tests/unit/test_model_no_wallclock.py` 静态断言）。
8. **引用完整性是硬失败。** 任何 actor/resource/token/session 引用解析不了就抛
   `RefResolutionError` / `CompileError`，绝不静默变成 `None` 流进 oracle。

## 目录布局

权威模块地图（哪个子代理拥有哪个文件、彼此间的签名级契约）见设计 §15。
