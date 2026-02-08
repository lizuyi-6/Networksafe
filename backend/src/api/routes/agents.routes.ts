/**
 * Agent 管理 API 路由
 * SECURITY FIX CVE-2026-030: Added authentication middleware
 */

import { Router, Request, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import logger from '../../utils/logger';

const router = Router();

// Agent Gateway 引用 (将由 index.ts 注入)
let agentGateway: any = null;

export function setAgentGateway(gateway: any): void {
    agentGateway = gateway;
}

// SECURITY FIX CVE-2026-030: Apply authentication to all routes
router.use(authenticate);

/**
 * GET /api/agents
 * 获取所有已连接的 Agent 列表
 */
router.get('/', (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const agents = agentGateway.getAgentList();
        res.json({
            success: true,
            count: agents.length,
            agents
        });
    } catch (error: any) {
        logger.error('Failed to get agents', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/agents/:id
 * 获取指定 Agent 详情
 */
router.get('/:id', (req: Request, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const agent = agentGateway.getAgent(req.params.id);
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        res.json({
            success: true,
            agent: {
                agentId: agent.agentId,
                registration: agent.registration,
                lastHeartbeat: agent.lastHeartbeat,
                status: agent.status,
                isOnline: true
            }
        });
    } catch (error: any) {
        logger.error('Failed to get agent', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/agents/:id/scan
 * 触发指定 Agent 运行安全扫描
 * SECURITY FIX: Require admin role for scan operations
 */
router.post('/:id/scan', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const success = agentGateway.sendCommandToAgent(req.params.id, { type: 'scan' });

        if (!success) {
            return res.status(404).json({ error: 'Agent not found or offline' });
        }

        res.json({
            success: true,
            message: 'Scan command sent'
        });
    } catch (error: any) {
        logger.error('Failed to trigger scan', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/agents/:id/block
 * 通过指定 Agent 封禁 IP
 * SECURITY FIX: Require admin role for block operations
 */
router.post('/:id/block', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const { ip, duration } = req.body;

        if (!ip) {
            return res.status(400).json({ error: 'IP address required' });
        }

        const success = agentGateway.sendCommandToAgent(req.params.id, {
            type: 'block_ip',
            payload: { ip, duration: duration || 3600 }
        });

        if (!success) {
            return res.status(404).json({ error: 'Agent not found or offline' });
        }

        res.json({
            success: true,
            message: `Block command sent for IP: ${ip}`
        });
    } catch (error: any) {
        logger.error('Failed to block IP', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/agents/:id/unblock
 * 通过指定 Agent 解封 IP
 * SECURITY FIX: Require admin role for unblock operations
 */
router.post('/:id/unblock', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const { ip } = req.body;

        if (!ip) {
            return res.status(400).json({ error: 'IP address required' });
        }

        const success = agentGateway.sendCommandToAgent(req.params.id, {
            type: 'unblock_ip',
            payload: { ip }
        });

        if (!success) {
            return res.status(404).json({ error: 'Agent not found or offline' });
        }

        res.json({
            success: true,
            message: `Unblock command sent for IP: ${ip}`
        });
    } catch (error: any) {
        logger.error('Failed to unblock IP', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/agents/stats/summary
 * 获取 Agent 统计摘要
 */
router.get('/stats/summary', (req: Request, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const agents = agentGateway.getAgentList();

        res.json({
            success: true,
            summary: {
                totalAgents: agents.length,
                onlineAgents: agents.filter((a: any) => a.isOnline).length,
                offlineAgents: 0, // TODO: 实现离线跟踪
                lastUpdated: new Date().toISOString()
            }
        });
    } catch (error: any) {
        logger.error('Failed to get stats', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
