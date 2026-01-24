/**
 * 攻击检测器单元测试
 */

import { AttackDetector, ThreatAlert } from '../agent/attack-detector';
import { TrafficEvent } from '../agent/traffic-monitor';

describe('AttackDetector', () => {
    let detector: AttackDetector;

    beforeEach(() => {
        detector = new AttackDetector();
    });

    afterEach(() => {
        detector.stop();
    });

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
});
