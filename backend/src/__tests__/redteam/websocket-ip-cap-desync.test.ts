/**
 * WebSocket IP Cap Desync — Redteam Test
 *
 * Scenario: A malicious client or buggy code removes a socket from the
 * `agents` Map without triggering the disconnect handler. If the ipSet
 * is not also cleaned up, that IP is permanently blocked — even after
 * all legitimate sockets have disconnected.
 *
 * Test sequence (per task spec):
 *   1. Connect 5 sockets from the same IP (localhost) — all succeed
 *   2. Disconnect 4 of them — ipSet should have 1 entry remaining
 *   3. Connect 1 more — should succeed (slot freed by step 2)
 *   4. Connect 2 more — one succeeds, one is rejected (cap = 10)
 *
 * This is a REDTEAM test because it probes the boundary between the
 * in-process ipConnectionCounts Map and the socket lifecycle. A bug
 * would allow a permanent IP block that cannot be cleared without
 * restarting the process.
 */

import { createServer, Server as HttpServer } from 'http';
import { io as SocketIOClient, Socket as ClientSocket } from 'socket.io-client';
import { AgentGateway } from '../../websocket/agent-gateway';

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
  __esModule: true,
  socketRateLimitService: {
    check: jest.fn().mockResolvedValue({
      allowed: true,
      remaining: 100,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
      resetAtMs: Date.now() + 60_000,
      decisionSource: 'memory-fallback',
      riskFlags: []
    }),
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

jest.mock('../../services/fastpath-client.service', () => ({
  fastpathClientService: {
    checkSocket: jest.fn().mockResolvedValue(null),
    check: jest.fn().mockResolvedValue(null)
  }
}));

const PORT = 15108;
const MAX_CAP = 10;

describe('AgentGateway IP cap desync (redteam)', () => {
  let httpServer: HttpServer;
  let gateway: AgentGateway;

  beforeAll((done) => {
    httpServer = createServer();
    gateway = new AgentGateway(httpServer);
    httpServer.listen(PORT, done);
  });

  afterAll(async () => {
    await gateway.close();
  });

  // -------------------------------------------------------------------------
  // Helper: connect one agent socket and wait for it to be ready.
  // -------------------------------------------------------------------------
  function connectAgent(agentId: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const socket = SocketIOClient(`http://localhost:${PORT}`, {
        auth: { type: 'agent', agentId },
        forceNew: true,
        reconnection: false,
        timeout: 5000
      });
      const timeout = setTimeout(() => reject(new Error(`connect timeout for ${agentId}`)), 5000);
      socket.on('connect', () => {
        clearTimeout(timeout);
        resolve(socket);
      });
      socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Helper: disconnect a socket and wait for the event to propagate.
  // -------------------------------------------------------------------------
  function disconnectSocket(socket: ClientSocket): Promise<void> {
    return new Promise((resolve) => {
      socket.once('disconnect', () => resolve());
      socket.disconnect();
    });
  }

  // -------------------------------------------------------------------------
  // Helper: forcibly disconnect all active sockets on the server.
  // Used to ensure a clean slate between tests.
  // -------------------------------------------------------------------------
  async function forceCleanupAllSockets(): Promise<void> {
    const io = (gateway as any).io;
    for (const [_socketId, socket] of io.sockets.sockets) {
      socket.disconnect(true);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  // -------------------------------------------------------------------------
  // REDTEAM TEST 1: Main scenario from task spec
  // -------------------------------------------------------------------------
  it(
    'REDTEAM: IP stays unblocked after partial disconnect; ' +
    '11th simultaneous connection is rejected',
    async () => {
      // Step 1: Connect 5 agent sockets — all succeed (cap = 10).
      const s1 = await connectAgent('rt-a1');
      const s2 = await connectAgent('rt-a2');
      const s3 = await connectAgent('rt-a3');
      const s4 = await connectAgent('rt-a4');
      const s5 = await connectAgent('rt-a5');

      const ipMap = (gateway as any).ipConnectionCounts as Map<string, Set<string>>;
      const firstIp = Array.from(ipMap.keys())[0];

      expect(s1.connected && s2.connected && s3.connected && s4.connected && s5.connected).toBe(true);
      expect(ipMap.get(firstIp)?.size).toBe(5);

      // Step 2: Disconnect 4 of them. Only 1 socket (s5) remains.
      await Promise.all([
        disconnectSocket(s1),
        disconnectSocket(s2),
        disconnectSocket(s3),
        disconnectSocket(s4)
      ]);
      await new Promise((r) => setTimeout(r, 200));
      expect(ipMap.get(firstIp)?.size).toBe(1);

      // Step 3: Connect 1 more — should succeed (slot was freed).
      const s6 = await connectAgent('rt-a6');
      expect(s6.connected).toBe(true);
      expect(ipMap.get(firstIp)?.size).toBe(2);

      // Step 4: Disconnect s6 so we can rebuild to exactly 9, then test 10th/11th.
      await disconnectSocket(s6);
      await new Promise((r) => setTimeout(r, 200));
      expect(ipMap.get(firstIp)?.size).toBe(1);

      // Connect 8 more to reach 9 total (s5 + 8 new).
      const extras = await Promise.all([
        connectAgent('rt-b1'), connectAgent('rt-b2'), connectAgent('rt-b3'),
        connectAgent('rt-b4'), connectAgent('rt-b5'), connectAgent('rt-b6'),
        connectAgent('rt-b7'), connectAgent('rt-b8')
      ]);
      expect(ipMap.get(firstIp)?.size).toBe(9);

      // 10th succeeds.
      const s10 = await connectAgent('rt-c1');
      expect(s10.connected).toBe(true);
      expect(ipMap.get(firstIp)?.size).toBe(10);

      // 11th is rejected (cap = 10).  The server emits a WARN log and
      // disconnects the socket before auth, so the client may timeout
      // rather than throw a connect_error.  We tolerate both outcomes —
      // what matters is that ipSet.size does NOT grow beyond 10.
      let eleventhTimedOut = false;
      try {
        const s11 = await connectAgent('rt-c2');
        // If it somehow connected despite the cap, the server would have
        // rejected it in the auth middleware before adding to ipSet.
        // s11.connected could be true only if auth passed (cap was not checked).
        if (!s11.connected) eleventhTimedOut = true;
      } catch {
        eleventhTimedOut = true; // connect_error = rejected by cap
      }
      expect(eleventhTimedOut).toBe(true);
      expect(ipMap.get(firstIp)?.size).toBe(10); // Cap still enforced

      // Cleanup: disconnect all remaining sockets for this test.
      for (const s of [s5, s10, ...extras]) {
        if (s.connected) s.disconnect();
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  );

  // -------------------------------------------------------------------------
  // Sanity: after all sockets disconnect, ipSet is empty.
  // -------------------------------------------------------------------------
  it('ipSet is empty after all sockets disconnect', async () => {
    await forceCleanupAllSockets();

    const ipMap = (gateway as any).ipConnectionCounts as Map<string, Set<string>>;
    expect(ipMap.size).toBe(0); // Already clean from forceCleanup

    // Connect 3 sockets.
    const [a, b, c] = await Promise.all([
      connectAgent('rt-d1'),
      connectAgent('rt-d2'),
      connectAgent('rt-d3')
    ]);
    const firstIp = Array.from(ipMap.keys())[0];
    expect(ipMap.get(firstIp)?.size).toBe(3);

    // Disconnect them all.
    await Promise.all([disconnectSocket(a), disconnectSocket(b), disconnectSocket(c)]);
    await new Promise((r) => setTimeout(r, 200));

    expect(ipMap.size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // REDTEAM TEST 2: Desync injection — removing from ipSet without
  // triggering disconnect must NOT permanently block the IP.
  // -------------------------------------------------------------------------
  it(
    'REDTEAM: removing socketId from ipSet then disconnecting ' +
    'does NOT leave IP permanently blocked',
    async () => {
      await forceCleanupAllSockets();

      const ipMap = (gateway as any).ipConnectionCounts as Map<string, Set<string>>;

      const s1 = await connectAgent('rt-e1');
      const s2 = await connectAgent('rt-e2');

      const firstIp = Array.from(ipMap.keys())[0]!;
      expect(ipMap.get(firstIp)?.size).toBe(2);

      // SIMULATE DESYNC: remove s1's id from ipSet WITHOUT calling disconnect.
      // This models the bug where agents Map is cleared but ipSet is not.
      ipMap.get(firstIp)?.delete(s1.id!);
      expect(ipMap.get(firstIp)?.size).toBe(1); // Now shows 1 even though s1 is still connected

      // Disconnect s1 (its id is already gone from ipSet).
      // The disconnect handler must NOT crash or leave IP blocked.
      await disconnectSocket(s1);
      await new Promise((r) => setTimeout(r, 200));

      // IP should have exactly 1 entry (s2) remaining.
      expect(ipMap.get(firstIp)?.size).toBe(1);

      // The IP must NOT be blocked — we should be able to connect again.
      const s3 = await connectAgent('rt-e3');
      expect(s3.connected).toBe(true);
      expect(ipMap.get(firstIp)?.size).toBe(2);

      // Cleanup.
      for (const s of [s2, s3]) { if (s.connected) s.disconnect(); }
      await new Promise((r) => setTimeout(r, 200));
    }
  );
});
