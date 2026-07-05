/**
 * Tests for ProbeAgent - System Monitoring & Health Check
 */

import type { AgentConfig, AgentRole, TrafficContext } from '../../ai-agents/core/types';
import type { ProbeConfig, ProbeAlert } from '../../ai-agents/monitoring/probe-agent';

// --- Mocks must be set up BEFORE requiring ProbeAgent ---

let mockBaseShutdown: jest.Mock;
let mockBaseInitialize: jest.Mock;
let mockMessageBusSubscribe: jest.Mock;
let mockMessageBusGetStats: jest.Mock;
let mockMessageBusInstance: any;
let mockIsDemoMode: jest.Mock;
let mockLoggerInstance: any;

beforeAll(() => {
    mockBaseShutdown = jest.fn().mockResolvedValue(undefined);
    mockBaseInitialize = jest.fn().mockResolvedValue(undefined);
    mockMessageBusSubscribe = jest.fn().mockReturnValue(() => {});
    mockMessageBusGetStats = jest.fn().mockReturnValue({
        queueSize: 10,
        subscriptionCount: 2,
        pendingRequests: 0,
    });
    mockMessageBusInstance = {
        subscribe: mockMessageBusSubscribe,
        getStats: mockMessageBusGetStats,
        publish: jest.fn(),
    };
    mockIsDemoMode = jest.fn().mockReturnValue(false);
    mockLoggerInstance = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    };

    // Note: Use prototype methods (not class properties) so that ProbeAgent's
    // own analyze override is not shadowed by instance-level mocks.
    jest.doMock('../../ai-agents/core/base-agent', () => {
        class MockBaseAgent {
            protected config: any;
            protected identity: any;
            protected messageBus: any;
            protected isActive = false;
            constructor(config: any, messageBus?: any) {
                this.config = config;
                this.identity = config.identity;
                this.messageBus = messageBus;
            }
            async initialize(): Promise<void> { return mockBaseInitialize(); }
            async shutdown(): Promise<void> { return mockBaseShutdown(); }
            async sendMessage(_to: any, _type: any, _payload: any): Promise<void> {}
            async analyze(_context: any): Promise<any> { return {}; }
        }
        // Put spies on the prototype so child class overrides take precedence
        MockBaseAgent.prototype.initialize = mockBaseInitialize;
        MockBaseAgent.prototype.shutdown = mockBaseShutdown;
        MockBaseAgent.prototype.sendMessage = jest.fn().mockResolvedValue(undefined);
        return { __esModule: true, BaseAgent: MockBaseAgent };
    });

    jest.doMock('../../ai-agents/core/message-bus', () => ({
        __esModule: true,
        MessageBus: jest.fn().mockImplementation(() => mockMessageBusInstance),
    }));

    jest.doMock('../../ai-agents/core/scoring', () => ({
        distributionFromVerdict: jest.fn().mockReturnValue({ safe: 0.98, suspicious: 0.01, malicious: 0.01 }),
        normalizeDistribution: jest.fn((d: any) => d),
    }));

    jest.doMock('../../config/app-mode', () => ({
        isDemoMode: mockIsDemoMode,
    }));

    // getHealthStatus() reads real host metrics via os.totalmem()/os.freemem()/
    // os.loadavg(); under parallel Jest shards host memory can exceed the 90%
    // threshold and flip systemHealth to 'degraded', making the 'healthy'
    // assertions flaky. Pin the metrics to a deterministic healthy state.
    jest.doMock('os', () => {
        const actual = jest.requireActual('os');
        return {
            ...actual,
            totalmem: () => 16 * 1024 * 1024 * 1024,
            freemem: () => 8 * 1024 * 1024 * 1024,
            loadavg: () => [0.5, 0.5, 0.5],
        };
    });

    jest.doMock('../../utils/logger', () => ({
        __esModule: true,
        default: mockLoggerInstance,
    }));
});

// --- Helpers ---

function createAgentConfig(role: AgentRole = 'orchestrator'): AgentConfig {
    return {
        identity: {
            id: 'probe-agent-001',
            role,
            team: 'analyst',
            name: 'Probe Agent',
            description: 'System monitoring probe',
            capabilities: ['monitoring', 'health-check'],
        },
        modelConfig: {
            provider: 'ollama',
            model: 'test-model',
            temperature: 0,
            maxTokens: 1000,
        },
        timeout: 30000,
        maxRetries: 3,
    };
}

function createTrafficContext(overrides: Partial<TrafficContext> = {}): TrafficContext {
    return {
        request: {
            id: 'req-001',
            timestamp: new Date(),
            sourceIP: '127.0.0.1',
            method: 'GET',
            path: '/api/health',
            headers: {},
        },
        history: [],
        relatedRequests: [],
        ...overrides,
    };
}

// --- Test Suite ---

describe('ProbeAgent', () => {
    let ProbeAgent: any;
    let agent: any;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        // Reset message bus stats to default healthy state
        mockMessageBusGetStats.mockReturnValue({
            queueSize: 10,
            subscriptionCount: 2,
            pendingRequests: 0,
        });

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('../../ai-agents/monitoring/probe-agent');
        ProbeAgent = mod.ProbeAgent;

        agent = new ProbeAgent(createAgentConfig(), mockMessageBusInstance);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // =========================================================================
    // 1. Constructor & Config
    // =========================================================================
    describe('constructor', () => {
        it('should use DEFAULT_PROBE_CONFIG when no probeConfig is provided', () => {
            const a = new ProbeAgent(createAgentConfig(), mockMessageBusInstance);
            // Access internal config via generateReport which uses it
            expect(a).toBeDefined();
        });

        it('should merge custom probeConfig with defaults', () => {
            const customConfig: Partial<ProbeConfig> = {
                heartbeatInterval: 5000,
                alertThresholds: { cpuUsage: 90, memoryUsage: 95, agentResponseTime: 10000, queueSize: 500 },
            };
            const a = new ProbeAgent(createAgentConfig(), mockMessageBusInstance, customConfig);
            expect(a).toBeDefined();
        });

        it('should accept partial probeConfig overriding only specified fields', () => {
            const partialConfig: Partial<ProbeConfig> = {
                metricsInterval: 2000,
            };
            const a = new ProbeAgent(createAgentConfig(), mockMessageBusInstance, partialConfig);
            expect(a).toBeDefined();
        });

        it('should store identity from config', () => {
            expect(agent.identity.id).toBe('probe-agent-001');
            expect(agent.identity.role).toBe('orchestrator');
            expect(agent.identity.name).toBe('Probe Agent');
        });
    });

    // =========================================================================
    // 2. getHealthStatus
    // =========================================================================
    describe('getHealthStatus', () => {
        it('should return healthy when system and message bus are fine and no agents tracked', () => {
            const health = agent.getHealthStatus();
            // With no agents, agentHealth = 'unknown'. System and bus are healthy.
            // Overall: 'unknown' is not 'unhealthy' or 'degraded', so status = 'healthy'.
            expect(health.status).toBe('healthy');
            expect(health.details.system).toBe('healthy');
            expect(health.details.messageBus).toBe('healthy');
            expect(health.details.agents).toBe('unknown');
        });

        it('should return healthy when all agents are healthy', () => {
            agent.updateAgentHeartbeat({ agentId: 'socrates', role: 'socrates', status: 'healthy' });
            agent.updateAgentHeartbeat({ agentId: 'plato', role: 'plato', status: 'healthy' });

            const health = agent.getHealthStatus();
            expect(health.status).toBe('healthy');
            expect(health.details.agents).toBe('healthy');
        });

        it('should return degraded when some agents are degraded', () => {
            agent.updateAgentHeartbeat({ agentId: 'socrates', role: 'socrates', status: 'healthy' });
            agent.updateAgentHeartbeat({ agentId: 'plato', role: 'plato', status: 'degraded' });

            const health = agent.getHealthStatus();
            expect(health.status).toBe('degraded');
            expect(health.details.agents).toBe('degraded');
        });

        it('should return degraded when some agents are unhealthy but at least one is healthy', () => {
            agent.updateAgentHeartbeat({ agentId: 'socrates', role: 'socrates', status: 'healthy' });
            agent.updateAgentHeartbeat({ agentId: 'plato', role: 'plato', status: 'unhealthy' });

            const health = agent.getHealthStatus();
            // some(healthy) is true => 'degraded' (not 'unhealthy')
            expect(health.status).toBe('degraded');
            expect(health.details.agents).toBe('degraded');
        });

        it('should return unhealthy when all agents are unhealthy', () => {
            agent.updateAgentHeartbeat({ agentId: 'socrates', role: 'socrates', status: 'unhealthy' });
            agent.updateAgentHeartbeat({ agentId: 'plato', role: 'plato', status: 'unhealthy' });

            const health = agent.getHealthStatus();
            expect(health.status).toBe('unhealthy');
        });

        it('should return degraded when message bus queue size exceeds threshold but not double', () => {
            // Set queue size above threshold (1000) but below double (2000)
            mockMessageBusGetStats.mockReturnValue({
                queueSize: 1500,
                subscriptionCount: 2,
                pendingRequests: 0,
            });

            const health = agent.getHealthStatus();
            expect(health.details.messageBus).toBe('degraded');
        });

        it('should return unhealthy when message bus queue size exceeds double threshold', () => {
            mockMessageBusGetStats.mockReturnValue({
                queueSize: 2500,
                subscriptionCount: 2,
                pendingRequests: 0,
            });

            const health = agent.getHealthStatus();
            expect(health.details.messageBus).toBe('unhealthy');
            expect(health.status).toBe('unhealthy');
        });
    });

    // =========================================================================
    // 3. updateAgentHeartbeat
    // =========================================================================
    describe('updateAgentHeartbeat', () => {
        it('should add a new agent with default values', () => {
            agent.updateAgentHeartbeat({ agentId: 'socrates', role: 'socrates' });

            const states = agent.getAgentStates();
            expect(states).toHaveLength(1);
            expect(states[0].agentId).toBe('socrates');
            expect(states[0].role).toBe('socrates');
            expect(states[0].status).toBe('unknown');
            expect(states[0].responseTime).toBe(0);
            expect(states[0].tasksCompleted).toBe(0);
        });

        it('should set lastSeen to a Date object when none provided', () => {
            agent.updateAgentHeartbeat({ agentId: 'plato', role: 'plato' });

            const states = agent.getAgentStates();
            expect(states[0].lastSeen).toBeInstanceOf(Date);
        });

        it('should update an existing agent, preserving previous values', () => {
            agent.updateAgentHeartbeat({
                agentId: 'socrates',
                role: 'socrates',
                status: 'healthy',
                responseTime: 100,
                tasksCompleted: 5,
            });
            // Now update with only partial data
            agent.updateAgentHeartbeat({
                agentId: 'socrates',
                status: 'degraded',
                responseTime: 200,
            });

            const states = agent.getAgentStates();
            expect(states).toHaveLength(1);
            expect(states[0].status).toBe('degraded');
            expect(states[0].responseTime).toBe(200);
            // tasksCompleted should be preserved from first update
            expect(states[0].tasksCompleted).toBe(5);
            // role should be preserved
            expect(states[0].role).toBe('socrates');
        });

        it('should not overwrite numeric zero values with existing values (tasksPending)', () => {
            agent.updateAgentHeartbeat({
                agentId: 'socrates',
                role: 'socrates',
                tasksPending: 3,
            });
            // Passing 0 explicitly should update to 0 (uses ?? not ||)
            agent.updateAgentHeartbeat({
                agentId: 'socrates',
                tasksPending: 0,
            });

            const states = agent.getAgentStates();
            expect(states[0].tasksPending).toBe(0);
        });

        it('should generate an alert when response time exceeds threshold', () => {
            agent.updateAgentHeartbeat({
                agentId: 'socrates',
                role: 'socrates',
                responseTime: 6000, // default threshold is 5000ms
            });

            const alerts = agent.getAlerts();
            expect(alerts.length).toBeGreaterThanOrEqual(1);
            const responseAlert = alerts.find(
                (a: ProbeAlert) => a.message.includes('Agent response time high')
            );
            expect(responseAlert).toBeDefined();
            expect(responseAlert.severity).toBe('warning');
            expect(responseAlert.source).toBe('socrates');
        });

        it('should not generate alert when response time is below threshold', () => {
            agent.updateAgentHeartbeat({
                agentId: 'socrates',
                role: 'socrates',
                responseTime: 100,
            });

            const alerts = agent.getAlerts();
            const responseAlert = alerts.find(
                (a: ProbeAlert) => a.message.includes('Agent response time high')
            );
            expect(responseAlert).toBeUndefined();
        });
    });

    // =========================================================================
    // 4. generateReport
    // =========================================================================
    describe('generateReport', () => {
        it('should return a report with required fields', () => {
            const report = agent.generateReport();

            expect(report).toHaveProperty('id');
            expect(report).toHaveProperty('timestamp');
            expect(report).toHaveProperty('system');
            expect(report).toHaveProperty('agents');
            expect(report).toHaveProperty('messageBus');
            expect(report).toHaveProperty('alerts');
            expect(report).toHaveProperty('uptime');
        });

        it('should include message bus stats from getStats()', () => {
            const report = agent.generateReport();

            expect(report.messageBus.queueSize).toBe(10);
            expect(report.messageBus.subscriptionCount).toBe(2);
            expect(report.messageBus.pendingRequests).toBe(0);
        });

        it('should include agent states in the report', () => {
            agent.updateAgentHeartbeat({ agentId: 'socrates', role: 'socrates', status: 'healthy' });
            agent.updateAgentHeartbeat({ agentId: 'plato', role: 'plato', status: 'degraded' });

            const report = agent.generateReport();
            expect(report.agents).toHaveLength(2);
        });

        it('should include system metrics with correct structure', () => {
            const report = agent.generateReport();

            expect(report.system).toHaveProperty('cpu');
            expect(report.system).toHaveProperty('memory');
            expect(report.system).toHaveProperty('network');
            expect(report.system).toHaveProperty('process');
            expect(report.system.cpu).toHaveProperty('usage');
            expect(report.system.cpu).toHaveProperty('loadAverage');
            expect(report.system.cpu).toHaveProperty('cores');
            expect(report.system.memory).toHaveProperty('total');
            expect(report.system.memory).toHaveProperty('used');
            expect(report.system.memory).toHaveProperty('free');
            expect(report.system.memory).toHaveProperty('usagePercent');
        });

        it('should include current alerts (last 10)', () => {
            // Generate enough alerts to exceed 10
            for (let i = 0; i < 15; i++) {
                agent.updateAgentHeartbeat({
                    agentId: `agent-${i}`,
                    role: 'socrates',
                    responseTime: 6000,
                });
            }

            const report = agent.generateReport();
            // report.alerts should be the last 10 alerts
            expect(report.alerts.length).toBeLessThanOrEqual(10);
        });

        it('should use provided metrics when passed as argument', () => {
            const customMetrics: any = {
                timestamp: new Date('2025-01-01T00:00:00Z'),
                cpu: { usage: 50, loadAverage: [1, 1, 1], cores: 4 },
                memory: { total: 1000, used: 500, free: 500, usagePercent: 50 },
                network: { connections: 0, bytesReceived: 0, bytesSent: 0 },
                process: { pid: 1, uptime: 100 },
            };

            const report = agent.generateReport(customMetrics);
            expect(report.system.timestamp).toEqual(new Date('2025-01-01T00:00:00Z'));
            expect(report.system.memory.usagePercent).toBe(50);
        });

        it('should report uptime as positive number', () => {
            // Advance fake timers so Date.now() moves forward from startTime
            jest.advanceTimersByTime(1000);
            const report = agent.generateReport();
            expect(report.uptime).toBeGreaterThan(0);
        });

        it('should generate unique report IDs', () => {
            const report1 = agent.generateReport();
            const report2 = agent.generateReport();
            expect(report1.id).not.toBe(report2.id);
        });
    });

    // =========================================================================
    // 5. getAlerts / clearAlerts
    // =========================================================================
    describe('getAlerts and clearAlerts', () => {
        it('should return empty array when no alerts exist', () => {
            const alerts = agent.getAlerts();
            expect(alerts).toEqual([]);
        });

        it('should return a copy of alerts (not the internal array)', () => {
            agent.updateAgentHeartbeat({
                agentId: 'socrates',
                role: 'socrates',
                responseTime: 6000,
            });
            const alerts1 = agent.getAlerts();
            const alerts2 = agent.getAlerts();
            expect(alerts1).not.toBe(alerts2);
            expect(alerts1).toEqual(alerts2);
        });

        it('should clear all alerts', () => {
            agent.updateAgentHeartbeat({
                agentId: 'socrates',
                role: 'socrates',
                responseTime: 6000,
            });
            expect(agent.getAlerts().length).toBeGreaterThan(0);

            agent.clearAlerts();
            expect(agent.getAlerts()).toEqual([]);
        });

        it('should cap alerts at 100', () => {
            // Add 105 slow-response agents to generate 105 alerts
            for (let i = 0; i < 105; i++) {
                agent.updateAgentHeartbeat({
                    agentId: `slow-agent-${i}`,
                    role: 'socrates',
                    responseTime: 6000,
                });
            }

            const alerts = agent.getAlerts();
            expect(alerts.length).toBeLessThanOrEqual(100);
        });

        it('should generate alerts with required fields', () => {
            agent.updateAgentHeartbeat({
                agentId: 'socrates',
                role: 'socrates',
                responseTime: 6000,
            });

            const alerts = agent.getAlerts();
            const alert = alerts[0];
            expect(alert).toHaveProperty('id');
            expect(alert).toHaveProperty('severity');
            expect(alert).toHaveProperty('source');
            expect(alert).toHaveProperty('message');
            expect(alert).toHaveProperty('timestamp');
            expect(alert.id).toBeTruthy();
            expect(alert.timestamp).toBeInstanceOf(Date);
        });
    });

    // =========================================================================
    // 6. recordAgentMetric
    // =========================================================================
    describe('recordAgentMetric', () => {
        it('should update existing agent with new metric values', () => {
            agent.updateAgentHeartbeat({
                agentId: 'socrates',
                role: 'socrates',
                status: 'healthy',
            });

            agent.recordAgentMetric('socrates', {
                tasksCompleted: 10,
                memoryUsage: 75,
                cpuUsage: 30,
            });

            const states = agent.getAgentStates();
            expect(states[0].tasksCompleted).toBe(10);
            expect(states[0].memoryUsage).toBe(75);
            expect(states[0].cpuUsage).toBe(30);
        });

        it('should not create a new agent if agentId does not exist', () => {
            agent.recordAgentMetric('nonexistent-agent', {
                tasksCompleted: 10,
            });

            const states = agent.getAgentStates();
            expect(states).toHaveLength(0);
        });

        it('should preserve existing fields when updating only specific metrics', () => {
            agent.updateAgentHeartbeat({
                agentId: 'socrates',
                role: 'socrates',
                status: 'healthy',
                tasksCompleted: 5,
                tasksPending: 3,
            });

            agent.recordAgentMetric('socrates', {
                tasksCompleted: 8,
            });

            const states = agent.getAgentStates();
            expect(states[0].tasksCompleted).toBe(8);
            // tasksPending should be preserved
            expect(states[0].tasksPending).toBe(3);
            expect(states[0].status).toBe('healthy');
        });
    });

    // =========================================================================
    // 7. analyze
    // =========================================================================
    describe('analyze', () => {
        it('should return a safe verdict', async () => {
            const result = await agent.analyze(createTrafficContext());
            expect(result.verdict).toBe('safe');
        });

        it('should return confidence of 1.0', async () => {
            const result = await agent.analyze(createTrafficContext());
            expect(result.confidence).toBe(1.0);
        });

        it('should include class scores from distributionFromVerdict', async () => {
            const result = await agent.analyze(createTrafficContext());
            expect(result.classScores).toEqual({ safe: 0.98, suspicious: 0.01, malicious: 0.01 });
        });

        it('should include evidence with system metrics', async () => {
            const result = await agent.analyze(createTrafficContext());
            expect(result.evidence).toBeDefined();
            expect(result.evidence.length).toBeGreaterThanOrEqual(1);
            const evidence = result.evidence[0];
            expect(evidence.type).toBe('behavior');
            expect(evidence.source).toBe('ProbeAgent');
            expect(evidence.data).toHaveProperty('cpuUsage');
            expect(evidence.data).toHaveProperty('memoryUsage');
            expect(evidence.data).toHaveProperty('agentCount');
        });

        it('should include reasoning mentioning agent count and alerts', async () => {
            agent.updateAgentHeartbeat({ agentId: 'socrates', role: 'socrates' });
            agent.updateAgentHeartbeat({ agentId: 'plato', role: 'plato' });

            const result = await agent.analyze(createTrafficContext());
            expect(result.reasoning).toContain('2 agents monitored');
        });

        it('should use the agent identity id in the result', async () => {
            const result = await agent.analyze(createTrafficContext());
            expect(result.agentId).toBe('probe-agent-001');
            expect(result.role).toBe('orchestrator');
        });
    });

    // =========================================================================
    // 8. shutdown
    // =========================================================================
    describe('shutdown', () => {
        it('should call super.shutdown()', async () => {
            await agent.initialize();
            await agent.shutdown();
            expect(mockBaseShutdown).toHaveBeenCalled();
        });

        it('should not throw when shutdown is called without initialize', async () => {
            // shutdown should work even if initialize was never called
            await expect(agent.shutdown()).resolves.not.toThrow();
        });

        it('should clear heartbeat timers on shutdown', async () => {
            await agent.initialize();
            await agent.shutdown();

            // After shutdown, timers should be cleared. Advance time and verify no errors.
            jest.advanceTimersByTime(60000);
            // No error means timers were cleared
        });

        it('should clear metrics collection interval on shutdown', async () => {
            await agent.initialize();
            await agent.shutdown();

            // Advance past metrics collection interval
            jest.advanceTimersByTime(20000);
            // No side effects means interval was cleared
        });
    });

    // =========================================================================
    // 9. initialize
    // =========================================================================
    describe('initialize', () => {
        it('should call super.initialize()', async () => {
            await agent.initialize();
            expect(mockBaseInitialize).toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 10. getMetricsHistory & getAgentStates
    // =========================================================================
    describe('getMetricsHistory and getAgentStates', () => {
        it('should return empty metrics history initially', () => {
            const history = agent.getMetricsHistory();
            expect(history).toEqual([]);
        });

        it('should return empty agent states initially', () => {
            const states = agent.getAgentStates();
            expect(states).toEqual([]);
        });

        it('should return copies of agent states (not the internal map)', () => {
            agent.updateAgentHeartbeat({ agentId: 'socrates', role: 'socrates' });
            const states1 = agent.getAgentStates();
            const states2 = agent.getAgentStates();
            expect(states1).not.toBe(states2);
            expect(states1).toEqual(states2);
        });
    });

    // =========================================================================
    // 11. onReport
    // =========================================================================
    describe('onReport', () => {
        it('should invoke callback when report is generated during metrics collection', async () => {
            const reportCallback = jest.fn();
            agent.onReport(reportCallback);
            await agent.initialize();

            // Trigger metrics collection interval (default metricsInterval is 10000ms)
            jest.advanceTimersByTime(10000);

            expect(reportCallback).toHaveBeenCalled();
            const report = reportCallback.mock.calls[0][0];
            expect(report).toHaveProperty('id');
            expect(report).toHaveProperty('system');
            expect(report).toHaveProperty('agents');
            expect(report).toHaveProperty('alerts');
        });
    });

    // =========================================================================
    // 12. getSystemPrompt
    // =========================================================================
    describe('getSystemPrompt', () => {
        it('should return a non-empty system prompt', () => {
            const prompt = agent.getSystemPrompt();
            expect(typeof prompt).toBe('string');
            expect(prompt.length).toBeGreaterThan(0);
        });

        it('should mention monitoring responsibilities', () => {
            const prompt = agent.getSystemPrompt();
            expect(prompt).toContain('Probe Agent');
            expect(prompt).toContain('monitoring');
        });
    });
});
