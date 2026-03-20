/**
 * Multi-Agent Decision System - Demo Script
 * Demonstrates all 7 layers of the AI security analysis system
 */

import {
    MultiAgentDecisionSystem,
    TrafficRequest,
    ProbeReport,
    SecurityDecision
} from '../index';
import logger from '../../utils/logger';

const SAMPLE_REQUESTS: TrafficRequest[] = [
    {
        id: 'req-normal-001',
        timestamp: new Date(),
        sourceIP: '192.168.1.100',
        method: 'GET',
        path: '/api/users/profile',
        headers: {
            'content-type': 'application/json',
            'user-agent': 'Mozilla/5.0'
        },
        queryParams: { id: '12345' },
        userAgent: 'Mozilla/5.0'
    },
    {
        id: 'req-sql-injection-001',
        timestamp: new Date(),
        sourceIP: '10.0.0.50',
        method: 'POST',
        path: '/api/login',
        headers: {
            'content-type': 'application/x-www-form-urlencoded'
        },
        body: "username=admin' OR '1'='1' --&password=anything",
        userAgent: 'sqlmap/1.0'
    },
    {
        id: 'req-xss-001',
        timestamp: new Date(),
        sourceIP: '172.16.0.25',
        method: 'POST',
        path: '/api/comments',
        headers: {
            'content-type': 'application/json'
        },
        body: '{"comment": "<script>alert(document.cookie)</script>"}',
        userAgent: 'Mozilla/5.0'
    },
    {
        id: 'req-path-traversal-001',
        timestamp: new Date(),
        sourceIP: '192.168.100.200',
        method: 'GET',
        path: '/api/files?path=../../../etc/passwd',
        headers: {},
        queryParams: { path: '../../../etc/passwd' },
        userAgent: 'curl/7.0'
    },
    {
        id: 'req-rate-abuse-001',
        timestamp: new Date(),
        sourceIP: '203.0.113.50',
        method: 'POST',
        path: '/api/auth/login',
        headers: {},
        body: '{"username": "admin", "password": "test"}',
        userAgent: 'python-requests/2.0'
    }
];

class MultiAgentDemo {
    private system: MultiAgentDecisionSystem;
    private results: { request: TrafficRequest; decision: SecurityDecision }[] = [];

    constructor() {
        this.system = new MultiAgentDecisionSystem({
            enabled: true,
            thresholds: {
                debateTrigger: 0.3,
                debateDivergence: 0.3,
                debateConfidenceRange: 0.3,
                cloudEscalation: 0.6,
                autoBlock: 0.85
            }
        });
    }

    async run(): Promise<void> {
        console.log('\n');
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║     AetherGuard Multi-Agent Decision System - 7 Layer Demo      ║');
        console.log('╚════════════════════════════════════════════════════════════════╝');
        console.log('\n');

        await this.initialize();
        this.setupProbeMonitoring();
        await this.runAnalysis();
        this.displayResults();
        await this.showSystemStats();
        await this.shutdown();
    }

    private async initialize(): Promise<void> {
        console.log('📦 Initializing Multi-Agent Decision System...');
        console.log('   └─ L1: Multi-Agent Collaboration');
        console.log('   └─ L2: Role Playing (Socrates, Plato, Aristotle)');
        console.log('   └─ L3: Scene Traversal');
        console.log('   └─ L4: Capability Incarnation');
        console.log('   └─ L5: Debate Protocol');
        console.log('   └─ L6: Heterogeneous Model Collaboration');
        console.log('   └─ L7: Synthesis & Self-Evolution');
        console.log('');

        await this.system.initialize();
        console.log('✅ System initialized successfully\n');
    }

    private setupProbeMonitoring(): void {
        this.system.onProbeReport((report: ProbeReport) => {
            const memUsage = report.system.memory.usagePercent.toFixed(1);
            const cpuCores = report.system.cpu.cores;
            const alerts = report.alerts.length;
            
            process.stdout.write(
                `\r🔍 Probe: Memory ${memUsage}% | CPU ${cpuCores} cores | Alerts ${alerts}   `
            );
        });
    }

    private async runAnalysis(): Promise<void> {
        console.log('🔍 Running security analysis on sample requests...\n');

        for (const request of SAMPLE_REQUESTS) {
            console.log(`\n━━━ Request: ${request.id} ━━━`);
            console.log(`   Method: ${request.method}`);
            console.log(`   Path: ${request.path}`);
            console.log(`   Source IP: ${request.sourceIP}`);
            if (request.body) {
                console.log(`   Body: ${request.body.substring(0, 80)}${request.body.length > 80 ? '...' : ''}`);
            }

            try {
                const startTime = Date.now();
                const decision = await this.system.analyze(request);
                const processingTime = Date.now() - startTime;

                this.results.push({ request, decision });

                console.log(`\n   📊 Decision: ${this.formatVerdict(decision.verdict)}`);
                console.log(`   📈 Confidence: ${(decision.confidence * 100).toFixed(1)}%`);
                console.log(`   ⚠️  Threat Level: ${decision.threatLevel.toUpperCase()}`);
                console.log(`   ⏱️  Processing Time: ${processingTime}ms`);
                console.log(`   🔬 Layers Activated: L${decision.layersActivated.join(', L')}`);
                
                if (decision.evidence.length > 0) {
                    console.log(`   📋 Evidence:`);
                    for (const evidence of decision.evidence.slice(0, 3)) {
                        console.log(`      - [${evidence.severity.toUpperCase()}] ${evidence.description}`);
                    }
                }

                if (decision.actions.length > 0) {
                    console.log(`   🎯 Actions:`);
                    for (const action of decision.actions) {
                        console.log(`      - ${action.action.toUpperCase()}: ${action.target} (${action.reason})`);
                    }
                }

            } catch (error: any) {
                console.log(`   ❌ Error: ${error.message}`);
            }

            await this.delay(500);
        }
    }

    private displayResults(): void {
        console.log('\n\n');
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║                      Analysis Summary                          ║');
        console.log('╚════════════════════════════════════════════════════════════════╝');

        const allowed = this.results.filter(r => r.decision.verdict === 'allow').length;
        const blocked = this.results.filter(r => r.decision.verdict === 'block').length;
        const monitored = this.results.filter(r => r.decision.verdict === 'monitor').length;
        const challenged = this.results.filter(r => r.decision.verdict === 'challenge').length;

        console.log(`\n   Total Requests Analyzed: ${this.results.length}`);
        console.log(`   ✅ Allowed: ${allowed}`);
        console.log(`   🚫 Blocked: ${blocked}`);
        console.log(`   👁️  Monitored: ${monitored}`);
        console.log(`   ❓ Challenged: ${challenged}`);

        const avgConfidence = this.results.reduce((sum, r) => sum + r.decision.confidence, 0) / this.results.length;
        console.log(`   📊 Average Confidence: ${(avgConfidence * 100).toFixed(1)}%`);

        const avgProcessingTime = this.results.reduce((sum, r) => sum + r.decision.processingTime, 0) / this.results.length;
        console.log(`   ⏱️  Average Processing Time: ${avgProcessingTime.toFixed(0)}ms`);
    }

    private async showSystemStats(): Promise<void> {
        console.log('\n');
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║                      System Statistics                         ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        const stats = this.system.getStats();
        const health = this.system.getHealthStatus();
        const probeReport = this.system.getProbeReport();

        console.log('   🏥 Health Status:', health.status.toUpperCase());
        console.log('      - System:', health.details.system);
        console.log('      - Agents:', health.details.agents);
        console.log('      - Message Bus:', health.details.messageBus);

        console.log('\n   📊 Orchestrator:');
        console.log(`      - Active Tasks: ${stats.orchestrator.activeTasks}`);
        console.log(`      - Registered Agents: ${stats.orchestrator.registeredAgents}`);

        console.log('\n   📨 Message Bus:');
        console.log(`      - Queue Size: ${stats.messageBus.queueSize}`);
        console.log(`      - Subscriptions: ${stats.messageBus.subscriptionCount}`);

        console.log('\n   🧠 Synthesis Engine:');
        console.log(`      - Case Files: ${stats.synthesis.totalCaseFiles}`);
        console.log(`      - Lessons Learned: ${stats.synthesis.totalLessons}`);
        console.log(`      - Policy Updates: ${stats.synthesis.totalPolicyUpdates}`);

        if (stats.synthesis.topPatterns.length > 0) {
            console.log('\n   🔍 Top Detected Patterns:');
            for (const pattern of stats.synthesis.topPatterns.slice(0, 5)) {
                console.log(`      - ${pattern.pattern}: ${pattern.frequency} occurrences`);
            }
        }

        console.log('\n   💾 System Resources:');
        console.log(`      - Memory Usage: ${probeReport.system.memory.usagePercent.toFixed(1)}%`);
        console.log(`      - CPU Cores: ${probeReport.system.cpu.cores}`);
        console.log(`      - Process Uptime: ${(probeReport.system.process.uptime / 60).toFixed(1)} minutes`);
    }

    private async shutdown(): Promise<void> {
        console.log('\n\n🛑 Shutting down system...');
        await this.system.shutdown();
        console.log('✅ Shutdown complete. Goodbye!\n');
    }

    private formatVerdict(verdict: string): string {
        const icons: Record<string, string> = {
            'allow': '✅ ALLOW',
            'block': '🚫 BLOCK',
            'monitor': '👁️  MONITOR',
            'challenge': '❓ CHALLENGE'
        };
        return icons[verdict] || verdict.toUpperCase();
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

async function main(): Promise<void> {
    const demo = new MultiAgentDemo();
    await demo.run();
}

main().catch(console.error);

export { MultiAgentDemo };
