/**
 * AgentGateway agent session revalidation.
 *
 * Pins the security invariant that a connected host agent's WebSocket is
 * actively disconnected when its registration is revoked mid-session
 * (revokeAgent flips status='revoked' in the DB). Before this mechanism the
 * agent socket was authenticated once in io.use and stayed live until TCP
 * dropped — an over-privilege window.
 *
 * The dashboard side already had revalidation (websocket-dashboard-session-
 * revalidation.test.ts); this covers the agent (API-key) side.
 */

import { createServer, Server as HttpServer } from 'http';
import { io as SocketIOClient, Socket as ClientSocket } from 'socket.io-client';

const mockVerifyAgent = jest.fn();
const mockGetAgentStatus = jest.fn();
const mockUpdateLastSeen = jest.fn();

jest.mock('../../security/agent-auth.service', () => ({
  __esModule: true,
  default: {
    verifyAgent: mockVerifyAgent,
    getAgentStatus: mockGetAgentStatus,
    updateLastSeen: mockUpdateLastSeen
  }
}));

jest.mock('../../testing/test-runtime-adapter', () => ({
  isTestRuntime: jest.fn(() => false),
  wsTestAgentAdapter: jest.fn(),
  wsTestDashboardUserAdapter: jest.fn()
}));

jest.mock('../../security/audit-logger.service', () => ({
  __esModule: true,
  default: {
    log: jest.fn().mockResolvedValue({}),
    logAgent: jest.fn().mockResolvedValue({}),
    logCommand: jest.fn().mockResolvedValue({}),
    logFirewall: jest.fn().mockResolvedValue({})
  }
}));

jest.mock('../../services/socket-rate-limit.service', () => ({
  socketRateLimitService: {
    check: jest.fn().mockResolvedValue({
      allowed: true,
      remaining: 100,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
      resetAtMs: Date.now() + 60_000,
      decisionSource: 'test',
      riskFlags: []
    }),
    close: jest.fn()
  }
}));

jest.mock('../../services/fastpath-client.service', () => ({
  fastpathClientService: {
    checkSocket: jest.fn().mockResolvedValue(null),
    check: jest.fn().mockResolvedValue(null)
  }
}));

jest.mock('../../services/command-dispatcher.service', () => ({
  commandDispatcherService: {
    handleAgentCommandAck: jest.fn(),
    handleAgentCommandFailure: jest.fn()
  }
}));

jest.mock('../../services/detection-pipeline.service', () => ({
  detectionPipelineService: {
    recordBlockedThreat: jest.fn().mockResolvedValue(undefined),
    reviewAgentSample: jest.fn().mockResolvedValue({
      aiVerdict: 'safe',
      matchedRuleIds: [],
      attackFamily: 'unknown',
      riskScore: 0.1,
      decisionSource: 'test'
    }),
    listDynamicRules: jest.fn().mockResolvedValue([])
  }
}));

import { AgentGateway } from '../../websocket/agent-gateway';
import auditLogger from '../../security/audit-logger.service';

describe('AgentGateway agent session revalidation', () => {
  const originalInterval = process.env.WS_AGENT_SESSION_REVALIDATE_MS;
  const PORT = 15111;
  let httpServer: HttpServer;
  let gateway: AgentGateway;
  let socket: ClientSocket | null = null;

  beforeAll((done) => {
    process.env.WS_AGENT_SESSION_REVALIDATE_MS = '20';
    httpServer = createServer();
    gateway = new AgentGateway(httpServer);
    httpServer.listen(PORT, done);
  });

  afterAll(async () => {
    if (originalInterval === undefined) {
      delete process.env.WS_AGENT_SESSION_REVALIDATE_MS;
    } else {
      process.env.WS_AGENT_SESSION_REVALIDATE_MS = originalInterval;
    }
    socket?.disconnect();
    await gateway.close();
  });

  afterEach(() => {
    socket?.disconnect();
    socket = null;
    mockVerifyAgent.mockReset();
    mockGetAgentStatus.mockReset();
    mockUpdateLastSeen.mockReset();
  });

  it('disconnects a connected agent socket after its registration is revoked', async () => {
    mockVerifyAgent.mockResolvedValue({
      agentId: 'agent-revoke-1',
      hostname: 'host-revoke',
      platform: 'linux',
      tenantId: 'tenant-a'
    });
    // First revalidation tick: still approved (no disconnect). Thereafter:
    // revoked -> disconnect.
    mockGetAgentStatus
      .mockReturnValueOnce('approved')
      .mockReturnValue('revoked');

    socket = SocketIOClient(`http://localhost:${PORT}`, {
      auth: { type: 'agent', agentId: 'agent-revoke-1', apiKey: 'key-revoke-1' },
      forceNew: true,
      reconnection: false,
      timeout: 2000
    });

    await new Promise<void>((resolve, reject) => {
      socket!.once('connect', () => resolve());
      socket!.once('connect_error', reject);
    });

    const disconnectReason = await new Promise<string>((resolve) => {
      socket!.once('disconnect', (reason) => resolve(reason));
    });

    // io server disconnect = the server called socket.disconnect(true).
    expect(disconnectReason).toBe('io server disconnect');
    // The revocation status was actually polled (not just a connection drop).
    expect(mockGetAgentStatus).toHaveBeenCalledWith('agent-revoke-1');
    expect(mockGetAgentStatus).toHaveBeenCalledTimes(2);
  });

  it('keeps the agent connected while status stays approved', async () => {
    mockVerifyAgent.mockResolvedValue({
      agentId: 'agent-keep-1',
      hostname: 'host-keep',
      platform: 'linux',
      tenantId: 'tenant-a'
    });
    mockGetAgentStatus.mockReturnValue('approved');

    socket = SocketIOClient(`http://localhost:${PORT}`, {
      auth: { type: 'agent', agentId: 'agent-keep-1', apiKey: 'key-keep-1' },
      forceNew: true,
      reconnection: false,
      timeout: 2000
    });

    await new Promise<void>((resolve, reject) => {
      socket!.once('connect', () => resolve());
      socket!.once('connect_error', reject);
    });

    // Let several revalidation ticks fire; none should disconnect.
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(socket!.connected).toBe(true);
    expect(mockGetAgentStatus).toHaveBeenCalledWith('agent-keep-1');
    expect(mockGetAgentStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT disconnect when the status check throws a transient error', async () => {
    mockVerifyAgent.mockResolvedValue({
      agentId: 'agent-blip-1',
      hostname: 'host-blip',
      platform: 'linux',
      tenantId: 'tenant-a'
    });
    // Simulate a transient DB error on every poll.
    mockGetAgentStatus.mockImplementation(() => {
      throw new Error('SQLITE_BUSY');
    });

    socket = SocketIOClient(`http://localhost:${PORT}`, {
      auth: { type: 'agent', agentId: 'agent-blip-1', apiKey: 'key-blip-1' },
      forceNew: true,
      reconnection: false,
      timeout: 2000
    });

    await new Promise<void>((resolve, reject) => {
      socket!.once('connect', () => resolve());
      socket!.once('connect_error', reject);
    });

    await new Promise((resolve) => setTimeout(resolve, 120));

    // A blip must not mass-kick agents: the socket stays connected.
    expect(socket!.connected).toBe(true);
    expect(mockGetAgentStatus).toHaveBeenCalledWith('agent-blip-1');
    expect(mockGetAgentStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('contains an asynchronous audit failure during normal disconnect', async () => {
    mockVerifyAgent.mockResolvedValue({
      agentId: 'agent-audit-failure-1',
      hostname: 'host-audit-failure',
      platform: 'linux',
      tenantId: 'tenant-a'
    });
    mockGetAgentStatus.mockReturnValue('approved');

    socket = SocketIOClient(`http://localhost:${PORT}`, {
      auth: { type: 'agent', agentId: 'agent-audit-failure-1', apiKey: 'key-audit-failure-1' },
      forceNew: true,
      reconnection: false,
      timeout: 2000
    });

    await new Promise<void>((resolve, reject) => {
      socket!.once('connect', () => resolve());
      socket!.once('connect_error', reject);
    });

    (auditLogger.logAgent as jest.Mock).mockRejectedValueOnce(new Error('audit disk full'));
    socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(socket.connected).toBe(false);
    expect(auditLogger.logAgent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'disconnect',
      agentId: 'agent-audit-failure-1',
      success: true
    }));
  });
});
