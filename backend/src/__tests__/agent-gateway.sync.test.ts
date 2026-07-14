import { createServer, Server as HttpServer } from 'http';
import { io as SocketIOClient, Socket as ClientSocket } from 'socket.io-client';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-minimum-32-characters-long';

jest.mock('../services/detection-pipeline.service', () => ({
  detectionPipelineService: {
    listDynamicRules: jest.fn()
  }
}));

jest.mock('../security/audit-logger.service', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    logAgent: jest.fn(),
    logCommand: jest.fn(),
    logFirewall: jest.fn()
  }
}));

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

import { AgentGateway } from '../websocket/agent-gateway';
import { detectionPipelineService } from '../services/detection-pipeline.service';

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('AgentGateway rule sync', () => {
  let httpServer: HttpServer;
  let gateway: AgentGateway;
  const sockets: ClientSocket[] = [];
  const port = 3199;

  beforeAll((done) => {
    httpServer = createServer();
    gateway = new AgentGateway(httpServer);
    httpServer.listen(port, done);
  });

  afterAll(async () => {
    sockets.splice(0).forEach((socket) => {
      if (socket.connected) {
        socket.disconnect();
      }
    });
    await gateway.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
    sockets.splice(0).forEach((socket) => {
      if (socket.connected) {
        socket.disconnect();
      }
    });
  });

  it('broadcasts update_rules to three online agents in the same tenant', async () => {
    (detectionPipelineService.listDynamicRules as jest.Mock).mockResolvedValue([
      {
        ruleId: 'rule-1',
        tenantId: 'tenant-sync',
        name: 'Agent learned rule',
        scope: 'agent',
        action: 'block',
        priority: 820,
        severity: 'high',
        matcher: {
          keywordPatterns: ['malicious-fragment']
        },
        source: 'candidate',
        enabled: true,
        version: 1
      }
    ]);

    const receivedCommands = new Map<string, any[]>();
    const agentIds = ['agent-sync-1', 'agent-sync-2', 'agent-sync-3'];

    await Promise.all(agentIds.map((agentId) => new Promise<void>((resolve, reject) => {
      const socket = SocketIOClient(`http://localhost:${port}`, {
        auth: {
          type: 'agent',
          agentId,
          tenantId: 'tenant-sync'
        }
      });

      socket.on('connect_error', reject);
      socket.on('command', (command) => {
        const existing = receivedCommands.get(agentId) || [];
        existing.push(command);
        receivedCommands.set(agentId, existing);
      });
      socket.on('agent:authenticated', () => resolve());

      sockets.push(socket);
    })));

    await waitFor(() => Array.from(receivedCommands.values()).reduce((sum, commands) => sum + commands.length, 0) >= 3);
    receivedCommands.clear();

    const result = await gateway.syncTenantDetectionRules('tenant-sync');

    expect(result).toEqual({ attempted: 3, succeeded: 3 });
    await waitFor(() => agentIds.every((agentId) => (receivedCommands.get(agentId) || []).some((command) => command.type === 'update_rules')));

    for (const agentId of agentIds) {
      const command = (receivedCommands.get(agentId) || []).find((item) => item.type === 'update_rules');
      expect(command?.payload?.rules).toHaveLength(1);
      expect(command?.payload?.rules?.[0]?.ruleId).toBe('rule-1');
      expect(command?.metadata?.tenantId).toBe('tenant-sync');
    }
  });
});
