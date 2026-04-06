import { Request, Response } from 'express';
import os from 'os';
import { getAgentSystem } from '../../services/agent-system.service';
import logger from '../../utils/logger';
import { isDemoMode } from '../../config/app-mode';

export class AdminController {
    static getErrors(req: Request, res: Response) {
        try {
            const agentSystem = getAgentSystem();
            let errors: any[] = [];

            if (agentSystem && agentSystem.isInitialized()) {
                const probeReport = agentSystem.getProbeReport();
                const alerts = probeReport.alerts || [];

                errors = alerts
                    .filter((alert: any) => alert.severity === 'critical' || alert.severity === 'high')
                    .slice(0, 10)
                    .map((alert: any) => ({
                        userId: alert.metadata?.sourceIP || 'unknown',
                        errorCode: alert.metadata?.ruleId || 'SECURITY_ALERT',
                        message: alert.message || 'Security event detected',
                        timestamp: alert.timestamp || new Date().toISOString()
                    }));
            }

            // 无论是否是演示模式，都返回真实数据
            res.json(errors);
        } catch (error: any) {
            logger.error('Failed to get errors', { error: error.message });
            res.json([]);
        }
    }

    static getPerformance(req: Request, res: Response) {
        try {
            const cpus = os.cpus();
            const totalMemory = os.totalmem();
            const freeMemory = os.freemem();
            const usedMemory = totalMemory - freeMemory;
            const memoryUsage = (usedMemory / totalMemory) * 100;

            let totalIdle = 0;
            let totalTick = 0;
            cpus.forEach(cpu => {
                for (const type in cpu.times) {
                    totalTick += (cpu.times as any)[type];
                }
                totalIdle += cpu.times.idle;
            });
            const cpuUsage = 100 - ~~(100 * totalIdle / totalTick);

            const agentSystem = getAgentSystem();
            let totalAgents = 0;
            let avgCpuOverhead = 0;
            let avgLatency = 0;

            if (agentSystem && agentSystem.isInitialized()) {
                const stats = agentSystem.getStats();
                totalAgents = stats.orchestrator.registeredAgents;

                const probeReport = agentSystem.getProbeReport();
                const agents = probeReport.agents || [];

                if (agents.length > 0) {
                    const totalCpu = agents.reduce((sum: number, a: any) => sum + (a.cpuUsage || 0), 0);
                    const totalLatency = agents.reduce((sum: number, a: any) => sum + (a.responseTime || 0), 0);
                    avgCpuOverhead = totalCpu / agents.length;
                    avgLatency = totalLatency / agents.length;
                }
            }

            const performance = {
                server: {
                    cpu: Math.round(cpuUsage * 10) / 10,
                    memory: Math.round(memoryUsage * 10) / 10,
                    uptime: os.uptime(),
                    platform: os.platform(),
                    hostname: os.hostname()
                },
                clients: {
                    total_agents: totalAgents,
                    avg_cpu_overhead: avgCpuOverhead.toFixed(2),
                    avg_latency_added: `${Math.round(avgLatency)}ms`
                }
            };

            res.json(performance);
        } catch (error: any) {
            logger.error('Failed to get performance', { error: error.message });
            res.json({
                server: {
                    cpu: 0,
                    memory: 0,
                    uptime: 0
                },
                clients: {
                    total_agents: 0,
                    avg_cpu_overhead: '0',
                    avg_latency_added: '0ms'
                }
            });
        }
    }

    static submitLogs(req: Request, res: Response) {
        try {
            const { data } = req.body;

            if (!data) {
                return res.status(400).json({ error: 'backend.missing_data' });
            }

            logger.info('[ADMIN] Received logs', { data });

            res.json({ success: true, message: 'backend.logs_received' });
        } catch (error) {
            logger.error('[ADMIN] Processing failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            res.status(400).json({ error: 'backend.processing_failed' });
        }
    }
}
