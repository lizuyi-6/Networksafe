﻿﻿﻿/**
 * Agent management API routes
 */

import { Router, Request, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import logger from '../../utils/logger';
import { getAlerts } from './alerts.routes';
import * as net from 'net';
import { securityOperationsService } from '../../services/security-operations.service';
import { scannerTaskService } from '../../services/scanner-task.service';
import auditLogger from '../../security/audit-logger.service';
import { commandDispatcherService } from '../../services/command-dispatcher.service';

const router = Router();

const MIN_DURATION = 1;
const MAX_DURATION = 86400;

function isValidIP(ip: string): boolean {
  return net.isIP(ip) !== 0;
}

function validateDuration(duration: any): { valid: boolean; value?: number; error?: string } {
  if (duration === undefined || duration === null) {
    return { valid: true, value: 3600 };
  }
  
  const num = Number(duration);
  if (!Number.isFinite(num) || num < MIN_DURATION || num > MAX_DURATION) {
    return { 
      valid: false, 
      error: `Invalid duration. Must be between ${MIN_DURATION} and ${MAX_DURATION} seconds.` 
    };
  }
  
  return { valid: true, value: Math.floor(num) };
}

let agentGateway: any = null;

export function setAgentGateway(gateway: any): void {
    agentGateway = gateway;
    commandDispatcherService.setAgentGateway(gateway);
}

function tenantOf(req: AuthenticatedRequest): string {
    return req.user?.tenantId || 'global';
}

function safeAuditLog(payload: any): void {
    Promise.resolve(auditLogger.log(payload)).catch((error: any) => {
        logger.warn('Agent audit log unavailable', { error: error?.message });
    });
}

function ensureAgentAsset(tenantId: string, agent: any) {
    const agentAsset = securityOperationsService.upsertAsset({
        tenantId,
        assetType: 'agent',
        externalRef: String(agent.agentId),
        displayName: String(agent.hostname || agent.agentId),
        primaryAddress: agent.registration?.ip || agent.hostname,
        status: agent.isOnline ? 'online' : 'offline',
        metadata: {
            platform: agent.platform,
            version: agent.registration?.version,
            hostname: agent.hostname
        }
    });

    if (agent?.hostname) {
        securityOperationsService.upsertAsset({
            tenantId,
            assetType: 'host',
            externalRef: String(agent.hostname),
            displayName: String(agent.hostname),
            primaryAddress: agent.registration?.ip || agent.hostname,
            status: agent.isOnline ? 'online' : 'offline',
            metadata: {
                agentId: agent.agentId,
                platform: agent.platform
            }
        });
    }

    return agentAsset;
}

function syncAgentSignals(tenantId: string, agent: any, assetId?: string): void {
    const target = String(agent.hostname || agent.agentId);
    const heartbeatTime = new Date(agent.lastHeartbeat || 0).getTime();
    const staleHeartbeat = agent.isOnline && Number.isFinite(heartbeatTime) && Date.now() - heartbeatTime > 5 * 60 * 1000;

    securityOperationsService.syncSignalFinding({
        tenantId,
        active: !agent.isOnline || staleHeartbeat,
        assetId,
        sourceType: 'agent-health',
        sourceRef: String(agent.agentId),
        target,
        category: 'agent-health',
        severity: 'high',
        title: !agent.isOnline ? 'Agent Offline' : 'Agent Heartbeat Stale',
        description: !agent.isOnline
            ? `Agent ${target} is offline and not receiving commands.`
            : `Agent ${target} has not sent telemetry within the last 5 minutes.`,
        evidence: {
            agentId: agent.agentId,
            lastHeartbeat: agent.lastHeartbeat,
            isOnline: agent.isOnline
        },
        remediation: {
            title: 'Recover agent control plane connectivity',
            owner: 'operations',
            priority: 'high',
            suggestedSteps: [
                'Check the agent process and host reachability.',
                'Verify the gateway can still establish control channel connectivity.',
                'Re-register or restart the agent if telemetry does not resume.'
            ]
        },
        fingerprint: `agent:${agent.agentId}:health:availability`,
        createAlert: true,
        alertType: 'system'
    });

    securityOperationsService.syncSignalFinding({
        tenantId,
        active: Boolean(agent.status && agent.status.cpuUsage >= 90),
        assetId,
        sourceType: 'agent-health',
        sourceRef: String(agent.agentId),
        target,
        category: 'agent-health',
        severity: 'high',
        title: 'Agent CPU Saturation',
        description: `Agent ${target} CPU usage is ${agent.status?.cpuUsage || 0}%.`,
        evidence: {
            agentId: agent.agentId,
            cpuUsage: agent.status?.cpuUsage || 0
        },
        remediation: {
            title: 'Reduce agent execution pressure',
            owner: 'operations',
            priority: 'high',
            suggestedSteps: [
                'Inspect the active tasks assigned to the agent.',
                'Throttle scan concurrency or rebalance workloads.',
                'Confirm the agent returns to a stable CPU baseline.'
            ]
        },
        fingerprint: `agent:${agent.agentId}:health:cpu`,
        createAlert: true,
        alertType: 'system'
    });

    securityOperationsService.syncSignalFinding({
        tenantId,
        active: Boolean(agent.status && agent.status.memoryUsage >= 85),
        assetId,
        sourceType: 'agent-health',
        sourceRef: String(agent.agentId),
        target,
        category: 'agent-health',
        severity: 'medium',
        title: 'Agent Memory Pressure',
        description: `Agent ${target} memory usage is ${agent.status?.memoryUsage || 0}%.`,
        evidence: {
            agentId: agent.agentId,
            memoryUsage: agent.status?.memoryUsage || 0
        },
        remediation: {
            title: 'Stabilize agent memory usage',
            owner: 'operations',
            priority: 'medium',
            suggestedSteps: [
                'Review the heaviest tasks running on the agent.',
                'Restart degraded workers if memory does not recover.',
                'Validate the agent remains healthy after rebalancing.'
            ]
        },
        fingerprint: `agent:${agent.agentId}:health:memory`,
        createAlert: false,
        alertType: 'system'
    });
}

function recordAgentAction(tenantId: string, agent: any, input: { title: string; status: 'pending' | 'running' | 'completed' | 'failed'; operator: string; rollbackNotes?: string; runLog?: Record<string, any>[]; }): void {
    try {
        const asset = ensureAgentAsset(tenantId, agent);
        securityOperationsService.recordActionRun({
            tenantId,
            assetId: asset.assetId,
            title: input.title,
            status: input.status,
            operator: input.operator,
            rollbackNotes: input.rollbackNotes,
            runLog: input.runLog
        });
    } catch {
        // Ignore when operations database is unavailable.
    }
}

function hydrateAgentContext(tenantId: string, agent: any) {
    try {
        const refs = new Set<string>();
        if (agent?.agentId) refs.add(String(agent.agentId));
        if (agent?.hostname) refs.add(String(agent.hostname));
        if (agent?.registration?.ip) refs.add(String(agent.registration.ip));

        const agentAsset = ensureAgentAsset(tenantId, agent);
        syncAgentSignals(tenantId, agent, agentAsset.assetId);

        const context = securityOperationsService.getOperationalContextForExternalRefs(
            tenantId,
            Array.from(refs),
            ['agent', 'host', 'ip']
        );

        return {
            agentAsset,
            context
        };
    } catch {
        return {
            agentAsset: null,
            context: {
                assets: [],
                findings: [],
                alerts: [],
                actions: [],
                trafficSessions: [],
                serviceExposure: [],
                scanRuns: []
            }
        };
    }
}

router.use(authenticate);

router.get('/', (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'backend.agent_gateway_not_available' });
        }

        const tenantId = tenantOf(req);
        const agents = agentGateway.getAgentList().map((agent: any) => {
            const context = hydrateAgentContext(tenantId, agent);
            return {
                ...agent,
                securitySummary: {
                    asset: context.agentAsset,
                    alerts: context.context.alerts.slice(0, 3),
                    findings: context.context.findings.slice(0, 3),
                    actions: context.context.actions.slice(0, 3),
                    scans: context.context.scanRuns.slice(0, 3)
                }
            };
        });
        res.json({ success: true, count: agents.length, agents });
    } catch (error: any) {
        logger.error('Failed to get agents', { error: error.message });
        res.status(500).json({ error: 'backend.internal_server_error' });
    }
});

router.get('/threats/recent', async (req: Request, res: Response) => {
    try {
        const limitRaw = Number(req.query.limit || 50);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

        const alerts = (await getAlerts())
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

router.post('/:id/scan', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'backend.agent_gateway_not_available' });
        }

        const agent = agentGateway.getAgent(req.params.id);
        if (!agent) {
            return res.status(404).json({ error: 'backend.agent_not_found_or_offline' });
        }

        let scanTask: any = null;
        try {
            scanTask = await scannerTaskService.createTask({
                tenantId: tenantOf(req),
                createdBy: req.user?.email || req.user?.userId || 'unknown',
                enginePolicy: 'opt_then_nuclei',
                targets: {
                    agentIds: [req.params.id]
                }
            });
        } catch {
            scanTask = null;
        }

        const dispatch = await commandDispatcherService.dispatchAgentCommand({
            agentId: req.params.id,
            commandType: 'scan',
            payload: { taskId: scanTask?.id || null },
            actor: {
                tenantId: tenantOf(req),
                userId: req.user?.userId || 'unknown',
                email: req.user?.email,
                ip: req.ip
            },
            approved: true
        });

        if (!dispatch.success) {
            return res.status(404).json({ error: 'backend.agent_not_found_or_offline', actionId: dispatch.actionId });
        }

        res.json({
            success: true,
            message: 'backend.scan_command_sent',
            dispatchMessage: dispatch.message,
            taskId: scanTask?.id,
            status: scanTask?.status,
            phase: scanTask?.phase,
            actionId: dispatch.actionId,
            commandStatus: dispatch.status
        });
    } catch (error: any) {
        logger.error('Failed to trigger scan', { error: error.message });
        res.status(500).json({ error: 'backend.internal_server_error' });
    }
});

router.post('/:id/block', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'backend.agent_gateway_not_available' });
        }

        const { ip, duration } = req.body;
        if (!ip) {
            return res.status(400).json({ error: 'backend.ip_address_required' });
        }

        if (!isValidIP(ip)) {
            return res.status(400).json({ error: 'backend.invalid_ip_address_format' });
        }

        const durationValidation = validateDuration(duration);
        if (!durationValidation.valid) {
            return res.status(400).json({ error: durationValidation.error });
        }

        const dispatch = await commandDispatcherService.dispatchAgentCommand({
            agentId: req.params.id,
            commandType: 'block_ip',
            payload: { ip, duration: durationValidation.value },
            actor: {
                tenantId: tenantOf(req),
                userId: req.user?.userId || 'unknown',
                email: req.user?.email,
                ip: req.ip
            },
            approved: true
        });

        if (!dispatch.success) {
            return res.status(404).json({ error: 'backend.agent_not_found_or_offline', actionId: dispatch.actionId });
        }

        res.json({ success: true, message: dispatch.message, actionId: dispatch.actionId, status: dispatch.status });
    } catch (error: any) {
        logger.error('Failed to block IP', { error: error.message });
        res.status(500).json({ error: 'backend.internal_server_error' });
    }
});

router.post('/:id/unblock', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'backend.agent_gateway_not_available' });
        }

        const { ip } = req.body;
        if (!ip) {
            return res.status(400).json({ error: 'backend.ip_address_required' });
        }

        if (!isValidIP(ip)) {
            return res.status(400).json({ error: 'backend.invalid_ip_address_format' });
        }

        const dispatch = await commandDispatcherService.dispatchAgentCommand({
            agentId: req.params.id,
            commandType: 'unblock_ip',
            payload: { ip },
            actor: {
                tenantId: tenantOf(req),
                userId: req.user?.userId || 'unknown',
                email: req.user?.email,
                ip: req.ip
            },
            approved: true
        });

        if (!dispatch.success) {
            return res.status(404).json({ error: 'backend.agent_not_found_or_offline', actionId: dispatch.actionId });
        }

        res.json({ success: true, message: dispatch.message, actionId: dispatch.actionId, status: dispatch.status });
    } catch (error: any) {
        logger.error('Failed to unblock IP', { error: error.message });
        res.status(500).json({ error: 'backend.internal_server_error' });
    }
});

router.get('/stats', (req: Request, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'backend.agent_gateway_not_available' });
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
        res.status(500).json({ error: 'backend.internal_server_error' });
    }
});

router.get('/health', (req: Request, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'backend.agent_gateway_not_available' });
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
        res.status(500).json({ error: 'backend.internal_server_error' });
    }
});

router.get('/stats/summary', (req: Request, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'backend.agent_gateway_not_available' });
        }

        const agents = agentGateway.getAgentList();
        res.json({
            success: true,
            summary: {
                totalAgents: agents.length,
                onlineAgents: agents.filter((a: any) => a.isOnline).length,
                offlineAgents: agents.filter((a: any) => !a.isOnline).length,
                lastUpdated: new Date().toISOString()
            }
        });
    } catch (error: any) {
        logger.error('Failed to get stats', { error: error.message });
        res.status(500).json({ error: 'backend.internal_server_error' });
    }
});

router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!agentGateway) {
            return res.status(503).json({ error: 'backend.agent_gateway_not_available' });
        }

        const agent = agentGateway.getAgent(req.params.id);
        if (!agent) {
            return res.status(404).json({ error: 'backend.agent_not_found' });
        }

        const tenantId = tenantOf(req);
        const securityContext = hydrateAgentContext(tenantId, agent);
        const relatedThreats = (await getAlerts(tenantId))
            .filter((alert: any) => alert.type === 'security')
            .filter((alert: any) =>
                String(alert.source || '').toLowerCase().includes(String(agent.hostname || '').toLowerCase()) ||
                String(alert.message || '').toLowerCase().includes(String(agent.hostname || '').toLowerCase())
            )
            .slice(0, 10);

        res.json({
            success: true,
            agent: {
                ...agent,
                isOnline: agent.isOnline
            },
            data: {
                summary: {
                    ...agent,
                    isOnline: agent.isOnline,
                    securitySummary: securityContext.agentAsset
                },
                capabilities: {
                    platform: agent.platform || 'linux',
                    arch: agent.registration?.arch || 'unknown',
                    cpus: agent.registration?.cpus || 0,
                    totalMemory: agent.registration?.totalMemory || 0,
                    version: agent.registration?.version || 'unknown'
                },
                recentThreats: securityContext.context.alerts.length > 0 ? securityContext.context.alerts : relatedThreats,
                securityOverview: {
                    asset: securityContext.agentAsset,
                    assets: securityContext.context.assets,
                    findings: securityContext.context.findings,
                    alerts: securityContext.context.alerts,
                    actions: securityContext.context.actions,
                    scans: securityContext.context.scanRuns,
                    trafficSessions: securityContext.context.trafficSessions,
                    serviceExposure: securityContext.context.serviceExposure
                },
                relatedFindings: securityContext.context.findings,
                relatedActions: securityContext.context.actions,
                relatedScans: securityContext.context.scanRuns,
                relatedSessions: securityContext.context.trafficSessions,
                timeline: [
                    {
                        title: 'Last heartbeat',
                        description: agent.isOnline ? 'Agent reported healthy telemetry.' : 'Agent heartbeat is stale.',
                        timestamp: agent.lastHeartbeat
                    },
                    ...securityContext.context.scanRuns.slice(0, 5).map((run: any) => ({
                        title: 'Scan activity',
                        description: `Run ${run.id} is ${run.status} in phase ${run.phase}`,
                        timestamp: run.completedAt || run.startedAt || run.createdAt
                    })),
                    ...securityContext.context.actions.slice(0, 5).map((action: any) => ({
                        title: 'Remediation action',
                        description: `${action.title} is ${action.status}`,
                        timestamp: action.updatedAt
                    }))
                ]
            }
        });
    } catch (error: any) {
        logger.error('Failed to get agent', { error: error.message });
        res.status(500).json({ error: 'backend.internal_server_error' });
    }
});

export default router;
