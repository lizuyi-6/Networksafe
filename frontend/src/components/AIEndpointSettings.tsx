/**
 * AI 模型端点配置组件
 * 
 * 支持配置多个 AI 模型来源：
 * - 用户笔记本本地模型 (Ollama)
 * - 用户服务器部署的大模型
 * - 第三方 API (OpenAI 兼容)
 */

import { useState, useEffect } from 'react';
import {
    Brain, Plus, Trash2, TestTube,
    Server, Laptop, Globe, Check, X, Loader2,
    ChevronDown, ChevronUp, AlertCircle
} from 'lucide-react';

interface AIEndpoint {
    id: string;
    name: string;
    url: string;
    modelName: string;
    apiKey: string;
    enabled: boolean;
    priority: number;
    timeout: number;
    type: 'ollama' | 'openai' | 'custom';
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
    type: 'ollama' | 'openai' | 'custom';
    priority: number;
}

const AIEndpointSettings = () => {
    const [endpoints, setEndpoints] = useState<AIEndpoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [testingId, setTestingId] = useState<string | null>(null);

    const [formData, setFormData] = useState<AddEndpointFormData>({
        name: '',
        url: '',
        modelName: '',
        apiKey: '',
        type: 'ollama',
        priority: 10,
    });

    // 模拟端点数据
    useEffect(() => {
        const mockEndpoints: AIEndpoint[] = [
            {
                id: 'default-laptop',
                name: '本地笔记本 (Ollama)',
                url: 'http://192.168.4.1:5000/api/analyze',
                modelName: 'llama3',
                apiKey: '',
                enabled: true,
                priority: 100,
                timeout: 10000,
                type: 'ollama',
                lastTest: {
                    success: true,
                    latency: 234,
                    timestamp: new Date().toISOString(),
                },
            },
        ];

        setTimeout(() => {
            setEndpoints(mockEndpoints);
            setLoading(false);
        }, 500);
    }, []);

    const handleAddEndpoint = () => {
        if (!formData.url) return;

        const newEndpoint: AIEndpoint = {
            id: `custom-${Date.now()}`,
            name: formData.name || `自定义端点 ${endpoints.length}`,
            url: formData.url,
            modelName: formData.modelName || 'default',
            apiKey: formData.apiKey,
            enabled: true,
            priority: formData.priority,
            timeout: 15000,
            type: formData.type,
        };

        setEndpoints(prev => [...prev, newEndpoint]);
        setShowAddForm(false);
        setFormData({
            name: '',
            url: '',
            modelName: '',
            apiKey: '',
            type: 'ollama',
            priority: 10,
        });
    };

    const handleDeleteEndpoint = (id: string) => {
        if (id === 'default-laptop') return;
        setEndpoints(prev => prev.filter(ep => ep.id !== id));
    };

    const handleToggleEndpoint = (id: string) => {
        setEndpoints(prev => prev.map(ep =>
            ep.id === id ? { ...ep, enabled: !ep.enabled } : ep
        ));
    };

    const handleTestEndpoint = async (id: string) => {
        setTestingId(id);

        // 模拟测试
        await new Promise(resolve => setTimeout(resolve, 1500));

        const success = Math.random() > 0.3;
        const latency = Math.floor(Math.random() * 500) + 100;

        setEndpoints(prev => prev.map(ep =>
            ep.id === id ? {
                ...ep,
                lastTest: {
                    success,
                    latency,
                    timestamp: new Date().toISOString(),
                },
            } : ep
        ));

        setTestingId(null);
    };

    const handlePriorityChange = (id: string, direction: 'up' | 'down') => {
        setEndpoints(prev => {
            const sorted = [...prev].sort((a, b) => a.priority - b.priority);
            const idx = sorted.findIndex(ep => ep.id === id);

            if (direction === 'up' && idx > 0) {
                const temp = sorted[idx].priority;
                sorted[idx].priority = sorted[idx - 1].priority;
                sorted[idx - 1].priority = temp;
            } else if (direction === 'down' && idx < sorted.length - 1) {
                const temp = sorted[idx].priority;
                sorted[idx].priority = sorted[idx + 1].priority;
                sorted[idx + 1].priority = temp;
            }

            return sorted;
        });
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
            {/* Header */}
            <div className="flex justify-between items-center mb-5">
                <div className="flex items-center gap-2">
                    <Brain size={18} className="text-primary" />
                    <h3 className="font-semibold text-foreground">AI 模型端点配置</h3>
                </div>
                <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all"
                >
                    <Plus size={14} /> 添加端点
                </button>
            </div>

            {/* Info Banner */}
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-4 flex items-start gap-2">
                <AlertCircle size={16} className="text-blue-500 mt-0.5" />
                <div className="text-xs text-blue-700 dark:text-blue-300">
                    <strong>离线模式 AI 调用优先级:</strong> 按列表顺序尝试调用，失败则自动降级到下一个端点。
                    建议将延迟最低的服务器放在最前面。
                </div>
            </div>

            {/* Add Form */}
            {showAddForm && (
                <div className="bg-muted/30 border border-border rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">端点名称</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="例如: 生产服务器模型"
                                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">类型</label>
                            <select
                                value={formData.type}
                                onChange={e => setFormData(prev => ({ ...prev, type: e.target.value as any }))}
                                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                            >
                                <option value="ollama">Ollama</option>
                                <option value="openai">OpenAI 兼容</option>
                                <option value="custom">自定义</option>
                            </select>
                        </div>
                    </div>

                    <div className="mb-4">
                        <label className="block text-xs text-muted-foreground mb-1">API 端点 URL *</label>
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
                            <label className="block text-xs text-muted-foreground mb-1">模型名称</label>
                            <input
                                type="text"
                                value={formData.modelName}
                                onChange={e => setFormData(prev => ({ ...prev, modelName: e.target.value }))}
                                placeholder="llama3 / gpt-4 / qwen"
                                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:border-primary focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-muted-foreground mb-1">API Key (可选)</label>
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
                            取消
                        </button>
                        <button
                            onClick={handleAddEndpoint}
                            disabled={!formData.url}
                            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            添加
                        </button>
                    </div>
                </div>
            )}

            {/* Endpoints List */}
            {loading ? (
                <div className="text-center py-8 text-muted-foreground">
                    <Loader2 size={24} className="mx-auto mb-2 animate-spin" />
                    加载中...
                </div>
            ) : sortedEndpoints.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                    暂无配置的 AI 端点
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
                                    {/* Priority Controls */}
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
                                            {endpoint.id === 'default-laptop' && (
                                                <span className="px-1.5 py-0.5 text-xxs bg-primary/10 text-primary rounded">默认</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground mb-1">{endpoint.url}</div>
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                            <span>模型: {endpoint.modelName}</span>
                                            {endpoint.lastTest && (
                                                <span className={`flex items-center gap-1 ${endpoint.lastTest.success ? 'text-emerald-500' : 'text-red-500'
                                                    }`}>
                                                    {endpoint.lastTest.success ? <Check size={12} /> : <X size={12} />}
                                                    {endpoint.lastTest.latency}ms
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleTestEndpoint(endpoint.id)}
                                        disabled={testingId === endpoint.id}
                                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all"
                                        title="测试连接"
                                    >
                                        {testingId === endpoint.id ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <TestTube size={16} />
                                        )}
                                    </button>
                                    <button
                                        onClick={() => handleToggleEndpoint(endpoint.id)}
                                        className={`p-2 rounded-lg transition-all ${endpoint.enabled
                                            ? 'text-emerald-500 hover:bg-emerald-500/10'
                                            : 'text-muted-foreground hover:bg-muted'
                                            }`}
                                        title={endpoint.enabled ? '禁用' : '启用'}
                                    >
                                        {endpoint.enabled ? <Check size={16} /> : <X size={16} />}
                                    </button>
                                    {endpoint.id !== 'default-laptop' && (
                                        <button
                                            onClick={() => handleDeleteEndpoint(endpoint.id)}
                                            className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                            title="删除"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Footer */}
            <div className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground">
                <strong>调用逻辑:</strong> 按优先级顺序尝试每个启用的端点，首个成功响应将被采用。
                如果所有自定义端点失败，将回退到本地笔记本模型。
            </div>
        </div>
    );
};

export default AIEndpointSettings;
