import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Brain, Lock, Sparkles, Crown, Loader2, AlertTriangle } from 'lucide-react';
import { fetchAvailableModels, AIModelInfo } from '../services/api';
import { useLanguage } from '../context/LanguageContext';

const getCategoryIcon = (model: AIModelInfo) => {
    if (model.category === 'partner') {
        return <Sparkles className="h-3.5 w-3.5" />;
    }
    return <Brain className="h-3.5 w-3.5" />;
};

const getCategoryLabel = (model: AIModelInfo) => {
    if (model.category === 'partner') {
        return 'Partner';
    }
    return 'Tencent';
};

const getTierBadge = (tier: string) => {
    switch (tier) {
        case 'starter':
            return <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">STARTER</span>;
        case 'pro':
            return <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-bold text-blue-600 dark:text-blue-400">PRO</span>;
        case 'ultra':
            return <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold text-rose-600 dark:text-rose-400">ULTRA</span>;
        default:
            return null;
    }
};

const ModelSelector = () => {
    const [models, setModels] = useState<AIModelInfo[]>([]);
    const [plan, setPlan] = useState<string>('starter');
    const [canCustomize, setCanCustomize] = useState(false);
    const [selectedModelId, setSelectedModelId] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { t } = useLanguage();

    const loadModels = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await fetchAvailableModels();
            setModels(data.models);
            setPlan(data.plan);
            setCanCustomize(data.canCustomize);
            setSelectedModelId(data.defaultModelId);
        } catch (err: any) {
            setError(err.message || 'Failed to load model catalog');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadModels();
    }, [loadModels]);

    if (loading) {
        return (
            <div className="flex items-center justify-center gap-3 rounded-2xl border border-border bg-card p-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">{t('modelSelector.loadingConfig')}</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-2xl border border-rose-500/20 bg-card p-6">
                <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                    <AlertTriangle className="h-5 w-5" />
                    <span>{error}</span>
                </div>
                <button onClick={loadModels} className="mt-3 rounded-lg border border-border bg-muted px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-muted/80">
                    {t('modelSelector.retry')}
                </button>
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/20 px-6 py-4">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-primary">
                        <Brain className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-foreground">{t('modelSelector.title')}</h3>
                        <p className="text-xs text-muted-foreground">
                            {t('modelSelector.currentPlan')}: {getTierBadge(plan)}
                            <span className="ml-2">
                                {models.filter((model) => model.available).length}/{models.length} {t('modelSelector.modelsAvailable')}
                            </span>
                        </p>
                    </div>
                </div>
                {canCustomize && (
                    <span className="flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                        <Crown className="h-3 w-3" />
                        {t('modelSelector.customPolicy')}
                    </span>
                )}
            </div>

            <div className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
                {models.map((model, idx) => {
                    const isSelected = model.id === selectedModelId;
                    const isLocked = !model.available;

                    return (
                        <motion.button
                            key={model.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            whileHover={isLocked ? {} : { y: -4, scale: 1.01, transition: { duration: 0.2 } }}
                            onClick={() => !isLocked && setSelectedModelId(model.id)}
                            disabled={isLocked}
                            className={`relative rounded-xl border p-4 text-left transition-colors ${isLocked
                                    ? 'cursor-not-allowed border-border bg-muted/15 opacity-60'
                                    : isSelected
                                        ? 'border-primary/25 bg-primary/5'
                                        : 'border-border bg-card hover:bg-muted/20 hover:shadow-lg hover:border-primary/30'
                                }`}
                        >
                            {isSelected && <div className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-primary" />}

                            {isLocked && (
                                <div className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-muted">
                                    <Lock className="h-3 w-3 text-muted-foreground" />
                                </div>
                            )}

                            <div className="mb-1.5 flex items-center gap-2">
                                <span className="text-sm font-semibold text-foreground">{model.name}</span>
                            </div>

                            <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{model.description}</p>

                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {getCategoryIcon(model)}
                                    {getCategoryLabel(model)}
                                </span>
                                {getTierBadge(model.minTier)}
                                {isLocked && <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-400">{t('modelSelector.upgradeRequired')}</span>}
                            </div>
                        </motion.button>
                    );
                })}
            </div>
        </div>
    );
};

export default ModelSelector;
