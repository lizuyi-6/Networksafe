import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Server, Download, Check, FileCode, ChevronRight, Save } from 'lucide-react';
import { clsx } from 'clsx';
import { useLanguage } from '../context/LanguageContext';
import { fetchDeploymentHistory, generateDeploymentConfig, getDeploymentDownloadUrl, saveDeploymentConfig } from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';

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
        upstream: 'http://backend:3005',
    });

    const handleNext = async () => {
        if (step === 1) {
            setStep(2);
            return;
        }
        if (step === 2) {
            await doGenerate();
        }
    };

    const handleBack = () => {
        setError(null);
        setStep((prev) => Math.max(1, prev - 1));
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
                    upstream: config.upstream,
                },
            });
            setGenerated(response.data);
            setStep(3);
        } catch (e: any) {
            setError(e.message || '生成配置失败');
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
                    upstream: config.upstream,
                },
                configText: generated.configText,
                envSnippet: generated.envSnippet,
                name: `${serverType}-${config.serverName}`,
            });
            setSavedId(response.data.deploymentId);
            await loadHistory();
        } catch (e: any) {
            setError(e.message || '保存部署配置失败');
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
        <ConsolePage title={t('deploy.title')} subtitle="按步骤生成、保存并下载中间件部署配置">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                <ConsolePanel title="部署向导" subtitle="按步骤完成中间件配置" icon={Server} iconTone="primary" className="xl:col-span-2">
                    <div className="relative mb-12 flex items-center justify-between">
                        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-border" />
                        {[1, 2, 3].map((s) => (
                            <div key={s} className="relative z-10 flex flex-col items-center gap-2 bg-card px-2">
                                <div
                                    className={clsx(
                                        'flex h-8 w-8 items-center justify-center rounded-full border text-sm font-bold transition-all',
                                        step >= s ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted text-muted-foreground',
                                    )}
                                >
                                    {step > s ? <Check size={14} /> : s}
                                </div>
                                <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">{s === 1 ? t('deploy.step1') : s === 2 ? t('deploy.step2') : t('deploy.step3')}</span>
                            </div>
                        ))}
                    </div>

                    {error && <div className="mb-4 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}

                    {step === 1 && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                            <h2 className="mb-6 text-lg font-medium text-foreground">{t('deploy.select_server')}</h2>
                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                {(['nginx', 'apache'] as const).map((type) => (
                                    <div
                                        key={type}
                                        onClick={() => setServerType(type)}
                                        className={clsx(
                                            'flex cursor-pointer flex-col items-center gap-4 rounded-xl border p-6 transition-colors',
                                            serverType === type ? 'border-primary bg-primary/5' : 'border-border bg-muted/15 hover:bg-muted/25',
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
                                    <label className="mb-2 block text-xs text-muted-foreground">{t('deploy.listen_port')}</label>
                                    <input
                                        type="text"
                                        value={config.port}
                                        onChange={(e) => setConfig({ ...config, port: e.target.value })}
                                        className="w-full rounded-lg border border-border bg-muted/20 px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="mb-2 block text-xs text-muted-foreground">{t('deploy.server_name')}</label>
                                    <input
                                        type="text"
                                        value={config.serverName}
                                        onChange={(e) => setConfig({ ...config, serverName: e.target.value })}
                                        className="w-full rounded-lg border border-border bg-muted/20 px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="mb-2 block text-xs text-muted-foreground">{t('deploy.rate_limit')}</label>
                                    <input
                                        type="text"
                                        value={config.rateLimit}
                                        onChange={(e) => setConfig({ ...config, rateLimit: e.target.value })}
                                        className="w-full rounded-lg border border-border bg-muted/20 px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="mb-2 block text-xs text-muted-foreground">{t('wizard.upstream')}</label>
                                    <input
                                        type="text"
                                        value={config.upstream}
                                        onChange={(e) => setConfig({ ...config, upstream: e.target.value })}
                                        className="w-full rounded-lg border border-border bg-muted/20 px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                                    />
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {step === 3 && generated && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                            <div className="mb-4 text-center">
                                <div className="mb-4 inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-600 dark:text-emerald-400">
                                    <FileCode size={48} />
                                </div>
                                <h2 className="text-xl font-bold text-foreground">{t('deploy.config_ready')}</h2>
                                <p className="mt-2 text-sm text-muted-foreground">{t('deploy.config_desc')}</p>
                            </div>

                            <div className="text-xs text-muted-foreground">
                                校验和：<span className="font-mono">{generated.checksum}</span>
                            </div>
                            <div className="overflow-x-auto rounded-xl border border-border bg-muted/20 p-6 font-mono text-xs text-foreground">
                                <pre>{generated.configText}</pre>
                                <div className="my-4 border-t border-border"></div>
                                <pre>{generated.envSnippet}</pre>
                            </div>
                        </motion.div>
                    )}

                    <div className="mt-8 flex justify-between border-t border-border pt-6">
                        <button
                            onClick={handleBack}
                            disabled={step === 1 || loading || saving}
                            className={clsx('rounded-lg px-4 py-2 text-sm font-medium transition-colors', step === 1 ? 'cursor-not-allowed text-muted-foreground' : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground')}
                        >
                            {t('deploy.back')}
                        </button>

                        {step < 3 ? (
                            <button
                                onClick={handleNext}
                                disabled={(step === 1 && !serverType) || loading}
                                className={clsx(
                                    'flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors',
                                    (step === 1 && !serverType) || loading ? 'cursor-not-allowed opacity-50' : 'hover:bg-primary/90',
                                )}
                            >
                                {loading ? t('wizard.generating') : t('deploy.next')} <ChevronRight size={16} />
                            </button>
                        ) : (
                            <div className="flex gap-2">
                                <button
                                    onClick={doSave}
                                    disabled={saving || !generated}
                                    className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                                >
                                    <Save size={16} /> {saving ? t('wizard.saving') : t('wizard.save_version')}
                                </button>
                                <a
                                    href={savedId ? getDeploymentDownloadUrl(savedId, 'bundle') : '#'}
                                    className={clsx('flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500', !savedId && 'pointer-events-none opacity-50')}
                                >
                                    <Download size={16} /> {t('wizard.download')}
                                </a>
                            </div>
                        )}
                    </div>
                </ConsolePanel>

                <ConsolePanel title={t('wizard.deployment_history')} subtitle="最近生成与保存的配置包" icon={FileCode} iconTone="neutral">
                    <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
                        {history.length === 0 && <ConsoleEmptyState title={t('wizard.no_profiles')} description="还没有保存过部署配置。" />}
                        {history.map((row: any) => (
                            <div key={row.id} className="rounded-xl border border-border bg-muted/15 p-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <div className="text-sm font-medium text-foreground">{row.name || row.server_type}</div>
                                        <div className="text-xs text-muted-foreground">
                                            v{row.version} / {row.server_type}
                                        </div>
                                    </div>
                                    <a href={getDeploymentDownloadUrl(row.id, 'bundle')} className="text-xs text-primary hover:underline">
                                        {t('wizard.download')}
                                    </a>
                                </div>
                                <div className="mt-2 break-all font-mono text-[10px] text-muted-foreground">{row.checksum}</div>
                                <div className="mt-1 text-[10px] text-muted-foreground">{new Date(row.created_at).toLocaleString()}</div>
                            </div>
                        ))}
                    </div>
                </ConsolePanel>
            </div>
        </ConsolePage>
    );
};

export default DeploymentWizard;
