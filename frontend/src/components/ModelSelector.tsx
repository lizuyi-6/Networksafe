import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
    Brain, Lock, Sparkles,
    Crown, Loader2, AlertTriangle
} from 'lucide-react';
import { fetchAvailableModels, AIModelInfo } from '../services/api';

// ========================
// 辅助函数
// ========================
const getCategoryIcon = (model: AIModelInfo) => {
    if (model.id.includes('glm') || model.id.includes('kimi')) {
        return <Sparkles className="w-3.5 h-3.5" />;
    }
    return <Brain className="w-3.5 h-3.5" />;
};

const getCategoryLabel = (model: AIModelInfo) => {
    if (model.id.includes('glm') || model.id.includes('kimi')) {
        return '第三方';
    }
    return '千问系列';
};

const getTierBadge = (tier: string) => {
    switch (tier) {
        case 'starter':
            return <span className="px-1.5 py-0.5 text-[9px] font-bold bg-gray-700 text-gray-300 rounded-full">STARTER</span>;
        case 'pro':
            return <span className="px-1.5 py-0.5 text-[9px] font-bold bg-gradient-to-r from-blue-600 to-blue-400 text-white rounded-full">PRO</span>;
        case 'ultra':
            return <span className="px-1.5 py-0.5 text-[9px] font-bold bg-gradient-to-r from-purple-600 to-red-500 text-white rounded-full">ULTRA</span>;
        default:
            return null;
    }
};

// ========================
// 主组件
// ========================
const ModelSelector = () => {
    const [models, setModels] = useState<AIModelInfo[]>([]);
    const [plan, setPlan] = useState<string>('starter');
    const [canCustomize, setCanCustomize] = useState(false);
    const [selectedModelId, setSelectedModelId] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
            setError(err.message || '加载模型列表失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadModels(); }, [loadModels]);

    if (loading) {
        return (
            <div className="bg-card/50 backdrop-blur-md border border-border rounded-2xl p-8 flex items-center justify-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                <span className="text-muted-foreground">加载 AI 模型配置...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-card/50 backdrop-blur-md border border-red-500/30 rounded-2xl p-6">
                <div className="flex items-center gap-2 text-red-400">
                    <AlertTriangle className="w-5 h-5" />
                    <span>{error}</span>
                </div>
                <button onClick={loadModels} className="mt-3 px-4 py-1.5 bg-red-500/20 text-red-300 rounded-lg text-sm hover:bg-red-500/30 transition">
                    重试
                </button>
            </div>
        );
    }

    return (
        <div className="bg-card/50 backdrop-blur-md border border-border rounded-2xl overflow-hidden">
            {/* 标题栏 */}
            <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center">
                        <Brain className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-foreground text-lg">AI 模型中心</h3>
                        <p className="text-xs text-muted-foreground">
                            当前订阅: {getTierBadge(plan)}
                            <span className="ml-2 text-muted-foreground/60">
                                · {models.filter(m => m.available).length}/{models.length} 个模型可用
                            </span>
                        </p>
                    </div>
                </div>
                {canCustomize && (
                    <span className="px-3 py-1 text-xs bg-gradient-to-r from-purple-600/20 to-red-500/20 text-purple-300 rounded-full border border-purple-500/30 flex items-center gap-1">
                        <Crown className="w-3 h-3" /> 自定义模型已解锁
                    </span>
                )}
            </div>

            {/* 模型网格 */}
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {models.map((model, idx) => {
                    const isSelected = model.id === selectedModelId;
                    const isLocked = !model.available;

                    return (
                        <motion.button
                            key={model.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            onClick={() => !isLocked && setSelectedModelId(model.id)}
                            disabled={isLocked}
                            className={`
                                relative group text-left p-4 rounded-xl border transition-all duration-200
                                ${isLocked
                                    ? 'opacity-50 cursor-not-allowed border-border/30 bg-card/20'
                                    : isSelected
                                        ? 'border-blue-500/60 bg-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.15)]'
                                        : 'border-border/50 bg-card/30 hover:border-blue-500/30 hover:bg-blue-500/5 cursor-pointer'
                                }
                            `}
                        >
                            {/* 选中指示器 */}
                            {isSelected && (
                                <motion.div
                                    layoutId="model-indicator"
                                    className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-blue-500"
                                    initial={false}
                                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                >
                                    <div className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-60" />
                                </motion.div>
                            )}

                            {/* 锁定图标 */}
                            {isLocked && (
                                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-gray-700/60 flex items-center justify-center">
                                    <Lock className="w-3 h-3 text-gray-400" />
                                </div>
                            )}

                            {/* 模型名称 */}
                            <div className="flex items-center gap-2 mb-1.5">
                                <span className="font-semibold text-sm text-foreground">{model.name}</span>
                            </div>

                            {/* 描述 */}
                            <p className="text-xs text-muted-foreground line-clamp-2 mb-2.5">
                                {model.description}
                            </p>

                            {/* 标签行 */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium
                                    ${(model.id.includes('glm') || model.id.includes('kimi')) ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'}
                                `}>
                                    {getCategoryIcon(model)}
                                    {getCategoryLabel(model)}
                                </span>
                                {getTierBadge(model.minTier)}
                                {isLocked && (
                                    <span className="text-[10px] text-yellow-500/80 ml-auto">需升级</span>
                                )}
                            </div>
                        </motion.button>
                    );
                })}
            </div>
        </div>
    );
};

export default ModelSelector;
