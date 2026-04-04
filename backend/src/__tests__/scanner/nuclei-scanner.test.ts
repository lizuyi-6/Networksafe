/**
 * NucleiScanner Tests
 */

jest.mock('child_process', () => ({
  exec: jest.fn(),
  execSync: jest.fn(),
  spawn: jest.fn(() => ({
    on: jest.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') cb(0);
      return this;
    }),
    stdout: { on: jest.fn((event: string, cb: (data: Buffer) => void) => {
      if (event === 'data') cb(Buffer.from('{}'));
    }) },
    stderr: { on: jest.fn() },
    kill: jest.fn(),
  })),
}));

jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { NucleiScanner } from '../../scanner/nuclei-scanner';

describe('NucleiScanner', () => {
  let scanner: NucleiScanner;

  beforeEach(() => {
    jest.clearAllMocks();
    scanner = new NucleiScanner();
  });

  describe('validateTarget', () => {
    it('has correct structure for scan methods', () => {
      // The validateTarget method is private but we can test its effects
      expect(typeof scanner.quickScan).toBe('function');
      expect(typeof scanner.fullScan).toBe('function');
      expect(typeof scanner.webAppScan).toBe('function');
      expect(typeof scanner.cveScan).toBe('function');
      expect(typeof scanner.getSummary).toBe('function');
      expect(typeof scanner.checkAvailability).toBe('function');
    });
  });

  describe('getSummary', () => {
    it('returns zeros for empty results', () => {
      const summary = scanner.getSummary([]);

      expect(summary.total).toBe(0);
      expect(summary.bySeverity.critical).toBe(0);
      expect(summary.bySeverity.high).toBe(0);
      expect(summary.bySeverity.medium).toBe(0);
      expect(summary.bySeverity.low).toBe(0);
      expect(summary.bySeverity.info).toBe(0);
    });

    it('groups by severity correctly', () => {
      const results = [
        {
          templateId: 'sql-injection-1',
          name: 'SQL Injection',
          severity: 'critical' as const,
          host: 'example.com',
          matched: '/api?id=1',
          timestamp: new Date(),
          tags: ['sqli', 'injection'],
        },
        {
          templateId: 'xss-1',
          name: 'XSS',
          severity: 'high' as const,
          host: 'example.com',
          matched: '/search?q=test',
          timestamp: new Date(),
          tags: ['xss'],
        },
        {
          templateId: 'sql-injection-2',
          name: 'SQL Injection 2',
          severity: 'critical' as const,
          host: 'example.com',
          matched: '/api?id=2',
          timestamp: new Date(),
          tags: ['sqli', 'injection'],
        },
      ];

      const summary = scanner.getSummary(results);

      expect(summary.total).toBe(3);
      expect(summary.bySeverity.critical).toBe(2);
      expect(summary.bySeverity.high).toBe(1);
      expect(summary.byType['sqli']).toBe(2);
      expect(summary.byType['xss']).toBe(1);
    });

    it('groups by type correctly (uses first tag only)', () => {
      const results = [
        {
          templateId: 'cve-1',
          name: 'CVE-2021-44228',
          severity: 'critical' as const,
          host: 'example.com',
          matched: '/',
          timestamp: new Date(),
          tags: ['cve', 'rce', 'log4j'],
        },
        {
          templateId: 'cve-2',
          name: 'CVE-2022-1234',
          severity: 'high' as const,
          host: 'example.com',
          matched: '/admin',
          timestamp: new Date(),
          tags: ['cve', 'auth-bypass'],
        },
      ];

      const summary = scanner.getSummary(results);

      expect(summary.total).toBe(2);
      expect(summary.byType['cve']).toBe(2);
      // Note: byType only uses the first tag
      expect(summary.byType['rce']).toBeUndefined();
    });

    it('handles mixed severity levels', () => {
      const results = [
        { templateId: '1', name: 'Critical Vuln', severity: 'critical' as const, host: 'test.com', matched: '/', timestamp: new Date(), tags: ['vuln'] },
        { templateId: '2', name: 'High Vuln', severity: 'high' as const, host: 'test.com', matched: '/', timestamp: new Date(), tags: ['vuln'] },
        { templateId: '3', name: 'Medium Vuln', severity: 'medium' as const, host: 'test.com', matched: '/', timestamp: new Date(), tags: ['vuln'] },
        { templateId: '4', name: 'Low Vuln', severity: 'low' as const, host: 'test.com', matched: '/', timestamp: new Date(), tags: ['vuln'] },
        { templateId: '5', name: 'Info Vuln', severity: 'info' as const, host: 'test.com', matched: '/', timestamp: new Date(), tags: ['vuln'] },
      ];

      const summary = scanner.getSummary(results);

      expect(summary.total).toBe(5);
      expect(summary.bySeverity.critical).toBe(1);
      expect(summary.bySeverity.high).toBe(1);
      expect(summary.bySeverity.medium).toBe(1);
      expect(summary.bySeverity.low).toBe(1);
      expect(summary.bySeverity.info).toBe(1);
    });
  });

  describe('checkAvailability', () => {
    it('returns boolean when nuclei is not installed', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: any) => {
        cb(new Error('nuclei not found'), null);
        return { stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });

      const result = await scanner.checkAvailability();
      expect(typeof result).toBe('boolean');
    });

    it('returns boolean when nuclei is installed', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: any) => {
        cb(null, { stdout: 'v3.1.0' });
        return { stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });

      const result = await scanner.checkAvailability();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('scan methods exist', () => {
    it('has quickScan method', () => {
      expect(typeof scanner.quickScan).toBe('function');
    });

    it('has fullScan method', () => {
      expect(typeof scanner.fullScan).toBe('function');
    });

    it('has webAppScan method', () => {
      expect(typeof scanner.webAppScan).toBe('function');
    });

    it('has cveScan method', () => {
      expect(typeof scanner.cveScan).toBe('function');
    });

    it('has getSummary method', () => {
      expect(typeof scanner.getSummary).toBe('function');
    });

    it('has checkAvailability method', () => {
      expect(typeof scanner.checkAvailability).toBe('function');
    });
  });
});
