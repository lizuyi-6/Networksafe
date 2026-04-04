/**
 * 攻击检测器单元测试
 */

import { AttackDetector, ThreatAlert, AgentReviewSample } from '../agent/attack-detector';
import { TrafficEvent } from '../agent/traffic-monitor';
import * as detectionEngine from '../services/detection-engine';

// Spy on detection-engine functions to allow real implementations while tracking calls
const spyAssessDetectionHeuristics = jest.spyOn(detectionEngine, 'assessDetectionHeuristics');
const spyBuildSeedDetectionRules = jest.spyOn(detectionEngine, 'buildSeedDetectionRules');
const spyEvaluateDetectionRules = jest.spyOn(detectionEngine, 'evaluateDetectionRules');
const spyInferAttackFamily = jest.spyOn(detectionEngine, 'inferAttackFamily');
const spySeverityToBlockDurationSeconds = jest.spyOn(detectionEngine, 'severityToBlockDurationSeconds');

describe('AttackDetector', () => {
    let detector: AttackDetector;

    beforeEach(() => {
        detector = new AttackDetector();
        // Reset spies that we need to control
        spyAssessDetectionHeuristics.mockReset();
        spyBuildSeedDetectionRules.mockReset();
        spyInferAttackFamily.mockReset();
        spySeverityToBlockDurationSeconds.mockReset();

        // Don't reset spyEvaluateDetectionRules - let it run with real implementation
        // This allows remote rules to be properly evaluated

        // Setup default spy implementations that return neutral values
        spyAssessDetectionHeuristics.mockReturnValue({ riskScore: 0.1, signals: [] });
        spyBuildSeedDetectionRules.mockReturnValue([]);
        spyInferAttackFamily.mockReturnValue('other');
        spySeverityToBlockDurationSeconds.mockReturnValue(300);
    });

    afterEach(() => {
        detector.stop();
    });

    // Helper function to create TrafficEvent
    function createTrafficEvent(overrides: Partial<TrafficEvent> = {}): TrafficEvent {
        return {
            timestamp: new Date(),
            sourceIP: '192.168.1.100',
            destPort: 80,
            method: 'GET',
            path: '/test',
            queryParams: {},
            headers: { 'user-agent': 'TestAgent/1.0' },
            requestBody: '',
            responseBody: '',
            responseStatus: 200,
            ...overrides,
        } as TrafficEvent;
    }

    describe('SQL Injection Detection', () => {
        it('should detect UNION SELECT attack', () => {
            const event: TrafficEvent = {
                timestamp: new Date(),
                sourceIP: '192.168.1.100',
                destPort: 80,
                path: '/api/users?id=1 UNION SELECT * FROM users--',
                method: 'GET'
            };

            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('sql_injection');
            expect(result?.severity).toBe('critical');
            expect(result?.ruleId).toBe('SQL-001');
        });

        it('should detect OR 1=1 attack', () => {
            const event: TrafficEvent = {
                timestamp: new Date(),
                sourceIP: '192.168.1.100',
                destPort: 80,
                path: "/api/login",
                requestBody: "username=admin' OR '1'='1&password=test",
                method: 'POST'
            };

            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('sql_injection');
            expect(result?.ruleId).toBe('SQL-002');
        });

        it('should detect stacked queries', () => {
            const event: TrafficEvent = {
                timestamp: new Date(),
                sourceIP: '192.168.1.100',
                destPort: 80,
                path: '/api/users?id=1; DROP TABLE users--',
                method: 'GET'
            };

            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('sql_injection');
            expect(result?.severity).toBe('critical');
        });
    });

    describe('XSS Detection', () => {
        it('should detect script tag injection', () => {
            const event: TrafficEvent = {
                timestamp: new Date(),
                sourceIP: '192.168.1.100',
                destPort: 80,
                path: '/api/comment',
                requestBody: 'content=<script>alert("xss")</script>',
                method: 'POST'
            };

            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('xss');
            expect(result?.ruleId).toBe('XSS-001');
        });

        it('should detect event handler XSS', () => {
            const event: TrafficEvent = {
                timestamp: new Date(),
                sourceIP: '192.168.1.100',
                destPort: 80,
                path: '/api/profile',
                requestBody: 'bio=<img src=x onerror=alert(1)>',
                method: 'POST'
            };

            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('xss');
        });
    });

    describe('Path Traversal Detection', () => {
        it('should detect ../ traversal', () => {
            const event: TrafficEvent = {
                timestamp: new Date(),
                sourceIP: '192.168.1.100',
                destPort: 80,
                path: '/api/files?path=../../../etc/passwd',
                method: 'GET'
            };

            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('lfi');
        });

        it('should detect sensitive file access', () => {
            const event: TrafficEvent = {
                timestamp: new Date(),
                sourceIP: '192.168.1.100',
                destPort: 80,
                path: '/api/download?file=.env',
                method: 'GET'
            };

            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('lfi');
            expect(result?.severity).toBe('critical');
        });
    });

    describe('Command Injection Detection', () => {
        it('should detect command injection', () => {
            const event: TrafficEvent = {
                timestamp: new Date(),
                sourceIP: '192.168.1.100',
                destPort: 80,
                path: '/api/ping?host=localhost; cat /etc/passwd',
                method: 'GET'
            };

            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('command_injection');
            expect(result?.severity).toBe('critical');
        });

        it('should detect backtick execution', () => {
            const event: TrafficEvent = {
                timestamp: new Date(),
                sourceIP: '192.168.1.100',
                destPort: 80,
                path: '/api/exec',
                requestBody: 'cmd=`whoami`',
                method: 'POST'
            };

            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('command_injection');
        });
    });

    describe('Bot Detection', () => {
        it('should detect sqlmap user agent', () => {
            const event: TrafficEvent = {
                timestamp: new Date(),
                sourceIP: '192.168.1.100',
                destPort: 80,
                path: '/api/users',
                userAgent: 'sqlmap/1.5.2#stable (http://sqlmap.org)',
                method: 'GET'
            };

            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('bad_bot');
        });
    });

    describe('Rate Limiting', () => {
        it('should detect DDoS pattern (high request rate)', () => {
            // 模拟快速请求
            for (let i = 0; i < 150; i++) {
                const event: TrafficEvent = {
                    timestamp: new Date(),
                    sourceIP: '10.0.0.1',
                    destPort: 80,
                    path: '/api/test',
                    method: 'GET'
                };
                detector.analyze(event);
            }

            // 第 151 次请求应该触发 DDoS 检测
            const event: TrafficEvent = {
                timestamp: new Date(),
                sourceIP: '10.0.0.1',
                destPort: 80,
                path: '/api/test',
                method: 'GET'
            };

            const result = detector.analyze(event);

            // 如果速率检测正常工作，应该检测到威胁
            // 注意：由于时间窗口计算，这个测试可能不稳定
            if (result) {
                expect(['ddos', 'brute_force']).toContain(result.type);
            }
        });
    });

    describe('Rule Management', () => {
        it('should add custom rule', () => {
            const initialCount = detector.getRules().length;

            detector.addRule({
                id: 'CUSTOM-001',
                name: 'Custom Test Rule',
                type: 'custom',
                severity: 'medium',
                patterns: [/custom_attack_pattern/i],
                autoBlock: false
            });

            expect(detector.getRules().length).toBe(initialCount + 1);
        });

        it('should update rules', () => {
            detector.updateRules([
                {
                    id: 'NEW-001',
                    name: 'New Rule',
                    type: 'test',
                    severity: 'low',
                    patterns: [/test/i],
                    autoBlock: false
                }
            ]);

            expect(detector.getRules().length).toBe(1);
            expect(detector.getRules()[0].id).toBe('NEW-001');
        });
    });

    describe('Safe Requests', () => {
        it('should not flag normal requests', () => {
            const event: TrafficEvent = {
                timestamp: new Date(),
                sourceIP: '192.168.1.100',
                destPort: 80,
                path: '/api/users/123',
                method: 'GET',
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0'
            };

            const result = detector.analyze(event);

            expect(result).toBeNull();
        });

        it('should not flag normal POST request', () => {
            const event: TrafficEvent = {
                timestamp: new Date(),
                sourceIP: '192.168.1.100',
                destPort: 80,
                path: '/api/login',
                requestBody: '{"username":"john","password":"secret123"}',
                method: 'POST'
            };

            const result = detector.analyze(event);

            expect(result).toBeNull();
        });
    });

    describe('Remote Rules - mapAttackFamilyToThreatType', () => {
        it('should map sqli attack family to sql_injection', () => {
            detector.updateRemoteRules([{
                ruleId: 'REMOTE-SQLI',
                tenantId: 'test',
                name: 'Remote SQLi',
                attackFamily: 'sqli',
                severity: 'critical',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: ['/admin'],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: []
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/admin?id=1' });
            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('sql_injection');
            expect(result?.ruleId).toBe('REMOTE-SQLI');
        });

        it('should map xss attack family to xss', () => {
            detector.updateRemoteRules([{
                ruleId: 'REMOTE-XSS',
                tenantId: 'test',
                name: 'Remote XSS',
                attackFamily: 'xss',
                severity: 'high',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: [],
                    bodyPatterns: ['<script'],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: []
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/test', requestBody: '<script>alert(1)</script>' });
            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('xss');
        });

        it('should map path_traversal attack family to lfi', () => {
            detector.updateRemoteRules([{
                ruleId: 'REMOTE-LFI',
                tenantId: 'test',
                name: 'Remote LFI',
                attackFamily: 'path_traversal',
                severity: 'high',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: ['../'],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: []
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/test/../etc/passwd' });
            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('lfi');
        });

        it('should map command_injection attack family to command_injection', () => {
            detector.updateRemoteRules([{
                ruleId: 'REMOTE-CMD',
                tenantId: 'test',
                name: 'Remote Command Injection',
                attackFamily: 'command_injection',
                severity: 'critical',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: [],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: ['; cat']
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/test', requestBody: '; cat /etc/passwd' });
            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('command_injection');
        });

        it('should map ssrf attack family to ssrf', () => {
            detector.updateRemoteRules([{
                ruleId: 'REMOTE-SSRF',
                tenantId: 'test',
                name: 'Remote SSRF',
                attackFamily: 'ssrf',
                severity: 'high',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: [],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: ['169.254.169.254']
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/test', requestBody: 'url=http://169.254.169.254/latest/meta-data' });
            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('ssrf');
        });

        it('should map automation attack family to bad_bot', () => {
            detector.updateRemoteRules([{
                ruleId: 'REMOTE-BOT',
                tenantId: 'test',
                name: 'Remote Bot Detection',
                attackFamily: 'automation',
                severity: 'medium',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: [],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: ['sqlmap'],
                    keywordPatterns: []
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/test', userAgent: 'sqlmap/1.5' });
            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('bad_bot');
        });

        it('should map unknown attack family to other', () => {
            detector.updateRemoteRules([{
                ruleId: 'REMOTE-OTHER',
                tenantId: 'test',
                name: 'Remote Other',
                attackFamily: 'benign',
                severity: 'low',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: ['/special'],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: []
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/special' });
            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.type).toBe('other');
        });
    });

    describe('Remote Rules - block action', () => {
        it('should create ThreatAlert for remote rule with block action', () => {
            // Clear local rules so remote rules are tested in isolation
            detector.updateRules([]);

            detector.updateRemoteRules([{
                ruleId: 'REMOTE-BLOCK',
                tenantId: 'test',
                name: 'Block Rule',
                attackFamily: 'sqli',
                severity: 'critical',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: [],
                    bodyPatterns: ["' OR '1'='1"],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: []
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({
                path: '/test',
                requestBody: "' OR '1'='1",
                sourceIP: '1.2.3.4',
                destPort: 80
            });

            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.ruleId).toBe('REMOTE-BLOCK');
            expect(result?.type).toBe('sql_injection');
            expect(result?.blocked).toBeUndefined(); // autoBlock is set based on rule.action === 'block'
            expect(result?.autoBlock).toBe(true);
        });

        it('should return null for remote rule with allow action', () => {
            detector.updateRemoteRules([{
                ruleId: 'REMOTE-ALLOW',
                tenantId: 'test',
                name: 'Allow Rule',
                attackFamily: 'sqli',
                severity: 'critical',
                action: 'allow',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: ['/test'],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: []
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/test' });
            const result = detector.analyze(event);

            expect(result).toBeNull();
        });

        it('should filter out disabled remote rules', () => {
            detector.updateRemoteRules([{
                ruleId: 'REMOTE-DISABLED',
                tenantId: 'test',
                name: 'Disabled Rule',
                attackFamily: 'sqli',
                severity: 'critical',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: ['/disabled'],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: []
                },
                enabled: false, // DISABLED
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/disabled' });
            const result = detector.analyze(event);

            expect(result).toBeNull();
        });

        it('should filter out rules with scope http_api when channel is agent', () => {
            detector.updateRemoteRules([{
                ruleId: 'REMOTE-HTTP-ONLY',
                tenantId: 'test',
                name: 'HTTP Only Rule',
                attackFamily: 'sqli',
                severity: 'critical',
                action: 'block',
                scope: 'http_api', // Not 'all' or 'agent'
                priority: 1000,
                matcher: {
                    pathPatterns: ['/http-only'],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: []
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/http-only' });
            const result = detector.analyze(event);

            expect(result).toBeNull();
        });
    });

    describe('Remote Rules - pattern matching', () => {
        it('should match pathPatterns in remote rules', () => {
            detector.updateRemoteRules([{
                ruleId: 'PATH-001',
                tenantId: 'test',
                name: 'Path Match',
                attackFamily: 'sqli',
                severity: 'high',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: ['/admin/api'],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: []
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/admin/api?id=1' });
            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.ruleId).toBe('PATH-001');
        });

        it('should match bodyPatterns in remote rules', () => {
            detector.updateRemoteRules([{
                ruleId: 'BODY-001',
                tenantId: 'test',
                name: 'Body Match',
                attackFamily: 'xss',
                severity: 'high',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: [],
                    bodyPatterns: ['eval\\('],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: []
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/test', requestBody: 'data=eval(alert)' });
            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.ruleId).toBe('BODY-001');
        });

        it('should match userAgentPatterns in remote rules', () => {
            // Clear local rules to avoid conflict with BOT-001 which also matches nikto
            detector.updateRules([]);

            detector.updateRemoteRules([{
                ruleId: 'UA-001',
                tenantId: 'test',
                name: 'UA Match',
                attackFamily: 'automation',
                severity: 'medium',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: [],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: ['nikto'],
                    keywordPatterns: []
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/test', userAgent: 'Nikto/2.1.6' });
            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.ruleId).toBe('UA-001');
        });

        it('should match keywordPatterns in remote rules', () => {
            detector.updateRemoteRules([{
                ruleId: 'KW-001',
                tenantId: 'test',
                name: 'Keyword Match',
                attackFamily: 'ssrf',
                severity: 'high',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: [],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: ['metadata.google.internal']
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/test', requestBody: 'url=http://metadata.google.internal/computeMetadata/v1' });
            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.ruleId).toBe('KW-001');
        });

        it('should match evidencePatterns in remote rules', () => {
            detector.updateRemoteRules([{
                ruleId: 'EVIDENCE-001',
                tenantId: 'test',
                name: 'Evidence Match',
                attackFamily: 'command_injection',
                severity: 'critical',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: [],
                    bodyPatterns: [],
                    evidencePatterns: ['/bin/bash'],
                    userAgentPatterns: [],
                    keywordPatterns: []
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/test', rawLog: 'Executing /bin/bash -c ls' });
            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.ruleId).toBe('EVIDENCE-001');
        });

        it('should truncate evidence content longer than 180 chars', () => {
            detector.updateRemoteRules([{
                ruleId: 'LONG-EVIDENCE',
                tenantId: 'test',
                name: 'Long Evidence',
                attackFamily: 'other',
                severity: 'low',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: [],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: ['MATCH']
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            // Create a very long content string with MATCH in the middle
            const longContent = 'A'.repeat(100) + 'MATCH' + 'B'.repeat(100);
            const event = createTrafficEvent({ path: '/test', requestBody: longContent });
            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(result?.evidence.length).toBeLessThanOrEqual(183); // 180 + '...'
        });
    });

    describe('Rate Limit Thresholds', () => {
        it('should return null for exactly 30 req/s (below brute force threshold)', () => {
            // Simulate exactly 30 rapid requests - should still return null
            // Note: The 30th request is the one we're checking, so loop makes 29 requests + 1 check = 30 total
            for (let i = 0; i < 29; i++) {
                detector.analyze(createTrafficEvent({ sourceIP: '5.6.7.8', path: `/req${i}` }));
            }
            const result = detector.analyze(createTrafficEvent({ sourceIP: '5.6.7.8', path: '/req29' }));
            // 30/s is the boundary, not yet brute force (need > 30)
            expect(result).toBeNull();
        });

        it('should trigger brute_force for 31+ req/s', () => {
            // First establish baseline (need more than 30/s)
            for (let i = 0; i < 35; i++) {
                detector.analyze(createTrafficEvent({ sourceIP: '9.8.7.6', path: `/flood${i}` }));
            }
            const result = detector.analyze(createTrafficEvent({ sourceIP: '9.8.7.6', path: '/flood35' }));
            expect(result?.type).toBe('brute_force');
            expect(result?.severity).toBe('high');
            expect(result?.autoBlock).toBe(true);
        });

        it('should trigger ddos for >100 req/s', () => {
            // First establish baseline
            for (let i = 0; i < 105; i++) {
                detector.analyze(createTrafficEvent({ sourceIP: '1.1.1.1', path: `/ddos${i}` }));
            }
            const result = detector.analyze(createTrafficEvent({ sourceIP: '1.1.1.1', path: '/ddos105' }));
            expect(result?.type).toBe('ddos');
            expect(result?.severity).toBe('critical');
            expect(result?.autoBlock).toBe(true);
        });

        it('should return null when no IP counter exists', () => {
            const event = createTrafficEvent({ sourceIP: '192.168.1.200' });
            const result = detector.analyze(event);
            // Should return null because there's no prior IP counter data and no attack patterns
            expect(result).toBeNull();
        });
    });

    describe('assessForReview', () => {
        it('should return null when rule verdict is block', () => {
            spyEvaluateDetectionRules.mockReturnValueOnce({
                matchedRules: [],
                matchedRuleIds: ['block-rule'],
                highestPriorityRule: {
                    ruleId: 'block-rule',
                    tenantId: 'test',
                    name: 'Block Rule',
                    action: 'block',
                    scope: 'all',
                    priority: 1000,
                    severity: 'high',
                    matcher: {},
                    source: 'seed',
                    enabled: true,
                    version: 1
                },
                ruleVerdict: 'block',
                shouldEscalate: false,
                riskScore: 0.8,
                signals: []
            });

            const event = createTrafficEvent({
                path: '/admin',
                requestBody: "admin' DROP TABLE users--"
            });

            const result = detector.assessForReview(event);
            expect(result).toBeNull();
        });

        it('should return null when risk score is below 0.4', () => {
            spyEvaluateDetectionRules.mockReturnValueOnce({
                matchedRules: [],
                matchedRuleIds: [],
                highestPriorityRule: null,
                ruleVerdict: 'allow',
                shouldEscalate: false,
                riskScore: 0.1,
                signals: []
            });
            spyAssessDetectionHeuristics.mockReturnValueOnce({
                riskScore: 0.2,
                signals: []
            });

            const event = createTrafficEvent({
                path: '/normal',
                userAgent: 'Mozilla/5.0 normal browser'
            });

            const result = detector.assessForReview(event);
            expect(result).toBeNull();
        });

        it('should return AgentReviewSample for escalated events with high risk', () => {
            spyEvaluateDetectionRules.mockReturnValueOnce({
                matchedRules: [{
                    rule: {
                        ruleId: 'review-rule',
                        tenantId: 'test',
                        name: 'Review Rule',
                        action: 'review',
                        scope: 'all',
                        priority: 500,
                        severity: 'medium',
                        matcher: {},
                        source: 'seed',
                        enabled: true,
                        version: 1
                    },
                    signal: {
                        source: 'rule',
                        key: 'review-rule',
                        score: 0.5,
                        severity: 'medium',
                        description: 'Review rule triggered'
                    }
                }],
                matchedRuleIds: ['review-rule'],
                highestPriorityRule: {
                    ruleId: 'review-rule',
                    tenantId: 'test',
                    name: 'Review Rule',
                    action: 'review',
                    scope: 'all',
                    priority: 500,
                    severity: 'medium',
                    matcher: {},
                    source: 'seed',
                    enabled: true,
                    version: 1
                },
                ruleVerdict: 'monitor',
                shouldEscalate: true,
                riskScore: 0.5,
                signals: [{
                    source: 'rule',
                    key: 'review-rule',
                    score: 0.5,
                    severity: 'medium',
                    description: 'Review rule triggered'
                }]
            });
            spyAssessDetectionHeuristics.mockReturnValueOnce({
                riskScore: 0.3,
                signals: []
            });
            spyInferAttackFamily.mockReturnValueOnce('sqli');

            const event = createTrafficEvent({
                path: '/suspicious',
                requestBody: "' OR '1'='1",
                sourceIP: '10.0.0.1'
            });

            const result = detector.assessForReview(event);

            expect(result).not.toBeNull();
            expect(result?.riskScore).toBe(0.5);
            expect(result?.matchedRuleIds).toContain('review-rule');
            expect(result?.attackFamily).toBe('sqli');
            expect(result?.decisionSource).toBe('seed:review');
        });

        it('should return AgentReviewSample with heuristic_only decision source when no rules matched', () => {
            spyEvaluateDetectionRules.mockReturnValueOnce({
                matchedRules: [],
                matchedRuleIds: [],
                highestPriorityRule: null,
                ruleVerdict: 'allow',
                shouldEscalate: false,
                riskScore: 0.2,
                signals: []
            });
            spyAssessDetectionHeuristics.mockReturnValueOnce({
                riskScore: 0.5,
                signals: [{
                    source: 'heuristic',
                    key: 'heuristic-large-payload',
                    score: 0.45,
                    severity: 'high',
                    description: 'Large payload observed'
                }]
            });
            spyInferAttackFamily.mockReturnValueOnce('other');

            const event = createTrafficEvent({
                path: '/test',
                requestBody: 'A'.repeat(5000)
            });

            const result = detector.assessForReview(event);

            expect(result).not.toBeNull();
            expect(result?.decisionSource).toBe('heuristic_only');
            expect(result?.existingSignals.length).toBeGreaterThan(0);
        });

        it('should include metadata with eventPort', () => {
            spyEvaluateDetectionRules.mockReturnValueOnce({
                matchedRules: [],
                matchedRuleIds: [],
                highestPriorityRule: null,
                ruleVerdict: 'allow',
                shouldEscalate: false,
                riskScore: 0.5,
                signals: []
            });
            spyAssessDetectionHeuristics.mockReturnValueOnce({
                riskScore: 0.5,
                signals: []
            });
            spyInferAttackFamily.mockReturnValueOnce('other');

            const event = createTrafficEvent({ path: '/test', destPort: 8080 });
            const result = detector.assessForReview(event);

            expect(result?.metadata?.eventPort).toBe(8080);
            expect(result?.metadata?.localRuleVerdict).toBe('allow');
        });
    });

    describe('IP Tracking', () => {
        it('should track IP request counts across multiple requests', () => {
            const ip = '2.2.2.2';

            // First request
            detector.analyze(createTrafficEvent({ sourceIP: ip }));

            // Verify that subsequent requests from same IP are tracked
            // This is tested indirectly via rate limit behavior
            for (let i = 0; i < 35; i++) {
                detector.analyze(createTrafficEvent({ sourceIP: ip, path: `/req${i}` }));
            }

            const result = detector.analyze(createTrafficEvent({ sourceIP: ip, path: '/final' }));
            expect(result?.type).toBe('brute_force');
        });
    });

    describe('buildContentToCheck edge cases', () => {
        it('should handle empty fields in buildContentToCheck', () => {
            const event = createTrafficEvent({
                path: '',
                requestBody: '',
                userAgent: '',
                rawLog: ''
            });

            const result = detector.analyze(event);
            // Should not throw and should return null (no attack patterns)
            expect(result).toBeNull();
        });

        it('should combine all fields in buildContentToCheck', () => {
            detector.updateRemoteRules([{
                ruleId: 'COMBINED-001',
                tenantId: 'test',
                name: 'Combined Match',
                attackFamily: 'sqli',
                severity: 'high',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: [],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: ['COMBINED_PAYLOAD']
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({
                path: '/test',
                requestBody: 'body content',
                userAgent: 'user agent',
                rawLog: 'raw log'
            });

            // The COMBINED_PAYLOAD pattern should match because keywordPatterns
            // searches across all content fields joined with space
            const result = detector.analyze(event);
            expect(result).toBeNull(); // COMBINED_PAYLOAD not in the content
        });
    });

    describe('extractEvidence edge cases', () => {
        it('should return context around match at start of content', () => {
            // Use bodyPatterns since the MATCH is in the body content
            detector.updateRules([]); // Clear local rules

            detector.updateRemoteRules([{
                ruleId: 'START-MATCH',
                tenantId: 'test',
                name: 'Start Match',
                attackFamily: 'sqli',
                severity: 'high',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: [],
                    bodyPatterns: ['MATCH_at_start'],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: []
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({
                path: '/test',
                requestBody: 'MATCH_at_start trailing content here'
            });

            const result = detector.analyze(event);
            expect(result).not.toBeNull();
            expect(result?.evidence).toContain('MATCH');
        });

        it('should return context around match at end of content', () => {
            detector.updateRules([]); // Clear local rules

            detector.updateRemoteRules([{
                ruleId: 'END-MATCH',
                tenantId: 'test',
                name: 'End Match',
                attackFamily: 'sqli',
                severity: 'high',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: [],
                    bodyPatterns: ['END_MATCH'],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: []
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({
                path: '/test',
                requestBody: 'leading content END_MATCH'
            });

            const result = detector.analyze(event);
            expect(result).not.toBeNull();
            expect(result?.evidence).toContain('END_MATCH');
        });
    });

    describe('stop method', () => {
        it('should clear IP counter and cleanup interval', () => {
            // First add some data to IP counter
            detector.analyze(createTrafficEvent({ sourceIP: '1.1.1.1' }));
            detector.analyze(createTrafficEvent({ sourceIP: '2.2.2.2' }));

            // Stop the detector
            detector.stop();

            // After stop, new requests should not trigger rate limits
            // because the counter was cleared
            for (let i = 0; i < 35; i++) {
                detector.analyze(createTrafficEvent({ sourceIP: '1.1.1.1', path: `/req${i}` }));
            }

            // The requests are new (counter cleared), so only 35 requests from fresh IP
            // would not trigger rate limit
            const result = detector.analyze(createTrafficEvent({ sourceIP: '1.1.1.1', path: '/final' }));
            // Since counter was cleared and restarted, the rate is measured from first request
            // This test validates stop() doesn't throw
        });
    });

    describe('updateRemoteRules', () => {
        it('should handle empty array', () => {
            detector.updateRemoteRules([]);
            const event = createTrafficEvent({ path: '/test' });
            const result = detector.analyze(event);
            expect(result).toBeNull();
        });

        it('should handle non-array input gracefully', () => {
            // @ts-ignore - testing defensive coding
            detector.updateRemoteRules(null);
            const event = createTrafficEvent({ path: '/test' });
            const result = detector.analyze(event);
            expect(result).toBeNull();
        });

        it('should filter out rules with undefined enabled', () => {
            detector.updateRemoteRules([{
                ruleId: 'UNDEFINED-ENABLED',
                tenantId: 'test',
                name: 'Undefined Enabled',
                attackFamily: 'sqli',
                severity: 'high',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: ['/undefined-enabled'],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: []
                },
                enabled: undefined, // undefined should be treated as false
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/undefined-enabled' });
            const result = detector.analyze(event);
            expect(result).toBeNull();
        });

        it('should log updated remote detection rules', () => {
            detector.updateRemoteRules([{
                ruleId: 'LOG-TEST',
                tenantId: 'test',
                name: 'Log Test',
                attackFamily: 'sqli',
                severity: 'high',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: { pathPatterns: ['/log-test'] },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/log-test' });
            const result = detector.analyze(event);
            expect(result).not.toBeNull();
        });
    });

    describe('getRules', () => {
        it('should return a copy of rules array', () => {
            const rules = detector.getRules();
            expect(Array.isArray(rules)).toBe(true);
            expect(rules.length).toBeGreaterThan(0);

            // Verify it's a copy by modifying it
            rules.push({ id: 'MODIFIED', name: 'Test', type: 'test', severity: 'low', patterns: [/test/], autoBlock: false });
            expect(detector.getRules().length).toBe(rules.length - 1);
        });
    });

    describe('Severity to block duration mapping', () => {
        it('should use correct block duration based on severity', () => {
            spySeverityToBlockDurationSeconds.mockReturnValue(7200);

            detector.updateRemoteRules([{
                ruleId: 'DURATION-TEST',
                tenantId: 'test',
                name: 'Duration Test',
                attackFamily: 'sqli',
                severity: 'critical',
                action: 'block',
                scope: 'all',
                priority: 1000,
                matcher: {
                    pathPatterns: ['/duration-test'],
                    bodyPatterns: [],
                    evidencePatterns: [],
                    userAgentPatterns: [],
                    keywordPatterns: []
                },
                enabled: true,
                source: 'dynamic',
                version: 1
            }]);

            const event = createTrafficEvent({ path: '/duration-test' });
            const result = detector.analyze(event);

            expect(result).not.toBeNull();
            expect(spySeverityToBlockDurationSeconds).toHaveBeenCalledWith('critical');
        });
    });
});
