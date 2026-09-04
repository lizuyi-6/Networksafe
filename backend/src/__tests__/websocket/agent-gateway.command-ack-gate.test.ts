/**
 * AgentGateway command-ack truthfulness gate (N4, audit 2026-08)
 *
 * Before N4, the `agent:command_ack` / `agent:command_failed` handlers:
 *   1. had NO socket-ownership check — a superseded socket (replaced by a
 *      newer authenticated connection) could still mutate command state;
 *   2. broadcast "completed/failed" to dashboards regardless of whether the
 *      dispatcher actually accepted the transition — a rejected ack (replay,
 *      tenant/target mismatch, wrong prior state) was still reported to
 *      operators as a successful completion.
 *
 * The contract pinned here:
 *   - accepted ack -> dispatcher called, dashboard broadcast emitted;
 *   - rejected ack -> dispatcher called, NO dashboard broadcast, audit
 *     records failure;
 *   - non-current socket -> handler returns before the dispatcher is even
 *     consulted (no state mutation, no broadcast).
 */

import { Server as HttpServer, createServer } from 'http';
import { io as SocketIOClient, Socket as ClientSocket } from 'socket.io-client';

jest.mock('../../security/audit-logger.service', () => ({
  __esModule: true,
  default: {
    log: jest.fn().mockResolvedValue({}),
    logAgent: jest.fn().mockResolvedValue({}),
    logCommand: jest.fn().mockResolvedValue({}),
    logFirewall: jest.fn().mockResolvedValue({})
  }
}));

const checkMock = jest.fn().mockResolvedValue({
  allowed: true,
  remaining: 100,
  resetAt: new Date(Date.now() + 60_000).toISOString(),
  resetAtMs: Date.now() + 60_000,
  decisionSource: 'memory-fallback',
  riskFlags: []
});

jest.mock('../../services/socket-rate-limit.service', () => ({
  __esModule: true,
  socketRateLimitService: {
    check: checkMock,
    close: jest.fn()
  }
}));

const ackMock = jest.fn().mockReturnValue(true);
const failMock = jest.fn().mockReturnValue(true);

jest.mock('../../services/command-dispatcher.service', () => ({
  commandDispatcherService: {
    handleAgentCommandAck: (...args: any[]) => ackMock(...args),
    handleAgentCommandFailure: (...args: any[]) => failMock(...args)
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

jest.mock('../../security/command-signing.service', () => ({
  commandSigningService: {
    signCommand: jest.fn().mockReturnValue({
      command: { type: 'test', timestamp: Date.now(), nonce: 'n' },
      signature: 'sig',
      agentId: 'test-agent'
    })
  }
}));

import { AgentGateway } from '../../websocket/agent-gateway';
import auditLogger from '../../security/audit-logger.service';

describe('AgentGateway command-ack truthfulness gate (N4)', () => {
  let httpServer: HttpServer;
  let gateway: AgentGateway;
  const PORT = 3107;
  const TENANT = 'ack-gate-tenant';
  const sockets: ClientSocket[] = [];

  beforeAll((done) => {
    httpServer = createServer();
    gateway = new AgentGateway(httpServer);
    httpServer.listen(PORT, done);
  });

  afterAll(async () => {
    sockets.splice(0).forEach((socket) => {
      if (socket.connected) socket.disconnect();
    });
    await gateway.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
    sockets.splice(0).forEach((socket) => {
      if (socket.connected) socket.disconnect();
    });
  });

  function connectAgent(agentId: string): Promise<ClientSocket> {
    return new Promise<ClientSocket>((resolve, reject) => {
      const socket = SocketIOClient(`http://localhost:${PORT}`, {
        auth: { type: 'agent', agentId, tenantId: TENANT }
      });
      sockets.push(socket);
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });
  }

  function connectDashboard(): Promise<ClientSocket> {
    return new Promise<ClientSocket>((resolve, reject) => {
      const socket = SocketIOClient(`http://localhost:${PORT}`, {
        auth: { type: 'dashboard', tenantId: TENANT, userId: 'dash-1' }
      });
      sockets.push(socket);
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });
  }

  function waitFor(predicate: () => boolean, timeoutMs = 2000, everyMs = 50): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (predicate()) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error('condition not met within timeout'));
        }
      }, everyMs);
    });
  }

  it('broadcasts completion to dashboards only when the dispatcher ACCEPTS the ack', async () => {
    const dash = await connectDashboard();
    const agent = await connectAgent('ack-accept-agent');
    const ackReceived = new Promise<any>((resolve) => {
      dash.on('agent:command:ack', (payload: any) => resolve(payload));
    });

    ackMock.mockReturnValueOnce(true);
    agent.emit('agent:command_ack', { actionId: 'action-accepted', message: 'done' });

    const payload = await Promise.race([
      ackReceived,
      new Promise((_, reject) => setTimeout(() => reject(new Error('broadcast not received')), 2000))
    ]);
    expect(payload).toMatchObject({ actionId: 'action-accepted' });
    expect(ackMock).toHaveBeenCalledWith('ack-accept-agent', TENANT, { actionId: 'action-accepted', message: 'done' });
  });

  it('does NOT broadcast when the dispatcher REJECTS the ack (fake completion blocked)', async () => {
    const dash = await connectDashboard();
    const agent = await connectAgent('ack-reject-agent');
    let broadcastSeen = false;
    dash.on('agent:command:ack', () => { broadcastSeen = true; });

    ackMock.mockReturnValueOnce(false); // replay / mismatched / wrong prior state
    agent.emit('agent:command_ack', { actionId: 'action-rejected' });

    await waitFor(() => (auditLogger.log as jest.Mock).mock.calls.some(
      (call) => call[0]?.eventType === 'command_ack' && call[0]?.details?.accepted === false
    ));

    // Give any (wrong) broadcast a chance to arrive before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(broadcastSeen).toBe(false);
    const auditCall = (auditLogger.log as jest.Mock).mock.calls.find(
      (call) => call[0]?.eventType === 'command_ack'
    );
    expect(auditCall?.[0]).toMatchObject({ status: 'failure', severity: 'warning' });
  });

  it('does NOT broadcast a failure when the dispatcher REJECTS the failure report', async () => {
    const dash = await connectDashboard();
    const agent = await connectAgent('fail-reject-agent');
    let broadcastSeen = false;
    dash.on('agent:command:failed', () => { broadcastSeen = true; });

    failMock.mockReturnValueOnce(false);
    agent.emit('agent:command_failed', { actionId: 'action-f-rejected' });

    await waitFor(() => (auditLogger.log as jest.Mock).mock.calls.some(
      (call) => call[0]?.eventType === 'command_failed' && call[0]?.details?.accepted === false
    ));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(broadcastSeen).toBe(false);
  });

  it('ignores ack/failure events from a socket that no longer owns the agent connection (superseded)', async () => {
    const agent = await connectAgent('ack-superseded-agent');

    // Force the ownership check to report "not the current socket" — exactly
    // the state a superseded connection is in after a newer authenticated
    // registration replaced it. If the guard were missing, the dispatcher
    // would be consulted anyway and the failure would be observable here.
    const ownershipSpy = jest.spyOn(gateway as any, 'isCurrentAgentSocket').mockReturnValue(false);
    try {
      agent.emit('agent:command_ack', { actionId: 'action-stale' });
      agent.emit('agent:command_failed', { actionId: 'action-stale-2' });
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(ackMock).not.toHaveBeenCalled();
      expect(failMock).not.toHaveBeenCalled();
      expect((auditLogger.log as jest.Mock).mock.calls.filter(
        (call) => call[0]?.eventType === 'command_ack' || call[0]?.eventType === 'command_failed'
      )).toHaveLength(0);
    } finally {
      ownershipSpy.mockRestore();
    }
  });
});
