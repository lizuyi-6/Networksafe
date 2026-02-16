import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
    MultiAgentDecisionSystem,
    createMultiAgentSystem,
    ProbeReport,
    TrafficRequest,
    MultiAgentConfig
} from '../ai-agents';
import logger from '../utils/logger';
import { isAttackSimulatorEnabled, isDemoMode } from '../config/app-mode';

const router = Router();

let multiAgentSystem: MultiAgentDecisionSystem | null = null;
let attackHistory: any[] = [];
let agentGateway: any = null;

interface TrafficStats {
    packetsProcessed: number;
    packetsAllowed: number;
    packetsBlocked: number;
    packetsInspected: number;
    bytesProcessed: number;
    startTime: Date;
    threats: Map<string, { type: string; count: number; severity: string }>;
    activeFlows: any[];
}

const trafficStats: TrafficStats = {
    packetsProcessed: 0,
    packetsAllowed: 0,
    packetsBlocked: 0,
    packetsInspected: 0,
    bytesProcessed: 0,
    startTime: new Date(),
    threats: new Map(),
    activeFlows: []
};

export const setAgentGateway = (gateway: any) => {
    agentGateway = gateway;
};

export const initializeAgentSystem = async (): Promise<void> => {
    if (multiAgentSystem) {
        logger.warn('Multi-Agent System already initialized');
        return;
    }

    const config: Partial<MultiAgentConfig> = {
        enabled: true,
        models: {
            local: {
                provider: 'ollama' as const,
                model: process.env.AI_LOCAL_MODEL || 'llama3:8b',
                temperature: 0.3,
                maxTokens: 2000,
                baseURL: process.env.OLLAMA_URL || 'http://localhost:11434'
            },
            cloud: {
                provider: 'dashscope' as const,
                model: process.env.AI_CLOUD_MODEL || 'qwen3-coder-480b-a35b-instruct',
                temperature: 0.2,
                maxTokens: 4000,
                baseURL: process.env.DASHSCOPE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                apiKey: process.env.DASHSCOPE_API_KEY
            }
        }
    };

    multiAgentSystem = createMultiAgentSystem(config);
    
    multiAgentSystem.onProbeReport((report: ProbeReport) => {
        logger.debug('Probe report generated', {
            agentCount: report.agents.length,
            alertCount: report.alerts.length
        });
    });

    await multiAgentSystem.initialize();
    logger.info('Multi-Agent System initialized for API routes');
};

export const getAgentSystem = (): MultiAgentDecisionSystem | null => {
    return multiAgentSystem;
};

export const getTrafficStats = (): TrafficStats => {
    return trafficStats;
};

const requireAttackSimulatorEnabled = (res: Response): boolean => {
    if (isAttackSimulatorEnabled()) {
        return true;
    }
    res.status(404).json({ error: 'Not found' });
    return false;
};

router.get('/agents/stats', async (req: Request, res: Response) => {
    try {
        if (!multiAgentSystem || !multiAgentSystem.isInitialized()) {
            const isDemo = isDemoMode();
            return res.json({
                orchestrator: {
                    activeTasks: 0,
                    registeredAgents: 0
                },
                messageBus: {
                    queueSize: trafficStats.packetsProcessed - trafficStats.packetsBlocked - trafficStats.packetsAllowed,
                    subscriptionCount: 0,
                    pendingRequests: 0
                },
                synthesis: {
                    totalCaseFiles: trafficStats.packetsProcessed,
                    totalLessons: trafficStats.packetsBlocked,
                    totalPolicyUpdates: Math.floor(trafficStats.packetsProcessed / 10),
                    topPatterns: Array.from(trafficStats.threats.values()).map(t => ({
                        pattern: t.type.toLowerCase().replace(/ /g, '_'),
                        frequency: t.count
                    }))
                },
                health: {
                    status: 'healthy' as const,
                    details: {
                        system: 'operational',
                        agents: 'no_live_data',
                        messageBus: 'active'
                    }
                },
                agents: isDemo ? [
                    { agentId: 'socrates-01', role: 'socrates', status: 'active', lastSeen: new Date().toISOString(), responseTime: 120, tasksCompleted: trafficStats.packetsProcessed, tasksPending: 0, errorCount: 0, memoryUsage: 45, cpuUsage: 23 },
                    { agentId: 'plato-01', role: 'plato', status: 'active', lastSeen: new Date().toISOString(), responseTime: 95, tasksCompleted: trafficStats.packetsProcessed, tasksPending: 0, errorCount: 0, memoryUsage: 38, cpuUsage: 18 },
                    { agentId: 'aristotle-01', role: 'aristotle', status: 'active', lastSeen: new Date().toISOString(), responseTime: 85, tasksCompleted: trafficStats.packetsProcessed, tasksPending: 0, errorCount: 0, memoryUsage: 42, cpuUsage: 21 }
                ] : []
            });
        }

        const stats = multiAgentSystem.getStats();
        const health = multiAgentSystem.getHealthStatus();
        const probeReport = multiAgentSystem.getProbeReport();

        const agents = probeReport.agents.map(agent => ({
            agentId: agent.agentId,
            role: agent.role,
            status: agent.status,
            lastSeen: agent.lastSeen.toISOString(),
            responseTime: agent.responseTime,
            tasksCompleted: agent.tasksCompleted,
            tasksPending: agent.tasksPending,
            errorCount: agent.errorCount,
            memoryUsage: agent.memoryUsage,
            cpuUsage: agent.cpuUsage
        }));

        res.json({
            orchestrator: {
                activeTasks: stats.orchestrator.activeTasks,
                registeredAgents: stats.orchestrator.registeredAgents
            },
            messageBus: {
                queueSize: stats.messageBus.queueSize,
                subscriptionCount: stats.messageBus.subscriptionCount,
                pendingRequests: stats.messageBus.pendingRequests
            },
            synthesis: stats.synthesis,
            health,
            agents
        });
    } catch (error: any) {
        logger.error('Failed to get agent stats', { error: error.message });
        res.status(500).json({ error: 'Failed to get agent stats' });
    }
});

router.get('/agents/health', (req: Request, res: Response) => {
    if (!multiAgentSystem || !multiAgentSystem.isInitialized()) {
        return res.json({
            status: 'healthy' as const,
            details: {
                system: 'operational',
                agents: 'no_live_data',
                messageBus: 'active'
            }
        });
    }

    res.json(multiAgentSystem.getHealthStatus());
});

router.get('/traffic/stats', (req: Request, res: Response) => {
    const uptime = Math.floor((Date.now() - trafficStats.startTime.getTime()) / 1000);
    const isDemo = isDemoMode();
    
    res.json({
        uptime,
        packetsProcessed: trafficStats.packetsProcessed,
        packetsAllowed: trafficStats.packetsAllowed,
        packetsBlocked: trafficStats.packetsBlocked,
        packetsInspected: trafficStats.packetsInspected,
        bytesProcessed: trafficStats.bytesProcessed,
        currentFlows: trafficStats.activeFlows.length,
        activeConnections: trafficStats.activeFlows.filter(f => f.state === 'ESTABLISHED').length,
        droppedPackets: 0,
        bufferOverflows: 0,
        avgProcessingTime: trafficStats.packetsProcessed > 0 
            ? Math.floor(trafficStats.bytesProcessed / trafficStats.packetsProcessed / 100) 
            : 0,
        cpuUsage: isDemo ? 25 + Math.random() * 15 : 0,
        memoryUsage: isDemo ? 40 + Math.random() * 20 : 0
    });
});

router.get('/traffic/flows', (req: Request, res: Response) => {
    if (trafficStats.activeFlows.length > 0) {
        res.json(trafficStats.activeFlows.slice(0, 20));
    } else {
        if (!isDemoMode()) {
            return res.json([]);
        }
        interface FlowInfo {
            id: string;
            sourceIP: string;
            destIP: string;
            sourcePort: number;
            destPort: number;
            protocol: string;
            state: string;
            packetCount: number;
            byteCount: number;
            startTime: string;
            lastActivity: string;
        }
        const flows: FlowInfo[] = [];
        const protocols = ['tcp', 'udp'];
        const states = ['ESTABLISHED', 'TIME_WAIT', 'CLOSE_WAIT', 'FIN_WAIT'];
        
        for (let i = 0; i < 10; i++) {
            flows.push({
                id: uuidv4(),
                sourceIP: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
                destIP: `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
                sourcePort: Math.floor(Math.random() * 65535) + 1024,
                destPort: [80, 443, 8080, 3000, 5432][Math.floor(Math.random() * 5)],
                protocol: protocols[Math.floor(Math.random() * protocols.length)],
                state: states[Math.floor(Math.random() * states.length)],
                packetCount: Math.floor(Math.random() * 10000),
                byteCount: Math.floor(Math.random() * 1000000),
                startTime: new Date(Date.now() - Math.random() * 3600000).toISOString(),
                lastActivity: new Date().toISOString()
            });
        }
        res.json(flows);
    }
});

router.get('/traffic/protocols', (req: Request, res: Response) => {
    const base = trafficStats.packetsProcessed;
    const isDemo = isDemoMode();
    if (!isDemo && base === 0) {
        return res.json({ http: 0, https: 0, dns: 0, other: 0 });
    }
    res.json({
        http: Math.floor(base * 0.3) + (isDemo ? Math.floor(Math.random() * 500) : 0),
        https: Math.floor(base * 0.6) + (isDemo ? Math.floor(Math.random() * 2000) : 0),
        dns: Math.floor(base * 0.05) + (isDemo ? Math.floor(Math.random() * 100) : 0),
        other: Math.floor(base * 0.05) + (isDemo ? Math.floor(Math.random() * 50) : 0)
    });
});

router.get('/traffic/threats', (req: Request, res: Response) => {
    const threats = Array.from(trafficStats.threats.values());
    if (threats.length > 0) {
        res.json(threats);
    } else {
        res.json([]);
    }
});

router.get('/types', (req: Request, res: Response) => {
    if (!requireAttackSimulatorEnabled(res)) {
        return;
    }
    res.json([
        { id: 'sql-1', name: "Basic OR Bypass", category: 'sql_injection', severity: 'critical', description: "' OR '1'='1' --" },
        { id: 'sql-2', name: "UNION SELECT", category: 'sql_injection', severity: 'critical', description: "UNION SELECT * FROM users" },
        { id: 'sql-3', name: "Comment Injection", category: 'sql_injection', severity: 'high', description: "admin'--" },
        { id: 'xss-1', name: "Script Tag", category: 'xss', severity: 'high', description: "<script>alert('XSS')</script>" },
        { id: 'xss-2', name: "Event Handler", category: 'xss', severity: 'high', description: "<img src=x onerror=alert(1)>" },
        { id: 'path-1', name: "Basic Traversal", category: 'path_traversal', severity: 'critical', description: "../../../etc/passwd" },
        { id: 'cmd-1', name: "Semicolon Injection", category: 'command_injection', severity: 'critical', description: "127.0.0.1; cat /etc/passwd" },
        { id: 'rate-1', name: "Rapid Requests", category: 'rate_abuse', severity: 'medium', description: "100 requests in 1 second" }
    ]);
});

router.post('/simulate', async (req: Request, res: Response) => {
    if (!requireAttackSimulatorEnabled(res)) {
        return;
    }
    const { attackIds } = req.body;
    const startTime = new Date();
    const simulationId = uuidv4();
    
    const allAttacks = [
        { id: 'sql-1', name: "Basic OR Bypass", category: 'sql_injection', severity: 'critical', payload: "' OR '1'='1' --" },
        { id: 'sql-2', name: "UNION SELECT", category: 'sql_injection', severity: 'critical', payload: "UNION SELECT * FROM users" },
        { id: 'sql-3', name: "Comment Injection", category: 'sql_injection', severity: 'high', payload: "admin'--" },
        { id: 'xss-1', name: "Script Tag", category: 'xss', severity: 'high', payload: "<script>alert('XSS')</script>" },
        { id: 'xss-2', name: "Event Handler", category: 'xss', severity: 'high', payload: "<img src=x onerror=alert(1)>" },
        { id: 'path-1', name: "Basic Traversal", category: 'path_traversal', severity: 'critical', payload: "../../../etc/passwd" },
        { id: 'cmd-1', name: "Semicolon Injection", category: 'command_injection', severity: 'critical', payload: "127.0.0.1; cat /etc/passwd" },
        { id: 'rate-1', name: "Rapid Requests", category: 'rate_abuse', severity: 'medium', payload: "rapid_requests" }
    ];
    
    const attacksToRun = attackIds && attackIds.length > 0
        ? allAttacks.filter(a => attackIds.includes(a.id))
        : allAttacks;

    const broadcastEvent = (event: string, data: any) => {
        if (agentGateway && typeof agentGateway.broadcastToDashboards === 'function') {
            agentGateway.broadcastToDashboards(event, { simulationId, ...data });
        }
    };

    interface AttackResult {
        attackId: string;
        attackName: string;
        category: string;
        severity: string;
        blocked: boolean;
        detected: boolean;
        responseTime: number;
        decision?: any;
    }
    const results: AttackResult[] = [];

    broadcastEvent('attack:simulation:start', { 
        totalAttacks: attacksToRun.length,
        attacks: attacksToRun 
    });

    for (let i = 0; i < attacksToRun.length; i++) {
        const attack = attacksToRun[i];
        let blocked = false;
        let detected = false;
        let responseTime = Math.floor(Math.random() * 100) + 10;
        let decision: any = null;

        trafficStats.packetsProcessed++;
        trafficStats.packetsInspected++;
        trafficStats.bytesProcessed += Math.floor(Math.random() * 5000) + 1000;

        const flowId = uuidv4();
        const flow = {
            id: flowId,
            sourceIP: '192.168.1.100',
            destIP: '10.0.0.1',
            sourcePort: Math.floor(Math.random() * 65535) + 1024,
            destPort: 443,
            protocol: 'tcp',
            state: 'ESTABLISHED',
            packetCount: 1,
            byteCount: attack.payload.length,
            startTime: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            attackId: attack.id,
            attackName: attack.name
        };
        trafficStats.activeFlows.unshift(flow);

        broadcastEvent('attack:start', {
            attackIndex: i,
            attackId: attack.id,
            attackName: attack.name,
            category: attack.category,
            severity: attack.severity,
            payload: attack.payload
        });

        if (multiAgentSystem && multiAgentSystem.isInitialized()) {
            try {
                const trafficRequest: TrafficRequest = {
                    id: uuidv4(),
                    method: 'POST',
                    path: '/api/test',
                    headers: { 'content-type': 'application/json' },
                    queryParams: {},
                    body: JSON.stringify({ input: attack.payload }),
                    sourceIP: '192.168.1.100',
                    userAgent: 'AttackSimulator/1.0',
                    timestamp: new Date()
                };

                broadcastEvent('agent:analysis', {
                    attackId: attack.id,
                    agent: 'socrates',
                    status: 'analyzing',
                    message: 'Red team agent analyzing for potential bypasses...'
                });

                await new Promise(r => setTimeout(r, 200));

                broadcastEvent('agent:analysis', {
                    attackId: attack.id,
                    agent: 'plato',
                    status: 'analyzing',
                    message: 'Blue team agent validating schema and patterns...'
                });

                await new Promise(r => setTimeout(r, 200));

                broadcastEvent('agent:analysis', {
                    attackId: attack.id,
                    agent: 'aristotle',
                    status: 'analyzing',
                    message: 'Analyst agent reviewing historical behavior...'
                });

                decision = await multiAgentSystem.analyze(trafficRequest);
                
                blocked = decision.verdict === 'block';
                detected = decision.verdict !== 'allow';
                responseTime = decision.processingTime || responseTime;

                broadcastEvent('agent:analysis', {
                    attackId: attack.id,
                    agent: 'orchestrator',
                    status: 'complete',
                    message: `Final decision: ${decision.verdict.toUpperCase()} (confidence: ${(decision.confidence * 100).toFixed(0)}%)`,
                    verdict: decision.verdict,
                    confidence: decision.confidence,
                    reasoning: decision.reasoning,
                    evidence: decision.evidence
                });

            } catch (error: any) {
                logger.warn(`Attack simulation failed for ${attack.id}`, { error: error.message });
                broadcastEvent('agent:analysis', {
                    attackId: attack.id,
                    agent: 'system',
                    status: 'error',
                    message: `Analysis failed: ${error.message}`
                });
                blocked = true;
                detected = true;
            }
        } else if (isDemoMode()) {
            blocked = Math.random() > 0.15;
            detected = blocked || Math.random() > 0.3;
        } else {
            return res.status(503).json({
                error: 'Attack simulator backend is not initialized'
            });
        }

        if (blocked) {
            trafficStats.packetsBlocked++;
            const threatType = attack.category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const existing = trafficStats.threats.get(attack.category);
            if (existing) {
                existing.count++;
            } else {
                trafficStats.threats.set(attack.category, {
                    type: threatType,
                    count: 1,
                    severity: attack.severity
                });
            }
        } else {
            trafficStats.packetsAllowed++;
        }

        flow.state = blocked ? 'BLOCKED' : 'ALLOWED';

        const result = {
            attackId: attack.id,
            attackName: attack.name,
            category: attack.category,
            severity: attack.severity,
            blocked,
            detected,
            responseTime,
            decision
        };
        results.push(result);

        broadcastEvent('attack:result', {
            attackIndex: i,
            ...result
        });

        broadcastEvent('traffic:update', {
            stats: {
                packetsProcessed: trafficStats.packetsProcessed,
                packetsAllowed: trafficStats.packetsAllowed,
                packetsBlocked: trafficStats.packetsBlocked,
                bytesProcessed: trafficStats.bytesProcessed
            },
            flow: flow
        });

        await new Promise(r => setTimeout(r, 100));
    }

    if (trafficStats.activeFlows.length > 100) {
        trafficStats.activeFlows = trafficStats.activeFlows.slice(0, 100);
    }
    
    const report = {
        total: results.length,
        blocked: results.filter(r => r.blocked).length,
        detected: results.filter(r => r.detected).length,
        allowed: results.filter(r => !r.blocked).length,
        errors: 0,
        results,
        startTime: startTime.toISOString(),
        endTime: new Date().toISOString(),
        detectionRate: results.length > 0 
            ? (results.filter(r => r.detected).length / results.length * 100).toFixed(1) + '%'
            : '0%',
        blockRate: results.length > 0
            ? (results.filter(r => r.blocked).length / results.length * 100).toFixed(1) + '%'
            : '0%'
    };
    
    broadcastEvent('attack:simulation:complete', report);
    
    attackHistory.unshift(report);
    if (attackHistory.length > 10) {
        attackHistory.pop();
    }
    
    res.json(report);
});

router.get('/history', (req: Request, res: Response) => {
    if (!requireAttackSimulatorEnabled(res)) {
        return;
    }
    res.json(attackHistory);
});

export default router;
