# Aether Security World — Phase 2B 状态报告

> 生成时间：2026-09-26。本文件记录 Phase 2B 已完成的部分、被阻塞的部分，以及恢复执行所需的
> 全部信息。**Phase 2B 未完成**：两个需要真实 provider 的步骤（Generator-OOD Engineering
> Pilot、500 fresh accepted worlds）因凭据失效而无法执行，详见 §2。

---

## 0. TLDR

| 项 | 状态 |
| --- | --- |
| Phase 2A freeze 完整性 | ✅ 冻结文件零改动；15 个组件中 3 个按 §6/§7 授权改动并已用字节级 diff 证明中性，其余 13 个零漂移 |
| testpaths 盲区修复 | ✅ 单次 `pytest` 收集 1392 → 1413 条（修复前 1229） |
| test collection guard | ✅ 脚本 + 套件内自测，非空转已证明 |
| canonical skeleton_id 收归程序 | ✅ 新模块 + production schema + prompt v0.7 + runner 三契约 |
| provider 责任审计（brief §7） | ✅ 契约里零程序可派生字段，测试钉死 |
| 全量回归 | ✅ 见 §1.5（含编译器改动对 Phase 2A 的字节级中性证明） |
| Generator-OOD Engineering Pilot | ⛔ **阻塞**：STEPFUN_API_KEY 返回 401 |
| 500 fresh accepted worlds | ⛔ **阻塞**：同上 |
| episode 展开（确定性，无 LLM） | ✅ 新家族 + surface 乘数，实测 112 episodes/world |
| production contract freeze | ⏸ 未做（按 brief §69 必须排在 OOD pilot 之后） |
| split / release / 最终报告 | ⏸ 未做 |

---

## 1. 已完成：Phase 2B-0 Production Hardening

完整证据见 [`PHASE2B-0-ENGINEERING.md`](PHASE2B-0-ENGINEERING.md)，这里只列结论。

### 1.1 Phase 2A 冻结产物的状态

**冻结文件本身一个字节都没动**：`PHASE2A-FINAL-FREEZE.json` / `.sha256` / `SHA256SUMS.txt`
仍是当初那份（`sha256sum -c SHA256SUMS.txt` 里 `PHASE2A-FINAL-FREEZE.json: OK`，
self-hash 也仍然对得上）。brief §1 禁止的是改冻结**产物**，不是永远不许碰它记录过的源码。

冻结清单记录的 15 个组件里，**有 3 个被本阶段有意改动**（都是 brief §6/§7 授权的 ID ownership
范围），因此 `sha256sum -c` 现在报 3 个 FAILED：

```
semantic_skeleton/compiler/compiler.py: FAILED   # canonical id 经 CompileContext 进 _plan
semantic_skeleton/coverage.py:        FAILED   # include_id_blacklist 参数
semantic_skeleton/skeleton.py:        FAILED   # load_schema(schema_path=, canonical_id=)
```

其余 13 个组件全部仍然 OK，其中包括两个**刻意保持逐字节不变**的：
`prompts/v0.6.md`（`1c891e4b…`）与 `schemas/semantic-skeleton.schema.json`（`82bc9516…`）——
production 版是新文件，不是覆盖。有测试钉死这两个哈希
（`test_frozen_phase2a_prompt_and_schema_are_still_byte_identical`）。

这 3 处漂移的全部影响已经用字节级 diff 证明是中性的，见 §1.5。production contract freeze
（brief §19）会记录这 3 个组件的**新**哈希，Phase 2A 的旧哈希留在原冻结件里作为历史。

### 1.2 pytest 收集盲区（brief §4）

`testpaths = ["tests"]` 让普通 `pytest` 跳过全部 Phase 2A 测试且退出码 0。已改成
`["tests", "semantic_skeleton/tests"]`：

```
$ py -3 -m pytest --co -q
1392 tests collected in 1.31s          # 修复前 1229
# （现在 1434：本阶段新增 42 条测试，下限仍冻结在 1392）
```

### 1.3 Collection guard（brief §5）

`scripts/check_test_collection.py` 写 `test-collection-manifest.json`，任一 suite 归零或
总数低于冻结下限 1392 即非零退出。**非空转已证明**：把 testpaths 临时改回 `["tests"]`，
guard 报 `[FAIL] legacy=1229 semantic=0 total=1229` 并退出 1。同一断言也搬进了测试套件
（`semantic_skeleton/tests/test_collection_guard.py`），所以只跑 `pytest` 也能发现分桶消失。

### 1.4 canonical skeleton_id 收归程序（brief §6/§7/§29）

这是本阶段唯一一处**correctness** 修复，不是洁癖：Phase 2A 里 `world_id` / `seed` /
**全部实体 ID** 都由 provider 写的 `skeleton_id` 派生，而 Step 曾连续三批复制旧 id。
Phase 2A 靠"撞 id 即拒收"挡住它，brief §29 又要求这个拒收理由消失——不先修身份派生就会
打开一个真实的口子。

* 新模块 `semantic_skeleton/identity.py`：
  `canonical_id = "SK-" + sha256(scheme ‖ sha256(canonical_json(payload)))[:16]`，
  payload 已剥掉 provider-owned 键。同一 frozen 骨架永远同一个 id，与到达顺序、
  run、provider 自称全都无关。
* production schema 由**脚本从冻结 schema 派生**（`scripts/build_production_schema.py`），
  先校验源文件哈希再施加三处显式编辑，最后逐键断言"除白名单外结构完全一致"。
* prompt v0.7 同样由脚本从冻结 v0.6 派生（`scripts/build_skeleton_prompt_v07.py`），
  difflib 逐行断言任何改动行必须在 ID 归属白名单内。实际差分只有：标题代际、键清单去掉
  `skeleton_id`、规则 1 改成"不要输出任何 id 字段"、两个 worked example 去掉该键。
  **没有**借 hardening 之名调语义 prompt（brief §8）。
* runner 支持 `--contract {phase2a,production,ood}`；默认 phase2a，行为不变。
* brief §7 的 provider 责任审计落在 `semantic_skeleton/tests/test_provider_ownership.py`：
  60 个程序可派生键名一个都不许出现，任何以 `id` 结尾的键名直接拒，prompt 声明的键清单
  必须与 schema 的 `required` 逐字一致。**结论：删除 `skeleton_id` 之后契约里零残留。**
* 顺带修了两个潜伏 bug：`freeze_phase2a()` 引用未定义的全局 `run_id`（一调用就
  NameError，freeze 模式因此从未真正跑通过）；以及我自己在 prompt/schema 生成脚本里用
  `write_text` 导致 Windows 上 `\r\n` 变 `\r\r\n`、记录哈希与落盘字节不一致——已全部改成
  显式 `write_bytes`。

### 1.5 全量回归

| 门 | 结果 |
| --- | --- |
| `py -3 -m pytest -q`（单次，legacy + semantic） | **1434 passed** in 387.31s（legacy 1244 + semantic 190；Phase 2A 冻结时是 1229 + 163 = 1392） |
| collection guard | PASS（1244 + 190 = 1434 ≥ 1392） |
| 机制注册表自检 | **46/46 passed, 0 failed** |
| Phase 1 回归（69 worlds） | 60 extracted / 60 compiled / 60 oracle-compiles |
| Phase 2A 冻结回归（用**改过的**编译器重裁 103 个 accepted） | 103/103 recompiled，**semantic_equivalent 103** |
| repository hygiene / project structure / no-secrets guard | 全部 exit 0 |

编译器改动的**字节级中性证明**：把 103 个世界的旧 spec 与新 spec 全量逐字段 diff，
差异只落在 `.provenance.*`（重裁脚本自己的占位上下文）和
`.episode_templates[].events[].summary`（Phase 2A 后期为修 G12 泄漏加的
`_sanitise_prose`，v05-run 产出时还没有）——实体、状态、事实路径、不变量、策略、证据、
信任、反事实轴、`world_id`、`attack_family` **零差异**。

---

## 2. 阻塞：provider 凭据失效

### 2.1 实测

```
STEPFUN_API_KEY: present (len 65)
probe step-3.7-flash  → HTTP 401 {"error":{"message":"Incorrect API key provided","type":"invalid_api_key"}}
probe step-5-preview  → HTTP 401 {"error":{"message":"Incorrect API key provided","type":"invalid_api_key"}}
```

两个模型都 401，说明是**凭据本身失效**（与 Phase 2A 期间遇到过的同一类问题：key 会过期），
不是模型名或端点问题。仓库里没有第二份凭据（`ml/data_pipeline/v03/.env.local` 只有
`ARK_BASE_URL`/`ARK_MODEL` 等，没有 key；根 `.env` 里没有 STEPFUN 条目）。

按 brief §9 / §5 的纪律：鉴权失败是**基础设施故障**，不得进入 dataset quality 指标。
客户端的 401 熔断（`auth_failure_limit=2`）工作正常——probe 第二次调用即熔断，没有无限重试。
因此没有发起任何正式 run，也没有产生任何需要作废的数据。

### 2.2 恢复执行需要什么

一个有效的 StepFun key（`step-5-preview` 与 `step-3.7-flash` 都可用同一把），
设进 `STEPFUN_API_KEY` 环境变量即可。代码里没有任何 key 字面量，key 永不落盘。

拿到之后，按 §4 的顺序继续，中间不需要再改任何代码。

---

## 3. 已完成：Phase 2B episode 展开（确定性，无 LLM）

brief §35 禁止再用 LLM 生成 episode truth，所以这一层全部是程序化的。已完成并测试：

### 3.1 新家族 `trust_provenance_variant`（brief §33/§40）

实现 `security_world/expansion/families.py`：把一条 establishing 证据**改挂到更弱的
来源**（`system_of_record → replicated_cache / client_supplied / llm_derived`），
**保留它断言的值**，然后由 Oracle 在新的 evidence view 上重算充分性。

* `provenance` / `source` / `freshness` 是模型可见的（七键投影里的字段）；
  `trust_level` 不在投影里——模型必须自己从 provenance 推断可信度，那正是要训练的能力。
* 编译器产出的语料里 provenance 与 trust_level 是**完全一致**的映射（实测 100 个
  accepted world：`system_of_record→trusted/fresh`、`replicated_cache→semi_trusted/stale`、
  `client_supplied→untrusted/fresh`、`log_pipeline→semi_trusted/fresh`、
  `llm_derived→derived/fresh`，无一例外）。有测试钉死这个一致性——一旦不一致就会造出
  "模型看不见的标签变化"，那是泄漏不是训练信号。
* 世界本体一个字节都不改，所以 `world_truth` 不变；`observable_decision` 降不降级由
  Oracle 说了算（实测 12 个候选里约 2 个真的造成降级）。
* schema 同步加了 `trust_provenance_variant` 到 `variant_type` 枚举 + allOf/if-then
  （干预记录必填），`VARIANT_TYPES` / `INTERVENTION_REQUIRED_VARIANTS` 两个镜像同步更新。

### 3.2 surface 乘数（brief §41）

`analysis/phase2b_expand.py` 把每个逻辑变体铺满 surface：

| 家族 | surface | 理由 |
| --- | --- | --- |
| `base` / `critical_intervention` | 8 renderer × 3 style = 24 | 判决就在这些 episode 里，要让模型在 HTTP / GraphQL / RPC 上都认出同一个安全态势 |
| `irrelevant_perturbation` / `evidence_masked` | 8 renderer × 1 style | 信号是证据可见性/表面噪声，style 再乘三倍只是重复同一种信号 |
| `trust_provenance_variant` | 1 renderer | 信号是"这条断言换了出处" |

实测（Phase 2A confirmation run 的 4 个世界）：**448 episodes = 112.0/world**，
按 500 worlds 推算 ≈ **56k episodes**，落在 brief §34 的 40k–60k 区间内、接近推荐中心
50k。计划落在 `configs/phase2b-episodes.json`（会被 production contract freeze 哈希）。

### 3.3 修掉一个真实的 id 碰撞 bug

第一版驱动产出 304 条 episode 却只有 **49 个不同 episode_id**——engine 的
`_derive_episode_id` 只哈希 (world, family, variant_type, action, intervention,
variant_key)，**不含 renderer/style**；Phase 1/2A 每族只用一个 renderer 所以从没撞过。
一旦铺满 surface，同一个 base 变体就拿到 8 个一模一样的 id。

修法：release 层的 id 在驱动层补上 surface（`release_episode_id` = engine id + renderer +
style），第三方拿着 episode 文档 + surface 就能逐字重算；驱动内还有硬断言，撞 id 即
`SystemExit`。改后 448 条 episode 448 个不同 id，0 重复。

### 3.4 测试

`tests/integration/test_phase2b_episodes.py`（14 条，全过）钉死：provenance↔trust 与语料
一致、改挂不改变断言值、候选只挑 establishing 且排序确定、隐藏证据绝不动、
`observable_effect` 不把"其他 observable 差异"冒充 downgrade、episode 全部过
`episode.schema.json`、`world_truth` 与 `observable_decision` 是两个字段、
surface 分配符合计划、干预记录写出 before/after、展开确定性、抽样重算 Oracle 标签一致。

---

## 4. 剩余工作（按 brief §69 的顺序）

凭据恢复后依序执行，**中间不需要再改代码**：

```
 6. Generator-OOD Engineering Pilot          py -3 scripts/skeleton_run.py ood --contract ood --live \
                                                --target-accepted 40 --batch-size 5
    （第二生成器 step-3.7-flash + clean-room prompt 家族 semantic_skeleton/prompts/ood-pilot-v1.md；
     产物落 worlds/ood-pilot/，永不进训练集/benchmark/500 corpus——brief §16。
     注意：这与 step-5-preview 是同一供应商，报告必须写明这是 MODEL-OOD 但**不是**
     VENDOR-OOD，brief §11 的"优先不同供应商"在本地无第二把 key 的前提下无法满足。）
 7. 只应用有依据的确定性兼容修复（parser / normalizer / alias / compiler robustness，
    不得降低安全 gate）
 8. 重跑全量测试 + 两个 guard
 9. 冻结 production contract                  scripts/freeze_production_contract.py（待写）
10. 500 fresh accepted worlds                 py -3 scripts/skeleton_run.py production --contract production --live
11. 冻结 world corpus                         生成 ASW-WORLDS-PRODUCTION-v0.x.jsonl + WORLD-RELEASE-MANIFEST.json
12. episode 展开                              py -3 analysis/phase2b_expand.py \
                                                --worlds worlds/production/accepted/provider-run-production-001.jsonl \
                                                --out releases/asw-v0.x/episodes/train.jsonl
13. episode 审计                              truth consistency / observation sufficiency / masking / counterfactual /
                                             evidence provenance / renderer leakage
14. group-based splits                        world_family / counterfactual_family / workflow_family /
                                             policy_family / invariant_family 五重 union，禁止随机 row split
15. fresh Generator-OOD benchmark worlds      （全新生成，不复用 pilot worlds）
16. split 隔离审计                            SPLIT-LEAKAGE-AUDIT.md
17. ASW Release Freeze                        ASW-RELEASE-FREEZE.json + .sha256 + SHA256SUMS.txt
18. reports/phase2b/PHASE2B-FINAL-REPORT.md
19. STOP（不自动开始任何模型训练）
```

预算参考（brief §24）：500 accepted ≈ 1.11M output tokens，建议上限 1.4M（非硬停点），
达到 500～520 即停。

---

## 5. 本阶段新增/改动的文件

新增：`semantic_skeleton/identity.py`、`semantic_skeleton/schemas/production/semantic-skeleton.schema.json`、
`semantic_skeleton/prompts/v0.7.md`(+`.json`)、`semantic_skeleton/prompts/ood-pilot-v1.md`(+`.json`)、
`security_world/expansion/families.py`、`analysis/phase2b_expand.py`、
`configs/phase2b-episodes.json`、`scripts/{check_test_collection,build_production_schema,
build_skeleton_prompt_v07,build_ood_prompt}.py`、
`semantic_skeleton/tests/{test_canonical_identity,test_production_runner,test_provider_ownership,
test_collection_guard}.py`、`tests/integration/test_phase2b_episodes.py`、
`reports/phase2b/{PHASE2B-0-ENGINEERING.md,PHASE2B-STATUS.md,mechanism-selfcheck.json,
phase1-regression.json,phase2a-frozen-regression.json}`、`test-collection-manifest.json`、
`state/{production-frozen,ood-frozen}.json`。

改动（均为加法或显式版本 bump，默认行为不变）：`pyproject.toml`、`semantic_skeleton/skeleton.py`、
`semantic_skeleton/compiler/compiler.py`、`semantic_skeleton/compiler/plan.py`（未改）、
`semantic_skeleton/generator/parser.py`、`semantic_skeleton/coverage.py`、
`scripts/skeleton_run.py`、`scripts/revalidate_phase2a.py`、
`security_world/model/episode.py`、`security_world/validation/distribution.py`、
`schemas/episode.schema.json`、`tests/unit/test_model_episode.py`。
