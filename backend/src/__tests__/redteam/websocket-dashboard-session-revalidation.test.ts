import { createServer, Server as HttpServer } from 'http';
import { io as SocketIOClient, Socket as ClientSocket } from 'socket.io-client';

const mockVerifyTokenAsyncDetailed = jest.fn();

jest.mock('../../middleware/auth.middleware', () => ({
  verifyTokenAsyncDetailed: mockVerifyTokenAsyncDetailed
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

jest.mock('../../security/agent-auth.service', () => ({
  __esModule: true,
  default: {
    verifyAgent: jest.fn(),
    updateLastSeen: jest.fn()
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

describe('AgentGateway dashboard session revalidation', () => {
  const originalInterval = process.env.WS_DASHBOARD_SESSION_REVALIDATE_MS;
  const PORT = 15109;
  let httpServer: HttpServer;
  let gateway: AgentGateway;
  let socket: ClientSocket | null = null;

  beforeAll(async () => {
    process.env.WS_DASHBOARD_SESSION_REVALIDATE_MS = '20';
    httpServer = createServer();
    gateway = new AgentGateway(httpServer);
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      httpServer.once('error', onError);
      httpServer.listen(PORT, () => {
        httpServer.off('error', onError);
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (originalInterval === undefined) {
      delete process.env.WS_DASHBOARD_SESSION_REVALIDATE_MS;
    } else {
      process.env.WS_DASHBOARD_SESSION_REVALIDATE_MS = originalInterval;
    }
    socket?.disconnect();
    socket?.io.close();
    socket?.removeAllListeners();
    await gateway.close();
    httpServer.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error: NodeJS.ErrnoException | undefined) => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
          reject(error);
          return;
        }
        resolve();
      });
    });
    expect(httpServer.listening).toBe(false);
  });

  afterEach(() => {
    socket?.disconnect();
    socket = null;
    mockVerifyTokenAsyncDetailed.mockReset();
  });

  it('disconnects an already-connected dashboard socket after the token is revoked', async () => {
    const user = {
      userId: 'dashboard-user-1',
      email: 'dashboard@example.com',
      username: 'dashboard',
      role: 'tenant_admin',
      tenantId: 'tenant-a'
    };
    mockVerifyTokenAsyncDetailed
      .mockResolvedValueOnce({ user })
      .mockResolvedValueOnce({ user: null, failureReason: 'blacklisted_token' });

    socket = SocketIOClient(`http://localhost:${PORT}`, {
      auth: { type: 'dashboard', token: 'token-that-will-be-revoked' },
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      timeout: 2000
    });

    await new Promise<void>((resolve, reject) => {
      socket!.once('connect', () => resolve());
      socket!.once('connect_error', reject);
    });

    const nativeWebSocket = (socket.io.engine.transport as any).ws;
    expect(nativeWebSocket).toBeDefined();
    const transportClosed = new Promise<void>((resolve) => {
      socket!.io.engine.once('close', () => resolve());
    });
    const nativeWebSocketClosed = new Promise<void>((resolve) => {
      if (nativeWebSocket.readyState === 3) {
        resolve();
        return;
      }
      nativeWebSocket.once('close', () => resolve());
    });
    const disconnectReason = await new Promise<string>((resolve) => {
      socket!.once('disconnect', (reason) => resolve(reason));
    });
    await transportClosed;
    await nativeWebSocketClosed;

    expect(disconnectReason).toBe('io server disconnect');
    expect(socket.io.engine.readyState).toBe('closed');
    expect(nativeWebSocket.readyState).toBe(3);
    expect(mockVerifyTokenAsyncDetailed).toHaveBeenCalledTimes(2);
  });
});
