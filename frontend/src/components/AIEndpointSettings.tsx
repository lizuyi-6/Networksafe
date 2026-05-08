import { useEffect, useState } from 'react';
import {
    Brain, Plus, Trash2, TestTube,
    Server, Laptop, Globe, Check, X, Loader2,
    ChevronDown, ChevronUp, AlertCircle
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import {
    fetchAIEndpoints,
    createAIEndpoint,
    updateAIEndpoint,
    deleteAIEndpoint,
    testAIEndpoint,
    verifyPlatformAI
} from '../services/api';
import type { PlatformAIProofError } from '../services/api';
import { motion, Variants } from 'framer-motion';

type EndpointType = 'ollama' | 'openai' | 'custom';
type EndpointPurpose = 'hot_path' | 'deep_analysis';

interface AIEndpoint {
    id: string;
    name: string;
    url: string;
    modelName: string;
    apiKey: string;
    enabled: boolean;
    priority: number;
    timeout: number;
    type: EndpointType;
    purpose?: EndpointPurpose;
    lastTest?: {
        success: boolean;
        latency: number;
        timestamp: string;
    };
}

interface AddEndpointFormData {
    name: string;
    url: string;
    modelName: string;
    apiKey: string;
    type: EndpointType;
    purpose: EndpointPurpose;
    priority: number;
}

const BUILT_IN_MODEL_OPTIONS = [
    { label: 'Tencent HY 2.0 Instruct', value: 'hunyuan-2.0-instruct' },
    { label: 'Tencent HY 2.0 Think', value: 'hunyuan-2.0-thinking' },
    { label: 'MiniMax-M2.5', value: 'minimax-m2.5' },
    { label: 'Kimi-K2.5', value: 'kimi-k2.5' },
    { label: 'GLM-5', value: 'glm-5' },
    { label: 'Hunyuan-T1', value: 'hunyuan-t1' },
    { label: 'Hunyuan-TurboS', value: 'hunyuan-turbos' }
];

const staggerContainer: Variants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1
        }
    }
};

const itemVariant: Variants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3 } }
};

const AIEndpointSettings = ({ onChanged }: { onChanged?: () => void }) => {
    const [endpoints, setEndpoints] = useState<AIEndpoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [verifyingPlatform, setVerifyingPlatform] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [platformProof, setPlatformProof] = useState<{
        success: boolean;
        content: string;
        model: string;
        latency: number;
        route?: string;
        provider?: string;
        upstreamPath?: string;
        requestId?: string;
    } | null>(null);
    const [platformProofError, setPlatformProofError] = useState<{
        message: string;
        provider?: string;
        upstreamStatus?: number;
        upstreamPath?: string;
        requestId?: string;
    } | null>(null);

    const [formData, setFormData] = useState<AddEndpointFormData>({
        name: '',
        url: '',
        modelName: '',
        apiKey: '',
        type: 'ollama',
        purpose: 'deep_analysis',
        priority: 10,
    });

    const { t } = useLanguage();

    const loadEndpoints = async () => {
        setLoading(true);
        setError(null);
        try {
            const rows = await fetchAIEndpoints();
            setEndpoints(rows || []);
        } catch (e: any) {
            setError(e.message || 'FG-AI-ENDPOINTS-LIST');
            setEndpoints([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadEndpoints();
    }, []);

    const handleAddEndpoint = async () => {
        if (!formData.url) return;
        setError(null);
        try {
            await createAIEndpoint({
                name: formData.name,
                url: formData.url,
                modelName: formData.modelName,
                apiKey: formData.apiKey,
                type: formData.type,
                purpose: formData.purpose,
                priority: formData.priority
            });
            setShowAddForm(false);
            setFormData({
                name: '',
                url: '',
                modelName: '',
                apiKey: '',
                type: 'ollama',
                purpose: 'deep_analysis',
                priority: 10,
            });
            await loadEndpoints();
            onChanged?.();
        } catch (e: any) {
            setError(e.message || 'FG-AI-ENDPOINTS-CREATE');
        }
    };

    const handleDeleteEndpoint = async (id: string) => {
        setError(null);
        try {
            await deleteAIEndpoint(id);
            await loadEndpoints();
            onChanged?.();
        } catch (e: any) {
            setError(e.message || 'FG-AI-ENDPOINTS-DELETE');
        }
    };

    const handleToggleEndpoint = async (id: string, enabled: boolean) => {
        setError(null);
        try {
            await updateAIEndpoint(id, { enabled: !enabled });
            await loadEndpoints();
            onChanged?.();
        } catch (e: any) {
            setError(e.message || 'FG-AI-ENDPOINTS-UPDATE');
        }
    };

    const handleTestEndpoint = async (id: string) => {
        setTestingId(id);
        setError(null);
        try {
            await testAIEndpoint(id);
            await loadEndpoints();
        } catch (e: any) {
            setError(e.message || 'FG-AI-ENDPOINTS-TEST');
        } finally {
            setTestingId(null);
        }
    };

    const handleVerifyPlatformAI = async () => {
        setVerifyingPlatform(true);
        setError(null);
        setPlatformProofError(null);
        try {
            const result = await verifyPlatformAI();
            setPlatformProof(result);
        } catch (e: any) {
            const typedError = e as PlatformAIProofError;
            setPlatformProof(null);
            setPlatformProofError({
                message: typedError.message || 'FG-AI-PLATFORM-VERIFY',
                provider: typedError.diagnostics?.provider,
                upstreamStatus: typedError.diagnostics?.upstreamStatus,
                upstreamPath: typedError.diagnostics?.upstreamPath,
                requestId: typedError.diagnostics?.requestId
            });
        } finally {
            setVerifyingPlatform(false);
        }
    };

    const handlePriorityChange = async (id: string, direction: 'up' | 'down') => {
        const sorted = [...endpoints].sort((a, b) => a.priority - b.priority);
        const idx = sorted.findIndex(ep => ep.id === id);
        if (idx < 0) return;

        const current = sorted[idx];
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= sorted.length) return;

        const target = sorted[targetIdx];
        setError(null);
        try {
            await Promise.all([
                updateAIEndpoint(current.id, { priority: target.priority }),
                updateAIEndpoint(target.id, { priority: current.priority })
            ]);
            await loadEndpoints();
            onChanged?.();
        } catch (e: any) {
            setError(e.message || 'FG-AI-ENDPOINTS-PRIORITY');
        }
    };

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'ollama': return <Laptop size={16} className="text-emerald-500" />;
            case 'openai': return <Globe size={16} className="text-blue-500" />;
            default: return <Server size={16} className="text-orange-500" />;
        }
    };

    const sortedEndpoints = [...endpoints].sort((a, b) => a.priority - b.priority);

    return (
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <div className="flex justify-between items-center mb-5">
                <div className="flex items-center gap-2">
                    <Brain size={18} className="text-primary" />
                    <h3 className="font-semibold text-foreground">{t('aiEndpoint.title')}</h3>
                </div>
                <button
                    data-testid="ai-endpoint-add-toggle"
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all"
                >
                    <Plus size={14} /> {t('aiEndpoint.addEndpoint')}
                </button>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4 text-xs text-red-300">
                    {error}
                </div>
            )}

            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-4 flex items-start gap-2">
                <AlertCircle size={16} className="text-blue-500 mt-0.5" />
                <div className="text-xs text-blue-700 dark:text-blue-300">
                    {t('aiEndpoint.priorityNote')}
                </div>
            </div>

            <div className="border border-border rounded-lg p-4 mb-4 bg-muted/20">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="text-sm font-medium text-foreground">{t('aiEndpoint.platformProof')}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                            {t('aiEndpoint.platformProofDesc')} <span className="font-mono">AETHERGUARD_REMOTE_AI_OK</span>.
                        </div>
                    </div>
                    <button
                        data-testid="ai-platform-verify"
                        onClick={handleVerifyPlatformAI}
                        disabled={verifyingPlatform}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                    >
                        {verifyingPlatform ? <Loader2 size={14} className="animate-spin" /> : <TestTube size={14} />}
                        {t('aiEndpoint.verifyPlatformAI')}
                    </button>
                </div>

                {platformProof && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
                        <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
                            <Check size={12} />
                            {t('aiEndpoint.platformProofSuccess')}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground space-y-1">
                            <div>{t('aiEndpoint.model')} <span className="text-foreground">{platformProof.model}</span></div>
                            <div>{t('aiEndpoint.latency')} <span className="text-foreground">{platformProof.latency}ms</span></div>
                            {platformProof.route && <div>{t('aiEndpoint.route')} <span className="text-foreground">{platformProof.route}</span></div>}
                            {platformProof.provider && <div>{t('aiEndpoint.provider')} <span className="text-foreground">{platformProof.provider}</span></div>}
                            {platformProof.upstreamPath && <div>{t('aiEndpoint.path')} <span className="font-mono text-foreground">{platformProof.upstreamPath}</span></div>}
                            {platformProof.requestId && <div>{t('aiEndpoint.requestId')} <span className="font-mono text-foreground">{platformProof.requestId}</span></div>}
                        </div>
                        <div className="mt-3 rounded-md border border-border bg-background/80 px-3 py-2 text-xs font-mono text-foreground break-all">
                            {platformProof.content}
                        </div>
                    </motion.div>
                )}

                {platformProofError && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
                        <div className="font-medium">{platformProofError.message}</div>
                        <div className="mt-2 space-y-1 text-rose-700/80 dark:text-rose-300/80">
                            {platformProofError.provider && <div>{t('aiEndpoint.provider')} {platformProofError.provider}</div>}
                            {platformProofError.upstreamStatus && <div>{t('aiEndpoint.status')} {platformProofError.upstreamStatus}</div>}
                            {platformProofError.upstreamPath && <div>{t('aiEndpoint.path')} <span className="font-mono">{platformProofError.upstreamPath}</span></div>}
                            {platformProofError.requestId && <div>{t('aiEndpoint.requestId')} <span className="font-mono">{platformProofError.requestId}</span></div>}
                        </div>
                    </motion.div>
                )}
            </div>

            {showAddForm && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="bg-muted/30 border border-border rounded-lg p-4 mb-4 overflow-hidden">
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">{t('aiEndpoint.name')}</label>
                            <input
                                data-testid="ai-endpoint-name"
                                type="text"
                                value={formData.name}
                                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Production model endpoint"
                                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">{t('aiEndpoint.type')}</label>
                            <select
                                data-testid="ai-endpoint-type"
                                value={formData.type}
                                onChange={e => setFormData(prev => ({ ...prev, type: e.target.value as EndpointType }))}
                                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                            >
                                <option value="ollama">Ollama</option>
                                <option value="openai">OpenAI Compatible</option>
                                <option value="custom">Custom</option>
                            </select>
                        </div>
                    </div>

                    <div className="mb-4">
                        <label className="block text-xs text-muted-foreground mb-1">{t('aiEndpoint.purpose')}</label>
                        <select
                            data-testid="ai-endpoint-purpose"
                            value={formData.purpose}
                            onChange={e => setFormData(prev => ({ ...prev, purpose: e.target.value as EndpointPurpose }))}
                            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                        >
                            <option value="deep_analysis">deep_analysis</option>
                            <option value="hot_path">hot_path</option>
                        </select>
                    </div>

                    <div className="mb-4">
                        <label className="block text-xs text-muted-foreground mb-1">{t('aiEndpoint.endpointUrl')}</label>
                        <input
                            data-testid="ai-endpoint-url"
                            type="text"
                            value={formData.url}
                            onChange={e => setFormData(prev => ({ ...prev, url: e.target.value }))}
                            placeholder="http://your-server:5000/api/analyze"
                            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">{t('aiEndpoint.modelLabel')}</label>
                            <input
                                data-testid="ai-endpoint-model"
                                type="text"
                                list="built-in-model-options"
                                value={formData.modelName}
                                onChange={e => setFormData(prev => ({ ...prev, modelName: e.target.value }))}
                                placeholder="glm-5 / hunyuan-turbos / kimi-k2.5"
                                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                            />
                            <datalist id="built-in-model-options">
                                {BUILT_IN_MODEL_OPTIONS.map((model) => (
                                    <option key={model.value} value={model.value}>
                                        {model.label}
                                    </option>
                                ))}
                            </datalist>
                        </div>
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">{t('aiEndpoint.apiKey')}</label>
                            <input
                                data-testid="ai-endpoint-api-key"
                                type="password"
                                value={formData.apiKey}
                                onChange={e => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
                                placeholder="sk-..."
                                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-2">
                        <button
                            data-testid="ai-endpoint-cancel"
                            onClick={() => setShowAddForm(false)}
                            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {t('aiEndpoint.cancel')}
                        </button>
                        <button
                            data-testid="ai-endpoint-submit"
                            onClick={handleAddEndpoint}
                            disabled={!formData.url}
                            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            {t('aiEndpoint.add')}
                        </button>
                    </div>
                </motion.div>
            )}

            {loading ? (
                <div className="text-center py-8 text-muted-foreground">
                    <Loader2 size={24} className="mx-auto mb-2 animate-spin" />
                    {t('aiEndpoint.loading')}
                </div>
            ) : sortedEndpoints.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                    {t('aiEndpoint.noEndpoints')}
                </div>
            ) : (
                <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-3">
                    {sortedEndpoints.map((endpoint, index) => (
                        <motion.div
                            variants={itemVariant}
                            whileHover={{ scale: 1.01 }}
                            key={endpoint.id}
                            data-testid={`ai-endpoint-row-${endpoint.id}`}
                            className={`border rounded-lg p-4 transition-all ${endpoint.enabled
                                ? 'border-border bg-card hover:border-primary/40'
                                : 'border-border/50 bg-muted/20 opacity-60'
                                }`}
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-3">
                                    <div className="flex flex-col items-center">
                                        <button
                                            data-testid={`ai-endpoint-priority-up-${endpoint.id}`}
                                            aria-label={`Move ${endpoint.name} up`}
                                            onClick={() => handlePriorityChange(endpoint.id, 'up')}
                                            disabled={index === 0}
                                            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                                        >
                                            <ChevronUp size={14} />
                                        </button>
                                        <span className="text-xs font-bold text-muted-foreground">{index + 1}</span>
                                        <button
                                            data-testid={`ai-endpoint-priority-down-${endpoint.id}`}
                                            aria-label={`Move ${endpoint.name} down`}
                                            onClick={() => handlePriorityChange(endpoint.id, 'down')}
                                            disabled={index === sortedEndpoints.length - 1}
                                            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                                        >
                                            <ChevronDown size={14} />
                                        </button>
                                    </div>

                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            {getTypeIcon(endpoint.type)}
                                            <span className="font-medium text-foreground">{endpoint.name}</span>
                                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                                {endpoint.purpose || 'deep_analysis'}
                                            </span>
                                        </div>
                                        <div className="text-xs text-muted-foreground mb-1">{endpoint.url}</div>
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                            <span>{t('aiEndpoint.model')} {endpoint.modelName}</span>
                                            {endpoint.lastTest && (
                                                <span className={`flex items-center gap-1 ${endpoint.lastTest.success ? 'text-emerald-500' : 'text-red-500'}`}>
                                                    {endpoint.lastTest.success ? <Check size={12} /> : <X size={12} />}
                                                    {endpoint.lastTest.latency}ms
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        data-testid={`ai-endpoint-test-${endpoint.id}`}
                                        aria-label={`Test ${endpoint.name}`}
                                        onClick={() => handleTestEndpoint(endpoint.id)}
                                        disabled={testingId === endpoint.id}
                                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all"
                                        title={t('aiEndpoint.test')}
                                    >
                                        {testingId === endpoint.id ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <TestTube size={16} />
                                        )}
                                    </button>
                                    <button
                                        data-testid={`ai-endpoint-toggle-${endpoint.id}`}
                                        aria-label={`${endpoint.enabled ? 'Disable' : 'Enable'} ${endpoint.name}`}
                                        onClick={() => handleToggleEndpoint(endpoint.id, endpoint.enabled)}
                                        className={`p-2 rounded-lg transition-all ${endpoint.enabled
                                            ? 'text-emerald-500 hover:bg-emerald-500/10'
                                            : 'text-muted-foreground hover:bg-muted'
                                            }`}
                                        title={endpoint.enabled ? t('aiEndpoint.disable') : t('aiEndpoint.enable')}
                                    >
                                        {endpoint.enabled ? <Check size={16} /> : <X size={16} />}
                                    </button>
                                    <button
                                        data-testid={`ai-endpoint-delete-${endpoint.id}`}
                                        aria-label={`Delete ${endpoint.name}`}
                                        onClick={() => handleDeleteEndpoint(endpoint.id)}
                                        className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                        title={t('aiEndpoint.delete')}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </motion.div>
            )}
        </div>
    );
};

export default AIEndpointSettings;
