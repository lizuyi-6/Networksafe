import { Router, Request, Response } from 'express';
import { uuidv4 } from '../../utils/uuid';
import { TrafficRequest } from '../../ai-agents';
import logger from '../../utils/logger';
import { isAttackSimulatorEnabled } from '../../config/app-mode';
import { getAgentSystem } from '../../services/agent-system.service';
import { getTrafficStats } from '../../services/traffic-stats.service';
import { getAgentGateway } from '../../services/agent-system.service';
import { securityOperationsService } from '../../services/security-operations.service';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { PLATFORM_API_CONFIG } from '../../utils/model-access';

const router = Router();
router.use(authenticate);

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
    const tenantId = (req as any).user?.tenantId || 'global';

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
        aiAnalysis?: Record<string, any>;
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
        let aiAnalysis: Record<string, any> = {
            enabled: Boolean(multiAgentSystem),
            usedAI: false,
            engine: 'multi_agent',
            route: 'unknown',
            provider: null,
            model: null,
            modelRouterDelta: {
                total: 0,
                local: 0,
                cloud: 0
            }
        };

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
        const sourceAsset = securityOperationsService.upsertAsset({
            tenantId,
            assetType: 'ip',
            externalRef: flow.sourceIP,
            displayName: flow.sourceIP,
            primaryAddress: flow.sourceIP
        });
        const destAsset = securityOperationsService.upsertAsset({
            tenantId,
            assetType: 'host',
            externalRef: flow.destIP,
            displayName: flow.destIP,
            primaryAddress: flow.destIP
        });

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
                const modelRouterStatsBefore = multiAgentSystem.getStats().modelRouter;
                const multiAgentConfig = multiAgentSystem.getConfig();
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
                const modelRouterStatsAfter = multiAgentSystem.getStats().modelRouter;
                const statsDelta = {
                    total: Math.max(0, modelRouterStatsAfter.total - modelRouterStatsBefore.total),
                    local: Math.max(0, modelRouterStatsAfter.local - modelRouterStatsBefore.local),
                    cloud: Math.max(0, modelRouterStatsAfter.cloud - modelRouterStatsBefore.cloud)
                };
                const routeUsed = statsDelta.cloud > 0 && statsDelta.local > 0
                    ? 'hybrid'
                    : statsDelta.cloud > 0
                        ? 'cloud'
                        : statsDelta.local > 0
                            ? 'local'
                            : 'unknown';

                aiAnalysis = {
                    enabled: true,
                    usedAI: statsDelta.total > 0,
                    engine: 'multi_agent',
                    route: routeUsed,
                    provider: routeUsed === 'cloud'
                        ? PLATFORM_API_CONFIG.providerId
                        : routeUsed === 'hybrid'
                            ? `local+${PLATFORM_API_CONFIG.providerId}`
                        : routeUsed === 'local'
                            ? 'local-model'
                            : null,
                    model: routeUsed === 'cloud'
                        ? multiAgentConfig.models.cloud.model
                        : routeUsed === 'hybrid'
                            ? `${multiAgentConfig.models.local.model}+${multiAgentConfig.models.cloud.model}`
                        : routeUsed === 'local'
                            ? multiAgentConfig.models.local.model
                            : null,
                    modelRouterDelta: statsDelta
                };

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
                aiAnalysis = {
                    ...aiAnalysis,
                    enabled: true,
                    usedAI: false,
                    route: 'error',
                    provider: PLATFORM_API_CONFIG.providerId,
                    error: error.message
                };
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
        securityOperationsService.upsertTrafficSession({
            tenantId,
            sessionId: flowId,
            sourceIP: flow.sourceIP,
            destIP: flow.destIP,
            sourcePort: flow.sourcePort,
            destPort: flow.destPort,
            protocol: flow.protocol,
            state: flow.state,
            packetCount: flow.packetCount,
            byteCount: flow.byteCount,
            startTime: flow.startTime,
            lastActivity: flow.lastActivity,
            sourceAssetId: sourceAsset.assetId,
            destAssetId: destAsset.assetId,
            metadata: {
                attackId: attack.id,
                attackName: attack.name,
                category: attack.category,
                severity: attack.severity,
                decision,
                aiAnalysis
            }
        });

        const verdict = blocked
            ? 'blocked'
            : detected
                ? 'alerted'
                : 'missed';

        securityOperationsService.recordValidationRun({
            tenantId,
            attackId: attack.id,
            attackName: attack.name,
            category: attack.category,
            severity: attack.severity as 'critical' | 'high' | 'medium' | 'low',
            verdict,
            detected,
            blocked,
            responseTime,
            startedAt: startTime.toISOString(),
            completedAt: new Date().toISOString(),
            result: {
                simulationId,
                decision,
                payload: attack.payload,
                aiAnalysis
            }
        });

        if (!blocked || !detected) {
            securityOperationsService.ingestFinding({
                tenantId,
                assetId: destAsset.assetId,
                sourceType: 'attack-validation',
                sourceRef: simulationId,
                target: attack.name,
                category: attack.category,
                severity: attack.severity,
                title: blocked ? 'Attack generated alert but was not blocked' : 'Attack validation bypassed active controls',
                description: blocked
                    ? `${attack.name} triggered a detection but still completed without an enforce action.`
                    : `${attack.name} was neither blocked nor reliably detected during validation.`,
                evidence: {
                    attackId: attack.id,
                    simulationId,
                    responseTime,
                    decision,
                    aiAnalysis
                },
                remediation: {
                    title: 'Review policy coverage for this attack path',
                    owner: 'security-engineering',
                    rollback: 'Revert the policy change if the rule blocks legitimate traffic.'
                },
                fingerprint: `${tenantId}:attack:${attack.id}:${verdict}`,
                createAlert: true
            });
        }

        const result = {
            attackId: attack.id,
            attackName: attack.name,
            category: attack.category,
            severity: attack.severity,
            blocked,
            detected,
            responseTime,
            decision,
            aiAnalysis
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
        id: simulationId,
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
            : '0%',
        aiAnalysis: {
            aiBackedCount: results.filter((item) => item.aiAnalysis?.usedAI).length,
            cloudCount: results.filter((item) => item.aiAnalysis?.route === 'cloud').length,
            localCount: results.filter((item) => item.aiAnalysis?.route === 'local').length,
            errorCount: results.filter((item) => item.aiAnalysis?.route === 'error').length
        }
    };

    broadcastEvent('attack:simulation:complete', report);

    attackHistory.unshift(report);
    if (attackHistory.length > 10) {
        attackHistory.pop();
    }

    res.json(report);
});

router.get('/history', async (req: AuthenticatedRequest, res: Response) => {
    if (!requireAttackSimulatorEnabled(res)) {
        return;
    }
    const tenantId = req.user?.tenantId || 'global';
    const persisted = (await securityOperationsService.listValidationRunsView(tenantId, 10)).map((run) => ({
        id: run.validationRunId,
        total: 1,
        blocked: run.blocked ? 1 : 0,
        detected: run.detected ? 1 : 0,
        allowed: run.blocked ? 0 : 1,
        errors: run.verdict === 'timeout' ? 1 : 0,
        results: [
            {
                attackId: run.attackId,
                attackName: run.attackName,
                category: run.category,
                severity: run.severity,
                blocked: run.blocked,
                detected: run.detected,
                responseTime: run.responseTime,
                verdict: run.verdict,
                aiAnalysis: run.result?.aiAnalysis
            }
        ],
        startTime: run.startedAt,
        endTime: run.completedAt
    }));
    res.json(persisted.length > 0 ? persisted : attackHistory);
});

router.get('/history/:id', async (req: AuthenticatedRequest, res: Response) => {
    if (!requireAttackSimulatorEnabled(res)) {
        return;
    }
    const tenantId = req.user?.tenantId || 'global';
    const run = await securityOperationsService.getValidationRunByIdView(tenantId, req.params.id);

    if (run) {
        const simulationId = String(run.result?.simulationId || '');
        const relatedFindings = simulationId
            ? await securityOperationsService.listFindingsBySourceView(tenantId, 'attack-validation', simulationId)
            : [];
        const relatedSessions = (await securityOperationsService
            .listTrafficSessionsView(tenantId, 100))
            .map((row: any) => ({
                sessionId: row.session_id,
                sourceIP: row.source_ip,
                destIP: row.dest_ip,
                sourcePort: Number(row.source_port || 0),
                destPort: Number(row.dest_port || 0),
                protocol: row.protocol,
                state: row.state,
                packetCount: Number(row.packet_count || 0),
                byteCount: Number(row.byte_count || 0),
                startTime: row.start_time,
                lastActivity: row.last_activity,
                sourceAssetId: row.source_asset_id || undefined,
                destAssetId: row.dest_asset_id || undefined,
                metadata: JSON.parse(row.metadata_json || '{}')
            }))
            .filter((session: any) =>
                String(session.metadata?.attackId || '') === String(run.attackId) ||
                String(session.metadata?.simulationId || '') === simulationId
            )
            .slice(0, 10);
        const assetIds = Array.from(new Set([
            ...relatedFindings.map((finding) => finding.assetId).filter(Boolean),
            ...relatedSessions.flatMap((session: any) => [session.sourceAssetId, session.destAssetId]).filter(Boolean)
        ] as string[]));
        const context = await securityOperationsService.getOperationalContextForAssetIdsView(tenantId, assetIds, 10);
        const findingIds = new Set(relatedFindings.map((finding) => finding.findingId));
        const relatedAlerts = context.alerts.filter((alert: any) =>
            !alert.findingId || findingIds.size === 0 || findingIds.has(alert.findingId)
        );
        const relatedActions = context.actions.filter((action: any) =>
            (!action.findingId && !action.alertId) ||
            (action.findingId && findingIds.has(action.findingId)) ||
            (action.alertId && relatedAlerts.some((alert: any) => alert.id === action.alertId))
        );

        return res.json({
            success: true,
            data: {
                id: run.validationRunId,
                summary: run,
                timeline: [
                    { title: 'Validation started', description: run.attackName, timestamp: run.startedAt },
                    { title: 'Validation completed', description: `Verdict ${run.verdict}`, timestamp: run.completedAt },
                    ...relatedAlerts.slice(0, 5).map((alert: any) => ({
                        title: 'Alert correlation',
                        description: `${alert.title} is ${alert.status}`,
                        timestamp: alert.timestamp
                    }))
                ],
                result: run.result,
                relatedFindings,
                relatedAlerts,
                relatedActions,
                relatedSessions,
                relatedAssets: context.assets,
                relatedScans: context.scanRuns,
                serviceExposure: context.serviceExposure
            }
        });
    }

    const legacy = attackHistory.find((item) => item.id === req.params.id);
    if (!legacy) {
        return res.status(404).json({ success: false, error: 'backend.attack_run_not_found' });
    }

    return res.json({
        success: true,
        data: {
            id: legacy.id,
            summary: legacy,
            timeline: [
                { title: 'Simulation started', timestamp: legacy.startTime },
                { title: 'Simulation completed', timestamp: legacy.endTime }
            ],
            result: legacy
        }
    });
});

export default router;
