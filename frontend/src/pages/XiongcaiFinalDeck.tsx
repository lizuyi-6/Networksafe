import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft,
    ArrowRight,
    Award,
    Building2,
    CheckCircle2,
    CircuitBoard,
    Cpu,
    Expand,
    FileText,
    LockKeyhole,
    MonitorCheck,
    Network,
    ShieldCheck,
    Sparkles,
} from 'lucide-react';

type EvidenceLevel = 'repo' | 'inferred' | 'placeholder';
type SlideLayout = 'hero' | 'statement' | 'problem' | 'solution' | 'innovation' | 'proof' | 'business' | 'xiongan' | 'roadmap' | 'summary' | 'architecture' | 'team';

type SlideVisual =
    | { type: 'image'; src: string; alt: string; caption: string }
    | { type: 'imageGrid'; images: Array<{ src: string; alt: string; caption: string }> }
    | { type: 'flow'; steps: string[] }
    | { type: 'metrics'; items: Array<{ value: string; label: string; note: string }> }
    | { type: 'timeline'; items: Array<{ title: string; text: string }> };

type Slide = {
    title: string;
    kicker: string;
    claim: string;
    bullets: string[];
    visual: SlideVisual;
    speakerNote: string;
    evidenceLevel: EvidenceLevel;
    layout: SlideLayout;
    hidden?: boolean;
};

const pitch = (name: string) => `/pitch/${name}`;

const slides: Slide[] = [
    {
        title: 'AetherGuard',
        kicker: '雄才杯决赛路演 · 聚雄才 创未来',
        claim: '面向雄安新区数字基础设施的智能服务器安全防御平台',
        bullets: ['服务器安全', '分布式 Agent', 'AI 决策与演练', 'ESP32 物理确认门'],
        visual: { type: 'image', src: pitch('02-dashboard.png'), alt: 'AetherGuard dashboard', caption: '已有控制台界面，可用于现场连续演示' },
        speakerNote: '开场只做一句定义：我们不是单点安全工具，而是把风险识别、判断、处置和物理确认放进同一条闭环。',
        evidenceLevel: 'repo',
        layout: 'hero',
    },
    {
        title: '决赛一句话',
        kicker: '从想法走到可落地产品',
        claim: '我们解决的是关键服务器操作缺少可信确认的安全断点。',
        bullets: [
            '高危操作一旦被远程账号或服务器权限劫持，纯软件确认容易被绕过',
            'AetherGuard 把危险动作接入串口硬件确认，要求人到现场按键',
            '即使服务端被入侵，攻击者也无法远程完成 destructive action',
        ],
        visual: { type: 'flow', steps: ['风险动作发起', '平台生成确认请求', 'ESP32 本地显示', '人工按键确认', '审计留痕执行'] },
        speakerNote: '这一页要把差异化讲透：硬件不是装饰，而是不可远程替代的最后确认环节。',
        evidenceLevel: 'repo',
        layout: 'statement',
    },
    {
        title: '行业痛点',
        kicker: '为什么需要新的服务器安全做法',
        claim: '安全需求在增强，但中小团队的安全人力、预算和响应能力没有同步增长。',
        bullets: [
            '安全能力分散在扫描、告警、日志、部署、审计等多个工具里',
            '高风险操作缺少独立可信确认，事后追责强，事前阻断弱',
            '私有化和本地化场景不愿把安全日志完整外发到云端',
            '传统方案更偏专家工具，中小团队落地和持续运营成本高',
        ],
        visual: {
            type: 'metrics',
            items: [
                { value: '碎片化', label: '工具堆叠', note: '安全动作分散，难以闭环' },
                { value: '滞后', label: '响应机制', note: '发现、判断、执行割裂' },
                { value: '弱确认', label: '高危操作', note: '远程权限一旦失守风险放大' },
                { value: '难私有化', label: '数据顾虑', note: '敏感日志和链路不愿外发' },
            ],
        },
        speakerNote: '不要堆市场大数字，聚焦评委能理解的真实采用障碍。',
        evidenceLevel: 'inferred',
        layout: 'problem',
    },
    {
        title: '整体方案',
        kicker: '一条闭环，不是几个孤立功能',
        claim: '控制平面、分布式 Agent、AI 分析和 ESP32 硬件门共同组成主动防御闭环。',
        bullets: [
            '前端控制台统一管理节点、站点、设备、扫描、告警与审计',
            '后端控制平面承接认证、实时通信、任务编排和结果沉淀',
            'Agent 更接近业务服务器现场，降低只靠边界设备的盲区',
            'ESP32 通过串口 allow-list 协议承接高风险动作的物理确认',
        ],
        visual: { type: 'flow', steps: ['控制台', '控制平面', 'Agent / 站点 / 设备', 'AI 判断与演练', '物理确认与审计'] },
        speakerNote: '强调系统已经具备平台级结构，不是临时拼出来的演示页面。',
        evidenceLevel: 'repo',
        layout: 'solution',
    },
    {
        title: '创新一：Agent-Inside',
        kicker: '把防护前移到业务服务器侧',
        claim: '防护位置越接近真实运行上下文，越容易做出及时、可追溯的安全动作。',
        bullets: [
            '统一查看 Agent 心跳、资源状态、风险事件和节点详情',
            '适合覆盖多站点、多服务器实例和分布式业务节点',
            '与扫描、告警、审计联动，避免安全信息停留在孤立列表',
        ],
        visual: { type: 'image', src: pitch('03-agents.png'), alt: 'Agent list screen', caption: 'Agent 管理界面：节点状态和运行信息已纳入平台' },
        speakerNote: '不要说替代所有边界设备，讲清楚这是主机侧内生防护思路。',
        evidenceLevel: 'repo',
        layout: 'innovation',
    },
    {
        title: '创新二：ESP32 物理确认门',
        kicker: '危险操作必须有人在现场',
        claim: '硬件确认把纯软件信任链延伸到物理世界，给高危动作增加不可远程伪造的门槛。',
        bullets: [
            'ESP32 只通过 USB-TTL 串口通信，不暴露网络控制面',
            '协议采用 allow-list：AG:REQ 到 AG:BEGIN / STEP / OK / ERR',
            '适用于安装/卸载 Agent、擦除数据、关键配置变更等危险动作',
            '平台侧保留设备状态、执行过程和证据记录，便于审计',
        ],
        visual: { type: 'image', src: pitch('07-devices.png'), alt: 'Devices screen', caption: '设备管理界面：硬件节点被纳入安全闭环' },
        speakerNote: '这是决赛最强差异化页，语言要稳：当前是原型和链路设计，不夸大为量产硬件。',
        evidenceLevel: 'repo',
        layout: 'innovation',
    },
    {
        title: '创新三：AI 监控与演练闭环',
        kicker: '从告警走向可验证判断',
        claim: 'AI 不是替代专家，而是把可配置、可演练、可复盘的分析路径放进平台。',
        bullets: [
            'Agent Monitor、模型配置和攻击模拟器形成智能分析入口',
            '攻击演练用于验证防护策略，而不是只做静态展示',
            '本地化与私有化模型路径有利于敏感安全日志留在企业边界内',
        ],
        visual: { type: 'image', src: pitch('05-agent-monitor.png'), alt: 'Agent monitor screen', caption: 'AI 与 Agent 监控界面：为持续优化提供入口' },
        speakerNote: '避免宣称 AI 已经完全自动替代安全专家，强调可配置和可验证。',
        evidenceLevel: 'repo',
        layout: 'innovation',
    },
    {
        title: '产品证据',
        kicker: '决赛不是只讲概念',
        claim: '从总览、部署、扫描到告警和后台，项目已经形成可连续演示的产品链路。',
        bullets: [
            '已有 React 前端、Node/TypeScript 后端、Socket.IO 实时链路和硬件目录',
            '页面覆盖 Dashboard、Agents、Devices、Deployment、Scanner、Alerts、Admin',
            '仓库内已有运行截图、双创答辩文档、硬件说明和生成式 PPT 脚本',
        ],
        visual: {
            type: 'imageGrid',
            images: [
                { src: pitch('02-dashboard.png'), alt: 'Dashboard', caption: '总览' },
                { src: pitch('11-deployment.png'), alt: 'Deployment', caption: '部署' },
                { src: pitch('12-scanner.png'), alt: 'Scanner', caption: '扫描' },
                { src: pitch('14-alerts.png'), alt: 'Alerts', caption: '告警' },
                { src: pitch('17-admin.png'), alt: 'Admin', caption: '后台' },
                { src: pitch('07-devices.png'), alt: 'Devices', caption: '设备' },
            ],
        },
        speakerNote: '这页用于建立可信度：能展示、能讲链路、能继续打磨。',
        evidenceLevel: 'repo',
        layout: 'proof',
    },
    {
        title: '商业模式',
        kicker: '从项目到可持续运营',
        claim: '以软件订阅建立持续收入，以硬件配套形成差异化，以私有化交付和安全服务承接高价值客户。',
        bullets: [
            '软件订阅：按节点、站点或企业版本提供持续防护与运营能力',
            '硬件配套：ESP32 确认门作为部署包和高危操作安全配件',
            '私有化交付：面向政企、园区、信创和合规敏感场景',
            '增值服务：安全配置、演练验证、合规材料和响应支持',
        ],
        visual: {
            type: 'metrics',
            items: [
                { value: '订阅', label: '软件平台', note: '持续运营与升级' },
                { value: '硬件', label: '物理确认', note: '强化差异化和客单价' },
                { value: '交付', label: '私有化部署', note: '适配敏感行业' },
                { value: '服务', label: '安全运营', note: '试点后沉淀案例' },
            ],
        },
        speakerNote: '商业模式写方向，不承诺没有验证的收入数字。',
        evidenceLevel: 'inferred',
        layout: 'business',
    },
    {
        title: '为什么适合雄安',
        kicker: '新一代信息技术 × 人工智能 × 数字城市安全',
        claim: 'AetherGuard 可以服务新区数字基础设施、AI 应用安全和园区企业服务器防护。',
        bullets: [
            '匹配雄才杯新一代信息技术、人工智能软件与系统服务方向',
            '适合数字城市、园区平台、信创环境和政企私有化安全需求',
            '硬件确认门让关键运维动作更可控、更可审计、更适合高可信场景',
            '如果落地雄安，优先寻找园区服务器、创新企业和示范应用试点',
        ],
        visual: {
            type: 'metrics',
            items: [
                { value: '数字城市', label: '基础设施', note: '服务器和应用链路保护' },
                { value: 'AI 安全', label: '智能应用', note: '模型与流量的运营治理' },
                { value: '信创适配', label: '私有化', note: '数据留在本地边界' },
                { value: '园区试点', label: '成果转化', note: '从示范场景切入复制' },
            ],
        },
        speakerNote: '把项目从泛网络安全拉回雄安：新区需要的是可试点、可复制、可转化的技术项目。',
        evidenceLevel: 'inferred',
        layout: 'xiongan',
    },
    {
        title: '阶段成果与下一步',
        kicker: '从可演示走向可试点',
        claim: '当前已经具备代码、界面、文档和硬件原型基础，下一阶段聚焦试点验证和交付收敛。',
        bullets: [
            '已完成核心前端页面、后端模块、硬件目录和答辩材料沉淀',
            '短期目标：完成决赛演示链路、硬件确认流程和部署证据闭环',
            '中期目标：选择 1-2 个服务器场景做小规模试点',
            '长期目标：形成可复制的私有化安全运营包',
        ],
        visual: {
            type: 'timeline',
            items: [
                { title: '现在', text: '可演示平台与硬件原型' },
                { title: '决赛后', text: '打磨部署、确认、审计闭环' },
                { title: '试点期', text: '接入真实服务器场景' },
                { title: '复制期', text: '沉淀交付包和行业案例' },
            ],
        },
        speakerNote: '路线图不要贪大，决赛最关心能否向试点走。',
        evidenceLevel: 'repo',
        layout: 'roadmap',
    },
    {
        title: '总结',
        kicker: '冲奖收束',
        claim: 'AetherGuard 的价值在于：技术有差异、产品可演示、场景能落地、团队可推进。',
        bullets: [
            '差异化：软硬件一体化物理确认门',
            '可实现：已有连续产品界面和仓库材料支撑',
            '可落地：从服务器安全和高危运维确认切入雄安数字场景',
            '可推进：下一步聚焦试点验证，不停留在概念页',
        ],
        visual: { type: 'flow', steps: ['痛点真实', '方案成形', '创新明确', '产品可演示', '雄安可试点'] },
        speakerNote: '最后回到评委问题：为什么值得支持，答案是差异化明确且能继续转化。',
        evidenceLevel: 'inferred',
        layout: 'summary',
    },
    {
        title: '备用：技术架构详解',
        kicker: '附录页',
        claim: '系统由访问层、控制平面、支撑层和受管对象层组成，支撑从发现到执行的安全闭环。',
        bullets: [
            '访问层：React 控制台负责展示、操作和演示入口',
            '控制平面：Express、Socket.IO、业务模块和服务编排',
            '支撑层：SQLite / Postgres shadow writes、Redis、审计与配置',
            '受管对象层：Agent、站点、ESP32 串口确认设备和 Rust fastpath',
        ],
        visual: { type: 'flow', steps: ['React 控制台', 'Node 控制平面', '数据与缓存', 'Agent / Site / ESP32', '审计证据'] },
        speakerNote: '只在评委追问架构时打开。',
        evidenceLevel: 'repo',
        layout: 'architecture',
        hidden: true,
    },
    {
        title: '备用：团队与知识产权',
        kicker: '附录页',
        claim: '团队信息和知识产权状态需要按真实材料补齐，当前版本保留占位。',
        bullets: [
            '团队名称 / 项目负责人 / 学校或公司：待补充',
            '成员分工：前后端、安全、AI、硬件、路演材料待补充',
            '软著编号 / 专利状态 / 奖项经历：待补充',
            '试点单位或合作意向：待补充',
        ],
        visual: {
            type: 'metrics',
            items: [
                { value: '待补', label: '团队名称', note: '不虚构参赛主体' },
                { value: '待补', label: '负责人', note: '按真实报名信息填写' },
                { value: '待补', label: '知识产权', note: '只填已申请或已授权状态' },
                { value: '待补', label: '试点', note: '有材料后再写具体单位' },
            ],
        },
        speakerNote: '这页不默认展示，避免占用主线时间。',
        evidenceLevel: 'placeholder',
        layout: 'team',
        hidden: true,
    },
];

const mainSlides = slides.filter((slide) => !slide.hidden);

const evidenceMap: Record<EvidenceLevel, { label: string; className: string }> = {
    repo: { label: '仓库可证实', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    inferred: { label: '推导表达', className: 'border-amber-200 bg-amber-50 text-amber-700' },
    placeholder: { label: '待补充', className: 'border-slate-200 bg-slate-50 text-slate-600' },
};

const layoutAccent: Record<SlideLayout, string> = {
    hero: 'from-cyan-500 to-emerald-500',
    statement: 'from-blue-600 to-cyan-500',
    problem: 'from-rose-500 to-amber-500',
    solution: 'from-emerald-500 to-cyan-500',
    innovation: 'from-cyan-500 to-blue-600',
    proof: 'from-emerald-500 to-teal-500',
    business: 'from-amber-500 to-emerald-500',
    xiongan: 'from-sky-500 to-emerald-500',
    roadmap: 'from-blue-500 to-amber-500',
    summary: 'from-emerald-500 to-blue-600',
    architecture: 'from-slate-600 to-cyan-500',
    team: 'from-slate-500 to-amber-500',
};

const icons = [ShieldCheck, LockKeyhole, CircuitBoard, Cpu, Network, MonitorCheck, Building2, Award];

function clampSlide(index: number, total: number) {
    return Math.min(Math.max(index, 0), total - 1);
}

function useFullscreen() {
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    const toggleFullscreen = useCallback(() => {
        if (document.fullscreenElement) {
            void document.exitFullscreen();
            return;
        }
        void document.documentElement.requestFullscreen();
    }, []);

    return { isFullscreen, toggleFullscreen };
}

function EvidenceBadge({ level }: { level: EvidenceLevel }) {
    const config = evidenceMap[level];
    return (
        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${config.className}`}>
            {config.label}
        </span>
    );
}

function SlideVisualPanel({ visual, slide, slideIndex }: { visual: SlideVisual; slide: Slide; slideIndex: number }) {
    if (visual.type === 'image') {
        return (
            <div className="relative h-full min-h-[260px] overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-[0_24px_80px_-46px_rgba(15,23,42,0.55)]">
                <img src={visual.src} alt={visual.alt} className="h-full w-full object-cover object-top" />
                <div className="absolute bottom-0 left-0 right-0 bg-white/92 px-4 py-3 text-sm font-medium text-slate-700 backdrop-blur">
                    {visual.caption}
                </div>
            </div>
        );
    }

    if (visual.type === 'imageGrid') {
        return (
            <div className="grid h-full min-h-[360px] grid-cols-2 gap-3 lg:grid-cols-3">
                {visual.images.map((image) => (
                    <div key={image.src} className="overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-sm">
                        <img src={image.src} alt={image.alt} className="h-[78%] w-full object-cover object-top" />
                        <div className="flex h-[22%] items-center justify-between px-3 text-sm font-semibold text-slate-700">
                            <span>{image.caption}</span>
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (visual.type === 'flow') {
        return (
            <div className="flex h-full min-h-[320px] flex-col justify-center rounded-[8px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="grid gap-3">
                    {visual.steps.map((step, idx) => {
                        const Icon = icons[(idx + slideIndex) % icons.length];
                        return (
                            <div key={step} className="flex items-center gap-4 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-gradient-to-br ${layoutAccent[slide.layout]} text-white`}>
                                    <Icon className="h-5 w-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Step {String(idx + 1).padStart(2, '0')}</div>
                                    <div className="text-lg font-semibold text-slate-900">{step}</div>
                                </div>
                                {idx < visual.steps.length - 1 && <ArrowRight className="hidden h-5 w-5 text-slate-300 sm:block" />}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    if (visual.type === 'metrics') {
        return (
            <div className="grid h-full min-h-[320px] grid-cols-1 gap-4 sm:grid-cols-2">
                {visual.items.map((item, idx) => {
                    const Icon = icons[(idx + slideIndex) % icons.length];
                    return (
                        <div key={`${item.value}-${item.label}`} className="flex flex-col justify-between rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                                <div className={`flex h-10 w-10 items-center justify-center rounded-[8px] bg-gradient-to-br ${layoutAccent[slide.layout]} text-white`}>
                                    <Icon className="h-5 w-5" />
                                </div>
                                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{item.label}</span>
                            </div>
                            <div className="mt-8">
                                <div className="text-3xl font-black tracking-normal text-slate-950">{item.value}</div>
                                <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.note}</p>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-[320px] items-center rounded-[8px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="relative w-full">
                <div className="absolute left-4 top-7 h-[calc(100%-56px)] w-px bg-gradient-to-b from-cyan-400 via-emerald-400 to-amber-400" />
                <div className="space-y-5">
                    {visual.items.map((item, idx) => (
                        <div key={item.title} className="relative flex gap-5">
                            <div className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${layoutAccent[slide.layout]} text-sm font-bold text-white`}>
                                {idx + 1}
                            </div>
                            <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                                <div className="text-base font-bold text-slate-950">{item.title}</div>
                                <div className="mt-1 text-sm leading-relaxed text-slate-600">{item.text}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function SlideFrame({ slide, slideIndex, total }: { slide: Slide; slideIndex: number; total: number }) {
    const accent = layoutAccent[slide.layout];

    return (
        <motion.section
            key={`${slideIndex}-${slide.title}`}
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.985 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="relative h-full overflow-hidden rounded-[8px] border border-slate-200 bg-[#f8fafc] shadow-[0_28px_90px_-44px_rgba(15,23,42,0.5)]"
        >
            <div className={`absolute left-0 top-0 h-1.5 w-full bg-gradient-to-r ${accent}`} />
            <div className="absolute right-0 top-0 h-56 w-56 translate-x-24 -translate-y-24 rounded-full border border-cyan-200/70" />
            <div className="absolute bottom-16 left-10 h-28 w-28 rounded-full border border-emerald-200/70" />

            <div className="relative flex h-full flex-col p-5 sm:p-7 lg:p-9">
                <header className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-500">
                                {String(slideIndex + 1).padStart(2, '0')} / {total}
                            </span>
                            <EvidenceBadge level={slide.evidenceLevel} />
                        </div>
                        <div className="mt-5 text-sm font-bold uppercase tracking-[0.22em] text-cyan-700">{slide.kicker}</div>
                    </div>
                    <div className="hidden items-center gap-3 sm:flex">
                        <img src="/brand-lockup.png" alt="AetherGuard" className="h-9 w-auto object-contain" />
                        <div className="h-8 w-px bg-slate-200" />
                        <div className="text-right text-xs font-semibold leading-tight text-slate-500">
                            雄才杯决赛<br />网页路演稿
                        </div>
                    </div>
                </header>

                <main className="grid min-h-0 flex-1 items-center gap-6 pt-4 lg:grid-cols-[0.9fr_1.1fr] lg:gap-8 lg:pt-6">
                    <div className="min-w-0">
                        <h1 className="max-w-[12ch] text-[clamp(2rem,6.8vh,4.8rem)] font-black leading-[0.98] tracking-normal text-slate-950">
                            {slide.title}
                        </h1>
                        <p className="mt-5 max-w-3xl text-[clamp(1.05rem,2.25vh,1.55rem)] font-bold leading-snug text-slate-800">
                            {slide.claim}
                        </p>
                        <div className="mt-6 grid gap-3">
                            {slide.bullets.map((bullet) => (
                                <div key={bullet} className="flex items-start gap-3 rounded-[8px] border border-slate-200 bg-white/85 px-4 py-3 shadow-sm">
                                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-br ${accent}`} />
                                    <span className="text-[clamp(0.9rem,1.6vh,1.08rem)] font-medium leading-relaxed text-slate-700">{bullet}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="min-h-0">
                        <SlideVisualPanel visual={slide.visual} slide={slide} slideIndex={slideIndex} />
                    </div>
                </main>

                <footer className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="truncate">{slide.speakerNote}</span>
                    </div>
                    <div className="shrink-0 font-semibold text-slate-500">守望流量，安抵未来</div>
                </footer>
            </div>
        </motion.section>
    );
}

function SlideNav({ current, onSelect, activeSlides }: { current: number; onSelect: (index: number) => void; activeSlides: Slide[] }) {
    return (
        <div className="hidden w-72 shrink-0 border-l border-slate-200 bg-white/90 p-4 backdrop-blur xl:block">
            <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">目录</div>
                <div className="text-xs font-semibold text-slate-500">{activeSlides.length} 页</div>
            </div>
            <div className="space-y-2">
                {activeSlides.map((slide, idx) => (
                    <button
                        key={`${slide.title}-${idx}`}
                        type="button"
                        onClick={() => onSelect(idx)}
                        className={`w-full rounded-[8px] border px-3 py-2 text-left transition ${idx === current
                            ? 'border-cyan-300 bg-cyan-50 text-cyan-900'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                    >
                        <div className="text-[11px] font-bold text-slate-400">{String(idx + 1).padStart(2, '0')}</div>
                        <div className="mt-0.5 truncate text-sm font-bold">{slide.title}</div>
                    </button>
                ))}
            </div>
        </div>
    );
}

export default function XiongcaiFinalDeck() {
    const [current, setCurrent] = useState(0);
    const [showAppendix, setShowAppendix] = useState(false);
    const { isFullscreen, toggleFullscreen } = useFullscreen();
    const activeSlides = showAppendix ? slides : mainSlides;
    const slide = activeSlides[current];
    const progress = useMemo(() => ((current + 1) / activeSlides.length) * 100, [activeSlides.length, current]);

    const goTo = useCallback((index: number) => setCurrent(clampSlide(index, activeSlides.length)), [activeSlides.length]);
    const next = useCallback(() => setCurrent((idx) => clampSlide(idx + 1, activeSlides.length)), [activeSlides.length]);
    const prev = useCallback(() => setCurrent((idx) => clampSlide(idx - 1, activeSlides.length)), [activeSlides.length]);

    useEffect(() => {
        setCurrent((idx) => clampSlide(idx, activeSlides.length));
    }, [activeSlides.length]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
                event.preventDefault();
                next();
            }
            if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
                event.preventDefault();
                prev();
            }
            if (event.key === 'Home') {
                event.preventDefault();
                goTo(0);
            }
            if (event.key === 'End') {
                event.preventDefault();
                goTo(activeSlides.length - 1);
            }
            if (event.key.toLowerCase() === 'a') {
                event.preventDefault();
                setShowAppendix((value) => !value);
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [activeSlides.length, goTo, next, prev]);

    return (
        <div className="h-screen w-screen overflow-hidden bg-[#eaf0f6] text-slate-950">
            <div className="flex h-full">
                <main className="flex min-w-0 flex-1 flex-col p-3 sm:p-5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-slate-950 text-white">
                                <Sparkles className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <div className="truncate text-sm font-black text-slate-950">AetherGuard · 雄才杯决赛冲奖版</div>
                                <div className="truncate text-xs font-medium text-slate-500">键盘左右键翻页，支持全屏路演</div>
                            </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                            <button
                                type="button"
                                onClick={prev}
                                disabled={current === 0}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-[8px] border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="Previous slide"
                            >
                                <ArrowLeft className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                onClick={next}
                                disabled={current === activeSlides.length - 1}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-[8px] border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="Next slide"
                            >
                                <ArrowRight className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowAppendix((value) => !value)}
                                className={`hidden h-10 items-center gap-2 rounded-[8px] border px-3 text-sm font-semibold shadow-sm transition sm:inline-flex ${showAppendix
                                    ? 'border-cyan-300 bg-cyan-50 text-cyan-800'
                                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                    }`}
                            >
                                附录
                            </button>
                            <button
                                type="button"
                                onClick={toggleFullscreen}
                                className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                            >
                                <Expand className="h-4 w-4" />
                                <span className="hidden sm:inline">{isFullscreen ? '退出全屏' : '全屏'}</span>
                            </button>
                        </div>
                    </div>

                    <div className="relative min-h-0 flex-1">
                        <AnimatePresence mode="wait">
                            <SlideFrame slide={slide} slideIndex={current} total={activeSlides.length} />
                        </AnimatePresence>
                    </div>

                    <div className="mt-3 rounded-full bg-white p-1 shadow-sm">
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <motion.div
                                className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-emerald-500 to-amber-400"
                                animate={{ width: `${progress}%` }}
                                transition={{ duration: 0.24 }}
                            />
                        </div>
                    </div>
                </main>
                <SlideNav current={current} onSelect={goTo} activeSlides={activeSlides} />
            </div>
        </div>
    );
}
