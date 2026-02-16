/**
 * Multi-Agent Decision System - Unit Tests
 */

import {
    MultiAgentDecisionSystem,
    TrafficRequest,
    SecurityDecision,
    AgentOrchestrator,
    MessageBus,
    DebateProtocol,
    SocratesAgent,
    PlatoAgent,
    AristotleAgent,
    ProbeAgent,
    ToolExecutor,
    SynthesisEngine
} from '../index';

describe('Multi-Agent Decision System', () => {
    let system: MultiAgentDecisionSystem;

    beforeAll(async () => {
        system = new MultiAgentDecisionSystem();
        await system.initialize();
    });

    afterAll(async () => {
        await system.shutdown();
    });

    describe('System Initialization', () => {
        test('should initialize successfully', () => {
            expect(system.isInitialized()).toBe(true);
        });

        test('should have correct config', () => {
            const config = system.getConfig();
            expect(config.enabled).toBe(true);
            expect(config.layers.l1_collaboration.enabled).toBe(true);
            expect(config.thresholds.debateTrigger).toBeDefined();
        });

        test('should return health status', () => {
            const health = system.getHealthStatus();
            expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
        });
    });

    describe('Traffic Analysis', () => {
        test('should analyze normal request as safe', async () => {
            const request: TrafficRequest = {
                id: 'test-normal-001',
                timestamp: new Date(),
                sourceIP: '192.168.1.100',
                method: 'GET',
                path: '/api/users',
                headers: {},
                queryParams: { page: '1' }
            };

            const decision = await system.analyze(request);
            
            expect(decision).toBeDefined();
            expect(decision.requestId).toBe(request.id);
            expect(decision.verdict).toBeDefined();
            expect(decision.confidence).toBeGreaterThanOrEqual(0);
            expect(decision.confidence).toBeLessThanOrEqual(1);
        });

        test('should detect SQL injection', async () => {
            const request: TrafficRequest = {
                id: 'test-sqli-001',
                timestamp: new Date(),
                sourceIP: '10.0.0.1',
                method: 'POST',
                path: '/api/login',
                headers: { 'content-type': 'application/json' },
                body: "{\"username\": \"admin' OR '1'='1\"}"
            };

            const decision = await system.analyze(request);
            
            expect(decision.verdict).toBe('block');
            expect(decision.threatLevel).toMatch(/high|critical/);
            expect(decision.evidence.length).toBeGreaterThan(0);
        });

        test('should detect XSS attack', async () => {
            const request: TrafficRequest = {
                id: 'test-xss-001',
                timestamp: new Date(),
                sourceIP: '172.16.0.1',
                method: 'POST',
                path: '/api/comments',
                headers: {},
                body: '{"content": "<script>alert(1)</script>"}'
            };

            const decision = await system.analyze(request);
            
            expect(['block', 'monitor']).toContain(decision.verdict);
            expect(decision.evidence.length).toBeGreaterThan(0);
        });

        test('should detect path traversal', async () => {
            const request: TrafficRequest = {
                id: 'test-traversal-001',
                timestamp: new Date(),
                sourceIP: '192.168.100.1',
                method: 'GET',
                path: '/api/files?path=../../../etc/passwd',
                headers: {},
                queryParams: { path: '../../../etc/passwd' }
            };

            const decision = await system.analyze(request);
            
            expect(['block', 'monitor']).toContain(decision.verdict);
        });

        test('should include processing time', async () => {
            const request: TrafficRequest = {
                id: 'test-time-001',
                timestamp: new Date(),
                sourceIP: '192.168.1.1',
                method: 'GET',
                path: '/api/test',
                headers: {}
            };

            const decision = await system.analyze(request);
            
            expect(decision.processingTime).toBeGreaterThanOrEqual(0);
        });

        test('should include layers activated', async () => {
            const request: TrafficRequest = {
                id: 'test-layers-001',
                timestamp: new Date(),
                sourceIP: '192.168.1.1',
                method: 'GET',
                path: '/api/test',
                headers: {}
            };

            const decision = await system.analyze(request);
            
            expect(decision.layersActivated).toContain(1);
        });
    });

    describe('Probe Agent', () => {
        test('should generate probe report', () => {
            const report = system.getProbeReport();
            
            expect(report).toBeDefined();
            expect(report.timestamp).toBeDefined();
            expect(report.system).toBeDefined();
            expect(report.system.memory).toBeDefined();
            expect(report.system.cpu).toBeDefined();
        });

        test('should track system metrics', () => {
            const report = system.getProbeReport();
            
            expect(report.system.memory.total).toBeGreaterThan(0);
            expect(report.system.cpu.cores).toBeGreaterThan(0);
            expect(report.system.process.pid).toBe(process.pid);
        });
    });

    describe('System Stats', () => {
        test('should return comprehensive stats', () => {
            const stats = system.getStats();
            
            expect(stats.orchestrator).toBeDefined();
            expect(stats.messageBus).toBeDefined();
            expect(stats.synthesis).toBeDefined();
        });
    });
});

describe('MessageBus', () => {
    let messageBus: MessageBus;

    beforeEach(() => {
        messageBus = new MessageBus();
    });

    afterEach(() => {
        messageBus.shutdown();
    });

    test('should subscribe and receive messages', async () => {
        const received: any[] = [];
        
        messageBus.subscribe('socrates', async (msg) => {
            received.push(msg);
        });

        await messageBus.publish({
            id: 'test-msg-001',
            type: 'analysis_request',
            from: 'orchestrator',
            to: 'socrates',
            payload: { test: true },
            timestamp: new Date(),
            priority: 'medium'
        });

        await new Promise(resolve => setTimeout(resolve, 100));
        
        expect(received.length).toBeGreaterThan(0);
    });

    test('should return correct stats', () => {
        const stats = messageBus.getStats();
        
        expect(stats.queueSize).toBeDefined();
        expect(stats.subscriptionCount).toBeDefined();
        expect(stats.pendingRequests).toBeDefined();
    });
});

describe('ToolExecutor', () => {
    let toolExecutor: ToolExecutor;

    beforeEach(() => {
        toolExecutor = new ToolExecutor();
    });

    test('should list available tools', () => {
        const tools = toolExecutor.listTools();
        
        expect(tools.length).toBeGreaterThan(0);
        expect(tools.find(t => t.name === 'explain_sql')).toBeDefined();
        expect(tools.find(t => t.name === 'decode_payload')).toBeDefined();
    });

    test('should execute decode_payload tool', async () => {
        const result = await toolExecutor.execute({
            requestId: 'test-001',
            toolName: 'decode_payload',
            parameters: {
                payload: 'SGVsbG8gV29ybGQ=',
                encoding: 'base64'
            },
            timeout: 5000
        });

        expect(result.success).toBe(true);
        expect(result.output).toBeDefined();
    });

    test('should execute check_pattern tool', async () => {
        const result = await toolExecutor.execute({
            requestId: 'test-002',
            toolName: 'check_pattern',
            parameters: {
                content: "SELECT * FROM users WHERE id = '1' OR '1'='1'"
            },
            timeout: 5000
        });

        expect(result.success).toBe(true);
        expect(result.output.matchesFound).toBeGreaterThan(0);
    });

    test('should handle unknown tool', async () => {
        const result = await toolExecutor.execute({
            requestId: 'test-003',
            toolName: 'unknown_tool',
            parameters: {},
            timeout: 5000
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Unknown tool');
    });
});

describe('SynthesisEngine', () => {
    let synthesisEngine: SynthesisEngine;

    beforeEach(() => {
        synthesisEngine = new SynthesisEngine();
    });

    test('should generate case file', () => {
        const decision: SecurityDecision = {
            id: 'decision-001',
            requestId: 'req-001',
            timestamp: new Date(),
            verdict: 'block',
            confidence: 0.95,
            threatLevel: 'critical',
            reasoning: 'SQL injection detected',
            evidence: [],
            actions: [],
            caseFileId: '',
            processingTime: 100,
            layersActivated: [1, 2, 5]
        };

        const narrative = {
            id: 'narrative-001',
            traceId: 'trace-001',
            timeline: [],
            services: ['api'],
            attackChain: [],
            summary: 'Test narrative',
            riskLevel: 'high' as const
        };

        const debate = {
            id: 'debate-001',
            requestId: 'req-001',
            topic: 'Test debate',
            participants: [],
            rounds: [],
            status: 'resolved' as const,
            startTime: new Date()
        };

        const caseFile = synthesisEngine.generateCaseFile(decision, narrative, debate);
        
        expect(caseFile).toBeDefined();
        expect(caseFile.requestId).toBe('req-001');
        expect(caseFile.summary).toBeDefined();
    });

    test('should track evolution stats', () => {
        const stats = synthesisEngine.getEvolutionStats();
        
        expect(stats.totalCaseFiles).toBeDefined();
        expect(stats.totalLessons).toBeDefined();
        expect(stats.totalPolicyUpdates).toBeDefined();
    });
});

describe('DebateProtocol', () => {
    let debateProtocol: DebateProtocol;
    let messageBus: MessageBus;

    beforeEach(() => {
        messageBus = new MessageBus();
        debateProtocol = new DebateProtocol(messageBus);
    });

    afterEach(() => {
        messageBus.shutdown();
    });

    test('should create debate session', async () => {
        const results = [
            {
                agentId: 'socrates-001',
                role: 'socrates' as const,
                verdict: 'malicious' as const,
                confidence: 0.9,
                reasoning: 'SQL injection detected',
                evidence: []
            },
            {
                agentId: 'plato-001',
                role: 'plato' as const,
                verdict: 'safe' as const,
                confidence: 0.7,
                reasoning: 'Schema compliant',
                evidence: []
            }
        ];

        const request: TrafficRequest = {
            id: 'req-debate-001',
            timestamp: new Date(),
            sourceIP: '10.0.0.1',
            method: 'POST',
            path: '/api/test',
            headers: {}
        };

        const session = await debateProtocol.initiateDebate('req-debate-001', results, request);
        
        expect(session).toBeDefined();
        expect(session.requestId).toBe('req-debate-001');
        expect(session.participants.length).toBeGreaterThan(0);
    });
});
