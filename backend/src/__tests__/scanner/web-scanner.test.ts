/**
 * WebScanner Tests
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

import { WebScanner } from '../../scanner/web-scanner';

describe('WebScanner', () => {
  let scanner: WebScanner;

  beforeEach(() => {
    jest.clearAllMocks();
    const { exec } = require('child_process');
    exec.mockImplementation((cmd: string, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: '', stderr: '' });
    });
    scanner = new WebScanner();
  });

  describe('scanWebServer', () => {
    it('returns server and recommendations', async () => {
      const { exec } = require('child_process');
      // nginx not installed (which returns null)
      exec.mockImplementation((cmd: string, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
        if (cmd.includes('which nginx')) cb(new Error('not found'), { stdout: '', stderr: '' });
        else cb(null, { stdout: '', stderr: '' });
      });

      const result = await scanner.scanWebServer();

      expect(result).toHaveProperty('server');
      expect(result).toHaveProperty('recommendations');
      expect(Array.isArray(result.recommendations)).toBe(true);
    });
  });

  describe('checkNginx', () => {
    it('returns null when nginx not installed', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
        if (cmd.includes('which')) cb(new Error('not found'), { stdout: '', stderr: '' });
        else cb(null, { stdout: '', stderr: '' });
      });

      const result = await scanner.checkNginx();

      expect(result).toBeNull();
    });

    it('returns recommendations when nginx is not running', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
        if (cmd.includes('which')) cb(null, { stdout: '/usr/sbin/nginx', stderr: '' });
        else if (cmd.includes('pgrep')) cb(new Error('not running'), { stdout: '', stderr: '' });
        else cb(null, { stdout: '', stderr: '' });
      });

      const result = await scanner.checkNginx();

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      if (result && result.length > 0) {
        expect(result[0].priority).toBe('high');
      }
    });
  });

  describe('getNginxConfig', () => {
    it('returns null when cannot read config', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
        cb(new Error('permission denied'), { stdout: '', stderr: '' });
      });

      const result = await scanner.getNginxConfig();

      expect(result).toBeNull();
    });

    it('returns config content when readable', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
        cb(null, { stdout: 'worker_processes auto;', stderr: '' });
      });

      const result = await scanner.getNginxConfig();

      expect(result).toContain('worker_processes');
    });
  });

  describe('getApacheConfig', () => {
    it('returns null when cannot read config', async () => {
      const { exec } = require('child_process');
      exec.mockImplementation((cmd: string, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
        cb(new Error('permission denied'), { stdout: '', stderr: '' });
      });

      const result = await scanner.getApacheConfig();

      expect(result).toBeNull();
    });
  });
});
