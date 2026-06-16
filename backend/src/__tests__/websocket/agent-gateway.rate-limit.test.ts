/**
 * AgentGateway — per-agent-event rate limit (Sprint 5 Wave 2 · F5)
 *
 * These tests pin down the contract of the 8 agent inbound event handlers
 * (`agent:heartbeat`, `agent:traffic_stats`, `agent:threat`,
 * `agent:review_sample`, `agent:scan_result`, `agent:log`,
 * `agent:command_ack`, `agent:command_failed`) that — before this fix —
 * had NO rate limiting at all.
 *
 * The contract verified here is:
 *   1. EVERY one of the 8 handlers consults `socketRateLimitService.check`
 *      with the expected composite key (`agent-event:<agentId>:<event>`).
 *   2. When the limiter denies a request, the socket receives a
 *      `rate_limit_exceeded` frame containing the offending event name
 *      and the retry hint.
 *   3. When the limiter denies a request, a tamper-evident audit log
 *      row is written with `eventType: 'rate_limit_exceeded'` and the
 *      offending event name in the details.
 *   4. Per-event limits are different (heartbeat=100, traffic_stats=200,
 *      threat=30, scan_result=30, command_ack=30, command_failed=30,
 *      log=60, review_sample=60) so a single aggressive emitter cannot
 *      be drowned in a noise-floor of heartbeat-limit pings.
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

// Mock the socket rate limit service BEFORE importing AgentGateway so the
// gateway picks up the mocked module reference. We expose a jest.fn() for
// `check` that individual tests can override.
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
import { socketRateLimitService } from '../../services/socket-rate-limit.service';
import auditLogger from '../../security/audit-logger.service';

describe('AgentGateway per-agent-event rate limit (Sprint 5 Wave 2 · F5)', () => {
  let httpServer: HttpServer;
  let gateway: AgentGateway;
  const PORT = 3098;
  const sockets: ClientSocket[] = [];

  beforeAll((done) => {
    httpServer = createServer();
    gateway = new AgentGateway(httpServer);
    httpServer.listen(PORT, done);
  });

  afterAll((done) => {
    sockets.splice(0).forEach((socket) => {
      if (socket.connected) socket.disconnect();
    });
    gateway.close();
    httpServer.close(done);
  });

  afterEach(() => {
    jest.clearAllMocks();
    sockets.splice(0).forEach((socket) => {
      if (socket.connected) socket.disconnect();
    });
  });

  /**
   * Connect a fresh agent socket for the test. Resolves once the socket
   * has actually connected at the transport level (the test runtime
   * auto-authenticates the agent in the handshake, so `connect` is
   * sufficient). Callers can then emit agent:* events and the server
   * will route them through the per-agent handlers.
   */
  function connectAgent(agentId: string, tenantId = 'rl-tenant'): Promise<ClientSocket> {
    return new Promise<ClientSocket>((resolve, reject) => {
      const socket = SocketIOClient(`http://localhost:${PORT}`, {
        auth: { type: 'agent', agentId, tenantId }
      });
      sockets.push(socket);

      const timer = setTimeout(() => reject(new Error('agent connect timeout')), 5000);
      socket.once('connect', () => {
        clearTimeout(timer);
        // small extra wait so the server-side `agent:authenticated` ack
        // and handler setup finish before the test starts emitting
        setTimeout(() => resolve(socket), 50);
      });
      socket.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Force the next `socketRateLimitService.check` call to return
   * `allowed: false`. This is what the production code path needs to
   * observe to take the "rejected" branch.
   */
  function mockRateLimitDenied(remaining = 0): void {
    const resetAtMs = Date.now() + 60_000;
    checkMock.mockResolvedValueOnce({
      allowed: false,
      remaining,
      resetAt: new Date(resetAtMs).toISOString(),
      resetAtMs,
      decisionSource: 'memory-fallback',
      riskFlags: []
    });
  }

  function mockRateLimitAllowed(limit = 100): void {
    const resetAtMs = Date.now() + 60_000;
    checkMock.mockResolvedValueOnce({
      allowed: true,
      remaining: limit - 1,
      resetAt: new Date(resetAtMs).toISOString(),
      resetAtMs,
      decisionSource: 'memory-fallback',
      riskFlags: []
    });
  }

  // ---------------------------------------------------------------------
  // 1. All 8 agent inbound events are rate-limited
  //
  // We exercise at least three different handlers and assert that the
  // limiter is invoked with the correct composite key. Together with the
  // code path inspection this gives us confidence the other five are
  // wired the same way (each handler now has the identical guard block).
  // ---------------------------------------------------------------------
  it('rate-limits agent:heartbeat via the per-agent-event key', async () => {
    checkMock.mockResolvedValueOnce({
      allowed: true,
      remaining: 99,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
      resetAtMs: Date.now() + 60_000,
      decisionSource: 'memory-fallback',
      riskFlags: []
    });

    const agent = await connectAgent('rl-heartbeat-agent');
    // connectAgent already waited for `connect`; nothing more to do here

    agent.emit('agent:heartbeat', {
      agentId: 'rl-heartbeat-agent',
      hostname: 'h',
      platform: 'linux',
      uptime: 1,
      cpuUsage: 1,
      memoryUsage: 1,
      lastHeartbeat: new Date().toISOString(),
      isOnline: true
    });

    // Give the async handler time to call the rate limiter
    await new Promise((resolve) => setTimeout(resolve, 100));

    const call = checkMock.mock.calls.find(
      ([arg]) => arg?.key === 'agent-event:rl-heartbeat-agent:agent:heartbeat'
    );
    expect(call).toBeDefined();
    expect(call?.[0]).toMatchObject({
      key: 'agent-event:rl-heartbeat-agent:agent:heartbeat',
      limit: 100,
      windowMs: 60_000,
      protocol: 'ws-agent'
    });
  });

  it('rate-limits agent:traffic_stats with a higher budget (200/min)', async () => {
    const agent = await connectAgent('rl-traffic-agent');
    // connectAgent already waited for `connect`; nothing more to do here

    checkMock.mockResolvedValueOnce({
      allowed: true,
      remaining: 199,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
      resetAtMs: Date.now() + 60_000,
      decisionSource: 'memory-fallback',
      riskFlags: []
    });

    agent.emit('agent:traffic_stats', {
      agentId: 'rl-traffic-agent',
      stats: { packetsProcessed: 1, packetsAllowed: 1, packetsBlocked: 0, activeFlows: [] },
      timestamp: new Date().toISOString()
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const call = checkMock.mock.calls.find(
      ([arg]) => arg?.key === 'agent-event:rl-traffic-agent:agent:traffic_stats'
    );
    expect(call).toBeDefined();
    expect(call?.[0]).toMatchObject({
      key: 'agent-event:rl-traffic-agent:agent:traffic_stats',
      limit: 200,
      windowMs: 60_000
    });
  });

  it('rate-limits agent:threat with a strict budget (30/min)', async () => {
    const agent = await connectAgent('rl-threat-agent');
    // connectAgent already waited for `connect`; nothing more to do here

    checkMock.mockResolvedValueOnce({
      allowed: true,
      remaining: 29,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
      resetAtMs: Date.now() + 60_000,
      decisionSource: 'memory-fallback',
      riskFlags: []
    });

    agent.emit('agent:threat', {
      threat: {
        type: 'sql_injection',
        severity: 'critical',
        sourceIP: '10.0.0.1',
        description: 'test threat'
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    const call = checkMock.mock.calls.find(
      ([arg]) => arg?.key === 'agent-event:rl-threat-agent:agent:threat'
    );
    expect(call).toBeDefined();
    expect(call?.[0]).toMatchObject({
      key: 'agent-event:rl-threat-agent:agent:threat',
      limit: 30
    });
  });

  it('rate-limits agent:scan_result / agent:log / agent:review_sample / agent:command_ack / agent:command_failed', async () => {
    // The remaining 5 handlers are exercised by the same guard block. We
    // verify their composite keys all pass through the limiter; if a
    // future refactor regresses any of them this assertion will catch it.
    const agent = await connectAgent('rl-misc-agent');
    // connectAgent already waited for `connect`; nothing more to do here

    checkMock.mockResolvedValue({
      allowed: true,
      remaining: 50,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
      resetAtMs: Date.now() + 60_000,
      decisionSource: 'memory-fallback',
      riskFlags: []
    });

    agent.emit('agent:scan_result', { scanId: 's1' });
    agent.emit('agent:log', { level: 'info', message: 'm' });
    agent.emit('agent:review_sample', { sample: { requestId: 'r1', sourceIp: '1.1.1.1', path: '/', riskScore: 0.1, matchedRuleIds: [] } });
    agent.emit('agent:command_ack', { actionId: 'a1' });
    agent.emit('agent:command_failed', { actionId: 'a2' });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = ['agent:scan_result', 'agent:log', 'agent:review_sample', 'agent:command_ack', 'agent:command_failed'];
    for (const ev of events) {
      const call = checkMock.mock.calls.find(([arg]) => arg?.key === `agent-event:rl-misc-agent:${ev}`);
      expect(call).toBeDefined();
    }
  });

  // ---------------------------------------------------------------------
  // 2. On rate-limit denial, the agent receives a `rate_limit_exceeded`
  //    frame containing the offending event name and a retry hint.
  // ---------------------------------------------------------------------
  it('emits rate_limit_exceeded to the agent when the limiter denies the request', async () => {
    const agent = await connectAgent('rl-deny-agent');
    // connectAgent already waited for `connect`; nothing more to do here

    const resetAtMs = Date.now() + 42_000;
    checkMock.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(resetAtMs).toISOString(),
      resetAtMs,
      decisionSource: 'memory-fallback',
      riskFlags: []
    });

    const rateLimitPromise = new Promise<any>((resolve) => {
      agent.once('rate_limit_exceeded', (payload) => resolve(payload));
    });

    agent.emit('agent:heartbeat', {
      agentId: 'rl-deny-agent',
      hostname: 'h',
      platform: 'linux',
      uptime: 1,
      cpuUsage: 1,
      memoryUsage: 1,
      lastHeartbeat: new Date().toISOString(),
      isOnline: true
    });

    const payload = await Promise.race([
      rateLimitPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('no rate_limit_exceeded frame received')), 2000))
    ]);

    expect(payload).toMatchObject({
      event: 'agent:heartbeat',
      limit: 100,
      windowMs: 60_000
    });
    expect(typeof payload.retryAfterMs).toBe('number');
    expect(payload.retryAfterMs).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------
  // 3. On rate-limit denial, an audit log row is written with the right
  //    eventType / actor / event name. This is the only signal an
  //    operator has to detect an agent misbehaving in production.
  // ---------------------------------------------------------------------
  it('records an audit log entry when the agent event rate limit is exceeded', async () => {
    const agent = await connectAgent('rl-audit-agent');
    // connectAgent already waited for `connect`; nothing more to do here

    (auditLogger.log as jest.Mock).mockClear();

    const resetAtMs = Date.now() + 30_000;
    checkMock.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date(resetAtMs).toISOString(),
      resetAtMs,
      decisionSource: 'memory-fallback',
      riskFlags: []
    });

    agent.emit('agent:traffic_stats', {
      agentId: 'rl-audit-agent',
      stats: { packetsProcessed: 1, packetsAllowed: 1, packetsBlocked: 0, activeFlows: [] },
      timestamp: new Date().toISOString()
    });

    // Poll for the audit log entry — it's written from the async handler
    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const tick = setInterval(() => {
        const calls = (auditLogger.log as jest.Mock).mock.calls.map(([arg]) => arg);
        const hit = calls.find((arg) => arg?.eventType === 'rate_limit_exceeded' && arg?.details?.event === 'agent:traffic_stats');
        if (hit) {
          clearInterval(tick);
          expect(hit).toMatchObject({
            eventType: 'rate_limit_exceeded',
            category: 'agent',
            severity: 'warning',
            status: 'failure',
            actor: { type: 'agent', id: 'rl-audit-agent' },
            action: 'agent_event_rate_limit',
            details: expect.objectContaining({
              event: 'agent:traffic_stats',
              limit: 200,
              windowMs: 60_000
            })
          });
          resolve();
        } else if (Date.now() - startedAt > 2000) {
          clearInterval(tick);
          reject(new Error('audit log not written within 2s'));
        }
      }, 25);
    });
  });

  // ---------------------------------------------------------------------
  // 4. Different event types use different limits. The same limiter
  //    invocation that allows N=200/min traffic_stats must allow only
  //    N=30/min threats. We assert this by inspecting the `limit` field
  //    the handler forwards to the limiter.
  // ---------------------------------------------------------------------
  it('uses different limits for different event types', async () => {
    const agent = await connectAgent('rl-limits-agent');
    // connectAgent already waited for `connect`; nothing more to do here

    checkMock.mockResolvedValue({
      allowed: true,
      remaining: 100,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
      resetAtMs: Date.now() + 60_000,
      decisionSource: 'memory-fallback',
      riskFlags: []
    });

    const eventLimits: Array<[string, number, Record<string, any>?]> = [
      ['agent:heartbeat', 100, {
        agentId: 'rl-limits-agent',
        hostname: 'h',
        platform: 'linux',
        uptime: 1,
        cpuUsage: 1,
        memoryUsage: 1,
        lastHeartbeat: new Date().toISOString(),
        isOnline: true
      }],
      ['agent:traffic_stats', 200, {
        agentId: 'rl-limits-agent',
        stats: { packetsProcessed: 1, activeFlows: [] },
        timestamp: new Date().toISOString()
      }],
      ['agent:threat', 30, {
        threat: { type: 'x', severity: 'high', sourceIP: '1.1.1.1', description: 'd' }
      }],
      ['agent:scan_result', 30, { scanId: 's' }],
      ['agent:log', 60, { level: 'info', message: 'm' }],
      ['agent:review_sample', 60, {
        sample: { requestId: 'r', sourceIp: '1.1.1.1', path: '/', riskScore: 0.1, matchedRuleIds: [] }
      }],
      ['agent:command_ack', 30, { actionId: 'a' }],
      ['agent:command_failed', 30, { actionId: 'b' }]
    ];

    for (const [event, expectedLimit, payload] of eventLimits) {
      agent.emit(event, payload);
      // tiny pause to let the limiter call resolve before the next emit
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    for (const [event, expectedLimit] of eventLimits) {
      const call = checkMock.mock.calls.find(
        ([arg]) => arg?.key === `agent-event:rl-limits-agent:${event}`
      );
      expect(call).toBeDefined();
      expect(call?.[0]?.limit).toBe(expectedLimit);
    }
  });
});
