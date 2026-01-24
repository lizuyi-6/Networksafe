/**
 * Nuclei 扫描器单元测试
 */

import { NucleiScanner } from '../scanner/nuclei-scanner';

describe('NucleiScanner', () => {
    let scanner: NucleiScanner;

    beforeEach(() => {
        scanner = new NucleiScanner();
    });

    describe('Availability Check', () => {
        it('should check if nuclei is installed', async () => {
            const isAvailable = await scanner.checkAvailability();

            // 这个测试的结果取决于系统是否安装了 nuclei
            expect(typeof isAvailable).toBe('boolean');
        });

        it('should report availability status', async () => {
            await scanner.checkAvailability();
            const status = scanner.getIsAvailable();

            expect(typeof status).toBe('boolean');
        });
    });

    describe('Summary Generation', () => {
        it('should generate correct summary for results', () => {
            const mockResults = [
                {
                    templateId: 'CVE-2021-44228',
                    name: 'Log4j RCE',
                    severity: 'critical' as const,
                    host: 'example.com',
                    matched: '/api/test',
                    timestamp: new Date(),
                    tags: ['cve', 'rce']
                },
                {
                    templateId: 'XSS-001',
                    name: 'Reflected XSS',
                    severity: 'high' as const,
                    host: 'example.com',
                    matched: '/search',
                    timestamp: new Date(),
                    tags: ['xss']
                },
                {
                    templateId: 'INFO-001',
                    name: 'Version Disclosure',
                    severity: 'info' as const,
                    host: 'example.com',
                    matched: '/about',
                    timestamp: new Date(),
                    tags: ['exposure']
                }
            ];

            const summary = scanner.getSummary(mockResults);

            expect(summary.total).toBe(3);
            expect(summary.bySeverity.critical).toBe(1);
            expect(summary.bySeverity.high).toBe(1);
            expect(summary.bySeverity.info).toBe(1);
            expect(summary.byType.cve).toBe(1);
            expect(summary.byType.xss).toBe(1);
        });

        it('should handle empty results', () => {
            const summary = scanner.getSummary([]);

            expect(summary.total).toBe(0);
            expect(summary.bySeverity.critical).toBe(0);
        });
    });

    describe('Scan Methods', () => {
        // 这些测试需要 nuclei 已安装才能运行
        // 在 CI 环境中可能需要跳过

        it('should have quickScan method', () => {
            expect(typeof scanner.quickScan).toBe('function');
        });

        it('should have fullScan method', () => {
            expect(typeof scanner.fullScan).toBe('function');
        });

        it('should have webAppScan method', () => {
            expect(typeof scanner.webAppScan).toBe('function');
        });

        it('should have cveScan method', () => {
            expect(typeof scanner.cveScan).toBe('function');
        });
    });
});
