/**
 * Agents Routes Tests
 *
 * Tests for agent management API endpoints
 */

import request from 'supertest';
import express from 'express';
import agentsRouter, { setAgentGateway } from '../../api/routes/agents.routes';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { getAlerts } from '../../services/alert-state.service';
import { commandDispatcherService } from '../../services/command-dispatcher.service';

// Mock dependencies
jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = {
      userId: 'test-user',
      email: 'test@example.com',
      role: 'admin',
      tenantId: 'tenant-001'
    };
    next();
  }),
  requireRole: jest.fn(() => (req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../services/alert-state.service', () => ({
  getAlerts: jest.fn(() => [
    { id: '1', type: 'security', title: 'SQL Injection', severity: 'critical', source: '192.168.1.1', timestamp: new Date().toISOString() },
    { id: '2', type: 'security', title: 'XSS Attempt', severity: 'high', source: '192.168.1.2', timestamp: new Date().toISOString() }
  ])
}));

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    upsertAsset: jest.fn().mockReturnValue({ assetId: 'agent-asset-1' }),
    syncSignalFinding: jest.fn(),
    getOperationalContextForExternalRefs: jest.fn().mockReturnValue({
      alerts: [],
      findings: [],
      actions: [],
      scanRuns: []
    }),
    recordActionRun: jest.fn()
  }
}));

jest.mock('../../services/scanner-task.service', () => ({
  scannerTaskService: {
    createTask: jest.fn().mockResolvedValue({ id: 'task-001' })
  }
}));

jest.mock('../../services/command-dispatcher.service', () => ({
  commandDispatcherService: {
    setAgentGateway: jest.fn(),
    dispatchAgentCommand: jest.fn().mockResolvedValue({
      success: true,
      actionId: 'action-001',
      status: 'queued',
      message: 'backend.command_dispatched'
    })
  }
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  }
}));

jest.mock('../../security/audit-logger.service', () => ({
  __esModule: true,
  default: {
    log: jest.fn().mockResolvedValue(undefined)
  }
}));

describe('Agents Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentsRouter);

  const mockAgentGateway = {
    getAgentList: jest.fn(() => [
      {
        agentId: 'agent-001',
        hostname: 'server-1',
        platform: 'linux',
        tenantId: 'tenant-001',
        isOnline: true,
        lastHeartbeat: new Date().toISOString(),
        status: { cpuUsage: 25.5, memoryUsage: 60, uptime: 3600 }
      },
      {
        agentId: 'agent-002',
        hostname: 'server-2',
        platform: 'linux',
        tenantId: 'tenant-001',
        isOnline: false,
        lastHeartbeat: new Date().toISOString(),
        status: null
      },
      {
        agentId: 'agent-foreign',
        hostname: 'foreign-server',
        platform: 'linux',
        tenantId: 'tenant-002',
        isOnline: true,
        lastHeartbeat: new Date().toISOString(),
        status: { cpuUsage: 99, memoryUsage: 99, uptime: 9999 }
      }
    ]),
    getAgent: jest.fn((id: string) => {
      if (id === 'agent-001') {
        return {
          agentId: 'agent-001',
          hostname: 'server-1',
          platform: 'linux',
          tenantId: 'tenant-001',
          isOnline: true,
          lastHeartbeat: new Date().toISOString(),
          status: { cpuUsage: 25.5, memoryUsage: 60, uptime: 3600 }
        };
      }
      if (id === 'agent-foreign') {
        return {
          agentId: 'agent-foreign',
          hostname: 'foreign-server',
          platform: 'linux',
          tenantId: 'tenant-002',
          isOnline: true,
          lastHeartbeat: new Date().toISOString(),
          status: { cpuUsage: 99, memoryUsage: 99, uptime: 9999 }
        };
      }
      return null;
    }),
    sendCommandToAgent: jest.fn((id: string, command: any) => {
      return id === 'agent-001';
    }),
    getOnlineCount: jest.fn(() => 1)
  };

  beforeEach(() => {
    setAgentGateway(mockAgentGateway);
    jest.clearAllMocks();
  });

  describe('GET /api/agents', () => {
    it('should return list of agents', async () => {
      const response = await request(app).get('/api/agents');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.agents).toBeDefined();
      expect(Array.isArray(response.body.agents)).toBe(true);
      expect(response.body.agents.map((agent: any) => agent.agentId)).toEqual(['agent-001', 'agent-002']);
      expect(response.body.agents.every((agent: any) => agent.tenantId === 'tenant-001')).toBe(true);
    });

    it('should return 503 if gateway not available', async () => {
      setAgentGateway(null);

      const response = await request(app).get('/api/agents');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('backend.agent_gateway_not_available');
    });
  });

  describe('GET /api/agents/threats/recent', () => {
    it('should return recent threats', async () => {
      const response = await request(app).get('/api/agents/threats/recent');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.threats)).toBe(true);
      expect(getAlerts).toHaveBeenCalledWith('tenant-001');
    });

    it('should respect limit parameter', async () => {
      const response = await request(app).get('/api/agents/threats/recent?limit=1');

      expect(response.status).toBe(200);
      expect(response.body.threats.length).toBeLessThanOrEqual(1);
    });
  });

  describe('POST /api/agents/:id/scan', () => {
    it('should send scan command to agent', async () => {
      const response = await request(app).post('/api/agents/agent-001/scan');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('backend.scan_command_sent');
    });

    it('should return 404 for non-existent agent', async () => {
      const response = await request(app).post('/api/agents/non-existent/scan');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('backend.agent_not_found_or_offline');
    });

    it('should reject a scan targeting another tenant agent before dispatch', async () => {
      const response = await request(app).post('/api/agents/agent-foreign/scan');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('backend.agent_not_found_or_offline');
      expect(commandDispatcherService.dispatchAgentCommand).not.toHaveBeenCalled();
    });

    it('should return 503 if gateway not available', async () => {
      setAgentGateway(null);

      const response = await request(app).post('/api/agents/agent-001/scan');

      expect(response.status).toBe(503);
    });
  });

  describe('POST /api/agents/:id/block', () => {
    it('should send block IP command to agent', async () => {
      const response = await request(app)
        .post('/api/agents/agent-001/block')
        .send({ ip: '192.168.1.100', duration: 3600 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 400 if IP is missing', async () => {
      const response = await request(app)
        .post('/api/agents/agent-001/block')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('backend.ip_address_required');
    });

    it('should return 404 for non-existent agent', async () => {
      const response = await request(app)
        .post('/api/agents/non-existent/block')
        .send({ ip: '192.168.1.100' });

      expect(response.status).toBe(404);
      expect(commandDispatcherService.dispatchAgentCommand).not.toHaveBeenCalled();
    });

    it('should reject a block command targeting another tenant agent', async () => {
      const response = await request(app)
        .post('/api/agents/agent-foreign/block')
        .send({ ip: '192.168.1.100' });

      expect(response.status).toBe(404);
      expect(commandDispatcherService.dispatchAgentCommand).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/agents/:id/unblock', () => {
    it('should send unblock IP command to agent', async () => {
      const response = await request(app)
        .post('/api/agents/agent-001/unblock')
        .send({ ip: '192.168.1.100' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 400 if IP is missing', async () => {
      const response = await request(app)
        .post('/api/agents/agent-001/unblock')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('backend.ip_address_required');
    });

    it('should reject an unblock command targeting another tenant agent', async () => {
      const response = await request(app)
        .post('/api/agents/agent-foreign/unblock')
        .send({ ip: '192.168.1.100' });

      expect(response.status).toBe(404);
      expect(commandDispatcherService.dispatchAgentCommand).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/agents/stats', () => {
    it('should return agent statistics', async () => {
      const response = await request(app).get('/api/agents/stats');

      expect(response.status).toBe(200);
      expect(response.body.totalAgents).toBeDefined();
      expect(response.body.activeAgents).toBeDefined();
      expect(response.body.avgCpuUsage).toBeDefined();
      expect(response.body.avgMemoryUsage).toBeDefined();
      expect(response.body.totalAgents).toBe(2);
      expect(response.body.agents.map((agent: any) => agent.id)).toEqual(['agent-001', 'agent-002']);
    });

    it('should return 503 if gateway not available', async () => {
      setAgentGateway(null);

      const response = await request(app).get('/api/agents/stats');

      expect(response.status).toBe(503);
    });
  });

  describe('GET /api/agents/health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/api/agents/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBeDefined();
      expect(response.body.details).toBeDefined();
      expect(response.body.details['agent-foreign']).toBeUndefined();
    });
  });

  describe('GET /api/agents/stats/summary', () => {
    it('should return summary statistics', async () => {
      const response = await request(app).get('/api/agents/stats/summary');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.summary).toBeDefined();
      expect(response.body.summary.totalAgents).toBeDefined();
      expect(response.body.summary.onlineAgents).toBeDefined();
      expect(response.body.summary.totalAgents).toBe(2);
    });
  });

  describe('GET /api/agents/:id', () => {
    it('should return agent by ID', async () => {
      const response = await request(app).get('/api/agents/agent-001');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.agent).toBeDefined();
      expect(response.body.agent.agentId).toBe('agent-001');
    });

    it('should return 404 for non-existent agent', async () => {
      const response = await request(app).get('/api/agents/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('backend.agent_not_found');
    });

    it('should hide another tenant agent as not found', async () => {
      const response = await request(app).get('/api/agents/agent-foreign');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('backend.agent_not_found');
    });
  });
});
