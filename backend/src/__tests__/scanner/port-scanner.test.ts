/**
 * PortScanner Tests
 */

jest.mock('child_process', () => ({
  exec: jest.fn(),
  execSync: jest.fn(),
  spawn: jest.fn(() => ({
    on: jest.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') cb(0);
      return this;
    }),
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    kill: jest.fn(),
  })),
}));

jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { PortScanner } from '../../scanner/port-scanner';

describe('PortScanner', () => {
  let scanner: PortScanner;

  beforeEach(() => {
    jest.clearAllMocks();
    scanner = new PortScanner();
  });

  describe('scanCommonPorts', () => {
    it('returns array of recommendations', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: any) => {
        cb(null, { stdout: '' });
        return { stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });

      const results = await scanner.scanCommonPorts();

      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('analyzePort - private method via behavior', () => {
    // Port 21 - FTP
    it('detects FTP as security risk', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: any) => {
        // Return output that includes port 21
        cb(null, { stdout: 'tcp        0      0 0.0.0.0:21            0.0.0.0:*               LISTEN' });
        return { stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });

      const results = await scanner.scanCommonPorts();
      const ftpRecommendation = results.find(r => r.title.includes('21'));

      expect(ftpRecommendation).toBeDefined();
      expect(ftpRecommendation?.priority).toBe('medium');
    });

    // Port 23 - Telnet
    it('detects Telnet as high risk', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: any) => {
        cb(null, { stdout: 'tcp        0      0 0.0.0.0:23            0.0.0.0:*               LISTEN' });
        return { stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });

      const results = await scanner.scanCommonPorts();
      const telnetRecommendation = results.find(r => r.title.includes('23'));

      expect(telnetRecommendation).toBeDefined();
      expect(telnetRecommendation?.priority).toBe('high');
    });

    // Port 3306 - MySQL
    it('detects MySQL as high risk', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: any) => {
        cb(null, { stdout: 'tcp        0      0 0.0.0.0:3306          0.0.0.0:*               LISTEN' });
        return { stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });

      const results = await scanner.scanCommonPorts();
      const mysqlRecommendation = results.find(r => r.title.includes('MySQL'));

      expect(mysqlRecommendation).toBeDefined();
      expect(mysqlRecommendation?.priority).toBe('high');
    });

    // Port 6379 - Redis
    it('detects Redis as critical risk', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: any) => {
        cb(null, { stdout: 'tcp        0      0 0.0.0.0:6379          0.0.0.0:*               LISTEN' });
        return { stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });

      const results = await scanner.scanCommonPorts();
      const redisRecommendation = results.find(r => r.title.includes('Redis'));

      expect(redisRecommendation).toBeDefined();
      expect(redisRecommendation?.priority).toBe('critical');
    });

    // Port 27017 - MongoDB
    it('detects MongoDB as high risk', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: any) => {
        cb(null, { stdout: 'tcp        0      0 0.0.0.0:27017          0.0.0.0:*               LISTEN' });
        return { stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });

      const results = await scanner.scanCommonPorts();
      const mongoRecommendation = results.find(r => r.title.includes('MongoDB'));

      expect(mongoRecommendation).toBeDefined();
      expect(mongoRecommendation?.priority).toBe('high');
    });

    // Safe ports should not generate recommendations
    it('ignores safe ports like 8080', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: any) => {
        cb(null, { stdout: 'tcp        0      0 0.0.0.0:8080          0.0.0.0:*               LISTEN' });
        return { stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });

      const results = await scanner.scanCommonPorts();

      // Port 8080 should not generate a recommendation
      expect(results.some(r => r.title.includes('8080'))).toBe(false);
    });

    it('ignores SSH port 22', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: any) => {
        cb(null, { stdout: 'tcp        0      0 0.0.0.0:22            0.0.0.0:*               LISTEN' });
        return { stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });

      const results = await scanner.scanCommonPorts();

      // SSH is expected and should not generate a recommendation
      expect(results.some(r => r.title.includes('22'))).toBe(false);
    });
  });

  describe('isPortOpen', () => {
    it('returns true when port is open', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: any) => {
        cb(null, { stdout: 'tcp        0      0 0.0.0.0:22            0.0.0.0:*               LISTEN' });
        return { stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });

      const result = await scanner.isPortOpen(22);

      expect(result).toBe(true);
    });

    it('returns false when port is closed', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: any) => {
        cb(new Error('not found'), { stdout: '' });
        return { stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      });

      const result = await scanner.isPortOpen(9999);

      expect(result).toBe(false);
    });
  });
});
