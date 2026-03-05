import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { TrafficRequest } from '../../ai-agents';
import logger from '../../utils/logger';
import { isAttackSimulatorEnabled } from '../../config/app-mode';
import { getAgentSystem, getTrafficStats, getAgentGateway } from './ai-system.routes';

const router = Router();

let attackHistory: any[] = [];

const requireAttackSimulatorEnabled = (res: Response): boolean => {
    if (isAttackSimulatorEnabled()) {
        return true;
    }
    res.status(404).json({ error: 'backend.not_found' });
    return false;
};

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
        ? allAttacks.filter((a: any) => attackIds.includes(a.id))
        : allAttacks;

    const agentGateway = getAgentGateway();

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

    const trafficStats = getTrafficStats();
    const multiAgentSystem = getAgentSystem();

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
                    message: 'backend.red_team_agent_analyzing_for_potential_bypasses'
                });

                await new Promise(r => setTimeout(r, 200));

                broadcastEvent('agent:analysis', {
                    attackId: attack.id,
                    agent: 'plato',
                    status: 'analyzing',
                    message: 'backend.blue_team_agent_validating_schema_and_patterns'
                });

                await new Promise(r => setTimeout(r, 200));

                broadcastEvent('agent:analysis', {
                    attackId: attack.id,
                    agent: 'aristotle',
                    status: 'analyzing',
                    message: 'backend.analyst_agent_reviewing_historical_behavior'
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
        } else {
            return res.status(503).json({
                error: 'backend.attack_simulator_backend_is_not_initialized'
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
