import { useEffect, useState } from 'react';
import {
    Brain, Plus, Trash2, TestTube,
    Server, Laptop, Globe, Check, X, Loader2,
    ChevronDown, ChevronUp, AlertCircle
} from 'lucide-react';
import {
    fetchAIEndpoints,
    createAIEndpoint,
    updateAIEndpoint,
    deleteAIEndpoint,
    testAIEndpoint
} from '../services/api';

type EndpointType = 'ollama' | 'openai' | 'custom';

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
    priority: number;
}

const AIEndpointSettings = () => {
    const [endpoints, setEndpoints] = useState<AIEndpoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [formData, setFormData] = useState<AddEndpointFormData>({
        name: '',
        url: '',
        modelName: '',
        apiKey: '',
        type: 'ollama',
        priority: 10,
    });

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
                priority: formData.priority
            });
            setShowAddForm(false);
            setFormData({
                name: '',
                url: '',
                modelName: '',
                apiKey: '',
                type: 'ollama',
                priority: 10,
            });
            await loadEndpoints();
        } catch (e: any) {
            setError(e.message || 'FG-AI-ENDPOINTS-CREATE');
        }
    };

    const handleDeleteEndpoint = async (id: string) => {
        setError(null);
        try {
            await deleteAIEndpoint(id);
            await loadEndpoints();
        } catch (e: any) {
            setError(e.message || 'FG-AI-ENDPOINTS-DELETE');
        }
    };

    const handleToggleEndpoint = async (id: string, enabled: boolean) => {
        setError(null);
        try {
            await updateAIEndpoint(id, { enabled: !enabled });
            await loadEndpoints();
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
                    <h3 className="font-semibold text-foreground">AI Endpoint Settings</h3>
                </div>
                <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all"
                >
                    <Plus size={14} /> Add Endpoint
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
                    Endpoints are used by priority order. If one fails, the next enabled endpoint is used.
                </div>
            </div>

            {showAddForm && (
                <div className="bg-muted/30 border border-border rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">Name</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Production model endpoint"
                                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">Type</label>
                            <select
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
                        <label className="block text-xs text-muted-foreground mb-1">Endpoint URL *</label>
                        <input
                            type="text"
                            value={formData.url}
                            onChange={e => setFormData(prev => ({ ...prev, url: e.target.value }))}
                            placeholder="http://your-server:5000/api/analyze"
                            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">Model</label>
                            <input
                                type="text"
                                value={formData.modelName}
                                onChange={e => setFormData(prev => ({ ...prev, modelName: e.target.value }))}
                                placeholder="llama3 / gpt-4 / qwen"
                                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">API Key</label>
                            <input
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
                            onClick={() => setShowAddForm(false)}
                            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleAddEndpoint}
                            disabled={!formData.url}
                            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            Add
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="text-center py-8 text-muted-foreground">
                    <Loader2 size={24} className="mx-auto mb-2 animate-spin" />
                    Loading...
                </div>
            ) : sortedEndpoints.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                    No configured AI endpoints.
                </div>
            ) : (
                <div className="space-y-3">
                    {sortedEndpoints.map((endpoint, index) => (
                        <div
                            key={endpoint.id}
                            className={`border rounded-lg p-4 transition-all ${endpoint.enabled
                                ? 'border-border bg-card'
                                : 'border-border/50 bg-muted/20 opacity-60'
                                }`}
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-3">
                                    <div className="flex flex-col items-center">
                                        <button
                                            onClick={() => handlePriorityChange(endpoint.id, 'up')}
                                            disabled={index === 0}
                                            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                                        >
                                            <ChevronUp size={14} />
                                        </button>
                                        <span className="text-xs font-bold text-muted-foreground">{index + 1}</span>
                                        <button
                                            onClick={() => handlePriorityChange(endpoint.id, 'down')}
                                            disabled={index === sortedEndpoints.length - 1}
                                            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                                        >
                                            <ChevronDown size={14} />
                                        </button>
                                    </div>

                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            {getTypeIcon(endpoint.type)}
                                            <span className="font-medium text-foreground">{endpoint.name}</span>
                                        </div>
                                        <div className="text-xs text-muted-foreground mb-1">{endpoint.url}</div>
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                            <span>Model: {endpoint.modelName}</span>
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
                                        onClick={() => handleTestEndpoint(endpoint.id)}
                                        disabled={testingId === endpoint.id}
                                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all"
                                        title="Test"
                                    >
                                        {testingId === endpoint.id ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <TestTube size={16} />
                                        )}
                                    </button>
                                    <button
                                        onClick={() => handleToggleEndpoint(endpoint.id, endpoint.enabled)}
                                        className={`p-2 rounded-lg transition-all ${endpoint.enabled
                                            ? 'text-emerald-500 hover:bg-emerald-500/10'
                                            : 'text-muted-foreground hover:bg-muted'
                                            }`}
                                        title={endpoint.enabled ? 'Disable' : 'Enable'}
                                    >
                                        {endpoint.enabled ? <Check size={16} /> : <X size={16} />}
                                    </button>
                                    <button
                                        onClick={() => handleDeleteEndpoint(endpoint.id)}
                                        className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                        title="Delete"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default AIEndpointSettings;
