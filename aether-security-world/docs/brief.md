你是一名同时具备以下能力的首席研究工程师：

1. 网络安全研究
2. Web / API / HTTP 安全
3. 身份认证与授权系统
4. Session / Token / OAuth / JWT 生命周期
5. 业务逻辑漏洞与状态机安全
6. 分布式系统、缓存与一致性
7. LLM 数据工程
8. 反事实学习 / 因果数据生成
9. 数据集污染、数据泄漏和 benchmark 设计
10. Python / TypeScript 工程
11. 可复现实验工程
12. AI Security / Security LLM Research

你现在需要从零设计并实现一个研究级项目：

# Aether Security World

它是一个“可执行的状态化网络安全数据工厂”。

注意：

这不是一个普通的“让大模型生成攻击数据”的项目。

核心思想是：

    真值由程序定义；
    AI 负责创造场景和语义多样性；
    程序负责执行、验证、反事实展开和标签生成。

最终目标是构建能够训练和评估下一代 Stateful Security Reasoning Model 的大规模数据基础设施。

==================================================
一、严格限定本阶段职责
==================================================

当前阶段只做：

    DATA GENERATION / DATA CURATION / DATA VALIDATION

不要实现：

- 模型微调
- QLoRA
- SFT Trainer
- RL Trainer
- RLVR
- 论文 LaTeX
- 论文写作
- 最终模型
- 产品前端
- SOC 控制台
- Networksafe 产品功能
- 自动攻击真实系统

未来会有三个完全独立的项目：

1. Data Factory
2. Training Lab
3. Evaluation / Paper Lab

本项目只负责第 1 项。

必须保证：

    Dataset generation
            ↓
    Frozen Dataset Release
            ↓
    后续训练项目只能读取

训练代码不能反过来修改数据生成逻辑。

==================================================
二、研究问题
==================================================

现有安全 LLM 经常学习：

    payload token → attack

而不是：

    system state + policy + evidence → security decision

例如：

请求：

    GET /api/orders/183

仅仅看到这个请求无法判断是否发生 IDOR。

真正决定安全性的可能是：

    authenticated_user = Alice
    resource_owner = Bob
    policy = owner_only

因此我们希望构建的数据能够使未来模型学习：

1. 哪些状态决定安全结论？
2. 当前证据是否足够？
3. 缺少什么证据？
4. 哪些证据与判断无关？
5. 修改关键状态后，结论是否应该变化？
6. 修改无关状态后，结论是否应该保持不变？
7. 证据是否可信？
8. Session / Token / Workflow 的历史状态如何影响当前请求？
9. 一个表面合法的请求是否因为历史状态而成为攻击？
10. 一个表面危险的请求是否实际上是合法行为？

最终一个安全事件不应该只表示成：

    HTTP Request

而应该近似表示成：

    Episode =
    {
        world,
        actors,
        resources,
        policies,
        workflow,
        state_history,
        current_state,
        observations,
        request,
        available_evidence,
        hidden_evidence,
        evidence_provenance,
        oracle_decision
    }

==================================================
三、最重要的设计原则
==================================================

必须遵循以下原则。

--------------------------------------------------
原则 1：LLM 不能成为 Ground Truth Oracle
--------------------------------------------------

禁止：

    Step-5-pre 生成样本
            ↓
    Step-5-pre 判断是不是攻击
            ↓
    标签直接进入数据集

这会形成 AI self-labeling loop。

必须：

    Structured World
            ↓
    Executable Security Policy
            ↓
    Deterministic Oracle
            ↓
    Ground Truth

LLM 可以建议一个世界应该包含什么规则。

但规则一旦结构化之后：

    safe
    attack
    insufficient_evidence

必须尽可能由程序计算。

--------------------------------------------------
原则 2：Step-5-pre 负责高信息密度内容
--------------------------------------------------

Step-5-pre 当前吞吐约：

    ~30 output tokens / second

因此不能让它生成百万条最终训练数据。

它只负责：

- 高质量业务场景
- 状态机
- 实体关系
- 安全策略
- 安全不变量
- 漏洞机会
- 业务描述
- 少量高质量自然语言表现
- 应用语义变化

程序负责：

- ID 替换
- 用户变化
- ownership 变化
- Session 变化
- Token 变化
- 状态 transition
- evidence masking
- counterfactual intervention
- HTTP serialization
- header permutation
- URL encoding
- JSON field variation
- irrelevant noise
- deterministic labeling

目标大致是：

    1 个 AI world seed
            ↓
    20~200 个程序生成实例

而不是：

    1 个 AI request
            ↓
    1 个样本

--------------------------------------------------
原则 3：数据必须支持 Counterfactual Learning
--------------------------------------------------

例如同一个请求：

    GET /api/orders/183

生成三个世界：

A:

    authenticated_user = Alice
    resource_owner = Bob

=> ATTACK

B:

    authenticated_user = Alice
    resource_owner = Alice

=> SAFE

C:

    authenticated_user = Alice
    resource_owner = HIDDEN

=> INSUFFICIENT_EVIDENCE / ABSTAIN

HTTP 请求尽可能保持一致。

只有真正决定安全结论的状态发生变化。

同时必须能够生成：

Irrelevant counterfactual：

    User-Agent changed
    Request-ID changed
    header order changed
    timestamp format changed

这些不应该改变 verdict。

最终我们需要同时训练未来模型：

    causal sensitivity

以及：

    irrelevant invariance

--------------------------------------------------
原则 4：UNKNOWN 不是普通第三类别
--------------------------------------------------

必须明确区分：

UNKNOWN / ABSTAIN / INSUFFICIENT_EVIDENCE

不是某一种攻击类型。

它表示：

    根据当前模型可观察信息，
    无法可靠推导安全结论。

数据结构必须区分：

    real_world_truth

和：

    observable_decision

例如：

真实世界中：

    Alice accessing Bob's resource
    => ATTACK

但如果模型只看到：

    GET /orders/183

没有：

    principal identity
    resource ownership

那么：

    real_world_truth = ATTACK

但是：

    observable_decision = INSUFFICIENT_EVIDENCE

这是整个数据体系必须支持的重要概念。

==================================================
四、核心 World Model
==================================================

设计一个正式、版本化、可扩展的 World Schema。

至少包含：

World
├── application
├── actors
├── identities
├── roles
├── resources
├── ownership
├── permissions
├── sessions
├── credentials
├── tokens
├── workflows
├── policies
├── trust_boundaries
├── caches
├── services
├── state_history
├── current_state
├── evidence
└── invariants

--------------------------------------------------
Actor
--------------------------------------------------

例如：

    user
    administrator
    support_agent
    merchant
    service_account
    attacker-controlled account
    anonymous principal
    backend service

字段考虑：

    actor_id
    actor_type
    identity
    roles
    groups
    tenant
    privileges
    authentication_state

--------------------------------------------------
Resource
--------------------------------------------------

例如：

    file
    order
    invoice
    message
    ticket
    secret
    API key
    user profile
    database record
    cloud resource

字段：

    resource_id
    resource_type
    owner
    tenant
    ACL
    sensitivity
    state

--------------------------------------------------
Session
--------------------------------------------------

至少考虑：

    principal
    session_id
    created_at
    authenticated_at
    auth_strength
    valid
    revoked
    expires_at
    privilege_snapshot
    flow_id

--------------------------------------------------
Token
--------------------------------------------------

至少考虑：

    issuer
    subject
    audience
    scope
    created_at
    expires_at
    one_time
    used
    parent_token
    flow_id
    privilege_version

--------------------------------------------------
Workflow
--------------------------------------------------

必须是状态机。

例如：

    CREATED
      ↓
    PAID
      ↓
    REFUND_PENDING
      ↓
    REFUNDED

允许：

    PAID → REFUND_PENDING

禁止：

    REFUNDED → PAID

必须支持：

    allowed transition
    forbidden transition
    conditional transition

--------------------------------------------------
Policy
--------------------------------------------------

不要一开始设计复杂通用编程语言。

先设计简单但清晰的 Security Policy DSL / AST。

例如概念表达：

    allow read(resource)
    if principal == resource.owner

或者：

    allow refund(order)
    if
        principal == order.owner
        AND order.state == paid
        AND refund_token.valid
        AND refund_token.used == false

Oracle 必须能够程序执行。

==================================================
五、安全不变量
==================================================

Security Invariant 是项目核心。

至少支持以下类别：

1. Ownership invariant
2. Authorization invariant
3. Tenant isolation invariant
4. Session binding invariant
5. Session revocation invariant
6. Token scope invariant
7. Token lineage invariant
8. One-time token invariant
9. Workflow transition invariant
10. Replay invariant
11. Privilege version invariant
12. Cache consistency invariant
13. Authentication state invariant
14. Trust-boundary invariant
15. Resource state invariant
16. Temporal invariant
17. Cross-flow isolation invariant
18. Cross-user isolation invariant
19. Cross-tenant isolation invariant
20. State freshness invariant

例如：

TOKEN_LINEAGE：

    token.flow_id must equal current.flow_id

ONE_TIME_TOKEN：

    token.used must be false

AUTHORIZATION_VERSION：

    session.privilege_version
    must equal
    current_user.privilege_version

这样可以自动制造：

    stale permission
    old token reuse
    revoked session reuse
    cross-workflow token reuse

这些不是传统字符串 payload 攻击。

==================================================
六、优先覆盖的安全场景
==================================================

第一阶段不要无限扩张。

重点覆盖最有研究价值的 Stateful / Logic Security。

至少：

A. Authorization
----------------

- IDOR / BOLA
- horizontal privilege escalation
- vertical privilege escalation
- tenant isolation violation
- stale authorization
- permission downgrade not reflected
- role transition errors

B. Session
----------

- revoked session reuse
- stale session privilege
- cross-account session misuse
- session binding errors
- session after password reset
- session after account disable
- authentication-state inconsistency

C. Token
--------

- token replay
- one-time token reuse
- cross-workflow token reuse
- cross-resource token reuse
- stale token
- scope mismatch
- audience mismatch
- privilege-version mismatch
- token lineage confusion

D. Workflow
-----------

- workflow bypass
- invalid state transition
- repeated operation
- skipping required step
- reversing irreversible state
- state-machine confusion
- stale intermediate state
- cross-process state reuse

E. Cache / Distributed State
----------------------------

- stale permission cache
- inconsistent revocation state
- stale ownership cache
- cache invalidation failure
- inconsistent replicas

F. Resource Logic
-----------------

- owner mismatch
- tenant mismatch
- resource-state violation
- race-sensitive state
- stale object reference

G. Traditional payload classes
-------------------------------

保留一定比例：

- SQL injection
- command injection
- path traversal
- XSS
- SSRF
- unsafe deserialization-like indicators
- prompt injection against LLM-integrated services

但传统 payload 类型不能成为数据主体。

本项目的研究重点是：

    State + Evidence + Policy + History

==================================================
七、Step-5-pre World Seed Generator
==================================================

为 Step-5-pre 设计单独的 generator prompt。

不要让它输出长篇解释。

要求一次批量输出多个 world specification。

推荐 JSONL 或严格 JSON array。

每个 world 至少包含：

{
  "world_id": "...",

  "application_domain": "...",

  "application_description": "...",

  "actors": [...],

  "resources": [...],

  "roles": [...],

  "workflow": {
      ...
  },

  "security_policies": [...],

  "security_invariants": [...],

  "critical_state_variables": [...],

  "irrelevant_state_variables": [...],

  "attack_opportunities": [...],

  "required_evidence": [...],

  "potentially_missing_evidence": [...],

  "trust_boundaries": [...],

  "expected_counterfactual_axes": [...]
}

非常重要：

让模型创造“逻辑结构”，不要让模型提前枚举 50 个 HTTP 请求。

必须最大化：

    information density / generated token

Step-5-pre 一次调用建议尝试产生多个 worlds。

但 batch size 必须通过实际稳定性测试确定。

如果一次生成太多导致：

- JSON 损坏
- world 重复
- 安全逻辑变浅
- schema violation

则降低 batch size。

==================================================
八、Generator Diversity
==================================================

必须避免所有世界都像同一个模型写出来。

应用领域至少覆盖：

- e-commerce
- cloud storage
- SaaS
- school systems
- finance-like workflow
- ticketing
- logistics
- healthcare-like workflow
- HR systems
- DevOps platforms
- code hosting
- CRM
- IAM systems
- IoT management
- industrial management
- API marketplaces
- content platforms
- messaging
- project management
- subscription systems

注意：

这是合成研究环境。

禁止写入：

- 真实密码
- 真实 token
- 真实企业私有地址
- 未授权真实系统信息

==================================================
九、Programmatic Expansion
==================================================

AI world seed 生成完成后：

程序必须负责大规模展开。

每个 World：

1. Concrete instantiation
2. Counterfactual mutation
3. Evidence masking
4. Evidence corruption
5. Irrelevant perturbation
6. Observation rendering
7. Oracle execution
8. Validation

--------------------------------------------------
Concrete Instantiation
--------------------------------------------------

一个抽象：

    User owns Resource

可以实例化为：

    Alice / Order983
    Bob / Ticket102
    Carol / File37

但要避免只靠字符串替换。

实体之间必须满足结构约束。

--------------------------------------------------
Critical Counterfactual
--------------------------------------------------

改变：

    owner
    role
    permission
    workflow state
    token lineage
    token used
    session revoked
    privilege version
    tenant

如果变量理论上决定 verdict：

必须产生对应 verdict change。

--------------------------------------------------
Irrelevant Perturbation
--------------------------------------------------

例如：

    Request-ID
    User-Agent
    benign extra headers
    formatting
    JSON key order
    trace id
    benign timestamp formatting
    cosmetic resource names

必须验证 verdict 不变。

--------------------------------------------------
Evidence Masking
--------------------------------------------------

对完整世界：

    Full state → Ground truth

然后构造 observation。

例如隐藏：

    owner

得到：

    observable_decision = insufficient_evidence

必须支持不同 evidence availability level：

    complete
    partially_missing
    minimally_sufficient
    insufficient
    contradictory
    stale
    attacker_controlled

==================================================
十、Evidence Model
==================================================

每条 evidence 不能只是 string。

建议：

{
    "evidence_id": "...",
    "type": "...",
    "value": ...,
    "source": "...",
    "provenance": "...",
    "trust_level": "...",
    "timestamp": "...",
    "freshness": "...",
    "attacker_controllable": true/false,
    "required_for_decision": true/false
}

至少考虑：

TRUSTED

    policy store
    signed auth state
    deterministic DB state

SEMI_TRUSTED

    application logs
    service metadata

UNTRUSTED

    HTTP parameters
    user-controlled headers
    submitted text

DERIVED

    LLM summary
    generated explanation
    heuristic classifier output

==================================================
十一、Oracle
==================================================

Oracle 是整个项目最不能糊弄的组件。

要求：

1. deterministic
2. unit-testable
3. no LLM dependency
4. explainable
5. reproducible

输出至少：

{
    "world_truth": "safe | attack",
    "observable_decision": "safe | attack | insufficient_evidence",
    "violated_invariants": [...],
    "satisfied_invariants": [...],
    "required_evidence": [...],
    "missing_evidence": [...],
    "decision_trace": [...]
}

注意：

decision_trace 是机器规则执行轨迹。

不是 LLM chain-of-thought。

例如：

[
  "principal=alice",
  "resource.owner=bob",
  "policy=owner_only",
  "principal != owner",
  "authorization_invariant violated"
]

==================================================
十二、Observation Renderer
==================================================

未来训练模型不能总是看到漂亮 JSON。

因此需要多个 renderer。

至少：

1. structured-state
2. HTTP request
3. reverse proxy log
4. application log
5. audit log
6. API gateway record
7. multi-event trace
8. mixed evidence bundle

但第一版不要让 Step-5 逐条自然化。

程序优先负责。

例如：

Abstract action：

    read_resource

Renderer：

REST：

    GET /api/orders/183

GraphQL：

    query {
      order(id: 183) {...}
    }

RPC-like：

    POST /rpc/order.get

最终安全语义保持不变。

==================================================
十三、Episode
==================================================

对于复杂业务逻辑：

禁止只保留单个 request。

支持：

Episode:

T0:
    login

T1:
    resource created

T2:
    permission changed

T3:
    token issued

T4:
    account privilege downgraded

T5:
    stale token reused

T6:
    sensitive operation

最终攻击可能只在 T6 出现。

但原因来自：

    T3 + T4 + T5

因此 episode schema 必须有：

    history
    causal events
    current event
    relevant history
    irrelevant history

==================================================
十四、Causal / Counterfactual Metadata
==================================================

每个 counterfactual family 都应该保存：

    family_id

例如：

    cf_family_000381

里面：

base:

    owner = Bob
    verdict = attack

counterfactual:

    owner = Alice
    verdict = safe

masked:

    owner = hidden
    observable = insufficient

irrelevant:

    user_agent changed
    verdict = attack

保存：

    intervention_variable
    before
    after
    expected_effect

这样未来可以直接测：

    Counterfactual Consistency
    Causal Sensitivity
    Irrelevant Invariance

==================================================
十五、数据泄漏控制
==================================================

必须将 leakage control 设计成一级模块。

不要随机 row split。

必须支持 group split。

group key 可以考虑：

    abstract world
    workflow template
    attack family
    policy graph
    counterfactual family
    semantic scenario signature

同一个 counterfactual family：

禁止跨：

    train
    validation
    test

同一 world 的轻微表面变体：

禁止一部分 train、一部分 test。

必须提供：

1. exact dedup
2. normalized dedup
3. structural dedup
4. semantic similarity audit

==================================================
十六、Split Strategy
==================================================

至少支持：

IID split

以及真正重要的：

WORLD-OOD

    unseen worlds

APP-OOD

    unseen application domains

WORKFLOW-OOD

    unseen workflows

POLICY-OOD

    unseen policy structures

ATTACK-OOD

    unseen attack/state failure combinations

EVIDENCE-OOD

    unseen evidence presentation

GENERATOR-OOD

未来如果使用多种生成器：

    train generator != test generator

正式 benchmark 必须优先使用 group-based / domain-based split。

==================================================
十七、数据质量 Gate
==================================================

每一个最终样本进入 release 前必须经过：

Gate 1
Schema validation

Gate 2
Reference integrity

所有引用 actor/resource/token/session 必须存在。

Gate 3
Policy executability

Gate 4
Oracle determinism

同一个样本执行多次：
必须得到相同输出。

Gate 5
Counterfactual consistency

关键 intervention：
应该产生预期变化。

Gate 6
Irrelevant invariance

无关 mutation：
不能改变 Oracle verdict。

Gate 7
Evidence sufficiency verification

如果标记 insufficient：
必须证明至少一个 required evidence 不可观察。

Gate 8
Leakage audit

Gate 9
Duplicate audit

Gate 10
Distribution summary

==================================================
十八、不要过早追求数量
==================================================

开发顺序：

Milestone 0

10 handcrafted worlds

用于验证：

    schema
    oracle
    counterfactual engine

Milestone 1

100 worlds

检查：

    program correctness

Milestone 2

500 AI-generated worlds

开始统计：

    diversity
    validity
    duplication

Milestone 3

1,000~3,000 worlds

此时才考虑：

    data release alpha

Milestone 4

5,000~10,000 worlds

正式规模。

不要一上来调用 Step-5-pre 生成 10k。

如果底层 schema 错误：

大量 token 将全部浪费。

==================================================
十九、Step-5-pre Token Efficiency
==================================================

Step-5-pre ≈ 30 output tokens/s。

因此：

1. prompt 尽量稳定复用
2. 输出严格结构化
3. 不要求长解释
4. 批量 worlds
5. 不让其输出重复 HTTP variants
6. 不让其负责简单字段随机化
7. 不让其写 Oracle label explanation 长文
8. 尽量让每个输出 token 带来新的业务逻辑信息

必须统计：

    output_tokens
    valid_worlds
    rejected_worlds
    valid_worlds_per_1k_tokens

建立指标：

    Generation Efficiency

例如：

GE =
accepted_unique_worlds /
output_tokens * 1000

后续根据指标优化 prompt。

==================================================
二十、Generator Provenance
==================================================

任何 AI 生成内容都必须保存 provenance。

至少：

    generator_model
    generator_model_version
    generation_timestamp
    prompt_version
    prompt_hash
    raw_generation_id
    decoding parameters
    validation outcome

数据集中不要依赖：

    “我们记得当时用了什么 prompt”。

==================================================
二十一、文件和仓库架构
==================================================

优先采用清晰、研究友好的结构。

例如：

aether-security-world/
│
├── README.md
│
├── pyproject.toml
│
├── configs/
│
├── schemas/
│   ├── world.schema.json
│   ├── episode.schema.json
│   ├── evidence.schema.json
│   └── release.schema.json
│
├── security_world/
│   ├── model/
│   ├── policy/
│   ├── oracle/
│   ├── invariants/
│   ├── workflows/
│   └── evidence/
│
├── generation/
│   ├── prompts/
│   ├── step5/
│   ├── parser/
│   ├── scheduler/
│   ├── retry/
│   └── provenance/
│
├── expansion/
│   ├── instantiate/
│   ├── counterfactual/
│   ├── masking/
│   ├── perturbation/
│   └── rendering/
│
├── validation/
│   ├── schema/
│   ├── oracle/
│   ├── consistency/
│   ├── leakage/
│   └── dedup/
│
├── datasets/
│   ├── raw/
│   ├── accepted/
│   ├── rejected/
│   ├── expanded/
│   └── releases/
│
├── analysis/
│   ├── coverage/
│   ├── diversity/
│   └── statistics/
│
├── tests/
│
└── scripts/

你可以根据实际工程进行修改。

不要为了遵循目录示例而牺牲架构质量。

==================================================
二十二、测试要求
==================================================

这是研究基础设施。

测试必须认真。

至少：

Unit tests

- policy evaluation
- ownership
- token lineage
- session revocation
- workflow transition
- evidence masking
- counterfactual mutation
- oracle
- renderer

Property-based tests

例如：

如果：

    owner == principal

并且：

    owner_only policy

其他所有必要条件满足，

则：

    owner authorization invariant

不应该被判 violation。

Metamorphic tests

例如：

修改：

    User-Agent

不能改变 ownership verdict。

修改：

    resource.owner

可能必须改变 verdict。

Determinism test

相同 world + seed：
必须产生相同程序扩增结果。

==================================================
二十三、安全要求
==================================================

所有数据默认：

    synthetic
    local
    authorized research

禁止系统实现：

- 自动扫描公网
- 自动测试未经授权目标
- 真实凭据采集
- 真实 token 获取
- 对外攻击执行器
- 自动利用真实第三方服务

真实漏洞数据未来只能通过：

    public datasets
    intentionally vulnerable apps
    authorized sandboxes

导入。

==================================================
二十四、Release
==================================================

每次冻结 release：

例如：

    ASW-v0.1
    ASW-v0.2
    ASW-v1.0

必须输出：

manifest.json

至少包括：

    release_id
    git_commit
    schema_version
    generator_prompt_hash
    source_world_count
    expanded_episode_count
    sample_count
    class_distribution
    attack_family_distribution
    app_distribution
    workflow_distribution
    evidence_distribution
    split_statistics
    rejected_count
    validation_summary
    file_sha256

一旦：

    v1.0-paper

被冻结：

不能修改。

任何修改：

    v1.1

==================================================
二十五、需要产生的统计数据
==================================================

每次 release 自动生成：

1. 样本数量
2. world 数量
3. episode 数量
4. app domain 分布
5. invariant 分布
6. attack family 分布
7. verdict 分布
8. evidence sufficiency 分布
9. episode 长度分布
10. counterfactual family 数量
11. average variants/world
12. rejected rate
13. duplicate rate
14. semantic similarity statistics
15. Step-5 token usage
16. accepted worlds / 1k output tokens
17. split overlap audit

输出：

    JSON
    CSV

图表放到后续 analysis 阶段。

==================================================
二十六、不要为了“论文创新”作弊
==================================================

非常重要。

当前工程阶段：

不要反向迎合某个希望得到的实验结论。

例如禁止：

    “为了提高 unknown recall，
     多生成一些特别容易识别的 unknown。”

数据设计依据应该是：

    security semantics

而不是：

    model weakness.

测试集更不能根据模型结果修改。

==================================================
二十七、第一阶段工程目标
==================================================

不要马上实现全部愿景。

第一阶段只完成：

A.

World Schema v0.1

B.

Policy + Invariant Engine

至少实现：

    ownership
    authorization
    session validity
    token lineage
    workflow state

C.

Deterministic Oracle

D.

Counterfactual Engine

支持：

    critical intervention
    irrelevant perturbation
    evidence masking

E.

10~30 个人工测试 worlds

F.

完整单元测试

G.

500-world Step-5 batch generator

但先不要真的生成 500。

只实现能力，并用少量调用测试。

==================================================
二十八、开发工作方式
==================================================

你不是一次性代码生成器。

你必须像真正的首席工程师一样工作。

开始前：

1. 审查项目目标
2. 写 architecture plan
3. 识别最大风险
4. 决定技术栈
5. 定义 schema
6. 定义 v0.1 范围

然后开始实现。

每完成一个阶段：

    run tests
    inspect failures
    fix
    continue

不要创建一堆占位文件然后宣布完成。

禁止：

    TODO-driven fake implementation

如果某模块没有真正实现：

明确标注：

    NOT IMPLEMENTED

==================================================
二十九、设计时重点质疑自己
==================================================

每做一个设计决定，都问：

1. 标签究竟是谁产生的？
2. AI 有没有偷偷参与 ground truth？
3. 这个 verdict 是否可以程序证明？
4. 这个 unknown 是否真的因为 evidence 不足？
5. counterfactual 是否只改变一个关键变量？
6. test 是否可能泄漏到 train？
7. 一个模型是否能仅靠模板特征猜标签？
8. 是否存在 generator fingerprint？
9. 数据是否过于人工、缺少业务语义？
10. 我们是否浪费了 Step-5-pre token 做程序就能完成的事情？

==================================================
三十、最终长期目标
==================================================

长期希望形成：

Step-5-pre
      │
      ▼
High-value Security World Seeds
      │
      ▼
Executable World Engine
      │
      ├────► Oracle
      │
      ├────► Counterfactual Engine
      │
      ├────► Evidence Masking
      │
      ├────► Observation Rendering
      │
      └────► Validation
                     │
                     ▼
              Frozen Dataset
                     │
                     ▼
              Training Lab
              （另一个项目）

目标最终可以得到：

    5k~10k high-quality worlds

程序扩展为：

    100k~500k high-quality episodes/samples

如果后续证明数据规模继续扩大会带来有效 scaling：

才扩展到：

    1M+

不要把“百万数据”作为第一阶段 KPI。

第一阶段 KPI 是：

    semantic richness
    oracle correctness
    counterfactual correctness
    leakage resistance
    reproducibility

==================================================
三十一、现在开始
==================================================

现在不要先调用 Step-5-pre 批量生成数据。

第一步：

请先完成一次全面设计审查。

输出：

1. 你对项目目标的准确理解
2. 当前方案中最危险的 10 个研究/工程风险
3. 推荐的总体架构
4. World Schema v0.1
5. Episode Schema v0.1
6. Evidence Schema v0.1
7. Policy / Invariant 表达方式
8. Oracle 设计
9. Counterfactual Engine 设计
10. Leakage-control 方案
11. Step-5-pre generator 设计
12. 第一阶段开发计划
13. 需要新增的测试
14. 第一阶段明确不做什么

先完成设计。

不要立刻大规模写代码。

等设计自检完毕后，再开始实现 Phase 1。

整个过程中，如果发现当前要求本身存在研究方法学缺陷，
必须明确指出，
不得为了迎合要求而继续实现一个有问题的设计。