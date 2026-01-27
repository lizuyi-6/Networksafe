
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    PlayCircle, Cpu, Zap, BrainCircuit, ShieldCheck, Cloud, Server, Network,
    Laptop, Database, Shield, Lock, Building, Check, X,
    CheckCircle, Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Logo, { PlanTier } from '../components/Logo';

// --- Types & Data ---

type DeployMode = 'saas' | 'private' | 'hybrid';

const TERMINAL_LOGS = [
    { text: "$ ./fluxguard-agent start --hardware-mode", type: "cmd", delay: 800 },
    { text: "[INIT] Initializing FluxGuard Core v2.3.0...", type: "info", delay: 200 },
    { text: "[INFO] Hardware Key detected: ESP32-S3-Dongle", type: "blue", delay: 400 },
    { text: "[NET] Listening on port 8443 (TLS 1.3)", type: "info", delay: 600 },
    { text: "[WARN] 192.168.1.105 is scanning ports...", type: "warn", delay: 1000 },
    { text: "[AI] Analyzing behavior (Model: GPT-4)...", type: "ai", delay: 1500 },
    { text: "[SECURE] IP 192.168.1.105 banned.", type: "success", delay: 800 },
    { text: "[INFO] System stable. Monitoring active.", type: "blue", delay: 3000 }
];

// --- Components ---

const Landing = () => {
    const navigate = useNavigate();
    const [deployMode, setDeployMode] = useState<DeployMode>('saas');
    const [toast, setToast] = useState<{ msg: string; type: 'success' | 'info' } | null>(null);
    const [terminalLines, setTerminalLines] = useState<any[]>([]);
    const [demoTier, setDemoTier] = useState<PlanTier>(null);
    const terminalRef = useRef<HTMLDivElement>(null);

    // Terminal Animation
    useEffect(() => {
        let currentIndex = 0;
        let timeoutId: NodeJS.Timeout;

        const processLog = () => {
            if (currentIndex >= TERMINAL_LOGS.length) {
                // Restart loop after a pause
                timeoutId = setTimeout(() => {
                    setTerminalLines([]);
                    currentIndex = 0;
                    processLog();
                }, 5000);
                return;
            }

            const log = TERMINAL_LOGS[currentIndex];
            setTerminalLines(prev => [...prev, log]);

            // Auto scroll
            if (terminalRef.current) {
                terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
            }

            currentIndex++;
            if (currentIndex < TERMINAL_LOGS.length) {
                timeoutId = setTimeout(processLog, log.delay);
            }
        };

        timeoutId = setTimeout(processLog, 1000);

        return () => clearTimeout(timeoutId);
    }, []);

    const showToast = (msg: string, type: 'success' | 'info' = 'info') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    const scrollToSection = (id: string) => {
        const element = document.getElementById(id);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth' });
        }
    };

    return (
        <div className="bg-[#050505] min-h-screen text-[#e5e5e5] font-sans overflow-x-hidden scroll-smooth selection:bg-green-500/20 selection:text-green-500 relative">
            {/* Force Dark Mode Override & Visibility */}
            <style>{`
                :root { color-scheme: dark; }
                body { background-color: #050505 !important; color: #e5e5e5 !important; }
                * { opacity: 1 !important; visibility: visible !important; } /* DEBUG: Force visibility */
            `}</style>
            {/* Toast */}
            <AnimatePresence>
                {toast && (
                    <motion.div
                        initial={{ opacity: 0, x: 100 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 100 }}
                        className={`fixed bottom-5 right-5 z-50 px-6 py-3 rounded-lg backdrop-blur-md border border-white/10 shadow-xl flex items-center gap-3 ${toast.type === 'success' ? 'bg-black/90 border-l-4 border-l-green-500' : 'bg-black/90 border-l-4 border-l-blue-500'}`}
                    >
                        {toast.type === 'success' ? <CheckCircle className="w-5 h-5 text-green-400" /> : <Info className="w-5 h-5 text-blue-400" />}
                        <span className="text-white text-sm font-medium">{toast.msg}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Navbar */}
            <nav className="fixed w-full z-40 bg-black/80 backdrop-blur-md border-b border-white/10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        <div className="group cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                            <Logo tier={demoTier} />
                        </div>
                        <div className="hidden md:flex items-center space-x-8">
                            <button onClick={() => scrollToSection('features')} className="hover:text-green-400 transition-colors text-sm font-medium">防御体系</button>
                            <button onClick={() => scrollToSection('deployment')} className="hover:text-green-400 transition-colors text-sm font-medium">部署方案</button>
                            <button onClick={() => scrollToSection('pricing')} className="hover:text-green-400 transition-colors text-sm font-medium">价格方案</button>
                            <button onClick={() => navigate('/login')} className="bg-white/10 hover:bg-green-500 hover:text-black px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 shadow-lg hover:shadow-green-500/25">控制台登录</button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 grid-bg min-h-screen flex items-center overflow-hidden">
                {/* Aurora Background Layer */}
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-[-20%] left-[-20%] w-[800px] h-[800px] bg-green-500/10 rounded-full blur-[120px] mix-blend-screen animate-blob opacity-40"></div>
                    <div className="absolute top-[10%] right-[-10%] w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[120px] mix-blend-screen animate-blob animation-delay-2000 opacity-40"></div>
                    <div className="absolute -bottom-32 left-1/2 w-[800px] h-[800px] bg-purple-500/10 rounded-full blur-[120px] transform -translate-x-1/2 opacity-30"></div>
                </div>
                <motion.div
                    initial={{ opacity: 0, y: 30, filter: "blur(10px)" }}
                    whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    viewport={{ once: true }}
                    transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
                    className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 w-full"
                >
                    <div className="lg:grid lg:grid-cols-12 lg:gap-16 items-center">
                        <div className="lg:col-span-6 text-center lg:text-left mb-16 lg:mb-0">
                            <motion.div
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.2 }}
                                className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-900/30 border border-green-500/30 text-green-400 text-xs font-mono mb-6"
                            >
                                <span className="w-2 h-2 rounded-full bg-green-500 status-pulse"></span> v22.0 Unibody 硬件现已发布
                            </motion.div>
                            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6 leading-tight text-white">
                                让服务器安全<br />
                                <span className="bg-clip-text text-transparent bg-gradient-to-br from-green-400 to-blue-500">像装杀毒软件一样简单</span>
                            </h1>
                            <p className="text-lg text-gray-400 mb-8 leading-relaxed max-w-2xl mx-auto lg:mx-0">
                                企业级智能服务器防御平台。分布式 Agent 架构 + AI 智能分析 + 硬件级物理部署，将被动响应转化为主动免疫。
                            </p>
                            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                                <button onClick={() => showToast('感谢申请！销售顾问将在 24 小时内联系您。', 'success')} className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-black font-bold py-3 px-8 rounded-lg shadow-lg shadow-green-500/20 transition-all transform hover:-translate-y-1">
                                    申请 14 天免费试用
                                </button>
                                <button onClick={() => window.open('https://github.com', '_blank')} className="bg-white/5 border border-white/10 hover:bg-white/10 text-white font-medium py-3 px-8 rounded-lg transition-all flex items-center justify-center gap-2 group">
                                    <PlayCircle className="w-5 h-5 group-hover:text-green-400 transition-colors" /> 观看演示 (3min)
                                </button>
                            </div>
                        </div>

                        {/* Terminal Window */}
                        <div className="lg:col-span-6 relative group">
                            <div className="absolute -inset-1 bg-gradient-to-r from-green-600 to-blue-600 rounded-xl blur opacity-25 group-hover:opacity-40 transition duration-1000 animate-pulse"></div>
                            <div className="relative bg-[#0d1117] rounded-xl border border-gray-700 shadow-2xl overflow-hidden font-mono text-sm leading-relaxed h-[400px] flex flex-col">
                                <div className="flex items-center justify-between px-4 py-3 bg-[#161b22] border-b border-gray-700 shrink-0 z-20">
                                    <div className="flex space-x-2"><div className="w-3 h-3 rounded-full bg-red-500"></div><div className="w-3 h-3 rounded-full bg-yellow-500"></div><div className="w-3 h-3 rounded-full bg-green-500"></div></div>
                                    <div className="text-gray-400 text-xs font-semibold">admin@fluxguard-dongle:~</div>
                                    <div className="text-gray-600 text-xs">bash</div>
                                </div>
                                <div className="scanline"></div>
                                <div ref={terminalRef} className="p-6 text-gray-300 flex-1 overflow-y-auto no-scrollbar relative font-medium">
                                    {terminalLines.map((log, i) => (
                                        <div key={i} className={`mb-1 ${log.type === 'cmd' ? 'text-green-400 font-bold' :
                                            log.type === 'warn' ? 'text-yellow-400' :
                                                log.type === 'error' ? 'text-red-500' :
                                                    log.type === 'success' ? 'text-green-400' :
                                                        log.type === 'ai' ? 'text-purple-400' :
                                                            log.type === 'blue' ? 'text-blue-400' :
                                                                'text-gray-500'
                                            }`}>
                                            {log.text}
                                        </div>
                                    ))}
                                    <motion.span
                                        animate={{ opacity: [1, 0] }}
                                        transition={{ repeat: Infinity, duration: 0.8 }}
                                        className="inline-block w-2 h-4 bg-green-500 ml-1 align-middle"
                                    />
                                </div>
                                <div className="absolute bottom-6 right-6 bg-black/90 backdrop-blur-md border border-green-500/30 p-3 rounded-lg flex items-center gap-3 shadow-lg shadow-black/50 z-30">
                                    <div className="relative"><Cpu className="text-green-400 w-6 h-6" /><span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full status-pulse"></span></div>
                                    <div><div className="text-[10px] text-gray-400 uppercase tracking-wider">Hardware Status</div><div className="text-green-400 font-bold text-sm tracking-wide">ONLINE • ENCRYPTED</div></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </section>

            {/* Hardware Section */}
            <section id="hardware" className="py-20 bg-black border-y border-white/10">
                <div className="max-w-7xl mx-auto px-4 text-center">
                    <h2 className="text-3xl font-bold mb-8">FluxGuard Deployment Dongle</h2>
                    <div
                        className="relative w-full max-w-4xl mx-auto aspect-video bg-gray-900 rounded-xl overflow-hidden group cursor-pointer"
                        onClick={() => showToast('正在跳转至硬件详情页...', 'info')}
                    >
                        <img
                            src="https://images.unsplash.com/photo-1550751827-4bd374c3f58b?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80"
                            className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-all duration-700 hover:scale-105"
                            alt="FluxGuard Hardware"
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="bg-black/50 backdrop-blur-md border border-white/10 px-8 py-4 rounded-xl transform group-hover:-translate-y-2 transition-all">
                                <h3 className="text-2xl font-bold text-white">v22.0 Unibody</h3>
                                <p className="text-green-400 text-sm mt-1">点击查看工业设计细节</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features Grid */}
            <section id="features" className="py-20 bg-[#0f0f0f] border-t border-white/5">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-bold mb-4 text-white">三位一体防御体系</h2>
                        <p className="text-gray-400">从代码层到物理层的全栈安全防护</p>
                    </div>
                    <div className="grid md:grid-cols-3 gap-8">
                        <FeatureCard
                            icon={Zap} color="green" title="主动免疫"
                            desc="分布式 Agent 驻留于业务内部，毫秒级响应威胁，无需等待中央指令。"
                            items={["实时流量镜像", "内存马查杀"]}
                        />
                        <FeatureCard
                            icon={BrainCircuit} color="blue" title="AI 决策大脑"
                            desc="集成 GPT-4 与本地模型，理解攻击意图，自动生成修复策略并阻断。"
                            items={["攻击溯源分析", "漏洞自动修复"]}
                        />
                        <FeatureCard
                            icon={ShieldCheck} color="purple" title="物理级隔离"
                            desc="物理密钥管理与离线防护。资产自动发现，从物理层保障服务器安全。"
                            items={["硬件加密存储", "拔出即锁定"]}
                        />
                    </div>
                </div>
            </section>

            {/* Deployment Solutions */}
            <section id="deployment" className="py-20 bg-black relative overflow-hidden">
                <div className="absolute inset-0 grid-bg opacity-30"></div>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-bold mb-4 text-white">灵活的部署架构</h2>
                        <p className="text-gray-400">无论是公有云还是涉密内网，FluxGuard 都能完美适配</p>
                    </div>

                    <div className="lg:grid lg:grid-cols-12 gap-8">
                        {/* Selector */}
                        <div className="lg:col-span-4 space-y-4">
                            <DeployOption active={deployMode === 'saas'} onClick={() => setDeployMode('saas')} icon={Cloud} title="云端托管 (SaaS)" sub="适合中小企业，开箱即用" />
                            <DeployOption active={deployMode === 'private'} onClick={() => setDeployMode('private')} icon={Server} title="私有化部署 (On-Premise)" sub="金融/政企首选，数据不离境" />
                            <DeployOption active={deployMode === 'hybrid'} onClick={() => setDeployMode('hybrid')} icon={Network} title="混合云架构 (Hybrid)" sub="统一管理多云资产" />
                        </div>

                        {/* Visualizer */}
                        <div className="lg:col-span-8">
                            <div className="bg-[#0d1117] border border-gray-700 rounded-xl p-8 h-full min-h-[400px] relative overflow-hidden flex flex-col justify-center">
                                {deployMode === 'saas' && (
                                    <motion.div animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                        <div className="flex justify-between items-center mb-8">
                                            <div className="text-center">
                                                <div className="w-16 h-16 mx-auto bg-gray-800 rounded-full flex items-center justify-center border border-gray-600 mb-2">
                                                    <Laptop className="w-8 h-8 text-gray-400" />
                                                </div>
                                                <div className="text-xs text-gray-500">您的服务器</div>
                                            </div>
                                            <div className="flex-1 h-px bg-gray-700 mx-4 relative">
                                                <motion.div
                                                    animate={{ left: ["0%", "100%"] }}
                                                    transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                                                    className="absolute top-1/2 -translate-y-1/2 w-2 h-2 bg-green-500 rounded-full"
                                                />
                                                <div className="text-center -mt-6 text-xs text-green-500 font-mono">TLS 1.3 Tunnel</div>
                                            </div>
                                            <div className="text-center relative">
                                                <div className="absolute -inset-4 bg-green-500/10 blur-xl rounded-full"></div>
                                                <div className="w-20 h-20 mx-auto bg-[#161b22] rounded-full flex items-center justify-center border-2 border-green-500 mb-2 relative z-10">
                                                    <Cloud className="w-10 h-10 text-green-400" />
                                                </div>
                                                <div className="text-sm font-bold text-green-400">FluxGuard Cloud</div>
                                            </div>
                                        </div>
                                    </motion.div>
                                )}

                                {deployMode === 'private' && (
                                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                        <div className="border border-green-500/30 bg-green-900/5 rounded-xl p-6 relative">
                                            <div className="absolute top-0 left-4 -translate-y-1/2 bg-[#0d1117] px-2 text-xs text-green-500 border border-green-500/30 rounded">企业内网 (Intranet)</div>
                                            <div className="flex justify-around items-center">
                                                <div className="text-center"><div className="w-12 h-12 mx-auto bg-gray-800 rounded-lg flex items-center justify-center mb-2"><Database className="w-6 h-6 text-purple-400" /></div><div className="text-xs text-gray-500">业务数据库</div></div>
                                                <div className="h-px w-16 bg-gray-600"></div>
                                                <div className="text-center">
                                                    <div className="w-16 h-16 mx-auto bg-[#161b22] rounded-lg flex items-center justify-center border border-green-500 mb-2 shadow-[0_0_15px_rgba(0,255,157,0.2)]"><Shield className="w-8 h-8 text-green-400" /></div>
                                                    <div className="text-xs font-bold text-white">本地控制台</div>
                                                </div>
                                                <div className="h-px w-16 bg-gray-600"></div>
                                                <div className="text-center"><div className="w-12 h-12 mx-auto bg-gray-800 rounded-lg flex items-center justify-center mb-2"><Server className="w-6 h-6 text-blue-400" /></div><div className="text-xs text-gray-500">应用服务器</div></div>
                                            </div>
                                        </div>
                                        <div className="mt-6 flex items-center gap-4 text-xs text-gray-400 bg-red-900/10 p-3 rounded border border-red-500/20">
                                            <Lock className="w-4 h-4 text-red-400" />
                                            <span>物理隔离模式：所有数据留存本地，完全切断外网连接。支持离线 AI 模型。</span>
                                        </div>
                                    </motion.div>
                                )}

                                {deployMode === 'hybrid' && (
                                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex justify-center items-center gap-8 mb-6">
                                        <div className="w-32 p-4 border border-gray-700 rounded-lg text-center opacity-50">
                                            <Cloud className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                                            <div className="text-xs">AWS / Azure</div>
                                        </div>
                                        <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center z-10 shadow-lg">
                                            <Zap className="w-6 h-6 text-black" />
                                        </div>
                                        <div className="w-32 p-4 border border-gray-700 rounded-lg text-center opacity-50">
                                            <Building className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                                            <div className="text-xs">IDC 机房</div>
                                        </div>
                                    </motion.div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Pricing Section */}
            <section id="pricing" className="py-20 relative bg-[#0a0a0a]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-bold mb-4 text-white">透明定价，按需订阅</h2>
                        <p className="text-gray-400">硬件一次性买断，软件服务按需订阅</p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8">
                        <PricingCard
                            title="Starter" price="¥999" sub="适合小型开发团队"
                            features={[{ t: "管理 5 台 Agent", c: true }, { t: "基础 WAF 防护", c: true }, { t: "7 天日志存储", c: true }, { t: "无 AI 分析引擎", c: false }]}
                            btnText="开始试用" outline onClick={() => navigate('/login')}
                            onMouseEnter={() => setDemoTier('starter')}
                            onMouseLeave={() => setDemoTier(null)}
                        />
                        <PricingCard
                            title="Professional" price="¥2,999" sub="适合快速成长的业务系统"
                            featured
                            features={[{ t: "管理 20 台 Agent", c: true }, { t: "AI 智能分析引擎 (GPT-4)", c: true }, { t: "Nuclei 自动化漏洞扫描", c: true }, { t: "硬件离线授权功能", c: true }]}
                            btnText="立即订阅" onClick={() => navigate('/login')}
                            onMouseEnter={() => setDemoTier('professional')}
                            onMouseLeave={() => setDemoTier(null)}
                        />
                        <PricingCard
                            title="Enterprise" price="询价" sub="大规模企业定制"
                            features={[{ t: "无限制 Agent", c: true }, { t: "私有化部署", c: true }, { t: "7x24h SLA", c: true }, { t: "专属客户经理", c: true }]}
                            btnText="联系销售" outline onClick={() => showToast('请联系 sales@fluxguard.io')}
                            onMouseEnter={() => setDemoTier('enterprise')}
                            onMouseLeave={() => setDemoTier(null)}
                        />
                    </div>
                </div>
            </section>

            <footer className="bg-black py-12 border-t border-white/10 text-center text-gray-600 text-sm">
                <p>&copy; 2026 FluxGuard Security Inc. <a href="#" className="hover:text-white" onClick={(e) => { e.preventDefault(); showToast('隐私政策页面正在建设中'); }}>隐私政策</a></p>
            </footer>
        </div>
    )
}

// --- Sub Components ---

const FeatureCard = ({ icon: Icon, color, title, desc, items }: any) => {
    // Map color to tailwind classes roughly
    const colors: any = {
        green: { text: 'text-green-400', bg: 'bg-green-900/30', border: 'hover:border-green-500/30' },
        blue: { text: 'text-blue-400', bg: 'bg-blue-900/30', border: 'hover:border-blue-500/30' },
        purple: { text: 'text-purple-400', bg: 'bg-purple-900/30', border: 'hover:border-purple-500/30' },
    };
    const c = colors[color];

    return (
        <div className={`bg-[#111] p-8 rounded-2xl border border-white/5 ${c.border} transition-all hover:-translate-y-2 group relative overflow-hidden`}>
            {/* Background Icon */}
            <div className={`absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity`}>
                <Icon className={`w-24 h-24 ${c.text.replace('400', '500')}`} />
            </div>
            <div className={`w-12 h-12 ${c.bg} rounded-lg flex items-center justify-center mb-6`}>
                <Icon className={`w-6 h-6 ${c.text}`} />
            </div>
            <h3 className={`text-xl font-bold mb-3 group-hover:${c.text} text-white`}>{title}</h3>
            <p className="text-gray-400 text-sm mb-4">{desc}</p>
            <ul className="text-xs text-gray-500 space-y-2 font-mono">
                {items.map((it: string, i: number) => (
                    <li key={i} className="flex items-center gap-2">
                        <div className={`w-1 h-1 ${c.text.replace('text', 'bg').replace('400', '500')} rounded-full`}></div> {it}
                    </li>
                ))}
            </ul>
        </div>
    )
}

const DeployOption = ({ active, onClick, icon: Icon, title, sub }: any) => (
    <div onClick={onClick} className={`cursor-pointer border p-6 rounded-xl transition-all group ${active ? 'bg-[#161616] border-green-500' : 'bg-[#111] border-gray-800 hover:bg-[#161616]'}`}>
        <div className="flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${active ? 'bg-green-900/20 text-green-400' : 'bg-gray-800 text-gray-400'}`}>
                <Icon className="w-5 h-5" />
            </div>
            <div>
                <h4 className={`font-bold transition-colors ${active ? 'text-green-400' : 'text-white group-hover:text-green-400'}`}>{title}</h4>
                <p className="text-xs text-gray-500 mt-1">{sub}</p>
            </div>
        </div>
    </div>
)

const PricingCard = ({ title, price, sub, features, btnText, outline, featured, onClick, onMouseEnter, onMouseLeave }: any) => (
    <div
        className={`bg-[#111] p-8 rounded-2xl border transition-all flex flex-col ${featured ? 'border-green-500/50 shadow-xl shadow-green-900/20 transform md:-translate-y-4 bg-[#1a1a1a]' : 'border-gray-800 hover:border-gray-600'}`}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
    >
        {featured && <div className="ml-auto mr-auto -mt-12 mb-6 bg-green-600 text-white text-xs px-3 py-1 rounded-full font-bold shadow-lg shadow-green-600/40 w-fit">最具性价比</div>}
        <div className="mb-4">
            <h3 className={`text-lg font-bold ${featured ? 'text-green-400' : 'text-gray-300'}`}>{title}</h3>
            <div className="my-4">
                <span className="text-4xl font-bold text-white">{price}</span>
                {price !== '询价' && <span className="text-gray-500">/月</span>}
            </div>
            <p className="text-sm text-gray-500">{sub}</p>
        </div>
        <ul className="space-y-4 mb-8 flex-1">
            {features.map((f: any, i: number) => (
                <li key={i} className={`flex gap-3 text-sm ${f.c ? (featured ? 'text-white' : 'text-gray-300') : 'text-gray-500'}`}>
                    {f.c ? <Check className="w-5 h-5 text-green-500 shrink-0" /> : <X className="w-5 h-5 shrink-0" />}
                    <span dangerouslySetInnerHTML={{ __html: f.t }}></span>
                </li>
            ))}
        </ul>
        <button onClick={onClick} className={`w-full py-3 rounded-lg font-bold transition-colors ${outline ? 'border border-white/20 hover:bg-white/5 text-white' : 'bg-green-600 hover:bg-green-500 text-white shadow-lg hover:shadow-green-500/25'}`}>
            {btnText}
        </button>
    </div>
)

export default Landing;
