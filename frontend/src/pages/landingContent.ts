export type LandingLanguage = 'en' | 'zh';

type Metric = {
    label: string;
    value: string;
    note?: string;
};

type Region = {
    name: string;
    role: string;
    latency: string;
    status: string;
};

export type LandingCopy = {
    language: {
        en: string;
        zh: string;
    };
    nav: Array<{ label: string; href: string }>;
    login: string;
    hero: {
        badge: string;
        title: string;
        description: string;
        primaryCta: string;
        secondaryCta: string;
        chips: string[];
        metrics: Metric[];
        fabricEyebrow: string;
        fabricTitle: string;
        fabricDescription: string;
        fabricSignals: Array<{ label: string; value: string; note: string }>;
        orbitCards: Array<{ eyebrow: string; title: string; description: string }>;
    };
    whyNow: {
        eyebrow: string;
        title: string;
        description: string;
        pressures: Array<{ title: string; description: string }>;
        manifestoTitle: string;
        manifestoBody: string;
        manifestoPoints: string[];
    };
    pillars: {
        eyebrow: string;
        title: string;
        description: string;
        items: Array<{
            eyebrow: string;
            title: string;
            description: string;
            bullets: string[];
            statLabel: string;
            statValue: string;
        }>;
    };
    surfaces: {
        eyebrow: string;
        title: string;
        description: string;
        items: Array<{
            eyebrow: string;
            title: string;
            description: string;
            bullets: string[];
            metrics: Metric[];
            railTitle: string;
            railDescription: string;
            railLines: string[];
        }>;
    };
    journey: {
        eyebrow: string;
        title: string;
        description: string;
        steps: Array<{
            step: string;
            title: string;
            description: string;
            detail: string;
        }>;
    };
    infrastructure: {
        eyebrow: string;
        title: string;
        description: string;
        stats: Metric[];
        regions: Region[];
        deviceEyebrow: string;
        deviceTitle: string;
        deviceDescription: string;
        deviceRows: Array<{ label: string; value: string }>;
        deviceBadges: string[];
        calloutTitle: string;
        calloutDescription: string;
    };
    cta: {
        eyebrow: string;
        title: string;
        description: string;
        primary: string;
        secondary: string;
        cards: Array<{ label: string; title: string }>;
    };
    footer: {
        tagline: string;
        privacy: string;
        terms: string;
        copyright: string;
    };
};

const content: Record<LandingLanguage, LandingCopy> = {
    en: {
        language: {
            en: 'EN',
            zh: '中文',
        },
        nav: [
            { label: 'Product Surfaces', href: 'product-surfaces' },
            { label: 'Workflow', href: 'workflow' },
            { label: 'Edge & Deploy', href: 'edge-and-deploy' },
        ],
        login: 'Login',
        hero: {
            badge: 'AI security operating surface',
            title: 'Security that can intercept, reason, and execute in one decision loop.',
            description: 'AetherGuard is a product for teams running model traffic in production. It unifies observation, adjudication, and edge enforcement so security decisions stop living in disconnected tools.',
            primaryCta: 'View product surfaces',
            secondaryCta: 'Enter console',
            chips: ['Traffic interception', 'Multi-agent adjudication', 'Edge policy control'],
            metrics: [
                { label: 'Decision layers', value: '7', note: 'Structured reasoning pipeline' },
                { label: 'Median policy latency', value: '<5ms', note: 'Live interception path' },
                { label: 'Red-team vectors', value: '30+', note: 'Simulation-ready attack set' },
            ],
            fabricEyebrow: 'Operating view',
            fabricTitle: 'AetherGuard operating fabric',
            fabricDescription: 'Three product surfaces share one decision loop: signal intake, reasoning, and edge action.',
            fabricSignals: [
                { label: 'Model ingress', value: '18.4k req/min', note: 'Observed and classified in real time' },
                { label: 'Policy arbitration', value: '4.7ms avg', note: 'Consensus and enforcement routing' },
                { label: 'Edge gateways', value: '128 nodes', note: 'Protected devices and branch runtimes' },
            ],
            orbitCards: [
                {
                    eyebrow: 'Intercept',
                    title: 'See model traffic before it becomes incident response.',
                    description: 'Requests, prompts, payloads, and runtime context are collected into one visible ingress surface.',
                },
                {
                    eyebrow: 'Adjudicate',
                    title: 'Force decisions through adversarial review, not one-shot intuition.',
                    description: 'Multiple agents debate, simulate, and synthesize before a policy verdict is accepted.',
                },
                {
                    eyebrow: 'Enforce',
                    title: 'Ship the answer to gateways, policies, and live controls.',
                    description: 'The same decision surface drives alerts, edge runtimes, and hardware-linked enforcement.',
                },
            ],
        },
        whyNow: {
            eyebrow: 'Why this product exists',
            title: 'AI traffic is already production traffic. Most security stacks still treat it as an afterthought.',
            description: 'The problem is no longer model quality alone. Teams now need one place to watch model requests, challenge risky decisions, and push policy to live edge infrastructure.',
            pressures: [
                {
                    title: 'Traffic arrives before policy catches up',
                    description: 'Most teams can see incidents only after requests hit the model, return results, or damage downstream systems.',
                },
                {
                    title: 'Reasoning and enforcement are split apart',
                    description: 'Detection lives in dashboards while controls live somewhere else, making every response slower and less accountable.',
                },
                {
                    title: 'Edge and model governance are treated as separate products',
                    description: 'Gateway health, runtime trust, and AI request policy rarely share the same evidence model or operator workflow.',
                },
            ],
            manifestoTitle: 'A product, not a theme.',
            manifestoBody: 'AetherGuard is designed as one operating surface for teams that need to observe, challenge, and act on AI traffic without stitching together point tools.',
            manifestoPoints: [
                'One evidence model across requests, agents, and devices',
                'One product language across traffic, simulation, and edge runtime',
                'One operator workflow from intake to policy execution',
            ],
        },
        pillars: {
            eyebrow: 'Core system',
            title: 'Three product pillars define the platform.',
            description: 'Each pillar solves a different failure mode, but all three are connected to the same runtime evidence and policy loop.',
            items: [
                {
                    eyebrow: 'Pillar 01',
                    title: 'Observe every model interaction.',
                    description: 'The platform treats prompts, payloads, and runtime metadata as first-class security signals instead of backend exhaust.',
                    bullets: [
                        'Request- and session-level intake with visible context',
                        'Traffic segmentation by model, route, and risk',
                        'Cross-surface visibility into alerts, scans, and device state',
                    ],
                    statLabel: 'Coverage',
                    statValue: 'Live ingress',
                },
                {
                    eyebrow: 'Pillar 02',
                    title: 'Reason through contested evidence.',
                    description: 'High-risk cases are challenged through role-separated analysis, adversarial debate, and simulation before action is taken.',
                    bullets: [
                        'Seven-layer reasoning pipeline for complex cases',
                        'Built-in attack simulation and red-team validation',
                        'Consensus output with traceable decision context',
                    ],
                    statLabel: 'Engine',
                    statValue: 'Multi-agent',
                },
                {
                    eyebrow: 'Pillar 03',
                    title: 'Execute policy where the risk actually lives.',
                    description: 'Outputs are not left in reporting surfaces. They are turned into edge actions, gateway controls, and enforceable runtime decisions.',
                    bullets: [
                        'Device-aware policy distribution',
                        'Hardware-backed edge trust and secure runtime state',
                        'Linked controls across traffic, alerts, and board status',
                    ],
                    statLabel: 'Outcome',
                    statValue: 'Edge enforced',
                },
            ],
        },
        surfaces: {
            eyebrow: 'Product surfaces',
            title: 'Three product surfaces expose the system from different angles.',
            description: 'The homepage no longer pretends to be the console. Instead, it shows the product as a coordinated set of surfaces built for operators.',
            items: [
                {
                    eyebrow: 'Surface 01',
                    title: 'Traffic Interceptor',
                    description: 'The traffic surface shows request flow, protocol mix, and severity pressure before incidents spread downstream.',
                    bullets: [
                        'Observe live request paths and suspicious protocol splits',
                        'Connect anomalies to cases, alerts, and device context',
                        'Route risky flows into the reasoning system without context loss',
                    ],
                    metrics: [
                        { label: 'Observed flows', value: '2.4M/s' },
                        { label: 'Policy triggers', value: '314' },
                    ],
                    railTitle: 'Ingress fabric',
                    railDescription: 'Signals moving from raw traffic to policy decision.',
                    railLines: [
                        'Gateway intake -> severity scoring -> arbitration queue',
                        'Suspicious replay burst isolated in 180 ms',
                        'Prompt payload linked to regional policy footprint',
                    ],
                },
                {
                    eyebrow: 'Surface 02',
                    title: 'Attack Simulator',
                    description: 'Operators can verify policy readiness with structured adversarial scenarios instead of waiting for production failure.',
                    bullets: [
                        'Replay common jailbreak, prompt injection, and payload vectors',
                        'Compare policy revisions against prior attack outcomes',
                        'Push validated changes back into the same decision loop',
                    ],
                    metrics: [
                        { label: 'Vector library', value: '30+' },
                        { label: 'Latest batch', value: '11m ago' },
                    ],
                    railTitle: 'Adversarial validation',
                    railDescription: 'Simulation results that feed real production policy.',
                    railLines: [
                        'Scenario graph built from recent incident classes',
                        'Consensus blocked 96.3% of regression payloads',
                        'Policy delta prepared for controlled rollout',
                    ],
                },
                {
                    eyebrow: 'Surface 03',
                    title: 'Devices & Board Status',
                    description: 'Edge hardware is part of the same product surface, so runtime trust and AI request controls share one operational picture.',
                    bullets: [
                        'Track gateway integrity, sync state, and enforcement readiness',
                        'Bind policy distribution to board health and trust posture',
                        'Treat hardware runtime as security state, not inventory metadata',
                    ],
                    metrics: [
                        { label: 'Protected boards', value: '128' },
                        { label: 'Sync health', value: '99.2%' },
                    ],
                    railTitle: 'Edge runtime',
                    railDescription: 'Hardware-backed enforcement linked to the policy graph.',
                    railLines: [
                        'Secure boot verified across active branch nodes',
                        'Key rotation staged with next policy wave',
                        'Device trust state attached to enforcement logs',
                    ],
                },
            ],
        },
        journey: {
            eyebrow: 'How it works',
            title: 'A request moves through one explicit product journey.',
            description: 'The workflow is designed to keep context intact from first observation to final action, even when humans and multiple agents are involved.',
            steps: [
                {
                    step: 'Step 01',
                    title: 'Observe',
                    description: 'Capture request, payload, route, and runtime evidence as one case record.',
                    detail: 'Signals are normalized before they become alerts.',
                },
                {
                    step: 'Step 02',
                    title: 'Challenge',
                    description: 'Escalate contested or high-risk cases into debate, simulation, and role-separated analysis.',
                    detail: 'Multiple agents are forced to disagree before consensus.',
                },
                {
                    step: 'Step 03',
                    title: 'Decide',
                    description: 'Synthesize a policy verdict with visible rationale, probability, and operational context.',
                    detail: 'The output is traceable, reviewable, and ready for action.',
                },
                {
                    step: 'Step 04',
                    title: 'Execute',
                    description: 'Push the decision into traffic controls, alerting, and edge runtime enforcement.',
                    detail: 'One loop closes the gap between reasoning and deployment.',
                },
            ],
        },
        infrastructure: {
            eyebrow: 'Infrastructure & edge',
            title: 'Global deployment and edge trust sit inside the same story.',
            description: 'The platform is meant to live across regions, branch runtimes, and dedicated gateways without losing policy coherence.',
            stats: [
                { label: 'Operational regions', value: '3', note: 'US, EU, APAC' },
                { label: 'Average coordination time', value: '4.7ms', note: 'Inter-region decision bus' },
                { label: 'Edge trust posture', value: 'Verified', note: 'Secure boot and key rotation aligned' },
            ],
            regions: [
                { name: 'US-WEST', role: 'Traffic screening and initial policy routing', latency: '12ms', status: 'Operational' },
                { name: 'EU-CENTRAL', role: 'Consensus, evidence synthesis, and review', latency: '24ms', status: 'Operational' },
                { name: 'ASIA-PAC', role: 'Edge coordination and gateway delivery', latency: '45ms', status: 'Operational' },
            ],
            deviceEyebrow: 'Edge runtime',
            deviceTitle: 'Edge control card',
            deviceDescription: 'A dedicated device view keeps runtime trust close to live policy distribution.',
            deviceRows: [
                { label: 'Chipset', value: 'ESP32-S3 secure element' },
                { label: 'Policy sync', value: '2 minutes ago' },
                { label: 'Key rotation', value: 'Scheduled for next wave' },
                { label: 'Integrity state', value: 'Verified across active nodes' },
            ],
            deviceBadges: ['Secure boot', 'Hardware trust root', 'Policy-linked runtime'],
            calloutTitle: 'Hardware-linked policy state',
            calloutDescription: 'Edge trust is treated as live policy context, not a detached asset inventory field.',
        },
        cta: {
            eyebrow: 'Final call',
            title: 'Move from fragmented AI security tooling to one operating product.',
            description: 'Review the product, enter the console, and see the same system continue from public narrative to operator workflow.',
            primary: 'Enter console',
            secondary: 'Read privacy policy',
            cards: [
                { label: 'Signal', title: 'Traffic, alerts, and payload evidence' },
                { label: 'Reason', title: 'Debate, simulate, and synthesize policy verdicts' },
                { label: 'Execute', title: 'Push the answer to live edge and runtime controls' },
            ],
        },
        footer: {
            tagline: 'Built by Aether Studio',
            privacy: 'Privacy',
            terms: 'Terms',
            copyright: 'Copyright 2026 AetherGuard. All rights reserved.',
        },
    },
    zh: {
        language: {
            en: 'EN',
            zh: '中文',
        },
        nav: [
            { label: '产品界面', href: 'product-surfaces' },
            { label: '工作方式', href: 'workflow' },
            { label: '边缘与部署', href: 'edge-and-deploy' },
        ],
        login: '登录',
        hero: {
            badge: 'AI 安全操作界面',
            title: '把拦截、推理、仲裁与执行收进同一条决策链。',
            description: 'AetherGuard 面向已经把模型流量放进生产环境的团队。它把观测、裁决与边缘执行合并到同一个产品里，不再让安全决策散落在互不相连的工具中。',
            primaryCta: '查看产品界面',
            secondaryCta: '进入控制台',
            chips: ['流量拦截', '多智能体仲裁', '边缘策略控制'],
            metrics: [
                { label: '决策层数', value: '7', note: '结构化推理链路' },
                { label: '中位策略延迟', value: '<5ms', note: '实时拦截路径' },
                { label: '红队向量', value: '30+', note: '可直接演练的攻击集合' },
            ],
            fabricEyebrow: '运行视图',
            fabricTitle: 'AetherGuard 决策织面',
            fabricDescription: '三条产品界面共享同一条决策链：信号进入、推理仲裁、边缘执行。',
            fabricSignals: [
                { label: '模型入口流量', value: '18.4k 次/分钟', note: '实时观测并分类' },
                { label: '策略仲裁', value: '平均 4.7ms', note: '共识与执行路由' },
                { label: '边缘网关', value: '128 个节点', note: '受保护设备与分支运行时' },
            ],
            orbitCards: [
                {
                    eyebrow: '拦截',
                    title: '在问题变成事故之前看见模型流量。',
                    description: '请求、提示词、载荷和运行时上下文被收进同一个可见入口面，而不是事后再从日志里补证据。',
                },
                {
                    eyebrow: '仲裁',
                    title: '让高风险判断经过对抗式复核，而不是一次性直觉输出。',
                    description: '多个智能体会在真正下发策略前完成辩论、推演与综合判定。',
                },
                {
                    eyebrow: '执行',
                    title: '把结果真正送到网关、策略和边缘控制面。',
                    description: '同一条决策链同时驱动告警、边缘运行时和硬件绑定的执行逻辑。',
                },
            ],
        },
        whyNow: {
            eyebrow: '为什么现在必须做',
            title: 'AI 流量已经是生产流量，但多数安全栈仍把它当作附属问题。',
            description: '现在的核心问题已经不只是模型质量，而是团队需要一个地方同时看见模型请求、挑战高风险决策，并把策略推到真实的边缘基础设施。',
            pressures: [
                {
                    title: '流量先发生，策略后补位',
                    description: '很多团队只有在请求进入模型、结果返回甚至影响下游系统之后，才开始看到安全问题。',
                },
                {
                    title: '推理和执行被拆成两张皮',
                    description: '检测在一个看板里，控制在另一个系统里，每一次响应都更慢、更难追责。',
                },
                {
                    title: '边缘治理和模型治理被当成两套产品',
                    description: '网关健康、运行时信任和 AI 请求策略很少共用同一套证据模型与操作流程。',
                },
            ],
            manifestoTitle: '这是一套产品，不是一组主题词。',
            manifestoBody: 'AetherGuard 被设计成一个统一的操作界面，让团队可以在同一条链路里观察、质证并执行 AI 安全决策，而不是再拼接零散点工具。',
            manifestoPoints: [
                '请求、智能体与设备共用一套证据模型',
                '流量、演练与边缘运行时共用一套产品语言',
                '从信号进入到策略执行只走一条操作路径',
            ],
        },
        pillars: {
            eyebrow: '核心系统',
            title: '平台由三条产品支柱组成。',
            description: '每条支柱都解决不同的失效模式，但它们共享同一套运行证据与策略闭环。',
            items: [
                {
                    eyebrow: '支柱 01',
                    title: '把每一次模型交互都变成可观测对象。',
                    description: '平台把提示词、载荷和运行时元数据视为一等安全信号，而不是后台废料。',
                    bullets: [
                        '以请求和会话为粒度采集上下文',
                        '按模型、路由和风险切分流量',
                        '把告警、扫描和设备状态接进同一视图',
                    ],
                    statLabel: '覆盖面',
                    statValue: '实时入口',
                },
                {
                    eyebrow: '支柱 02',
                    title: '让有争议的证据经过结构化推理。',
                    description: '高风险案例会进入角色拆分分析、对抗辩论和攻击推演，不再依赖一次性判断。',
                    bullets: [
                        '七层推理链路处理复杂案例',
                        '内建攻击演练与红队校验',
                        '输出可追踪的共识判定',
                    ],
                    statLabel: '引擎',
                    statValue: '多智能体',
                },
                {
                    eyebrow: '支柱 03',
                    title: '把策略真正执行到风险所在的位置。',
                    description: '结果不会停留在报告页面，而是直接变成边缘动作、网关控制与可执行运行时策略。',
                    bullets: [
                        '面向设备状态的策略分发',
                        '硬件信任根绑定边缘运行时',
                        '流量、告警与板卡状态联动执行',
                    ],
                    statLabel: '结果',
                    statValue: '边缘落地',
                },
            ],
        },
        surfaces: {
            eyebrow: '产品界面',
            title: '三条产品界面从不同角度打开同一套系统。',
            description: '新版首页不再伪装成控制台，而是把产品作为一组协同界面讲清楚，便于外部理解和内部落地。',
            items: [
                {
                    eyebrow: '界面 01',
                    title: 'Traffic Interceptor',
                    description: '流量界面在事故扩散之前展示请求流向、协议分布和风险压力。',
                    bullets: [
                        '观察实时请求路径和异常协议分布',
                        '把异常直接串到案例、告警和设备上下文',
                        '在不丢上下文的前提下把高风险流量送入推理系统',
                    ],
                    metrics: [
                        { label: '观测流量', value: '2.4M/秒' },
                        { label: '策略触发', value: '314' },
                    ],
                    railTitle: '入口信号面',
                    railDescription: '从原始流量到策略判定的信号迁移。',
                    railLines: [
                        '网关入口 -> 风险评分 -> 仲裁队列',
                        '异常重放突发流量在 180ms 内被隔离',
                        '提示词载荷与区域策略足迹完成关联',
                    ],
                },
                {
                    eyebrow: '界面 02',
                    title: 'Attack Simulator',
                    description: '运营人员可以通过结构化对抗场景验证策略准备度，而不是等生产环境失败后补洞。',
                    bullets: [
                        '重放越狱、提示注入和载荷攻击向量',
                        '对比新旧策略在历史攻击结果上的差异',
                        '把通过验证的策略直接送回生产决策闭环',
                    ],
                    metrics: [
                        { label: '向量库', value: '30+' },
                        { label: '最近批次', value: '11 分钟前' },
                    ],
                    railTitle: '对抗验证面',
                    railDescription: '演练结果直接反哺真实生产策略。',
                    railLines: [
                        '场景图按近期事件类型自动组装',
                        '共识系统拦截 96.3% 的回归载荷',
                        '策略差异已进入受控发布准备',
                    ],
                },
                {
                    eyebrow: '界面 03',
                    title: 'Devices & Board Status',
                    description: '边缘硬件属于同一套产品界面，因此运行时信任和 AI 请求控制共享一张操作图。',
                    bullets: [
                        '追踪网关完整性、同步状态与执行准备度',
                        '把策略分发和板卡健康、信任姿态绑定起来',
                        '把硬件运行时当作安全状态而不是库存元数据',
                    ],
                    metrics: [
                        { label: '受保护板卡', value: '128' },
                        { label: '同步健康度', value: '99.2%' },
                    ],
                    railTitle: '边缘运行面',
                    railDescription: '硬件信任根与策略图直接联动。',
                    railLines: [
                        '活跃分支节点均已完成安全启动验证',
                        '密钥轮换随下一轮策略波次准备发布',
                        '设备信任状态已写入执行日志',
                    ],
                },
            ],
        },
        journey: {
            eyebrow: '工作方式',
            title: '一次请求会沿着一条明确的产品路径流动。',
            description: '这条链路的目标是让上下文从第一眼观测到最终动作都保持完整，即使过程中有多智能体和人工复核参与。',
            steps: [
                {
                    step: '步骤 01',
                    title: 'Observe',
                    description: '把请求、载荷、路由和运行时证据收进同一个案例记录。',
                    detail: '信号先被标准化，再进入告警与决策。',
                },
                {
                    step: '步骤 02',
                    title: 'Challenge',
                    description: '把高风险或有争议的案例送进辩论、推演和角色拆分分析。',
                    detail: '多个智能体会被强制置于不同立场后再收敛。',
                },
                {
                    step: '步骤 03',
                    title: 'Decide',
                    description: '在可见的推理上下文里综合出策略结论、概率与执行意图。',
                    detail: '输出可追踪、可复核、可直接下发。',
                },
                {
                    step: '步骤 04',
                    title: 'Execute',
                    description: '把结果推到流量控制、告警系统与边缘运行时。',
                    detail: '同一条链路填平推理与部署之间的断层。',
                },
            ],
        },
        infrastructure: {
            eyebrow: '边缘与部署',
            title: '全球部署和边缘信任被放在同一个产品叙事里。',
            description: '这套平台本来就应该跨区域、分支运行时和专用网关协同工作，而且不能因此失去策略一致性。',
            stats: [
                { label: '运行区域', value: '3', note: '美西、欧洲、亚太' },
                { label: '平均协同时间', value: '4.7ms', note: '跨区域决策总线' },
                { label: '边缘信任状态', value: '已验证', note: '安全启动与密钥轮换对齐' },
            ],
            regions: [
                { name: 'US-WEST', role: '流量筛查与初始策略路由', latency: '12ms', status: '运行中' },
                { name: 'EU-CENTRAL', role: '共识综合、证据合成与复核', latency: '24ms', status: '运行中' },
                { name: 'ASIA-PAC', role: '边缘协调与网关投递', latency: '45ms', status: '运行中' },
            ],
            deviceEyebrow: '边缘运行时',
            deviceTitle: '边缘控制卡片',
            deviceDescription: '专门的设备视图让运行时信任始终贴着真实的策略分发流程。',
            deviceRows: [
                { label: '芯片组', value: 'ESP32-S3 安全元件' },
                { label: '策略同步', value: '2 分钟前' },
                { label: '密钥轮换', value: '下一轮波次已排程' },
                { label: '完整性状态', value: '活跃节点全部已验证' },
            ],
            deviceBadges: ['安全启动', '硬件信任根', '策略联动运行时'],
            calloutTitle: '硬件绑定的策略状态',
            calloutDescription: '边缘信任被视为实时策略上下文，而不是游离在外的资产字段。',
        },
        cta: {
            eyebrow: '最后一段',
            title: '把割裂的 AI 安全工具链收成一套真正可操作的产品。',
            description: '先理解产品，再进入控制台，你会看到同一套系统如何从公开叙事自然延续到运营工作流。',
            primary: '进入控制台',
            secondary: '查看隐私政策',
            cards: [
                { label: '信号', title: '流量、告警与载荷证据' },
                { label: '推理', title: '辩论、推演并综合策略结论' },
                { label: '执行', title: '把答案推向边缘与运行时控制面' },
            ],
        },
        footer: {
            tagline: 'Aether Studio 出品',
            privacy: '隐私政策',
            terms: '服务条款',
            copyright: 'Copyright 2026 AetherGuard. 保留所有权利。',
        },
    },
};

export const getLandingCopy = (language: LandingLanguage) => content[language];
