import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Plus, Database, Cpu, HardDrive, CheckCircle2, Server, Key, X } from 'lucide-react';

// NotebookLM-style "Add Source" animation promo
export default function Promo() {
    const [step, setStep] = useState(0);
    const [sources, setSources] = useState<any[]>([]);

    useEffect(() => {
        document.body.style.overflow = 'hidden';

        const runSequence = async () => {
            // Reset state
            setStep(0);
            setSources([]);

            // 1. Initial waiting
            await new Promise(r => setTimeout(r, 1500));
            setStep(1); // Move mouse to + Add Source button

            await new Promise(r => setTimeout(r, 800));
            setStep(2); // Hover state on button

            await new Promise(r => setTimeout(r, 400));
            setStep(3); // First click (Open Add Modal)

            await new Promise(r => setTimeout(r, 1200));
            setStep(4); // Move mouse to a source card (Server Logs)

            await new Promise(r => setTimeout(r, 800));
            setStep(5); // Hover on source card

            await new Promise(r => setTimeout(r, 400));
            setStep(6); // Click source card (Starts analyzing)

            await new Promise(r => setTimeout(r, 2000));
            setStep(7); // Loading/Connecting finish, Add to list

            await new Promise(r => setTimeout(r, 1500));
            setStep(8); // Move mouse to another source card (AI Model)

            await new Promise(r => setTimeout(r, 600));
            setStep(9); // Hover the card

            await new Promise(r => setTimeout(r, 400));
            setStep(10); // Click API card

            await new Promise(r => setTimeout(r, 2000));
            setStep(11); // Add second item

            await new Promise(r => setTimeout(r, 1500));
            setStep(12); // Close Modal

            await new Promise(r => setTimeout(r, 2000));
            setStep(13); // Zoom out / End state
        };

        // Loop the sequence
        runSequence();
        const interval = setInterval(runSequence, 15000);

        return () => {
            document.body.style.overflow = '';
            clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        if (step === 7) {
            setSources(prev => [...prev, { id: 1, type: 'server', title: 'Prod Node 01', status: 'Secured', icon: Server }]);
        }
        if (step === 11) {
            setSources(prev => [...prev, { id: 2, type: 'ai', title: 'Core Analytics Agent', status: 'Active', icon: Cpu }]);
        }
    }, [step]);

    // Derived flags for UI
    const isModalOpen = step >= 3 && step < 12;
    const isConnecting1 = step >= 6 && step < 7;
    const isConnecting2 = step >= 10 && step < 11;

    // Mouse coordinates based on step
    let mouseX = 800;
    let mouseY = 800; // Start offscreen bottom-right

    // X/Y relative to the application wrapper. Wrapper is 1000x700 centered.
    if (step >= 1 && step < 3) {
        mouseX = 300; // Over left panel Add button
        mouseY = 135;
    } else if (step >= 4 && step < 6) {
        mouseX = 500; // Over first modal card
        mouseY = 320;
    } else if (step >= 8 && step < 10) {
        mouseX = 800; // Over second modal card
        mouseY = 320;
    } else if (step >= 12) {
        mouseX = 650; // Over X button or just rest
        mouseY = 200;
        if (step === 13) {
            mouseX = 1000;
            mouseY = 1000;
        }
    }

    // Spring physics for buttery smooth NotebookLM style animations
    const springTransition = { type: 'spring' as const, stiffness: 300, damping: 25 };

    return (
        <div className="h-screen w-screen bg-[#F0F2F5] text-slate-900 flex items-center justify-center relative overflow-hidden font-sans">

            {/* The Main Application Envelope */}
            <motion.div
                animate={{ scale: step === 13 ? 0.95 : 1 }}
                transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
                className="w-[1024px] h-[720px] bg-white rounded-[24px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.15)] border border-slate-200/60 overflow-hidden flex relative"
            >
                {/* Left Sources Sidebar (Like NotebookLM) */}
                <div className="w-80 bg-slate-50/50 border-r border-slate-100 flex flex-col p-6 z-10">
                    <div className="flex items-center gap-3 mb-8">
                        <div className="h-8 w-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm">
                            <Shield className="h-5 w-5" />
                        </div>
                        <span className="font-semibold text-lg tracking-tight">AetherGuard</span>
                    </div>

                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Assets</h2>
                    </div>

                    <div className="space-y-3 relative">
                        <AnimatePresence>
                            {sources.map((s) => (
                                <motion.div
                                    key={s.id}
                                    initial={{ opacity: 0, x: -20, scale: 0.95 }}
                                    animate={{ opacity: 1, x: 0, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                    className="p-3.5 rounded-2xl bg-white border border-slate-200/60 shadow-sm flex items-center gap-3 group hover:border-blue-200 transition-colors"
                                >
                                    <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-500">
                                        <s.icon className="h-5 w-5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-slate-700 truncate">{s.title}</p>
                                        <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                            {s.status}
                                        </p>
                                    </div>
                                    <CheckCircle2 className="h-4 w-4 text-slate-300" />
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>

                    {/* Add Source Area */}
                    <motion.div
                        initial={false}
                        animate={{
                            scale: step === 2 ? 0.98 : 1,
                            backgroundColor: step >= 2 ? '#f1f5f9' : 'transparent',
                            borderColor: step >= 2 ? '#cbd5e1' : '#e2e8f0'
                        }}
                        transition={springTransition}
                        className={`mt-4 border-2 border-dashed rounded-2xl p-4 flex flex-col items-center justify-center cursor-pointer text-slate-500`}
                    >
                        <div className="h-10 w-10 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center mb-2">
                            <Plus className="h-5 w-5 text-slate-600" />
                        </div>
                        <span className="text-sm font-medium">Add protection node</span>
                        <span className="text-[11px] text-slate-400 mt-1">Servers, DBs, or Agents</span>
                    </motion.div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 bg-white relative flex flex-col items-center justify-center text-center">
                    <motion.div
                        animate={{ opacity: sources.length > 0 ? 0.2 : 1 }}
                        transition={{ duration: 0.5 }}
                        className="max-w-md mx-auto p-12"
                    >
                        <motion.div
                            animate={{ scale: [1, 1.05, 1], rotate: [0, 2, 0] }}
                            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                            className="w-24 h-24 rounded-full bg-blue-50/50 border border-blue-100/50 mx-auto flex items-center justify-center mb-6"
                        >
                            <Shield className="h-10 w-10 text-blue-300" />
                        </motion.div>
                        <h2 className="text-2xl font-semibold tracking-tight text-slate-800 mb-2">Ready to secure infrastructure</h2>
                        <p className="text-slate-500 font-light text-sm leading-relaxed">Add your first server node or AI agent to begin real-time monitoring and autonomous mitigation.</p>
                    </motion.div>
                </div>

                {/* Add Source Modal Overlay (NotebookLM style) */}
                <AnimatePresence>
                    {isModalOpen && (
                        <>
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="absolute inset-0 bg-slate-900/10 backdrop-blur-[2px] z-40"
                            />

                            <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                                transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.8 }}
                                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[680px] bg-white rounded-3xl shadow-2xl overflow-hidden z-50 border border-slate-100"
                            >
                                <div className="px-8 pt-8 pb-6 flex justify-between items-center">
                                    <h2 className="text-2xl font-semibold tracking-tight">Add to AetherGuard</h2>
                                    <div className="p-2 rounded-full hover:bg-slate-100 text-slate-400 cursor-pointer">
                                        <X className="h-5 w-5" />
                                    </div>
                                </div>

                                <div className="px-8 pb-8 grid grid-cols-2 gap-4">
                                    {/* Modal Option 1: Server */}
                                    <motion.div
                                        initial={false}
                                        animate={{
                                            scale: step === 5 ? 0.98 : 1,
                                            boxShadow: step >= 5 && step < 6 ? '0 0 0 2px #3b82f6' : '0 1px 2px rgba(0,0,0,0.05)'
                                        }}
                                        className="h-32 border border-slate-200 rounded-2xl p-5 flex flex-col justify-center gap-3 relative overflow-hidden bg-slate-50/50 cursor-pointer"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="p-2.5 bg-white rounded-xl shadow-sm border border-slate-100 text-slate-600">
                                                <HardDrive className="h-6 w-6" />
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-slate-800">Server Node</h3>
                                                <p className="text-xs text-slate-500">Linux / Windows Host</p>
                                            </div>
                                        </div>

                                        <AnimatePresence>
                                            {isConnecting1 && (
                                                <motion.div
                                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                                    className="absolute inset-0 bg-blue-600 flex items-center justify-center p-4"
                                                >
                                                    <motion.div
                                                        animate={{ rotate: 360 }}
                                                        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                                                        className="h-6 w-6 border-2 border-white/20 border-t-white rounded-full mr-3"
                                                    />
                                                    <span className="text-white font-medium text-sm">Deploying Rust Agent...</span>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </motion.div>

                                    {/* Modal Option 2: AI Processor */}
                                    <motion.div
                                        initial={false}
                                        animate={{
                                            scale: step === 9 ? 0.98 : 1,
                                            boxShadow: step >= 9 && step < 10 ? '0 0 0 2px #3b82f6' : '0 1px 2px rgba(0,0,0,0.05)'
                                        }}
                                        className="h-32 border border-slate-200 rounded-2xl p-5 flex flex-col justify-center gap-3 relative overflow-hidden bg-slate-50/50 cursor-pointer"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="p-2.5 bg-white rounded-xl shadow-sm border border-slate-100 text-slate-600">
                                                <Cpu className="h-6 w-6" />
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-slate-800">AI Intelligence</h3>
                                                <p className="text-xs text-slate-500">LLM Analytics Engine</p>
                                            </div>
                                        </div>

                                        <AnimatePresence>
                                            {isConnecting2 && (
                                                <motion.div
                                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                                    className="absolute inset-0 bg-blue-600 flex items-center justify-center p-4"
                                                >
                                                    <motion.div
                                                        animate={{ rotate: 360 }}
                                                        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                                                        className="h-6 w-6 border-2 border-white/20 border-t-white rounded-full mr-3"
                                                    />
                                                    <span className="text-white font-medium text-sm">Authenticating API...</span>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </motion.div>

                                    {/* Disabled Options */}
                                    <div className="h-32 border border-slate-200/50 rounded-2xl p-5 flex flex-col justify-center gap-3 bg-white opacity-50">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-slate-400">
                                                <Database className="h-6 w-6" />
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-slate-800">Database Proxy</h3>
                                                <p className="text-xs text-slate-500">Audit & Control</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="h-32 border border-slate-200/50 rounded-2xl p-5 flex flex-col justify-center gap-3 bg-white opacity-50">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-slate-400">
                                                <Key className="h-6 w-6" />
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-slate-800">IAM Provider</h3>
                                                <p className="text-xs text-slate-500">Identity Sync</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>

            </motion.div>

            {/* Fake Mouse Cursor for the Demo Video */}
            <motion.div
                animate={{ x: mouseX, y: mouseY, scale: (step === 2 || step === 5 || step === 9) ? 0.9 : 1 }}
                transition={springTransition}
                className="fixed top-0 left-0 z-[100] pointer-events-none drop-shadow-md"
                style={{ marginLeft: '-12px', marginTop: '-12px' }}
            >
                {/* Standard pointer cursor SVG */}
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M11 25.5L14.5 15.5L22.5 13.5L8.5 7.5L11 25.5Z" fill="black" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                </svg>

                {/* Click ripple effect */}
                <AnimatePresence>
                    {(step === 3 || step === 6 || step === 10 || step === 12) && (
                        <motion.div
                            initial={{ scale: 0, opacity: 0.5 }}
                            animate={{ scale: 2, opacity: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.4 }}
                            className="absolute top-1/2 left-1/2 -mt-4 -ml-4 w-8 h-8 rounded-full bg-blue-500/30"
                        />
                    )}
                </AnimatePresence>
            </motion.div>

        </div>
    );
}
