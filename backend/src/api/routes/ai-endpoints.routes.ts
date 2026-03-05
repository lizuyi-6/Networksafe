/**
 * FluxGuard - AI 模型端点配置 API
 *
 * 为 ESP32 离线模式提供多模型端点配置
 * 优先级: 用户自定义服务器 > 笔记本本地模型
 * SECURITY FIX CVE-2026-035: Added authentication middleware
 * SECURITY FIX SSRF-2024-001: Added URL whitelist validation to prevent SSRF attacks
 */

import { Router, Request, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import logger from '../../utils/logger';
import axios from 'axios';
import {
    PLATFORM_API_CONFIG,
    PLATFORM_MODELS,
    getModelsForTier,
    canUseModel,
    canUseCustomEndpoint,
    normalizePlan,
    getDefaultModel,
    PlanTier
} from '../../utils/model-access';

const router = Router();

// SECURITY FIX CVE-2026-035: Apply authentication to all routes
router.use(authenticate);

/**
 * SECURITY: SSRF 防护 - URL 白名单
 *
 * 允许的 AI 服务提供商域名
 * 防止攻击者利用此端点探测内网或窃取云服务元数据
 */
const ALLOWED_AI_HOSTS = [
    // 公共 AI 服务
    'api.openai.com',
    'api.anthropic.com',
    'generativelanguage.googleapis.com',

    // 私有部署（允许用户配置）
    // 用户可以添加自己的 Ollama 服务器等
];

/**
 * 验证 URL 是否在白名单中或不是内网地址
 * @param url 要验证的 URL
 * @returns true 如果 URL 安全，false 否则
 */
function validateAiUrl(url: string): { valid: boolean; error?: string } {
    try {
        const parsed = new URL(url);

        // 检查协议
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { valid: false, error: 'backend.only_http_and_https_protocols_are_allowed' };
        }

        const hostname = parsed.hostname.toLowerCase();

        // 检查是否在内网 IP 范围
        const isPrivateIP =
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '0.0.0.0' ||
            hostname.startsWith('192.168.') ||
            hostname.startsWith('10.') ||
            hostname.startsWith('172.16.') ||
            hostname.startsWith('172.17.') || // Docker 默认网段
            hostname.startsWith('172.18.') ||
            hostname.startsWith('172.19.') ||
            hostname.startsWith('172.2') ||
            hostname.startsWith('172.3') ||
            hostname.startsWith('127.') ||
            hostname === '169.254.169.254'; // AWS 元数据服务

        if (isPrivateIP) {
            return { valid: false, error: 'backend.private_ip_addresses_are_not_allowed' };
        }

        // 检查是否在白名单中
        const isWhitelisted = ALLOWED_AI_HOSTS.some(allowed =>
            hostname === allowed || hostname.endsWith(`.${allowed}`)
        );

        // 如果不在白名单中，检查是否是明确配置的外部服务
        if (!isWhitelisted) {
            // 允许非私有 IP 的外部地址（但记录警告）
            logger.warn('AI endpoint URL not in whitelist', { url, hostname });
        }

        return { valid: true };
    } catch (error) {
        return { valid: false, error: 'backend.invalid_url_format' };
    }
}

// AI 端点配置结构
interface AIEndpoint {
    id: string;
    name: string;           // 显示名称
    url: string;            // API 端点 URL
    modelName: string;      // 模型名称
    apiKey: string;         // API 密钥 (加密存储)
    enabled: boolean;       // 是否启用
    priority: number;       // 优先级 (数字越小越优先)
    timeout: number;        // 超时时间 (ms)
    type: 'ollama' | 'openai' | 'custom'; // 端点类型
    lastTest?: {
        success: boolean;
        latency: number;
        timestamp: string;
    };
}

// 存储 (内存 + 后续可持久化)
const endpoints = new Map<string, AIEndpoint>();

// 初始化默认端点
function initDefaults() {
    // 默认笔记本端点
    endpoints.set('default-laptop', {
        id: 'default-laptop',
        name: '本地笔记本 (Ollama)',
        url: 'http://192.168.4.1:5000/api/analyze',
        modelName: 'llama3',
        apiKey: '',
        enabled: true,
        priority: 100, // 最低优先级 (作为兜底)
        timeout: 10000,
        type: 'ollama'
    });
}

initDefaults();

// ============================================
// 订阅层级感知的模型管理接口
// 必须放在 /:id 参数化路由之前！
// ============================================

/**
 * GET /api/ai-endpoints/models
 * 获取当前用户可用的 AI 模型列表（基于订阅层级）
 */
router.get('/models', (req: Request, res: Response) => {
    try {
        const userPlan = normalizePlan((req as any).user?.plan);
        const availableModels = getModelsForTier(userPlan);
        const defaultModel = getDefaultModel(userPlan);

        const allModelsWithAccess = PLATFORM_MODELS.map(m => ({
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
            canCustomize: canUseCustomEndpoint(userPlan),
            models: allModelsWithAccess,
            defaultModelId: defaultModel.id,
        });
    } catch (error: any) {
        logger.error('Failed to get models list', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});

/**
 * POST /api/ai-endpoints/chat
 * 代理聊天接口
 */
router.post('/chat', async (req: Request, res: Response) => {
    try {
        const userPlan = normalizePlan((req as any).user?.plan);
        const { modelId, messages } = req.body;

        if (!modelId || !messages || !Array.isArray(messages)) {
            return res.status(400).json({
                success: false,
                error: 'backend.invalid_chat_request',
                message: '请提供 modelId 和 messages 数组'
            });
        }

        if (!canUseModel(userPlan, modelId)) {
            return res.status(403).json({
                success: false,
                error: 'backend.model_access_denied',
                message: `您的订阅等级 (${userPlan}) 无权使用模型 ${modelId}，请升级订阅`
            });
        }

        const modelInfo = PLATFORM_MODELS.find(m => m.id === modelId);
        if (!modelInfo) {
            return res.status(400).json({
                success: false,
                error: 'backend.unknown_model',
                message: `未知的模型 ID: ${modelId}`
            });
        }

        logger.info('AI chat proxy request', {
            user: (req as any).user?.email,
            plan: userPlan,
            model: modelId,
            messageCount: messages.length
        });

        const startTime = Date.now();

        const response = await axios.post(
            `${PLATFORM_API_CONFIG.baseURL}/v1/chat/completions`,
            {
                model: modelId,
                messages: messages.map((m: any) => ({
                    role: m.role || 'user',
                    content: m.content
                })),
                max_tokens: modelInfo.maxTokens,
                temperature: 0.7,
            },
            {
                headers: {
                    'Authorization': `Bearer ${PLATFORM_API_CONFIG.apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: PLATFORM_API_CONFIG.timeout,
            }
        );

        const latency = Date.now() - startTime;
        const content = response.data?.choices?.[0]?.message?.content || '';
        const usage = response.data?.usage;

        logger.info('AI chat proxy success', {
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
    } catch (error: any) {
        const errMsg = error.response?.data?.error?.message || error.message || 'Unknown error';
        logger.error('AI chat proxy error', {
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

/**
 * GET /api/ai-endpoints
 * 获取所有 AI 端点配置
 */
router.get('/', (_req: Request, res: Response) => {
    try {
        const sortedEndpoints = Array.from(endpoints.values())
            .sort((a, b) => a.priority - b.priority)
            .map(ep => ({
                ...ep,
                apiKey: ep.apiKey ? '******' : '', // 隐藏密钥
            }));

        res.json({
            success: true,
            endpoints: sortedEndpoints,
        });
    } catch (error: any) {
        logger.error('Failed to get AI endpoints', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});

/**
 * POST /api/ai-endpoints
 * 添加新的 AI 端点
 */
router.post('/', (req: Request, res: Response) => {
    try {
        // 层级校验：只有 Enterprise 用户才能添加自定义端点
        const userPlan = normalizePlan((req as any).user?.plan);
        if (!canUseCustomEndpoint(userPlan)) {
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

        // SECURITY: SSRF 防护 - 验证 URL
        const urlValidation = validateAiUrl(url);
        if (!urlValidation.valid) {
            logger.warn('Blocked AI endpoint with invalid URL', { url, error: urlValidation.error });
            return res.status(400).json({
                success: false,
                error: `Invalid URL: ${urlValidation.error}`
            });
        }

        const id = `custom-${Date.now()}`;

        const endpoint: AIEndpoint = {
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

        logger.info('AI endpoint added', { id, url });

        res.json({
            success: true,
            endpoint: {
                ...endpoint,
                apiKey: endpoint.apiKey ? '******' : '',
            },
        });
    } catch (error: any) {
        logger.error('Failed to add AI endpoint', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});

/**
 * PUT /api/ai-endpoints/:id
 * 更新 AI 端点
 */
router.put('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const endpoint = endpoints.get(id);

        if (!endpoint) {
            return res.status(404).json({ success: false, error: 'backend.endpoint_not_found' });
        }

        // 更新字段
        if (req.body.name) endpoint.name = req.body.name;
        if (req.body.url) {
            // SECURITY: SSRF 防护 - 验证 URL
            const urlValidation = validateAiUrl(req.body.url);
            if (!urlValidation.valid) {
                logger.warn('Blocked AI endpoint update with invalid URL', { url: req.body.url, error: urlValidation.error });
                return res.status(400).json({
                    success: false,
                    error: `Invalid URL: ${urlValidation.error}`
                });
            }
            endpoint.url = req.body.url;
        }
        if (req.body.modelName) endpoint.modelName = req.body.modelName;
        if (req.body.apiKey) endpoint.apiKey = req.body.apiKey;
        if (req.body.enabled !== undefined) endpoint.enabled = req.body.enabled;
        if (req.body.priority !== undefined) endpoint.priority = req.body.priority;
        if (req.body.timeout) endpoint.timeout = req.body.timeout;

        endpoints.set(id, endpoint);

        logger.info('AI endpoint updated', { id });

        res.json({
            success: true,
            endpoint: {
                ...endpoint,
                apiKey: endpoint.apiKey ? '******' : '',
            },
        });
    } catch (error: any) {
        logger.error('Failed to update AI endpoint', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});

/**
 * DELETE /api/ai-endpoints/:id
 * 删除 AI 端点
 */
router.delete('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // 不允许删除默认端点
        if (id === 'default-laptop') {
            return res.status(400).json({ success: false, error: 'backend.cannot_delete_default_endpoint' });
        }

        if (!endpoints.has(id)) {
            return res.status(404).json({ success: false, error: 'backend.endpoint_not_found' });
        }

        endpoints.delete(id);

        logger.info('AI endpoint deleted', { id });

        res.json({
            success: true,
            message: `Endpoint ${id} deleted`,
        });
    } catch (error: any) {
        logger.error('Failed to delete AI endpoint', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});

/**
 * POST /api/ai-endpoints/:id/test
 * 测试 AI 端点连通性
 */
router.post('/:id/test', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const endpoint = endpoints.get(id);

        if (!endpoint) {
            return res.status(404).json({ success: false, error: 'backend.endpoint_not_found' });
        }

        const startTime = Date.now();

        try {
            // 发送测试请求
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

            // 更新测试结果
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
        } catch (fetchError: any) {
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
    } catch (error: any) {
        logger.error('Failed to test AI endpoint', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});

/**
 * GET /api/ai-endpoints/sync-config
 * 获取 ESP32 同步配置 (紧凑格式)
 * SECURITY FIX: Require admin role and mask API keys
 */
router.get('/sync-config', requireRole('admin'), (_req: Request, res: Response) => {
    try {
        // 只返回启用的端点，按优先级排序
        // SECURITY FIX: Do not expose raw API keys
        const enabledEndpoints = Array.from(endpoints.values())
            .filter(ep => ep.enabled)
            .sort((a, b) => a.priority - b.priority)
            .map(ep => ({
                url: ep.url,
                model: ep.modelName,
                // SECURITY FIX CVE-2026-035: Mask API keys - only show last 4 chars
                key: ep.apiKey ? `***${ep.apiKey.slice(-4)}` : '',
            }));

        res.json({
            success: true,
            endpoints: enabledEndpoints,
        });
    } catch (error: any) {
        logger.error('Failed to get sync config', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});


// 导出辅助函数
export function getEndpointList(): AIEndpoint[] {
    return Array.from(endpoints.values())
        .filter(ep => ep.enabled)
        .sort((a, b) => a.priority - b.priority);
}

export default router;
