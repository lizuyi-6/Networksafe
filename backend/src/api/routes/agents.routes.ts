/**
 * Agent management API routes
 */

import { Router, Request, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import logger from '../../utils/logger';
import { getAlerts } from './alerts.routes';

const router = Router();

let agentGateway: any = null;

export function setAgentGateway(gateway: any): void {
    agentGateway = gateway;
}

router.use(authenticate);

router.get('/', (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const agents = agentGateway.getAgentList();
        res.json({ success: true, count: agents.length, agents });
    } catch (error: any) {
        logger.error('Failed to get agents', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/threats/recent', (req: Request, res: Response) => {
    try {
        const limitRaw = Number(req.query.limit || 50);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

        const alerts = getAlerts()
            .filter((a: any) => a.type === 'security')
            .slice(0, limit)
            .map((a: any) => ({
                id: a.id,
                title: a.title,
                message: a.message,
                severity: String(a.severity || '').toLowerCase(),
                source: a.source,
                timestamp: a.timestamp
            }));

        res.json({ success: true, threats: alerts });
    } catch (error: any) {
        logger.error('Failed to get recent threats', { error: error.message });
        res.status(500).json({
            success: false,
            error: {
                code: 'FG-AGENTS-THREATS-500',
                message: error?.message || 'Failed to fetch recent threats',
                timestamp: new Date().toISOString()
            }
        });
    }
});

router.post('/:id/scan', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const success = agentGateway.sendCommandToAgent(req.params.id, { type: 'scan' });

        if (!success) {
            return res.status(404).json({ error: 'Agent not found or offline' });
        }

        res.json({ success: true, message: 'Scan command sent' });
    } catch (error: any) {
        logger.error('Failed to trigger scan', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

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

        res.json({ success: true, message: `Block command sent for IP: ${ip}` });
    } catch (error: any) {
        logger.error('Failed to block IP', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

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

        res.json({ success: true, message: `Unblock command sent for IP: ${ip}` });
    } catch (error: any) {
        logger.error('Failed to unblock IP', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/stats', (req: Request, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const agents = agentGateway.getAgentList();
        const onlineAgents = agents.filter((a: any) => a.isOnline);

        let totalCpuUsage = 0;
        let totalMemoryUsage = 0;
        let totalUptime = 0;
        let validStatsCount = 0;

        for (const agent of agents) {
            if (agent.status && agent.isOnline) {
                totalCpuUsage += agent.status.cpuUsage || 0;
                totalMemoryUsage += agent.status.memoryUsage || 0;
                totalUptime += agent.status.uptime || 0;
                validStatsCount++;
            }
        }

        const avgCpuUsage = validStatsCount > 0 ? Math.round(totalCpuUsage / validStatsCount) : 0;
        const avgMemoryUsage = validStatsCount > 0 ? Math.round(totalMemoryUsage / validStatsCount) : 0;
        const avgUptime = validStatsCount > 0 ? Math.round(totalUptime / validStatsCount) : 0;

        res.json({
            totalAgents: agents.length,
            activeAgents: onlineAgents.length,
            avgCpuUsage,
            avgMemoryUsage,
            avgUptime,
            agents: agents.map((a: any) => ({
                id: a.agentId,
                name: a.hostname || a.agentId,
                role: a.platform || 'Probe',
                status: a.isOnline ? 'active' : 'inactive',
                cpuUsage: a.status?.cpuUsage || 0,
                memoryUsage: a.status?.memoryUsage || 0,
                uptime: a.status?.uptime || 0
            }))
        });
    } catch (error: any) {
        logger.error('Failed to get stats', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/health', (req: Request, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'Agent gateway not available' });
        }

        const agents = agentGateway.getAgentList();
        const details: Record<string, any> = {};

        for (const agent of agents) {
            details[agent.agentId] = {
                status: agent.isOnline ? 'active' : 'inactive',
                lastActivity: agent.lastHeartbeat || new Date().toISOString(),
                cpuUsage: agent.status?.cpuUsage || 0,
                memoryUsage: agent.status?.memoryUsage || 0
            };
        }

        res.json({
            status: agents.length > 0 ? 'healthy' : 'no_agents',
            details
        });
    } catch (error: any) {
        logger.error('Failed to get health', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

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
                offlineAgents: 0,
                lastUpdated: new Date().toISOString()
            }
        });
    } catch (error: any) {
        logger.error('Failed to get stats', { error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

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

export default router;
