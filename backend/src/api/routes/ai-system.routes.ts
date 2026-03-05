import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
    MultiAgentDecisionSystem,
    createMultiAgentSystem,
    ProbeReport,
    TrafficRequest,
    MultiAgentConfig
} from '../../ai-agents';
import { PLATFORM_API_CONFIG } from '../../utils/model-access';
import logger from '../../utils/logger';
import { isAttackSimulatorEnabled, isDemoMode } from '../../config/app-mode';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

// ============================================
// Multi-Agent System Dashboard Endpoints
// ============================================

router.get('/agents/health', authenticate, (req: Request, res: Response) => {
    try {
        const system = getAgentSystem();
        if (!system || !system.isInitialized()) {
            return res.json({ status: 'unknown', details: { reason: 'System not initialized' } });
        }
        res.json(system.getHealthStatus());
    } catch (error: any) {
        logger.error('Failed to get agent system health:', { error: error.message });
        res.status(500).json({ status: 'error', details: { message: error.message } });
    }
});

router.get('/agents/stats', authenticate, (req: Request, res: Response) => {
    try {
        const system = getAgentSystem();
        if (!system || !system.isInitialized()) {
            return res.status(503).json({
                error: 'system_unavailable',
                message: 'Multi-Agent Decision System is initializing...'
            });
        }

        const rawStats = system.getStats();
        const probeReport = system.getProbeReport();
        const health = system.getHealthStatus();

        const stats = {
            orchestrator: rawStats.orchestrator,
            messageBus: rawStats.messageBus,
            synthesis: rawStats.synthesis,
            health: health,
            agents: probeReport.agents || []
        };

        res.json(stats);
    } catch (error: any) {
        logger.error('Failed to get agent system stats:', { error: error.message });
        res.status(500).json({ error: 'internal_error', message: error.message });
    }
});

let multiAgentSystem: MultiAgentDecisionSystem | null = null;
let agentGateway: any = null;

export const getAgentGateway = () => agentGateway;

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
                model: 'qwen3-max-2026-01-23',
                temperature: 0.2,
                maxTokens: 4000,
                baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                apiKey: PLATFORM_API_CONFIG.apiKey
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

export default router;
