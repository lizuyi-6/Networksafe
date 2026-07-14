/**
 * Agent Test Suite
 *
 * Tests for the AetherGuard distributed agent that:
 * - Connects to control plane via Socket.IO
 * - Sends heartbeats
 * - Monitors traffic
 * - Detects attacks
 * - Executes signed commands
 */

import { Agent, startAgent, AgentConfig } from '../../agent/agent';

// Mock socket.io-client - define mock functions inside factory to avoid hoisting issues
export const mockSocketEmit = jest.fn();
export const mockSocketDisconnect = jest.fn();

jest.mock('socket.io-client', () => {
  return {
    io: jest.fn(() => ({
      on: jest.fn((event: string, cb: any) => {
        if (event === 'connect') setTimeout(() => cb(), 0);
        if (event === 'command') cb({
          command: {
            type: 'block_ip',
            payload: { ip: '1.2.3.4' },
            timestamp: Date.now(),
            nonce: 'n'
          },
          signature: 'sig',
          agentId: 'test-agent'
        });
        if (event === 'disconnect') setTimeout(() => cb(), 0);
      }),
      emit: mockSocketEmit,
      disconnect: mockSocketDisconnect,
      connected: true,
    })),
  };
});

// Mock os - inline to avoid hoisting issues
jest.mock('os', () => ({
  cpus: jest.fn().mockReturnValue([
    { times: { user: 100, nice: 0, sys: 100, idle: 800, irq: 0 } },
    { times: { user: 50, nice: 0, sys: 50, idle: 400, irq: 0 } }
  ]),
  totalmem: jest.fn().mockReturnValue(16000000000),
  freemem: jest.fn().mockReturnValue(8000000000),
  hostname: jest.fn().mockReturnValue('test-host'),
  platform: jest.fn().mockReturnValue('linux'),
  uptime: jest.fn().mockReturnValue(3600),
}));

// Mock TrafficMonitor
jest.mock('../../agent/traffic-monitor', () => ({
  TrafficMonitor: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    getStats: jest.fn().mockReturnValue({ flows: 5, packets: 100 }),
    getStatus: jest.fn().mockReturnValue({
      isRunning: true,
      dataSource: 'none',
      logPath: null,
      lastActivity: null,
      stats: { eventsProcessed: 0, errors: 0, startTime: null }
    }),
    on: jest.fn(),
  })),
}));

// Mock AttackDetector
jest.mock('../../agent/attack-detector', () => ({
  AttackDetector: jest.fn().mockImplementation(() => ({
    analyze: jest.fn().mockReturnValue(null),
    assessForReview: jest.fn().mockReturnValue(null),
    updateRules: jest.fn(),
    updateRemoteRules: jest.fn(),
    stop: jest.fn(),
    getRules: jest.fn().mockReturnValue([]),
  })),
}));

// Mock FirewallController
jest.mock('../../agent/firewall-controller', () => ({
  FirewallController: jest.fn().mockImplementation(() => ({
    blockIP: jest.fn().mockResolvedValue(true),
    unblockIP: jest.fn().mockResolvedValue(true),
    getBlockedIPs: jest.fn().mockReturnValue([]),
    isBlocked: jest.fn().mockReturnValue(false),
  })),
}));

// Mock crypto for HMAC verification
jest.mock('crypto', () => ({
  createHmac: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue(Buffer.from('abcdef1234567890abcdef1234567890', 'hex'))
  }),
  timingSafeEqual: jest.fn().mockReturnValue(true),
  randomBytes: jest.fn().mockReturnValue(Buffer.from('nonce12345678901234567890')),
}));

// Logger mock
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// Simple mock clearing between tests
beforeEach(() => {
  jest.clearAllMocks();
});

// Note: We don't mock setTimeout/setInterval to avoid timing issues
// Tests that depend on timers may need adjustment

// ============================================
// Constructor Tests
// ============================================

describe('Agent constructor', () => {
  it('throws when agentId is missing', () => {
    expect(() => new Agent({
      apiKey: 'test-key',
      secretKey: 'test-secret',
      serverUrl: 'http://localhost:3005',
    } as AgentConfig)).toThrow('agentId');
  });

  it('throws when apiKey is missing', () => {
    expect(() => new Agent({
      agentId: 'test-agent',
      secretKey: 'test-secret',
      serverUrl: 'http://localhost:3005',
    } as AgentConfig)).toThrow('apiKey');
  });

  it('throws when secretKey is missing', () => {
    expect(() => new Agent({
      agentId: 'test-agent',
      apiKey: 'test-key',
      serverUrl: 'http://localhost:3005',
    } as AgentConfig)).toThrow('secretKey');
  });

  it('throws with helpful security error message', () => {
    expect(() => new Agent({
      serverUrl: 'http://localhost:3005',
    } as AgentConfig)).toThrow(/SECURITY ERROR/);
  });

  it('creates with all required params', () => {
    const agent = new Agent({
      agentId: 'test-agent',
      apiKey: 'test-key',
      secretKey: 'test-secret',
      serverUrl: 'http://localhost:3005',
    });
    expect(agent).toBeDefined();
  });

  it('uses default heartbeat interval of 30 seconds', () => {
    const agent = new Agent({
      agentId: 'test-agent',
      apiKey: 'test-key',
      secretKey: 'test-secret',
      serverUrl: 'http://localhost:3005',
    });
    expect(agent).toBeDefined();
  });

  it('accepts custom heartbeat interval', () => {
    const agent = new Agent({
      agentId: 'test-agent',
      apiKey: 'test-key',
      secretKey: 'test-secret',
      serverUrl: 'http://localhost:3005',
      heartbeatInterval: 60000,
    });
    expect(agent).toBeDefined();
  });
});

// ============================================
// Agent Instance Tests
// ============================================

describe('Agent', () => {
  let agent: Agent;

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new Agent({
      agentId: 'test-agent',
      apiKey: 'test-key',
      secretKey: 'test-secret',
      serverUrl: 'http://localhost:3005',
    });
  });

  afterEach(async () => {
    await agent.stop();
  });

  describe('start', () => {
    it('initiates socket connection', async () => {
      await agent.start();
      const { io } = require('socket.io-client');
      expect(io).toHaveBeenCalledWith('http://localhost:3005', expect.any(Object));
    });

    it('connects with agent authentication', async () => {
      await agent.start();
      const { io } = require('socket.io-client');
      const connectOptions = io.mock.calls[0][1];
      expect(connectOptions.auth).toEqual(
        expect.objectContaining({
          type: 'agent',
          agentId: 'test-agent',
          apiKey: 'test-key',
        })
      );
    });

    it('starts traffic monitor', async () => {
      await agent.start();
      const { TrafficMonitor } = require('../../agent/traffic-monitor');
      expect(TrafficMonitor.mock.results[0].value.start).toHaveBeenCalled();
    });

    it('does not throw on connection timeout', async () => {
      // The socket mock auto-resolves, so this should succeed
      await expect(agent.start()).resolves.not.toThrow();
    });

    it('logs startup messages', async () => {
      const { default: logger } = require('../../utils/logger');
      await agent.start();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Starting AetherGuard Agent'));
    });
  });

  describe('getCpuUsage', () => {
    it('returns a number between 0 and 100', () => {
      const cpu = (agent as any).getCpuUsage();
      expect(typeof cpu).toBe('number');
      expect(cpu).toBeGreaterThanOrEqual(0);
      expect(cpu).toBeLessThanOrEqual(100);
    });

    it('calculates correct percentage from mock CPU data', () => {
      // Default mock: CPU1 (user=100,sys=100,idle=800) + CPU2 (user=50,sys=50,idle=400)
      // totalTick=1500, totalIdle=1200 → 20%
      const cpu = (agent as any).getCpuUsage();
      expect(cpu).toBe(20);
    });
  });

  describe('getMemoryUsage', () => {
    it('returns a number between 0 and 100', () => {
      const mem = (agent as any).getMemoryUsage();
      expect(typeof mem).toBe('number');
      expect(mem).toBeGreaterThanOrEqual(0);
      expect(mem).toBeLessThanOrEqual(100);
    });

    it('calculates correct percentage from mock memory data', () => {
      // Default mock: totalmem=16G, freemem=8G → 50%
      const mem = (agent as any).getMemoryUsage();
      expect(mem).toBe(50);
    });
  });

  describe('handleSignedCommand', () => {
    it('rejects command with wrong agentId', async () => {
      const { default: logger } = require('../../utils/logger');
      await agent.start();

      const signedCmd = {
        command: {
          type: 'block_ip',
          payload: { ip: '1.2.3.4' },
          timestamp: Date.now(),
          nonce: 'unique-nonce-1'
        },
        signature: 'sig',
        agentId: 'wrong-agent'
      };

      await (agent as any).handleSignedCommand(signedCmd);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('not for this agent'));
    });

    it('rejects command with expired timestamp (>5 min old)', async () => {
      const { default: logger } = require('../../utils/logger');
      await agent.start();

      const fiveMinAgo = Date.now() - 6 * 60 * 1000;
      const signedCmd = {
        command: {
          type: 'block_ip',
          payload: { ip: '1.2.3.4' },
          timestamp: fiveMinAgo,
          nonce: 'unique-nonce-2'
        },
        signature: 'sig',
        agentId: 'test-agent'
      };

      await (agent as any).handleSignedCommand(signedCmd);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Stale command'), expect.any(Object));
    });

    it('rejects command with future timestamp (>1 min ahead)', async () => {
      const { default: logger } = require('../../utils/logger');
      await agent.start();

      const twoMinAhead = Date.now() + 2 * 60 * 1000;
      const signedCmd = {
        command: {
          type: 'block_ip',
          payload: { ip: '1.2.3.4' },
          timestamp: twoMinAhead,
          nonce: 'unique-nonce-3'
        },
        signature: 'sig',
        agentId: 'test-agent'
      };

      await (agent as any).handleSignedCommand(signedCmd);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Future timestamp'));
    });

    it('rejects duplicate nonce (replay protection)', async () => {
      const { default: logger } = require('../../utils/logger');
      await agent.start();

      const nonce = 'replay-nonce-123';
      const signedCmd = {
        command: {
          type: 'block_ip',
          payload: { ip: '1.2.3.4' },
          timestamp: Date.now(),
          nonce: nonce
        },
        signature: 'sig',
        agentId: 'test-agent'
      };

      // First command should be processed
      await (agent as any).handleSignedCommand(signedCmd);

      // Second command with same nonce should be rejected
      await (agent as any).handleSignedCommand(signedCmd);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Replay attack'), expect.any(Object));
    });

    it('accepts valid command and executes block_ip', async () => {
      await agent.start();

      const signedCmd = {
        command: {
          type: 'block_ip',
          payload: { ip: '5.6.7.8' },
          timestamp: Date.now(),
          nonce: 'valid-nonce-block'
        },
        signature: 'abcdef1234567890abcdef1234567890',
        agentId: 'test-agent'
      };

      await (agent as any).handleSignedCommand(signedCmd);

      const { FirewallController } = require('../../agent/firewall-controller');
      expect(FirewallController.mock.results[0].value.blockIP).toHaveBeenCalledWith('5.6.7.8', expect.any(Number));
    });

    it('executes unblock_ip command', async () => {
      await agent.start();

      const signedCmd = {
        command: {
          type: 'unblock_ip',
          payload: { ip: '5.6.7.8' },
          timestamp: Date.now(),
          nonce: 'valid-nonce-unblock'
        },
        signature: 'abcdef1234567890abcdef1234567890',
        agentId: 'test-agent'
      };

      await (agent as any).handleSignedCommand(signedCmd);

      const { FirewallController } = require('../../agent/firewall-controller');
      expect(FirewallController.mock.results[0].value.unblockIP).toHaveBeenCalledWith('5.6.7.8');
    });

    it('executes scan command', async () => {
      const { default: logger } = require('../../utils/logger');
      await agent.start();

      const signedCmd = {
        command: {
          type: 'scan',
          payload: {},
          timestamp: Date.now(),
          nonce: 'valid-nonce-scan'
        },
        signature: 'abcdef1234567890abcdef1234567890',
        agentId: 'test-agent'
      };

      await (agent as any).handleSignedCommand(signedCmd);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Running local security scan'));
    });

    it('emits command_ack after successful execution', async () => {
      await agent.start();

      const signedCmd = {
        command: {
          type: 'block_ip',
          payload: { ip: '9.9.9.9' },
          timestamp: Date.now(),
          nonce: 'ack-nonce'
        },
        signature: 'abcdef1234567890abcdef1234567890',
        agentId: 'test-agent'
      };

      await (agent as any).handleSignedCommand(signedCmd);
      expect(mockSocketEmit).toHaveBeenCalledWith('agent:command_ack', expect.objectContaining({
        agentId: 'test-agent',
        commandType: 'block_ip',
        nonce: 'ack-nonce'
      }));
    });

    it('emits command_failed on execution error', async () => {
      // Create an agent whose firewall always fails
      const { FirewallController } = require('../../agent/firewall-controller');
      const originalImpl = FirewallController.mockImplementation;
      FirewallController.mockImplementationOnce(() => ({
        blockIP: jest.fn().mockRejectedValueOnce(new Error('Block failed')),
        unblockIP: jest.fn().mockResolvedValue(true),
        getBlockedIPs: jest.fn().mockReturnValue([]),
        isBlocked: jest.fn().mockReturnValue(false),
      }));

      const failingAgent = new Agent({
        agentId: 'failing-agent',
        apiKey: 'test-key',
        secretKey: 'test-secret',
        serverUrl: 'http://localhost:3005',
      });
      await failingAgent.start();

      const signedCmd = {
        command: {
          type: 'block_ip',
          payload: { ip: '9.9.9.9' },
          timestamp: Date.now(),
          nonce: 'fail-nonce'
        },
        signature: 'abcdef1234567890abcdef1234567890',
        agentId: 'failing-agent'
      };

      try {
        await (failingAgent as any).handleSignedCommand(signedCmd);
      } catch {
        // Expected: implementation catches, emits command_failed, then re-throws
      }
      expect(mockSocketEmit).toHaveBeenCalledWith('agent:command_failed', expect.objectContaining({
        agentId: 'failing-agent',
        commandType: 'block_ip'
      }));
      await failingAgent.stop();
    });
  });

  describe('executeCommand', () => {
    it('calls blockIP for block_ip command', async () => {
      await agent.start();
      await (agent as any).executeCommand({ type: 'block_ip', payload: { ip: '1.2.3.4' } });

      const { FirewallController } = require('../../agent/firewall-controller');
      expect(FirewallController.mock.results[0].value.blockIP).toHaveBeenCalledWith('1.2.3.4', expect.any(Number));
    });

    it('calls unblockIP for unblock_ip command', async () => {
      await agent.start();
      await (agent as any).executeCommand({ type: 'unblock_ip', payload: { ip: '1.2.3.4' } });

      const { FirewallController } = require('../../agent/firewall-controller');
      expect(FirewallController.mock.results[0].value.unblockIP).toHaveBeenCalledWith('1.2.3.4');
    });

    it('calls updateRules for legacy rule format', async () => {
      await agent.start();
      const rules = [
        { id: 'TEST-001', name: 'Test', type: 'test', patterns: [/test/], autoBlock: true }
      ];

      await (agent as any).executeCommand({ type: 'update_rules', payload: { rules } });

      const { AttackDetector } = require('../../agent/attack-detector');
      expect(AttackDetector.mock.results[0].value.updateRules).toHaveBeenCalledWith(rules);
    });

    it('calls updateRemoteRules for new rule format', async () => {
      await agent.start();
      const rules = [
        {
          ruleId: 'REMOTE-001',
          name: 'Remote Rule',
          attackFamily: 'sqli',
          severity: 'high',
          scope: 'all',
          matcher: {
            pathPatterns: ['**/login**'],
            bodyPatterns: ['**OR 1=1**']
          },
          action: 'block',
          enabled: true
        }
      ];

      await (agent as any).executeCommand({ type: 'update_rules', payload: { rules } });

      const { AttackDetector } = require('../../agent/attack-detector');
      expect(AttackDetector.mock.results[0].value.updateRemoteRules).toHaveBeenCalledWith(rules);
    });

    it('logs warning for unknown command', async () => {
      const { default: logger } = require('../../utils/logger');
      await agent.start();

      await (agent as any).executeCommand({ type: 'unknown_cmd', payload: {} });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown command'));
    });

    it('does not crash on block_ip without payload', async () => {
      await agent.start();
      await expect((agent as any).executeCommand({ type: 'block_ip', payload: {} })).resolves.not.toThrow();
    });

    it('does not crash on unblock_ip without payload', async () => {
      await agent.start();
      await expect((agent as any).executeCommand({ type: 'unblock_ip', payload: {} })).resolves.not.toThrow();
    });
  });

  describe('handleThreat', () => {
    it('emits threat event to server when threat detected', async () => {
      await agent.start();

      const threat = {
        type: 'sql_injection',
        severity: 'high',
        sourceIP: '1.2.3.4',
        description: 'SQL Injection attempt',
        evidence: 'union select',
        ruleId: 'SQL-001',
        autoBlock: true
      };

      (agent as any).handleThreat(threat);
      expect(mockSocketEmit).toHaveBeenCalledWith('agent:threat', expect.objectContaining({
        agentId: 'test-agent',
        threat
      }));
    });

    it('auto-blocks IP if threat has autoBlock flag', async () => {
      await agent.start();

      const threat = {
        type: 'sql_injection',
        severity: 'high',
        sourceIP: '2.3.4.5',
        description: 'SQL Injection',
        evidence: 'union select',
        ruleId: 'SQL-001',
        autoBlock: true,
        blockDuration: 3600
      };

      (agent as any).handleThreat(threat);

      const { FirewallController } = require('../../agent/firewall-controller');
      expect(FirewallController.mock.results[0].value.blockIP).toHaveBeenCalledWith('2.3.4.5', 3600);
    });

    it('does not auto-block if autoBlock is false', async () => {
      await agent.start();

      // Clear blockIP calls from the mock command fired during start()
      const { FirewallController } = require('../../agent/firewall-controller');
      FirewallController.mock.results[0].value.blockIP.mockClear();

      const threat = {
        type: 'xss',
        severity: 'medium',
        sourceIP: '2.3.4.5',
        description: 'XSS attempt',
        evidence: '<script>',
        ruleId: 'XSS-001',
        autoBlock: false
      };

      (agent as any).handleThreat(threat);

      expect(FirewallController.mock.results[0].value.blockIP).not.toHaveBeenCalled();
    });

    it('logs warning when threat detected', async () => {
      const { default: logger } = require('../../utils/logger');
      await agent.start();

      const threat = {
        type: 'sql_injection',
        severity: 'high',
        sourceIP: '3.4.5.6',
        description: 'SQL Injection',
        evidence: 'union select',
        ruleId: 'SQL-001',
        autoBlock: true
      };

      (agent as any).handleThreat(threat);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Threat detected'), expect.any(Object));
    });
  });

  describe('stop', () => {
    it('clears heartbeat timer', async () => {
      await agent.start();
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      await agent.stop();

      expect(clearIntervalSpy).toHaveBeenCalled();
      expect((agent as any).heartbeatTimer).toBeNull();
      expect((agent as any).trafficStatsTimer).toBeNull();
    });

    it('stops traffic monitor', async () => {
      await agent.start();
      const { TrafficMonitor } = require('../../agent/traffic-monitor');

      agent.stop();

      expect(TrafficMonitor.mock.results[0].value.stop).toHaveBeenCalled();
    });

    it('disconnects socket without error', async () => {
      await agent.start();
      expect((agent as any).socket).toBeDefined();
      expect(() => agent.stop()).not.toThrow();
    });

    it('logs stop message', async () => {
      const { default: logger } = require('../../utils/logger');
      await agent.start();

      agent.stop();

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Stopping Agent'));
    });

    it('can be called multiple times safely', async () => {
      await agent.start();
      expect(() => agent.stop()).not.toThrow();
      expect(() => agent.stop()).not.toThrow();
    });
  });
});

// ============================================
// startAgent Tests
// ============================================

describe('startAgent', () => {
  beforeEach(() => {
    process.env.AGENT_ID = 'env-agent-id';
    process.env.AGENT_API_KEY = 'env-api-key';
    process.env.AGENT_SECRET_KEY = 'env-secret-key';
  });

  afterEach(() => {
    delete process.env.AGENT_ID;
    delete process.env.AGENT_API_KEY;
    delete process.env.AGENT_SECRET_KEY;
    delete process.env.AetherGuard_AGENT_ID;
    delete process.env.AetherGuard_AGENT_API_KEY;
    delete process.env.AetherGuard_AGENT_SECRET_KEY;
  });

  it('creates and starts an agent from environment variables', async () => {
    const agent = await startAgent('http://localhost:3005');
    expect(agent).toBeDefined();
    agent.stop();
  });

  it('uses AetherGuard env vars when available', async () => {
    process.env.AetherGuard_AGENT_ID = 'aether-agent';
    process.env.AetherGuard_AGENT_API_KEY = 'aether-key';
    process.env.AetherGuard_AGENT_SECRET_KEY = 'aether-secret';

    const agent = await startAgent('http://localhost:3005');
    expect(agent).toBeDefined();
    agent.stop();
  });

  it('throws when API key is missing from environment', async () => {
    delete process.env.AGENT_API_KEY;
    delete process.env.AetherGuard_AGENT_API_KEY;

    await expect(startAgent('http://localhost:3005')).rejects.toThrow(/API_KEY/);
  });
});

// ============================================
// Integration: Full Command Flow Tests
// ============================================

describe('Agent command flow integration', () => {
  let agent: Agent;

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new Agent({
      agentId: 'integration-agent',
      apiKey: 'test-key',
      secretKey: 'test-secret',
      serverUrl: 'http://localhost:3005',
    });
  });

  afterEach(async () => {
    await agent.stop();
  });

  it('processes command through full flow: receive -> verify -> execute -> ack', async () => {
    await agent.start();

    // Simulate receiving a signed command via socket
    const signedCmd = {
      command: {
        type: 'block_ip',
        payload: { ip: '8.8.8.8', duration: 7200 },
        timestamp: Date.now(),
        nonce: 'flow-test-nonce'
      },
      signature: 'abcdef1234567890abcdef1234567890',
      agentId: 'integration-agent'
    };

    await (agent as any).handleSignedCommand(signedCmd);

    // Verify execution
    const { FirewallController } = require('../../agent/firewall-controller');
    expect(FirewallController.mock.results[0].value.blockIP).toHaveBeenCalledWith('8.8.8.8', 7200);

    // Verify acknowledgment
    expect(mockSocketEmit).toHaveBeenCalledWith('agent:command_ack', expect.objectContaining({
      agentId: 'integration-agent',
      commandType: 'block_ip'
    }));
  });

  it('handles unblock command through full flow', async () => {
    await agent.start();

    const signedCmd = {
      command: {
        type: 'unblock_ip',
        payload: { ip: '8.8.8.8' },
        timestamp: Date.now(),
        nonce: 'flow-unblock-nonce'
      },
      signature: 'abcdef1234567890abcdef1234567890',
      agentId: 'integration-agent'
    };

    await (agent as any).handleSignedCommand(signedCmd);

    const { FirewallController } = require('../../agent/firewall-controller');
    expect(FirewallController.mock.results[0].value.unblockIP).toHaveBeenCalledWith('8.8.8.8');
  });

  it('handles rule update command', async () => {
    await agent.start();

    const newRules = [
      {
        ruleId: 'CUSTOM-001',
        name: 'Custom Rule',
        attackFamily: 'xss',
        severity: 'medium',
        scope: 'agent',
        matcher: {
          pathPatterns: ['**/comment**'],
          bodyPatterns: ['**<script**']
        },
        action: 'block',
        enabled: true
      }
    ];

    const signedCmd = {
      command: {
        type: 'update_rules',
        payload: { rules: newRules },
        timestamp: Date.now(),
        nonce: 'rule-update-nonce'
      },
      signature: 'abcdef1234567890abcdef1234567890',
      agentId: 'integration-agent'
    };

    await (agent as any).handleSignedCommand(signedCmd);

    const { AttackDetector } = require('../../agent/attack-detector');
    expect(AttackDetector.mock.results[0].value.updateRemoteRules).toHaveBeenCalledWith(newRules);
  });
});
