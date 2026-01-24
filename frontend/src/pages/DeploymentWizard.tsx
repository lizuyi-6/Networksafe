import { useState } from 'react';
import { motion } from 'framer-motion';
import { Server, Download, Check, FileCode, ChevronRight } from 'lucide-react';
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
        <div className="space-y-6 p-6">
            <h1 className="text-xl font-medium text-foreground">
                {t('deploy.title')}
            </h1>

            <div className="bg-card border border-border p-8 rounded-lg max-w-4xl mx-auto">
                {/* Steps */}
                <div className="flex justify-between items-center mb-12 relative">
                    <div className="absolute top-1/2 left-0 w-full h-px bg-border -z-0"></div>
                    {[1, 2, 3].map((s) => (
                        <div key={s} className="relative z-10 flex flex-col items-center gap-2 bg-card px-2">
                            <div className={clsx(
                                "w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 border",
                                step >= s ? "bg-primary border-primary text-primary-foreground shadow-lg shadow-indigo-900/20" : "bg-muted border-border text-muted-foreground"
                            )}>
                                {step > s ? <Check size={14} /> : s}
                            </div>
                            <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">
                                {s === 1 ? t('deploy.step1') : s === 2 ? t('deploy.step2') : t('deploy.step3')}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Step 1: Server Selection */}
                {step === 1 && (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                        <h2 className="text-lg font-medium text-foreground mb-6">{t('deploy.select_server')}</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {(['nginx', 'apache'] as const).map((type) => (
                                <div
                                    key={type}
                                    onClick={() => setServerType(type)}
                                    className={clsx(
                                        "cursor-pointer p-6 rounded border transition-all duration-300 flex flex-col items-center gap-4 hover:border-primary/50 hover:bg-muted/5",
                                        serverType === type
                                            ? "bg-primary/10 border-primary"
                                            : "bg-muted/20 border-border"
                                    )}
                                >
                                    <Server size={48} className={serverType === type ? "text-primary" : "text-muted-foreground"} />
                                    <span className="text-base font-medium capitalize text-foreground">{type}</span>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}

                {/* Step 2: Configuration */}
                {step === 2 && (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                        <h2 className="text-lg font-medium text-foreground">{t('deploy.configure_middleware')}</h2>
                        <div className="grid grid-cols-1 gap-6">
                            <div>
                                <label className="block text-xs text-muted-foreground mb-2">{t('deploy.listen_port')}</label>
                                <input
                                    type="text"
                                    value={config.port}
                                    onChange={e => setConfig({ ...config, port: e.target.value })}
                                    className="w-full bg-muted/20 border border-border rounded px-4 py-2 text-foreground focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-muted-foreground mb-2">{t('deploy.server_name')}</label>
                                <input
                                    type="text"
                                    value={config.serverName}
                                    onChange={e => setConfig({ ...config, serverName: e.target.value })}
                                    className="w-full bg-muted/20 border border-border rounded px-4 py-2 text-foreground focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-muted-foreground mb-2">{t('deploy.rate_limit')}</label>
                                <input
                                    type="text"
                                    value={config.rateLimit}
                                    onChange={e => setConfig({ ...config, rateLimit: e.target.value })}
                                    className="w-full bg-muted/20 border border-border rounded px-4 py-2 text-foreground focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
                                />
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* Step 3: Download */}
                {step === 3 && (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                        <div className="text-center mb-8">
                            <div className="inline-flex p-4 rounded-full bg-emerald-500/10 text-emerald-400 mb-4 border border-emerald-500/20">
                                <FileCode size={48} />
                            </div>
                            <h2 className="text-xl font-bold text-foreground">{t('deploy.config_ready')}</h2>
                            <p className="text-muted-foreground text-sm mt-2">{t('deploy.config_desc')}</p>
                        </div>

                        <div className="bg-muted/30 rounded-lg p-6 border border-border font-mono text-xs text-indigo-400 overflow-x-auto">
                            <pre>{generateConfig()}</pre>
                        </div>
                    </motion.div>
                )}

                {/* Navigation Buttons */}
                <div className="flex justify-between mt-12 pt-6 border-t border-border">
                    <button
                        onClick={handleBack}
                        disabled={step === 1}
                        className={clsx(
                            "px-4 py-2 rounded font-medium transition-colors text-sm",
                            step === 1 ? "text-muted-foreground cursor-not-allowed" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        )}
                    >
                        {t('deploy.back')}
                    </button>

                    {step < 3 ? (
                        <button
                            onClick={handleNext}
                            disabled={step === 1 && !serverType}
                            className={clsx(
                                "px-6 py-2 bg-indigo-600 rounded font-medium text-white flex items-center gap-2 transition-all text-sm",
                                (step === 1 && !serverType) ? "opacity-50 cursor-not-allowed" : "hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-500/20"
                            )}
                        >
                            {t('deploy.next')} <ChevronRight size={16} />
                        </button>
                    ) : (
                        <button className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 rounded font-medium text-white flex items-center gap-2 shadow-lg shadow-emerald-900/20 text-sm">
                            <Download size={16} /> {t('deploy.download')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
export default DeploymentWizard;
