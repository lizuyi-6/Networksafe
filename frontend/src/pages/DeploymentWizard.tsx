import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Server, Download, Check, FileCode, ChevronRight, Save } from 'lucide-react';
import { clsx } from 'clsx';
import { useLanguage } from '../context/LanguageContext';
import {
    fetchDeploymentHistory,
    generateDeploymentConfig,
    getDeploymentDownloadUrl,
    saveDeploymentConfig
} from '../services/api';

interface GeneratedConfig {
    configText: string;
    envSnippet: string;
    checksum: string;
    warnings: string[];
}

const DeploymentWizard = () => {
    const { t } = useLanguage();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [serverType, setServerType] = useState<'nginx' | 'apache' | null>(null);
    const [generated, setGenerated] = useState<GeneratedConfig | null>(null);
    const [savedId, setSavedId] = useState<string | null>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [config, setConfig] = useState({
        port: '8080',
        serverName: 'api.example.com',
        rateLimit: '100',
        upstream: 'http://backend:3005'
    });

    const handleNext = async () => {
        if (step === 1) {
            setStep(2);
            return;
        }
        if (step === 2) {
            await doGenerate();
            return;
        }
    };

    const handleBack = () => {
        setError(null);
        setStep(prev => Math.max(1, prev - 1));
    };

    const doGenerate = async () => {
        if (!serverType) return;
        setError(null);
        setLoading(true);
        try {
            const response = await generateDeploymentConfig({
                serverType,
                profile: {
                    port: Number(config.port),
                    serverName: config.serverName,
                    rateLimit: Number(config.rateLimit),
                    upstream: config.upstream
                }
            });
            setGenerated(response.data);
            setStep(3);
        } catch (e: any) {
            setError(e.message || 'Failed to generate configuration');
        } finally {
            setLoading(false);
        }
    };

    const doSave = async () => {
        if (!serverType || !generated) return;
        setSaving(true);
        setError(null);
        try {
            const response = await saveDeploymentConfig({
                serverType,
                profile: {
                    port: Number(config.port),
                    serverName: config.serverName,
                    rateLimit: Number(config.rateLimit),
                    upstream: config.upstream
                },
                configText: generated.configText,
                envSnippet: generated.envSnippet,
                name: `${serverType}-${config.serverName}`
            });
            setSavedId(response.data.deploymentId);
            await loadHistory();
        } catch (e: any) {
            setError(e.message || 'Failed to save deployment profile');
        } finally {
            setSaving(false);
        }
    };

    const loadHistory = async () => {
        try {
            const rows = await fetchDeploymentHistory(undefined, 10);
            setHistory(rows);
        } catch {
            setHistory([]);
        }
    };

    useEffect(() => {
        loadHistory();
    }, []);

    return (
        <div className="space-y-6 p-6">
            <h1 className="text-xl font-medium text-foreground">
                {t('deploy.title')}
            </h1>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="bg-card border border-border p-8 rounded-lg xl:col-span-2">
                    <div className="flex justify-between items-center mb-12 relative">
                        <div className="absolute top-1/2 left-0 w-full h-px bg-border -z-0"></div>
                        {[1, 2, 3].map((s) => (
                            <div key={s} className="relative z-10 flex flex-col items-center gap-2 bg-card px-2">
                                <div className={clsx(
                                    'w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 border',
                                    step >= s ? 'bg-primary border-primary text-primary-foreground shadow-lg shadow-indigo-900/20' : 'bg-muted border-border text-muted-foreground'
                                )}>
                                    {step > s ? <Check size={14} /> : s}
                                </div>
                                <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">
                                    {s === 1 ? t('deploy.step1') : s === 2 ? t('deploy.step2') : t('deploy.step3')}
                                </span>
                            </div>
                        ))}
                    </div>

                    {error && (
                        <div className="mb-4 p-3 rounded border border-red-500/30 text-red-300 bg-red-500/10 text-sm">
                            {error}
                        </div>
                    )}

                    {step === 1 && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                            <h2 className="text-lg font-medium text-foreground mb-6">{t('deploy.select_server')}</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {(['nginx', 'apache'] as const).map((type) => (
                                    <div
                                        key={type}
                                        onClick={() => setServerType(type)}
                                        className={clsx(
                                            'cursor-pointer p-6 rounded border transition-all duration-300 flex flex-col items-center gap-4 hover:border-primary/50 hover:bg-muted/5',
                                            serverType === type ? 'bg-primary/10 border-primary' : 'bg-muted/20 border-border'
                                        )}
                                    >
                                        <Server size={48} className={serverType === type ? 'text-primary' : 'text-muted-foreground'} />
                                        <span className="text-base font-medium capitalize text-foreground">{type}</span>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}

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
                                <div>
                                    <label className="block text-xs text-muted-foreground mb-2">{t('wizard.upstream')}</label>
                                    <input
                                        type="text"
                                        value={config.upstream}
                                        onChange={e => setConfig({ ...config, upstream: e.target.value })}
                                        className="w-full bg-muted/20 border border-border rounded px-4 py-2 text-foreground focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
                                    />
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {step === 3 && generated && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                            <div className="text-center mb-4">
                                <div className="inline-flex p-4 rounded-full bg-emerald-500/10 text-emerald-400 mb-4 border border-emerald-500/20">
                                    <FileCode size={48} />
                                </div>
                                <h2 className="text-xl font-bold text-foreground">{t('deploy.config_ready')}</h2>
                                <p className="text-muted-foreground text-sm mt-2">{t('deploy.config_desc')}</p>
                            </div>

                            <div className="text-xs text-muted-foreground">
                                checksum: <span className="font-mono">{generated.checksum}</span>
                            </div>
                            <div className="bg-muted/30 rounded-lg p-6 border border-border font-mono text-xs text-indigo-300 overflow-x-auto">
                                <pre>{generated.configText}</pre>
                                <div className="my-4 border-t border-border"></div>
                                <pre>{generated.envSnippet}</pre>
                            </div>
                        </motion.div>
                    )}

                    <div className="flex justify-between mt-8 pt-6 border-t border-border">
                        <button
                            onClick={handleBack}
                            disabled={step === 1 || loading || saving}
                            className={clsx(
                                'px-4 py-2 rounded font-medium transition-colors text-sm',
                                step === 1 ? 'text-muted-foreground cursor-not-allowed' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                            )}
                        >
                            {t('deploy.back')}
                        </button>

                        {step < 3 ? (
                            <button
                                onClick={handleNext}
                                disabled={(step === 1 && !serverType) || loading}
                                className={clsx(
                                    'px-6 py-2 bg-indigo-600 rounded font-medium text-white flex items-center gap-2 transition-all text-sm',
                                    ((step === 1 && !serverType) || loading) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-500/20'
                                )}
                            >
                                {loading ? t('wizard.generating') : t('deploy.next')} <ChevronRight size={16} />
                            </button>
                        ) : (
                            <div className="flex gap-2">
                                <button
                                    onClick={doSave}
                                    disabled={saving || !generated}
                                    className="px-4 py-2 bg-primary hover:bg-primary/90 rounded font-medium text-white flex items-center gap-2 text-sm disabled:opacity-60"
                                >
                                    <Save size={16} /> {saving ? t('wizard.saving') : t('wizard.save_version')}
                                </button>
                                <a
                                    href={savedId ? getDeploymentDownloadUrl(savedId, 'bundle') : '#'}
                                    className={clsx(
                                        'px-6 py-2 bg-emerald-600 hover:bg-emerald-500 rounded font-medium text-white flex items-center gap-2 shadow-lg shadow-emerald-900/20 text-sm',
                                        !savedId && 'opacity-50 pointer-events-none'
                                    )}
                                >
                                    <Download size={16} /> {t('wizard.download')}
                                </a>
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-card border border-border rounded-lg p-5">
                    <h3 className="text-sm font-medium text-foreground mb-4">{t('wizard.deployment_history')}</h3>
                    <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                        {history.length === 0 && (
                            <div className="text-xs text-muted-foreground">{t('wizard.no_profiles')}</div>
                        )}
                        {history.map((row: any) => (
                            <div key={row.id} className="p-3 rounded border border-border bg-muted/20">
                                <div className="flex justify-between items-start gap-2">
                                    <div>
                                        <div className="text-sm text-foreground font-medium">{row.name || row.server_type}</div>
                                        <div className="text-xs text-muted-foreground">v{row.version} · {row.server_type}</div>
                                    </div>
                                    <a
                                        href={getDeploymentDownloadUrl(row.id, 'bundle')}
                                        className="text-xs text-primary hover:underline"
                                    >
                                        {t('wizard.download')}
                                    </a>
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-2 font-mono break-all">{row.checksum}</div>
                                <div className="text-[10px] text-muted-foreground mt-1">{new Date(row.created_at).toLocaleString()}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DeploymentWizard;

