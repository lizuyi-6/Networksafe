"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEndpointList = getEndpointList;
const express_1 = require("express");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const logger_1 = __importDefault(require("../../utils/logger"));
const axios_1 = __importDefault(require("axios"));
const model_access_1 = require("../../utils/model-access");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
const ALLOWED_AI_HOSTS = [
    'api.openai.com',
    'api.anthropic.com',
    'generativelanguage.googleapis.com',
];
function validateAiUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { valid: false, error: 'backend.only_http_and_https_protocols_are_allowed' };
        }
        const hostname = parsed.hostname.toLowerCase();
        const isPrivateIP = hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '0.0.0.0' ||
            hostname.startsWith('192.168.') ||
            hostname.startsWith('10.') ||
            hostname.startsWith('172.16.') ||
            hostname.startsWith('172.17.') ||
            hostname.startsWith('172.18.') ||
            hostname.startsWith('172.19.') ||
            hostname.startsWith('172.2') ||
            hostname.startsWith('172.3') ||
            hostname.startsWith('127.') ||
            hostname === '169.254.169.254';
        if (isPrivateIP) {
            return { valid: false, error: 'backend.private_ip_addresses_are_not_allowed' };
        }
        const isWhitelisted = ALLOWED_AI_HOSTS.some(allowed => hostname === allowed || hostname.endsWith(`.${allowed}`));
        if (!isWhitelisted) {
            logger_1.default.warn('AI endpoint URL not in whitelist', { url, hostname });
        }
        return { valid: true };
    }
    catch (error) {
        return { valid: false, error: 'backend.invalid_url_format' };
    }
}
const endpoints = new Map();
function initDefaults() {
    endpoints.set('default-laptop', {
        id: 'default-laptop',
        name: '本地笔记本 (Ollama)',
        url: 'http://192.168.4.1:5000/api/analyze',
        modelName: 'llama3',
        apiKey: '',
        enabled: true,
        priority: 100,
        timeout: 10000,
        type: 'ollama'
    });
}
initDefaults();
router.get('/models', (req, res) => {
    try {
        const userPlan = (0, model_access_1.normalizePlan)(req.user?.plan);
        const availableModels = (0, model_access_1.getModelsForTier)(userPlan);
        const defaultModel = (0, model_access_1.getDefaultModel)(userPlan);
        const allModelsWithAccess = model_access_1.PLATFORM_MODELS.map(m => ({
            id: m.id,
            name: m.name,
            description: m.description,
            category: m.category,
            maxTokens: m.maxTokens,
            available: availableModels.some(am => am.id === m.id),
            minTier: m.minTier,
            isDefault: m.id === defaultModel.id,
        }));
        res.json({
            success: true,
            plan: userPlan,
            canCustomize: (0, model_access_1.canUseCustomEndpoint)(userPlan),
            models: allModelsWithAccess,
            defaultModelId: defaultModel.id,
        });
    }
    catch (error) {
        logger_1.default.error('Failed to get models list', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});
router.post('/chat', async (req, res) => {
    try {
        const userPlan = (0, model_access_1.normalizePlan)(req.user?.plan);
        const { modelId, messages } = req.body;
        if (!modelId || !messages || !Array.isArray(messages)) {
            return res.status(400).json({
                success: false,
                error: 'backend.invalid_chat_request',
                message: '请提供 modelId 和 messages 数组'
            });
        }
        if (!(0, model_access_1.canUseModel)(userPlan, modelId)) {
            return res.status(403).json({
                success: false,
                error: 'backend.model_access_denied',
                message: `您的订阅等级 (${userPlan}) 无权使用模型 ${modelId}，请升级订阅`
            });
        }
        const modelInfo = model_access_1.PLATFORM_MODELS.find(m => m.id === modelId);
        if (!modelInfo) {
            return res.status(400).json({
                success: false,
                error: 'backend.unknown_model',
                message: `未知的模型 ID: ${modelId}`
            });
        }
        logger_1.default.info('AI chat proxy request', {
            user: req.user?.email,
            plan: userPlan,
            model: modelId,
            messageCount: messages.length
        });
        const startTime = Date.now();
        const response = await axios_1.default.post(`${model_access_1.PLATFORM_API_CONFIG.baseURL}/v1/chat/completions`, {
            model: modelId,
            messages: messages.map((m) => ({
                role: m.role || 'user',
                content: m.content
            })),
            max_tokens: modelInfo.maxTokens,
            temperature: 0.7,
        }, {
            headers: {
                'Authorization': `Bearer ${model_access_1.PLATFORM_API_CONFIG.apiKey}`,
                'Content-Type': 'application/json',
            },
            timeout: model_access_1.PLATFORM_API_CONFIG.timeout,
        });
        const latency = Date.now() - startTime;
        const content = response.data?.choices?.[0]?.message?.content || '';
        const usage = response.data?.usage;
        logger_1.default.info('AI chat proxy success', {
            model: modelId,
            latency,
            tokens: usage?.total_tokens
        });
        res.json({
            success: true,
            content,
            model: modelId,
            usage: usage || null,
            latency,
        });
    }
    catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message || 'Unknown error';
        logger_1.default.error('AI chat proxy error', {
            error: errMsg,
            status: error.response?.status,
        });
        res.status(error.response?.status || 500).json({
            success: false,
            error: 'backend.ai_chat_error',
            message: errMsg,
        });
    }
});
router.get('/', (_req, res) => {
    try {
        const sortedEndpoints = Array.from(endpoints.values())
            .sort((a, b) => a.priority - b.priority)
            .map(ep => ({
            ...ep,
            apiKey: ep.apiKey ? '******' : '',
        }));
        res.json({
            success: true,
            endpoints: sortedEndpoints,
        });
    }
    catch (error) {
        logger_1.default.error('Failed to get AI endpoints', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});
router.post('/', (req, res) => {
    try {
        const userPlan = (0, model_access_1.normalizePlan)(req.user?.plan);
        if (!(0, model_access_1.canUseCustomEndpoint)(userPlan)) {
            return res.status(403).json({
                success: false,
                error: 'backend.custom_endpoints_require_enterprise',
                message: '自定义模型端点仅对企业订阅用户开放'
            });
        }
        const { name, url, modelName, apiKey, type, timeout, priority } = req.body;
        if (!url) {
            return res.status(400).json({ success: false, error: 'backend.url_is_required' });
        }
        const urlValidation = validateAiUrl(url);
        if (!urlValidation.valid) {
            logger_1.default.warn('Blocked AI endpoint with invalid URL', { url, error: urlValidation.error });
            return res.status(400).json({
                success: false,
                error: `Invalid URL: ${urlValidation.error}`
            });
        }
        const id = `custom-${Date.now()}`;
        const endpoint = {
            id,
            name: name || `Custom Endpoint ${endpoints.size}`,
            url,
            modelName: modelName || 'default',
            apiKey: apiKey || '',
            enabled: true,
            priority: priority ?? 10,
            timeout: timeout || 15000,
            type: type || 'custom',
        };
        endpoints.set(id, endpoint);
        logger_1.default.info('AI endpoint added', { id, url });
        res.json({
            success: true,
            endpoint: {
                ...endpoint,
                apiKey: endpoint.apiKey ? '******' : '',
            },
        });
    }
    catch (error) {
        logger_1.default.error('Failed to add AI endpoint', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const endpoint = endpoints.get(id);
        if (!endpoint) {
            return res.status(404).json({ success: false, error: 'backend.endpoint_not_found' });
        }
        if (req.body.name)
            endpoint.name = req.body.name;
        if (req.body.url) {
            const urlValidation = validateAiUrl(req.body.url);
            if (!urlValidation.valid) {
                logger_1.default.warn('Blocked AI endpoint update with invalid URL', { url: req.body.url, error: urlValidation.error });
                return res.status(400).json({
                    success: false,
                    error: `Invalid URL: ${urlValidation.error}`
                });
            }
            endpoint.url = req.body.url;
        }
        if (req.body.modelName)
            endpoint.modelName = req.body.modelName;
        if (req.body.apiKey)
            endpoint.apiKey = req.body.apiKey;
        if (req.body.enabled !== undefined)
            endpoint.enabled = req.body.enabled;
        if (req.body.priority !== undefined)
            endpoint.priority = req.body.priority;
        if (req.body.timeout)
            endpoint.timeout = req.body.timeout;
        endpoints.set(id, endpoint);
        logger_1.default.info('AI endpoint updated', { id });
        res.json({
            success: true,
            endpoint: {
                ...endpoint,
                apiKey: endpoint.apiKey ? '******' : '',
            },
        });
    }
    catch (error) {
        logger_1.default.error('Failed to update AI endpoint', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;
        if (id === 'default-laptop') {
            return res.status(400).json({ success: false, error: 'backend.cannot_delete_default_endpoint' });
        }
        if (!endpoints.has(id)) {
            return res.status(404).json({ success: false, error: 'backend.endpoint_not_found' });
        }
        endpoints.delete(id);
        logger_1.default.info('AI endpoint deleted', { id });
        res.json({
            success: true,
            message: `Endpoint ${id} deleted`,
        });
    }
    catch (error) {
        logger_1.default.error('Failed to delete AI endpoint', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});
router.post('/:id/test', async (req, res) => {
    try {
        const { id } = req.params;
        const endpoint = endpoints.get(id);
        if (!endpoint) {
            return res.status(404).json({ success: false, error: 'backend.endpoint_not_found' });
        }
        const startTime = Date.now();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), endpoint.timeout);
            const response = await fetch(endpoint.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(endpoint.apiKey && { 'Authorization': `Bearer ${endpoint.apiKey}` }),
                },
                body: JSON.stringify({
                    model: endpoint.modelName,
                    prompt: 'test connection',
                    stream: false,
                }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            const latency = Date.now() - startTime;
            const success = response.ok;
            endpoint.lastTest = {
                success,
                latency,
                timestamp: new Date().toISOString(),
            };
            endpoints.set(id, endpoint);
            res.json({
                success,
                latency,
                status: response.status,
            });
        }
        catch (fetchError) {
            const latency = Date.now() - startTime;
            endpoint.lastTest = {
                success: false,
                latency,
                timestamp: new Date().toISOString(),
            };
            endpoints.set(id, endpoint);
            res.json({
                success: false,
                latency,
                error: fetchError.message,
            });
        }
    }
    catch (error) {
        logger_1.default.error('Failed to test AI endpoint', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});
router.get('/sync-config', (0, auth_middleware_1.requireRole)('admin'), (_req, res) => {
    try {
        const enabledEndpoints = Array.from(endpoints.values())
            .filter(ep => ep.enabled)
            .sort((a, b) => a.priority - b.priority)
            .map(ep => ({
            url: ep.url,
            model: ep.modelName,
            key: ep.apiKey ? `***${ep.apiKey.slice(-4)}` : '',
        }));
        res.json({
            success: true,
            endpoints: enabledEndpoints,
        });
    }
    catch (error) {
        logger_1.default.error('Failed to get sync config', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});
function getEndpointList() {
    return Array.from(endpoints.values())
        .filter(ep => ep.enabled)
        .sort((a, b) => a.priority - b.priority);
}
exports.default = router;
//# sourceMappingURL=ai-endpoints.routes.js.map