import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Server, Download, Check, FileCode, ChevronRight, Settings } from 'lucide-react';
import { clsx } from 'clsx';
import { useLanguage } from '../context/LanguageContext';

const DeploymentWizard = () => {
    const { t } = useLanguage();
    const [step, setStep] = useState(1);
    const [serverType, setServerType] = useState<'nginx' | 'apache' | null>(null);
    const [config, setConfig] = useState({
        port: '8080',
        serverName: 'api.example.com',
        rateLimit: '100',
    });

    const handleNext = () => setStep(prev => prev + 1);
    const handleBack = () => setStep(prev => prev - 1);

    const generateConfig = () => {
        // ... (keep generate logic the same)
        if (serverType === 'nginx') {
            return `
server {
    listen ${config.port};
    server_name ${config.serverName};

    # Anti-bot Protection
    location / {
        proxy_pass http://backend_upstream;
        proxy_set_header X-Real-IP $remote_addr;
        
        # Rate Limiting
        limit_req zone=api_limit burst=${config.rateLimit} nodelay;
    }
}`;
        }
        return `
<VirtualHost *:${config.port}>
    ServerName ${config.serverName}
    
    # Rate Limiting
    <Location />
        SetEnv rate-limit ${config.rateLimit}
    </Location>
</VirtualHost>`;
    };

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold text-gradient">
                {t('deploy.title')}
            </h1>

            <div className="glass-panel p-8 rounded-xl max-w-4xl mx-auto">
                {/* Steps */}
                <div className="flex justify-between items-center mb-12 relative">
                    <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-200 -z-0"></div>
                    {[1, 2, 3].map((s) => (
                        <div key={s} className="relative z-10 flex flex-col items-center gap-2 bg-[#F3F2F1] px-2">
                            <div className={clsx(
                                "w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all duration-300",
                                step >= s ? "bg-blue-600 text-white shadow-md shadow-blue-200" : "bg-white border border-gray-200 text-gray-400"
                            )}>
                                {step > s ? <Check size={20} /> : s}
                            </div>
                            <span className="text-xs text-gray-500 font-medium">
                                {s === 1 ? t('deploy.step1') : s === 2 ? t('deploy.step2') : t('deploy.step3')}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Step 1: Server Selection */}
                {step === 1 && (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                        <h2 className="text-xl font-semibold text-gray-900 mb-6">{t('deploy.select_server')}</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {(['nginx', 'apache'] as const).map((type) => (
                                <div
                                    key={type}
                                    onClick={() => setServerType(type)}
                                    className={clsx(
                                        "cursor-pointer p-6 rounded-xl border transition-all duration-300 flex flex-col items-center gap-4 hover:shadow-lg",
                                        serverType === type
                                            ? "bg-blue-50 border-blue-500 shadow-md"
                                            : "bg-white border-gray-200 hover:border-blue-300"
                                    )}
                                >
                                    <Server size={48} className={serverType === type ? "text-blue-600" : "text-gray-400"} />
                                    <span className="text-lg font-medium capitalize text-gray-700">{type}</span>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}

                {/* Step 2: Configuration */}
                {step === 2 && (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                        <h2 className="text-xl font-semibold text-gray-900">{t('deploy.configure_middleware')}</h2>
                        <div className="grid grid-cols-1 gap-6">
                            <div>
                                <label className="block text-sm text-gray-500 mb-2">{t('deploy.listen_port')}</label>
                                <input
                                    type="text"
                                    value={config.port}
                                    onChange={e => setConfig({ ...config, port: e.target.value })}
                                    className="w-full bg-white border border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-500 mb-2">{t('deploy.server_name')}</label>
                                <input
                                    type="text"
                                    value={config.serverName}
                                    onChange={e => setConfig({ ...config, serverName: e.target.value })}
                                    className="w-full bg-white border border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-500 mb-2">{t('deploy.rate_limit')}</label>
                                <input
                                    type="text"
                                    value={config.rateLimit}
                                    onChange={e => setConfig({ ...config, rateLimit: e.target.value })}
                                    className="w-full bg-white border border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all shadow-sm"
                                />
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* Step 3: Download */}
                {step === 3 && (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                        <div className="text-center mb-8">
                            <div className="inline-flex p-4 rounded-full bg-green-500/10 text-green-600 mb-4">
                                <FileCode size={48} />
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900">{t('deploy.config_ready')}</h2>
                            <p className="text-gray-500">{t('deploy.config_desc')}</p>
                        </div>

                        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 font-mono text-sm text-blue-300 overflow-x-auto shadow-inner">
                            <pre>{generateConfig()}</pre>
                        </div>
                    </motion.div>
                )}

                {/* Navigation Buttons */}
                <div className="flex justify-between mt-12 pt-6 border-t border-gray-100">
                    <button
                        onClick={handleBack}
                        disabled={step === 1}
                        className={clsx(
                            "px-6 py-2 rounded-lg font-medium transition-colors",
                            step === 1 ? "text-gray-300 cursor-not-allowed" : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                        )}
                    >
                        {t('deploy.back')}
                    </button>

                    {step < 3 ? (
                        <button
                            onClick={handleNext}
                            disabled={step === 1 && !serverType}
                            className={clsx(
                                "px-6 py-2 bg-blue-600 rounded-lg font-medium text-white flex items-center gap-2 transition-all",
                                (step === 1 && !serverType) ? "opacity-50 cursor-not-allowed" : "hover:bg-blue-500 hover:shadow-lg"
                            )}
                        >
                            {t('deploy.next')} <ChevronRight size={18} />
                        </button>
                    ) : (
                        <button className="px-6 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-medium text-white flex items-center gap-2 shadow-lg shadow-green-900/20">
                            <Download size={18} /> {t('deploy.download')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
export default DeploymentWizard;
