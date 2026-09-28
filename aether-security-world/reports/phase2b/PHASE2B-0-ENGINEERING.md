# Phase 2B-0 — Production Hardening（工程证据）

> 执行顺序 brief §69 的 1–5 步：preserve Phase 2A freeze → fix pytest collection →
> add collection guard → remove canonical `skeleton_id` from provider responsibility →
> run all regressions。
> 本阶段**没有**碰语义生成行为（brief §8）：prompt v0.7 与冻结的 v0.6 的差分只有
> ID 归属一处，由脚本逐行断言（见下）。

---

## 0. Phase 2A freeze 完整性（preserve，brief §1）

```
$ sha256sum -c SHA256SUMS.txt          # 16/16 OK
$ python -c <核对 PHASE2A-FINAL-FREEZE.json 的 15 个组件哈希>
components checked: 15 drift: 0
freeze self-hash check: True
```

`PHASE2A-FINAL-FREEZE.json` / `.sha256` / `SHA256SUMS.txt` 一个字节都没动。
被冻结的 `semantic-skeleton.schema.json` 与 `prompts/v0.6.md` 也仍然逐字节等于冻结值
（有测试钉死：`test_frozen_phase2a_prompt_and_schema_are_still_byte_identical`）。

---

## 1. testpaths 盲区修复（brief §4）

**故障**：`pyproject.toml` 的 `testpaths = ["tests"]` 让普通 `pytest` 只收集 1229 条
legacy 测试，`semantic_skeleton/tests/` 里的 163 条 Phase 2A 测试**一条都没跑**，退出码 0。
两次手工 pytest 才能看到 1229 + 163。

**修复**：`testpaths = ["tests", "semantic_skeleton/tests"]`（REVISION 3，注释写明原因）。

**实测**：

```
$ py -3 -m pytest --co -q
1392 tests collected in 1.31s        # 修复前：1229
$ py -3 -m pytest -q
1419 passed in 355.76s (0:05:55)     # 1229 legacy + 190 semantic（含本阶段新增 27 条）
```

## 2. Test Collection Guard（brief §5）

新增 `scripts/check_test_collection.py`（repository guard）+ 写
`test-collection-manifest.json`：

```
legacy    collected= 1229  (tests)
semantic  collected=  190  (semantic_skeleton/tests)
total     collected= 1419  (frozen minimum 1392)
manifest -> test-collection-manifest.json
```

门槛：任一 suite 收集到 0 条、有收集结果落在已知 testpath 之外、或总数低于冻结下限 1392
⇒ 非零退出。同一断言也搬进了测试套件（`semantic_skeleton/tests/test_collection_guard.py`），
所以**只跑 `pytest` 也能发现分桶消失**。

**非空转证明**（把 testpaths 临时改回 `["tests"]` 再跑）：

```
[FAIL] legacy=1229 semantic=0 total=1229 (minimum 1392)
guard exit=1
改回后：[PASS] legacy=1229 semantic=190 total=1419 (minimum 1392)  exit=0
```

## 3. canonical skeleton_id 收归程序（brief §6/§7/§29）

### 3.1 为什么这是 correctness 问题而不是洁癖

Phase 2A 里 `skeleton_id` 不只是句柄：`WorldPlan.world_id`、`seed`、**全部实体 ID**
（`stable_digest(skeleton_id, family, slot)`）、租户 ID、工作流 ID、时钟偏移全部由它派生。
Step 曾连续三批复制旧 `skeleton_id`——只要两个不同骨架撞了同一个句柄且机制族相同，
就会拿到同一个 `world_id` 和同一批实体 ID。Phase 2A 靠"provider 撞 id 即拒收"挡住了它，
而 brief §29 明确要求这个拒收理由消失；不先修身份派生，就会打开一个真实的口子。

### 3.2 新模块 `semantic_skeleton/identity.py`

```
canonical_skeleton_id(document) = "SK-" + sha256(scheme ‖ sha256(canonical_json(payload)))[:16]
payload = document 剥掉 PROVIDER_OWNED_KEYS = {skeleton_id, provider_claimed_id}
```

性质（每条都有测试）：

| 性质 | 测试 |
| --- | --- |
| 同一 frozen 骨架 ⇒ 同一 id（跨进程、跨键序、跨批次） | `test_canonical_id_is_deterministic_and_independent_of_arrival_order`、`test_canonical_id_is_stable_across_processes` |
| provider 自称的 id 不影响 canonical id | `test_provider_claimed_id_does_not_change_the_canonical_id` |
| 不同语义 ⇒ 不同 id | `test_distinct_semantics_get_distinct_ids` |
| `world_id` / 实体 id 跟随 canonical id | `test_compiled_identity_follows_the_canonical_id_not_the_claim` |
| 同一骨架重复编译逐字节相同 | `test_compiling_the_same_skeleton_twice_is_byte_identical` |
| provider 撞 id 不再是拒收理由 | `test_duplicate_claimed_ids_are_not_a_rejection_in_production` |
| Phase 2A 兼容路径行为不变 | `test_phase2a_parser_still_rejects_duplicate_ids`、`test_phase2a_contract_behaviour_is_unchanged` |

### 3.3 契约差分（可证明最小）

**schema**：`scripts/build_production_schema.py` 从冻结 schema 派生
`schemas/production/semantic-skeleton.schema.json`，先校验源文件 sha256 等于
PHASE2A-FINAL-FREEZE 记录值，再施加三处显式编辑，最后逐键断言"除白名单外与冻结版结构
完全一致"：

- `required` 删除 `skeleton_id`
- `properties` 删除 `skeleton_id`，新增 optional `provider_claimed_id`（provenance-only）
- title/description 标注代际与 ID 归属条款

**prompt**：`scripts/build_skeleton_prompt_v07.py` 从冻结的 v0.6 派生 v0.7，
用 difflib 逐行断言"任何改动行必须在 ID 归属白名单内"。实际差分（全部）：

```diff
-# Aether Security World — Phase 2A semantic skeleton generator
+# Aether Security World — Phase 2B production semantic skeleton generator
-exactly these keys: skeleton_id, domain, …
+exactly these keys: domain, …
-   every ID from a stable hash of your `skeleton_id`.
+   every ID from a stable hash of your skeleton's semantic content. Do NOT emit any id
+   field: no `skeleton_id`, no `provider_claimed_id`, no example-style handles. The
+   canonical id is derived by the program; an id you invent has no meaning and is never
+   used.
-{"skeleton_id": "SK-EXAMPLE-001", …
+{"domain": "saas", …
-{"skeleton_id": "SK-EXAMPLE-002", …
+{"domain": "devops_platform", …
```

除此之外**一个字节都没动**——没有借 production hardening 之名调语义 prompt（brief §8）。

### 3.4 brief §7 全字段审计（provider 责任清单）

`semantic_skeleton/tests/test_provider_ownership.py` 把 production schema 的每个键过一遍：

- 60 个程序可派生键名（`world_id` / `family_id` / `split` / `attack_family` /
  `schema_version` / `prompt_hash` / `seed` / 实体与证据 ID / `resource_states` /
  `policy_ast` / `provenance` / 时间戳 …）一个都不许出现；
- 任何以 `id` 结尾的键名直接拒（`provider_claimed_id` 是唯一显式例外，且必须 optional）；
- 全部键必须落在"语义字段 ∪ provenance-only ∪ `$comment`"里，未登记即红；
- prompt 声明的键清单必须与 schema 的 `required` **逐字一致**（否则模型按过期契约生产，
  整批撞 schema——那是工程失误，不是模型问题）。

**结论**：删除 `skeleton_id` 之后，provider 契约里**没有任何**程序可派生字段残留。
`mechanism_family` / `complexity` / `domain` / `history` / `security_invariants[].type` /
`counterfactuals[].semantic_expectation`（可伪证先验，由 Oracle 复核）都是安全语义，
属于 LLM 该负责的部分。

### 3.5 runner：`--contract production`

`scripts/skeleton_run.py` 增加 `--contract {phase2a,production}`（默认 phase2a，行为不变）：

| | phase2a（默认） | production |
| --- | --- | --- |
| schema | 冻结 schema | `schemas/production/…` |
| prompt | v0.6 | v0.7 |
| canonical id | provider 的 `skeleton_id` | `identity.canonical_skeleton_id` |
| provider 撞 id | 拒收 | 只计数（`provider_claimed_id_reuse`） |
| 逐字节相同的内容 | — | `duplicate_canonical_id`（程序判定的重复） |
| 产物 | `worlds/skeletons/…` | `worlds/production/…`（brief §23） |
| 默认 run_id | `provider-run-002` | `provider-run-production-001` |
| 冻结状态 | `state/phase2a-frozen.json` | `state/production-frozen.json` |

`freeze --contract phase2a` 重跑结果与既有 `state/phase2a-frozen.json` 逐字段一致
（顺带修了一个潜伏 bug：原 `freeze_phase2a()` 引用未定义的全局 `run_id`，一调用就
NameError，freeze 模式因此从未真正跑通过）。

### 3.6 基础设施故障隔离（brief §9 / §61）

provider 传输/鉴权失败现在写**独立**的 `state/infrastructure-failures-<run_id>.jsonl`，
并在 rejected 记录里打 `classification: INFRASTRUCTURE_FAILURE`；鉴权熔断
（`AuthCircuitOpen`）立即停止 run、返回退出码 6、落
`INFRASTRUCTURE_BLOCKED_PROVIDER_AUTH`。凭据问题因此不可能被算进 dataset quality 指标，
也不会和"生成器吐了坏数据"混在同一本账上。

---

## 4. 回归（brief §5 / §18）

| 门 | 命令 | 结果 |
| --- | --- | --- |
| 全量测试（单次 pytest，legacy + semantic） | `py -3 -m pytest -q` | **1419 passed** in 355.76s |
| collection guard | `py -3 scripts/check_test_collection.py` | PASS（1229 + 190 = 1419 ≥ 1392） |
| 机制注册表自检 | `py -3 scripts/mechanism_selfcheck.py` | **46/46 passed, 0 failed** |
| Phase 1 回归 | `py -3 scripts/phase1_regression.py --limit 69` | 69 considered / 60 extracted / 60 compiled / 60 oracle-compiles（与 Phase 2A 记录一致） |
| Phase 2A 冻结回归（用**改过的**编译器重裁 103 个 accepted） | `py -3 scripts/revalidate_phase2a.py --out worlds/revalidated` | considered 103 / recompiled 103 / rejected 0 / **semantic_equivalent 103** |
| repository hygiene guard | `node scripts/guards/check-repository-hygiene.mjs` | No tracked generated artifacts found |
| project structure guard | `node scripts/guards/check-project-structure.mjs` | project_contracts=passed, absolute_user_paths=0 |
| no-secrets guard | `node scripts/guards/check-no-secrets.mjs` | no_secrets=passed（2161 files scanned） |

### 4.1 编译器改动的字节级中性证明

`revalidate` 的 `semantic_equivalent` 是形状级比较；我又做了一次逐字段 diff，把 103 个
世界的旧 spec 与新 spec 全量对比，差异**只**落在两类字段：

```
  103  ONLY-OLD@.provenance.raw_generation_id        # 重裁脚本自己的上下文，不带 raw id
  103  VAL@.provenance.{generation_timestamp,generator_model,generator_model_version,prompt_hash,prompt_version}
  206  VAL@.episode_templates[0].events[2..7].summary  # Phase 2A 后期加的 _sanitise_prose 背衬
```

实体、状态、事实路径、不变量、策略、证据、信任、反事实轴、`world_id`、`attack_family`
**零差异**。也就是说：canonical-id 重构对 Phase 2A 路径是字节中性的；summary 的差异来自
Phase 2A 期间为修 G12 泄漏而加的 `_sanitise_prose`（v05-run 产出时还没加），与本次改动无关。

---

## 5. 本阶段新增/改动的文件

新增：

- `semantic_skeleton/identity.py` — canonical 身份派生
- `semantic_skeleton/schemas/production/semantic-skeleton.schema.json` — production 契约
- `semantic_skeleton/prompts/v0.7.md` / `v0.7.json` — production prompt
- `scripts/build_production_schema.py` / `scripts/build_skeleton_prompt_v07.py` — 可审计派生
- `scripts/check_test_collection.py` — collection guard
- `semantic_skeleton/tests/test_canonical_identity.py`（14）
- `semantic_skeleton/tests/test_production_runner.py`（5）
- `semantic_skeleton/tests/test_provider_ownership.py`（6）
- `semantic_skeleton/tests/test_collection_guard.py`（2）
- `reports/phase2b/{mechanism-selfcheck,phase1-regression,phase2a-frozen-regression}.json`

改动（均为加法，默认行为不变）：

- `pyproject.toml` — testpaths
- `semantic_skeleton/skeleton.py` — `load_skeleton(schema_path=, canonical_id=)`；无 id 时自行派生
- `semantic_skeleton/compiler/compiler.py` — `CompileContext.canonical_skeleton_id`；`_plan` 接收 id
- `semantic_skeleton/generator/parser.py` — `reject_duplicate_ids` / `schema_path` 参数
- `semantic_skeleton/coverage.py` — `include_id_blacklist` 参数
- `scripts/skeleton_run.py` — `--contract`；production 布局；基础设施故障分流
- `scripts/revalidate_phase2a.py` — `--report` / `--out` 可改道（默认值不变）

## 6. 冻结组件的哈希变化（供 production contract freeze 引用）

Phase 2A 冻结的 15 个组件里，本次被改动的是 4 个（都是 §6/§7 明确授权的 ID ownership /
工程基础设施范围）：

| 组件 | Phase 2A 冻结值 | 现值 | 改动原因 |
| --- | --- | --- | --- |
| `semantic_skeleton/skeleton.py` | `937473c0…` | 见 `state/production-frozen.json` 生成时的实算 | `load_skeleton` 支持 canonical id / production schema |
| `semantic_skeleton/compiler/compiler.py` | `c724fb3a…` | 同上 | canonical id 经 CompileContext 进入 `_plan` |
| `semantic_skeleton/generator/parser.py` | （未在 2A freeze 单列） | 同上 | production 下不再因 provider 撞 id 拒收 |
| `semantic_skeleton/coverage.py` | `7b51aa62…` | 同上 | production 下不发 id 黑名单 |
| `semantic_skeleton/prompts/v0.6.md` | `1c891e4b…` | **未变** | v0.7 是新文件 |
| `semantic_skeleton/schemas/semantic-skeleton.schema.json` | `82bc9516…` | **未变** | production schema 是新文件 |
| 其余 9 个组件 | — | **未变** | ontology / mechanisms / archetypes / errors / plan / verify / fingerprint / oracle / live / phase2a.json |

`scripts/freeze_production_contract.py`（Phase 2B-4 落地）会把这些现值连同
`test-collection-manifest.json`、episode expansion config、split algorithm 一起冻结。
