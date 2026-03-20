/**
 * 论文实验评估脚本
 * 生成学术论文所需的实验数据
 *
 * 运行方式: npx ts-node scripts/run-paper-evaluation.ts
 */

import { AttackDetector } from '../src/agent/attack-detector';
import { MultiAgentDecisionSystem, SecurityDecision } from '../src/ai-agents/index';
import { TrafficRequest } from '../src/ai-agents/core/types';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// 测试数据集
// ============================================================================

interface TestCase {
    id: string;
    category: 'benign' | 'malicious';
    attackType?: string;
    description: string;
    request: TrafficRequest;
    expectedVerdict: 'safe' | 'malicious';
}

// 正常流量样本
const benignTestCases: TestCase[] = [
    {
        id: 'benign-001',
        category: 'benign',
        description: '正常登录请求',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '192.168.1.100',
            method: 'POST',
            path: '/api/auth/login',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'password123' })
        },
        expectedVerdict: 'safe'
    },
    {
        id: 'benign-002',
        category: 'benign',
        description: '正常API查询',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '192.168.1.101',
            method: 'GET',
            path: '/api/users?page=1&limit=10',
            headers: { 'Authorization': 'Bearer valid_token' }
        },
        expectedVerdict: 'safe'
    },
    {
        id: 'benign-003',
        category: 'benign',
        description: '正常表单提交',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '192.168.1.102',
            method: 'POST',
            path: '/api/comments',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'content=这是一条正常评论&author=张三'
        },
        expectedVerdict: 'safe'
    },
    {
        id: 'benign-004',
        category: 'benign',
        description: '静态资源请求',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '192.168.1.103',
            method: 'GET',
            path: '/static/css/style.css',
            headers: {}
        },
        expectedVerdict: 'safe'
    },
    {
        id: 'benign-005',
        category: 'benign',
        description: '健康检查请求',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.1',
            method: 'GET',
            path: '/health',
            headers: {}
        },
        expectedVerdict: 'safe'
    },
    {
        id: 'benign-006',
        category: 'benign',
        description: '正常搜索请求',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '192.168.1.104',
            method: 'GET',
            path: '/api/search?q=产品介绍&category=electronics',
            headers: {}
        },
        expectedVerdict: 'safe'
    },
    {
        id: 'benign-007',
        category: 'benign',
        description: '正常文件下载',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '192.168.1.105',
            method: 'GET',
            path: '/api/files/download?file=report.pdf',
            headers: {}
        },
        expectedVerdict: 'safe'
    },
    {
        id: 'benign-008',
        category: 'benign',
        description: '正常分页请求',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '192.168.1.106',
            method: 'GET',
            path: '/api/orders?page=2&sort=date_desc',
            headers: { 'Authorization': 'Bearer valid_token' }
        },
        expectedVerdict: 'safe'
    },
    {
        id: 'benign-009',
        category: 'benign',
        description: '正常用户资料更新',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '192.168.1.107',
            method: 'PUT',
            path: '/api/users/profile',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: '李四', email: 'lisi@example.com' })
        },
        expectedVerdict: 'safe'
    },
    {
        id: 'benign-010',
        category: 'benign',
        description: '正常登出请求',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '192.168.1.108',
            method: 'POST',
            path: '/api/auth/logout',
            headers: { 'Authorization': 'Bearer valid_token' }
        },
        expectedVerdict: 'safe'
    }
];

// 恶意流量样本
const maliciousTestCases: TestCase[] = [
    {
        id: 'malicious-001',
        category: 'malicious',
        attackType: 'sql_injection',
        description: 'UNION SELECT SQL注入',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.100',
            method: 'GET',
            path: "/api/users?id=1 UNION SELECT username,password FROM users--",
            headers: {}
        },
        expectedVerdict: 'malicious'
    },
    {
        id: 'malicious-002',
        category: 'malicious',
        attackType: 'sql_injection',
        description: 'OR 1=1 SQL注入',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.101',
            method: 'POST',
            path: '/api/auth/login',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: "admin' OR '1'='1", password: 'anything' })
        },
        expectedVerdict: 'malicious'
    },
    {
        id: 'malicious-003',
        category: 'malicious',
        attackType: 'sql_injection',
        description: '堆叠查询SQL注入',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.102',
            method: 'GET',
            path: '/api/users?id=1; DROP TABLE users;--',
            headers: {}
        },
        expectedVerdict: 'malicious'
    },
    {
        id: 'malicious-004',
        category: 'malicious',
        attackType: 'xss',
        description: 'Script标签XSS',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.103',
            method: 'POST',
            path: '/api/comments',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'content=<script>alert(document.cookie)</script>'
        },
        expectedVerdict: 'malicious'
    },
    {
        id: 'malicious-005',
        category: 'malicious',
        attackType: 'xss',
        description: '事件处理器XSS',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.104',
            method: 'POST',
            path: '/api/profile',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'bio=<img src=x onerror=alert(1)>'
        },
        expectedVerdict: 'malicious'
    },
    {
        id: 'malicious-006',
        category: 'malicious',
        attackType: 'xss',
        description: 'SVG XSS',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.105',
            method: 'POST',
            path: '/api/upload',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: 'test.svg', content: '<svg onload=alert(1)>' })
        },
        expectedVerdict: 'malicious'
    },
    {
        id: 'malicious-007',
        category: 'malicious',
        attackType: 'path_traversal',
        description: '../../../etc/passwd路径遍历',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.106',
            method: 'GET',
            path: '/api/files?path=../../../etc/passwd',
            headers: {}
        },
        expectedVerdict: 'malicious'
    },
    {
        id: 'malicious-008',
        category: 'malicious',
        attackType: 'path_traversal',
        description: 'URL编码路径遍历',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.107',
            method: 'GET',
            path: '/api/files?path=%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
            headers: {}
        },
        expectedVerdict: 'malicious'
    },
    {
        id: 'malicious-009',
        category: 'malicious',
        attackType: 'command_injection',
        description: '管道命令注入',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.108',
            method: 'GET',
            path: '/api/ping?host=127.0.0.1|cat /etc/passwd',
            headers: {}
        },
        expectedVerdict: 'malicious'
    },
    {
        id: 'malicious-010',
        category: 'malicious',
        attackType: 'command_injection',
        description: '分号命令注入',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.109',
            method: 'POST',
            path: '/api/exec',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cmd: 'ls -la; rm -rf /' })
        },
        expectedVerdict: 'malicious'
    },
    {
        id: 'malicious-011',
        category: 'malicious',
        attackType: 'command_injection',
        description: '反引号命令注入',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.110',
            method: 'GET',
            path: '/api/status?name=test`whoami`',
            headers: {}
        },
        expectedVerdict: 'malicious'
    },
    {
        id: 'malicious-012',
        category: 'malicious',
        attackType: 'sql_injection',
        description: '时间盲注',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.111',
            method: 'GET',
            path: "/api/users?id=1' AND SLEEP(5)--",
            headers: {}
        },
        expectedVerdict: 'malicious'
    },
    {
        id: 'malicious-013',
        category: 'malicious',
        attackType: 'xss',
        description: 'JavaScript协议XSS',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.112',
            method: 'GET',
            path: '/api/redirect?url=javascript:alert(1)',
            headers: {}
        },
        expectedVerdict: 'malicious'
    },
    {
        id: 'malicious-014',
        category: 'malicious',
        attackType: 'path_traversal',
        description: 'Windows路径遍历',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.113',
            method: 'GET',
            path: '/api/files?path=..\\..\\..\\windows\\system32\\config\\sam',
            headers: {}
        },
        expectedVerdict: 'malicious'
    },
    {
        id: 'malicious-015',
        category: 'malicious',
        attackType: 'sql_injection',
        description: '布尔盲注',
        request: {
            id: uuidv4(),
            timestamp: new Date(),
            sourceIP: '10.0.0.114',
            method: 'GET',
            path: "/api/products?id=1' AND 1=1--",
            headers: {}
        },
        expectedVerdict: 'malicious'
    }
];

const allTestCases = [...benignTestCases, ...maliciousTestCases];

// ============================================================================
// 实验运行器
// ============================================================================

interface ExperimentResult {
    testCaseId: string;
    category: string;
    attackType?: string;
    description: string;
    expected: string;
    heuristicVerdict: string;
    heuristicCorrect: boolean;
    heuristicLatencyMs: number;
    multiAgentVerdict?: string;
    multiAgentCorrect?: boolean;
    multiAgentLatencyMs?: number;
    debateTriggered?: boolean;
    debateRounds?: number;
}

interface ExperimentSummary {
    totalCases: number;
    benignCases: number;
    maliciousCases: number;

    // 启发式检测器结果
    heuristicAccuracy: number;
    heuristicPrecision: number;
    heuristicRecall: number;
    heuristicF1: number;
    heuristicFalsePositiveRate: number;
    heuristicFalseNegativeRate: number;
    heuristicAvgLatencyMs: number;

    // 多智能体系统结果（如果启用）
    multiAgentEnabled: boolean;
    multiAgentAccuracy?: number;
    multiAgentPrecision?: number;
    multiAgentRecall?: number;
    multiAgentF1?: number;
    multiAgentFalsePositiveRate?: number;
    multiAgentFalseNegativeRate?: number;
    multiAgentAvgLatencyMs?: number;
    debateTriggerRate?: number;
    avgDebateRounds?: number;

    // 对比
    accuracyImprovement?: number;
    f1Improvement?: number;
    latencyIncrease?: number;
}

class PaperEvaluationRunner {
    private attackDetector: AttackDetector;
    private multiAgentSystem: MultiAgentDecisionSystem | null = null;

    constructor() {
        this.attackDetector = new AttackDetector();
    }

    async initialize(enableMultiAgent: boolean = false): Promise<void> {
        if (enableMultiAgent) {
            try {
                this.multiAgentSystem = new MultiAgentDecisionSystem({
                    enabled: true,
                    heuristicOnly: false,
                    layers: {
                        l1_collaboration: { enabled: true, priority: 1, timeout: 5000, maxConcurrency: 3 },
                        l2_rolePlaying: { enabled: true, priority: 2, timeout: 10000, maxConcurrency: 3 },
                        l3_sceneTraversal: { enabled: true, priority: 3, timeout: 5000, maxConcurrency: 2 },
                        l4_capability: { enabled: true, priority: 4, timeout: 10000, maxConcurrency: 2 },
                        l5_debate: { enabled: true, priority: 5, timeout: 30000, maxConcurrency: 1 },
                        l6_heterogeneous: { enabled: true, priority: 6, timeout: 15000, maxConcurrency: 2 },
                        l7_synthesis: { enabled: true, priority: 7, timeout: 5000, maxConcurrency: 1 }
                    },
                    models: {
                        local: { provider: 'ollama', model: 'llama3:8b', temperature: 0.2, maxTokens: 2000 },
                        cloud: { provider: 'zhipu', model: 'glm-4', temperature: 0.2, maxTokens: 2000 }
                    },
                    thresholds: {
                        debateTrigger: 0.3,
                        debateDivergence: 0.15,
                        debateConfidenceRange: 0.4,
                        cloudEscalation: 0.6,
                        autoBlock: 0.85
                    },
                    timeouts: {
                        analysis: 10000,
                        debate: 30000,
                        toolExecution: 5000,
                        modelResponse: 15000
                    }
                });
                console.log('多智能体系统初始化成功');
            } catch (error: any) {
                console.warn('多智能体系统初始化失败，将仅运行启发式检测:', error.message);
                this.multiAgentSystem = null;
            }
        }
    }

    async runExperiment(enableMultiAgent: boolean = false): Promise<{ results: ExperimentResult[], summary: ExperimentSummary }> {
        const results: ExperimentResult[] = [];

        console.log('\n========================================');
        console.log('开始论文实验评估');
        console.log('========================================');
        console.log(`测试样本总数: ${allTestCases.length}`);
        console.log(`正常流量: ${benignTestCases.length}`);
        console.log(`恶意流量: ${maliciousTestCases.length}`);
        console.log(`多智能体模式: ${enableMultiAgent ? '启用' : '禁用'}`);
        console.log('========================================\n');

        for (const testCase of allTestCases) {
            console.log(`运行测试: ${testCase.id} - ${testCase.description}`);

            // 启发式检测器
            const heuristicStart = Date.now();
            const trafficEvent = {
                timestamp: testCase.request.timestamp,
                sourceIP: testCase.request.sourceIP,
                destPort: 80,
                method: testCase.request.method,
                path: testCase.request.path,
                requestBody: testCase.request.body
            };
            const heuristicResult = this.attackDetector.analyze(trafficEvent);
            const heuristicLatency = Date.now() - heuristicStart;

            const heuristicVerdict = heuristicResult ? 'malicious' : 'safe';
            const heuristicCorrect = heuristicVerdict === testCase.expectedVerdict;

            let multiAgentVerdict: string | undefined;
            let multiAgentCorrect: boolean | undefined;
            let multiAgentLatency: number | undefined;
            let debateTriggered: boolean | undefined;
            let debateRounds: number | undefined;

            // 多智能体系统（如果启用且可用）
            if (enableMultiAgent && this.multiAgentSystem) {
                try {
                    const maStart = Date.now();
                    const maResult = await this.multiAgentSystem.analyze(testCase.request);
                    multiAgentLatency = Date.now() - maStart;

                    multiAgentVerdict = maResult.verdict === 'block' ? 'malicious' :
                                       maResult.verdict === 'allow' ? 'safe' : 'suspicious';

                    // 将suspicious视为正确如果预期是malicious
                    if (testCase.expectedVerdict === 'malicious') {
                        multiAgentCorrect = multiAgentVerdict === 'malicious' || multiAgentVerdict === 'suspicious';
                    } else {
                        multiAgentCorrect = multiAgentVerdict === 'safe';
                    }

                    debateTriggered = maResult.debateSession !== undefined;
                    debateRounds = maResult.debateSession?.rounds.length;

                    console.log(`  启发式: ${heuristicVerdict} (${heuristicCorrect ? '✓' : '✗'}) | 多智能体: ${multiAgentVerdict} (${multiAgentCorrect ? '✓' : '✗'}) | 辩论: ${debateTriggered ? '是' : '否'}`);
                } catch (error: any) {
                    console.warn(`  多智能体分析失败: ${error.message}`);
                    multiAgentVerdict = 'error';
                    multiAgentCorrect = false;
                }
            } else {
                console.log(`  启发式: ${heuristicVerdict} (${heuristicCorrect ? '✓' : '✗'})`);
            }

            results.push({
                testCaseId: testCase.id,
                category: testCase.category,
                attackType: testCase.attackType,
                description: testCase.description,
                expected: testCase.expectedVerdict,
                heuristicVerdict,
                heuristicCorrect,
                heuristicLatencyMs: heuristicLatency,
                multiAgentVerdict,
                multiAgentCorrect,
                multiAgentLatencyMs: multiAgentLatency,
                debateTriggered,
                debateRounds
            });
        }

        const summary = this.calculateSummary(results, enableMultiAgent);

        return { results, summary };
    }

    private calculateSummary(results: ExperimentResult[], multiAgentEnabled: boolean): ExperimentSummary {
        const benignCases = results.filter(r => r.category === 'benign').length;
        const maliciousCases = results.filter(r => r.category === 'malicious').length;

        // 启发式统计
        const heuristicTP = results.filter(r => r.category === 'malicious' && r.heuristicCorrect).length;
        const heuristicTN = results.filter(r => r.category === 'benign' && r.heuristicCorrect).length;
        const heuristicFP = results.filter(r => r.category === 'benign' && !r.heuristicCorrect).length;
        const heuristicFN = results.filter(r => r.category === 'malicious' && !r.heuristicCorrect).length;

        const heuristicAccuracy = (heuristicTP + heuristicTN) / results.length;
        const heuristicPrecision = heuristicTP / (heuristicTP + heuristicFP) || 0;
        const heuristicRecall = heuristicTP / (heuristicTP + heuristicFN) || 0;
        const heuristicF1 = 2 * (heuristicPrecision * heuristicRecall) / (heuristicPrecision + heuristicRecall) || 0;
        const heuristicAvgLatency = results.reduce((sum, r) => sum + r.heuristicLatencyMs, 0) / results.length;

        const summary: ExperimentSummary = {
            totalCases: results.length,
            benignCases,
            maliciousCases,
            heuristicAccuracy,
            heuristicPrecision,
            heuristicRecall,
            heuristicF1,
            heuristicFalsePositiveRate: heuristicFP / benignCases,
            heuristicFalseNegativeRate: heuristicFN / maliciousCases,
            heuristicAvgLatencyMs: heuristicAvgLatency,
            multiAgentEnabled
        };

        // 多智能体统计（如果启用）
        if (multiAgentEnabled && results[0].multiAgentVerdict !== undefined) {
            const maTP = results.filter(r => r.category === 'malicious' && r.multiAgentCorrect).length;
            const maTN = results.filter(r => r.category === 'benign' && r.multiAgentCorrect).length;
            const maFP = results.filter(r => r.category === 'benign' && !r.multiAgentCorrect).length;
            const maFN = results.filter(r => r.category === 'malicious' && !r.multiAgentCorrect).length;

            const maAccuracy = (maTP + maTN) / results.length;
            const maPrecision = maTP / (maTP + maFP) || 0;
            const maRecall = maTP / (maTP + maFN) || 0;
            const maF1 = 2 * (maPrecision * maRecall) / (maPrecision + maRecall) || 0;

            const maLatencies = results.filter(r => r.multiAgentLatencyMs).map(r => r.multiAgentLatencyMs!);
            const maAvgLatency = maLatencies.length > 0 ? maLatencies.reduce((a, b) => a + b, 0) / maLatencies.length : 0;

            const debateCases = results.filter(r => r.debateTriggered);
            const debateRounds = debateCases.filter(r => r.debateRounds).map(r => r.debateRounds!);

            summary.multiAgentAccuracy = maAccuracy;
            summary.multiAgentPrecision = maPrecision;
            summary.multiAgentRecall = maRecall;
            summary.multiAgentF1 = maF1;
            summary.multiAgentFalsePositiveRate = maFP / benignCases;
            summary.multiAgentFalseNegativeRate = maFN / maliciousCases;
            summary.multiAgentAvgLatencyMs = maAvgLatency;
            summary.debateTriggerRate = debateCases.length / results.length;
            summary.avgDebateRounds = debateRounds.length > 0 ? debateRounds.reduce((a, b) => a + b, 0) / debateRounds.length : 0;

            summary.accuracyImprovement = maAccuracy - heuristicAccuracy;
            summary.f1Improvement = maF1 - heuristicF1;
            summary.latencyIncrease = maAvgLatency - heuristicAvgLatency;
        }

        return summary;
    }

    printSummary(summary: ExperimentSummary): void {
        console.log('\n========================================');
        console.log('实验结果摘要');
        console.log('========================================');
        console.log(`\n测试集统计:`);
        console.log(`  总样本数: ${summary.totalCases}`);
        console.log(`  正常流量: ${summary.benignCases}`);
        console.log(`  恶意流量: ${summary.maliciousCases}`);

        console.log(`\n启发式检测器 (规则匹配):`);
        console.log(`  准确率 (Accuracy):  ${(summary.heuristicAccuracy * 100).toFixed(2)}%`);
        console.log(`  精确率 (Precision): ${(summary.heuristicPrecision * 100).toFixed(2)}%`);
        console.log(`  召回率 (Recall):    ${(summary.heuristicRecall * 100).toFixed(2)}%`);
        console.log(`  F1分数:             ${(summary.heuristicF1 * 100).toFixed(2)}%`);
        console.log(`  误报率 (FPR):       ${(summary.heuristicFalsePositiveRate * 100).toFixed(2)}%`);
        console.log(`  漏报率 (FNR):       ${(summary.heuristicFalseNegativeRate * 100).toFixed(2)}%`);
        console.log(`  平均延迟:           ${summary.heuristicAvgLatencyMs.toFixed(2)}ms`);

        if (summary.multiAgentEnabled && summary.multiAgentAccuracy !== undefined) {
            console.log(`\n多智能体辩论系统:`);
            console.log(`  准确率 (Accuracy):  ${(summary.multiAgentAccuracy * 100).toFixed(2)}%`);
            console.log(`  精确率 (Precision): ${(summary.multiAgentPrecision! * 100).toFixed(2)}%`);
            console.log(`  召回率 (Recall):    ${(summary.multiAgentRecall! * 100).toFixed(2)}%`);
            console.log(`  F1分数:             ${(summary.multiAgentF1! * 100).toFixed(2)}%`);
            console.log(`  误报率 (FPR):       ${(summary.multiAgentFalsePositiveRate! * 100).toFixed(2)}%`);
            console.log(`  漏报率 (FNR):       ${(summary.multiAgentFalseNegativeRate! * 100).toFixed(2)}%`);
            console.log(`  平均延迟:           ${summary.multiAgentAvgLatencyMs!.toFixed(2)}ms`);
            console.log(`  辩论触发率:         ${(summary.debateTriggerRate! * 100).toFixed(2)}%`);
            console.log(`  平均辩论轮数:       ${summary.avgDebateRounds!.toFixed(1)}`);

            console.log(`\n对比分析:`);
            console.log(`  准确率提升:         ${(summary.accuracyImprovement! * 100).toFixed(2)}%`);
            console.log(`  F1分数提升:         ${(summary.f1Improvement! * 100).toFixed(2)}%`);
            console.log(`  延迟增加:           ${summary.latencyIncrease!.toFixed(2)}ms`);
        }

        console.log('========================================\n');
    }

    generateLatexTable(summary: ExperimentSummary): string {
        return `
% 论文表格：实验结果对比
\\begin{table}[htbp]
\\caption{Detection Performance Comparison}
\\label{tab:performance}
\\begin{tabular}{|l|c|c|}
\\hline
\\textbf{Metric} & \\textbf{Heuristic} & \\textbf{Multi-Agent} \\\\
\\hline
Accuracy & ${(summary.heuristicAccuracy * 100).toFixed(1)}\\% & ${(summary.multiAgentAccuracy ? (summary.multiAgentAccuracy * 100).toFixed(1) : 'N/A')}\\% \\\\
Precision & ${(summary.heuristicPrecision * 100).toFixed(1)}\\% & ${(summary.multiAgentPrecision ? (summary.multiAgentPrecision * 100).toFixed(1) : 'N/A')}\\% \\\\
Recall & ${(summary.heuristicRecall * 100).toFixed(1)}\\% & ${(summary.multiAgentRecall ? (summary.multiAgentRecall * 100).toFixed(1) : 'N/A')}\\% \\\\
F1-Score & ${(summary.heuristicF1 * 100).toFixed(1)}\\% & ${(summary.multiAgentF1 ? (summary.multiAgentF1 * 100).toFixed(1) : 'N/A')}\\% \\\\
False Positive Rate & ${(summary.heuristicFalsePositiveRate * 100).toFixed(1)}\\% & ${(summary.multiAgentFalsePositiveRate ? (summary.multiAgentFalsePositiveRate * 100).toFixed(1) : 'N/A')}\\% \\\\
Avg Latency (ms) & ${summary.heuristicAvgLatencyMs.toFixed(1)} & ${(summary.multiAgentAvgLatencyMs ? summary.multiAgentAvgLatencyMs.toFixed(1) : 'N/A')} \\\\
\\hline
\\end{tabular}
\\end{table}
`;
    }
}

// ============================================================================
// 主程序
// ============================================================================

async function main() {
    const args = process.argv.slice(2);
    const enableMultiAgent = args.includes('--multi-agent') || args.includes('-m');

    const runner = new PaperEvaluationRunner();
    await runner.initialize(enableMultiAgent);

    const { results, summary } = await runner.runExperiment(enableMultiAgent);
    runner.printSummary(summary);

    console.log('\nLaTeX表格（可直接复制到论文）:');
    console.log(runner.generateLatexTable(summary));

    // 保存详细结果到JSON
    const fs = await import('fs/promises');
    const outputPath = `./paper-evaluation-results-${Date.now()}.json`;
    await fs.writeFile(outputPath, JSON.stringify({ results, summary }, null, 2));
    console.log(`\n详细结果已保存到: ${outputPath}`);
}

main().catch(console.error);
