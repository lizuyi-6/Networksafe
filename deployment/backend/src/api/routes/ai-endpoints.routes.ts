/**
 * FluxGuard - AI 模型端点配置 API
 * 
 * 为 ESP32 离线模式提供多模型端点配置
 * 优先级: 用户自定义服务器 > 笔记本本地模型
 */

import { Router, Request, Response } from 'express';
import logger from '../../utils/logger';

const router = Router();

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
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /api/ai-endpoints
 * 添加新的 AI 端点
 */
router.post('/', (req: Request, res: Response) => {
    try {
        const { name, url, modelName, apiKey, type, timeout, priority } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, error: 'URL is required' });
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
        res.status(500).json({ success: false, error: 'Internal server error' });
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
            return res.status(404).json({ success: false, error: 'Endpoint not found' });
        }

        // 更新字段
        if (req.body.name) endpoint.name = req.body.name;
        if (req.body.url) endpoint.url = req.body.url;
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
        res.status(500).json({ success: false, error: 'Internal server error' });
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
            return res.status(400).json({ success: false, error: 'Cannot delete default endpoint' });
        }

        if (!endpoints.has(id)) {
            return res.status(404).json({ success: false, error: 'Endpoint not found' });
        }

        endpoints.delete(id);

        logger.info('AI endpoint deleted', { id });

        res.json({
            success: true,
            message: `Endpoint ${id} deleted`,
        });
    } catch (error: any) {
        logger.error('Failed to delete AI endpoint', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
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
            return res.status(404).json({ success: false, error: 'Endpoint not found' });
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
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * GET /api/ai-endpoints/sync-config
 * 获取 ESP32 同步配置 (紧凑格式)
 */
router.get('/sync-config', (_req: Request, res: Response) => {
    try {
        // 只返回启用的端点，按优先级排序
        const enabledEndpoints = Array.from(endpoints.values())
            .filter(ep => ep.enabled)
            .sort((a, b) => a.priority - b.priority)
            .map(ep => ({
                url: ep.url,
                model: ep.modelName,
                key: ep.apiKey,
            }));

        res.json({
            success: true,
            endpoints: enabledEndpoints,
        });
    } catch (error: any) {
        logger.error('Failed to get sync config', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// 导出辅助函数
export function getEndpointList(): AIEndpoint[] {
    return Array.from(endpoints.values())
        .filter(ep => ep.enabled)
        .sort((a, b) => a.priority - b.priority);
}

export default router;
