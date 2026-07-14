import express from 'express';
import request from 'supertest';
import statsRouter from '../../api/routes/stats.routes';
import dashboardRouter from '../../api/routes/dashboard.routes';
import agentsRouter, { setAgentGateway } from '../../api/routes/agents.routes';
import devicesRouter, { registerDevice } from '../../api/routes/devices.routes';
import { detectionPipelineService } from '../../services/detection-pipeline.service';
import { securityOperationsService } from '../../services/security-operations.service';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'contract-user', email: 'contract@example.com', role: 'admin', tenantId: 'tenant-contract' };
    req.tenantContext = { tenantId: 'tenant-contract' };
    next();
  }),
  optionalAuth: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'contract-user', email: 'contract@example.com', role: 'admin', tenantId: 'tenant-contract' };
    req.tenantContext = { tenantId: 'tenant-contract' };
    next();
  }),
  requireRole: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../api/routes/ai-system.routes', () => ({
  getTrafficStats: jest.fn().mockReturnValue({
    packetsProcessed: 100,
    packetsBlocked: 2,
    packetsAllowed: 98,
    activeFlows: [],
    bytesProcessed: 2048,
    threats: new Map(),
  }),
  getAgentGateway: jest.fn().mockReturnValue(null),
  getAgentSystem: jest.fn().mockReturnValue(null),
  getAlerts: jest.fn().mockResolvedValue([]),
  getDeviceList: jest.fn().mockReturnValue([]),
}));

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    upsertAsset: jest.fn().mockReturnValue({ assetId: 'contract-agent-asset' }),
    syncSignalFinding: jest.fn(),
    recordActionRun: jest.fn(),
    getOperationalContextForExternalRefs: jest.fn().mockReturnValue({ alerts: [], findings: [], actions: [], scanRuns: [] }),
    getDashboardSummaryView: jest.fn().mockResolvedValue({
      openCriticalFindings: 0,
      highRiskFindings: 0,
      activeAlerts: 0,
      runningScans: 0,
      queuedScans: 0,
      pendingActions: 0,
      failedValidations: 0,
      assetsAtRisk: 0,
      observedSessions: 0,
      trafficAnomalies: 0,
      recentActions: [],
      recentValidations: [],
    }),
    summarizeThreatsView: jest.fn().mockResolvedValue([]),
    listTrafficSessionsView: jest.fn().mockResolvedValue([]),
  }
}));

jest.mock('../../services/detection-pipeline.service', () => ({
  detectionPipelineService: {
    getSummary: jest.fn()
  }
}));

jest.mock('../../services/scanner-task.service', () => ({
  scannerTaskService: {
    createTask: jest.fn().mockResolvedValue({ id: 'contract-task' })
  }
}));

jest.mock('../../services/command-dispatcher.service', () => ({
  commandDispatcherService: {
    setDeviceAdapter: jest.fn(),
    setAgentGateway: jest.fn(),
    dispatchAgentCommand: jest.fn().mockResolvedValue({ success: true, actionId: 'contract-action', status: 'queued' })
  }
}));

jest.mock('../../services/alert-state.service', () => ({
  getAlerts: jest.fn(() => [])
}));

jest.mock('../../utils/system-stats', () => ({
  SystemStats: {
    getInstance: jest.fn().mockReturnValue({
      cpuUsage: 11,
      memoryUsage: 22,
      diskUsage: 33,
      networkUsageMb: 1.5,
    }),
  }
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

jest.mock('../../security/audit-logger.service', () => ({
  __esModule: true,
  default: { log: jest.fn().mockResolvedValue(undefined) }
}));

const assertNoSensitiveFields = (body: unknown) => {
  const serialized = JSON.stringify(body);
  expect(serialized).not.toMatch(/password|secret|authorization|apiKey|hash|AdminLocal!2026|JWT_SECRET|AUDIT_LOG_SECRET/i);
};

const assertEnvelope = (body: any) => {
  expect(body).toHaveProperty('success');
  expect(typeof body.success).toBe('boolean');
  if (body.success === false) {
    expect(body.error).toBeTruthy();
  }
  assertNoSensitiveFields(body);
};

describe('console API contract shape', () => {
  const statsApp = express().use('/api/stats', statsRouter);
  const dashboardApp = express().use('/api/dashboard', dashboardRouter);
  const agentsApp = express().use(express.json()).use('/api/agents', agentsRouter);
  const devicesApp = express().use(express.json()).use('/api/devices', devicesRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    (detectionPipelineService.getSummary as jest.Mock).mockResolvedValue({ rules: [], stats: {} });
    setAgentGateway({
      getAgentList: jest.fn(() => [{
        agentId: 'contract-agent-1',
        hostname: 'contract-host',
        platform: 'linux',
        isOnline: true,
        lastHeartbeat: new Date().toISOString(),
        status: { cpuUsage: 10, memoryUsage: 20, uptime: 30 },
      }]),
      getAgent: jest.fn(),
      sendCommandToAgent: jest.fn(),
      getOnlineCount: jest.fn(() => 1),
    } as any);
    registerDevice({
      deviceId: 'contract-device-1',
      version: '1.0.0',
      chipModel: 'ESP32-WROOM-32',
      flashSize: 4096,
      freeHeap: 100000,
      sdkVersion: '4.4.0',
      mode: 'online',
    });
  });

  it('keeps dashboard read-model stats raw but clean', async () => {
    const response = await request(statsApp).get('/api/stats');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty('totalRequests');
    expect(response.body.data).toHaveProperty('history');
    expect(response.body.data).not.toHaveProperty('success');
    expect(response.body.data.totalRequests).toBe(0);
    expect(response.body.data.activeConnections).toBe(0);
    expect(response.body.data.successRate).toBe(0);
    expect(response.body.data.telemetryAvailable).toBe(false);
    expect(response.body.data.cpuUsage).toBe(0);
    expect(response.body.data.attackOrigins).toEqual([]);
    expect(securityOperationsService.getDashboardSummaryView).toHaveBeenCalledWith('tenant-contract');
    expect(detectionPipelineService.getSummary).toHaveBeenCalledWith('tenant-contract');
    assertNoSensitiveFields(response.body);
  });

  it('does not expose platform device or agent counts in tenant badges', async () => {
    const response = await request(statsApp).get('/api/stats/badges');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.devices).toBe(0);
    expect(response.body.data.agents).toBe(0);
  });

  it('keeps dashboard rules summary in the API envelope', async () => {
    const response = await request(dashboardApp).get('/api/dashboard/rules/summary');
    expect(response.status).toBe(200);
    assertEnvelope(response.body);
    expect(response.body.data).toHaveProperty('rules');
  });

  it('keeps agents list in the API envelope with array data', async () => {
    const response = await request(agentsApp).get('/api/agents');
    expect(response.status).toBe(200);
    assertEnvelope(response.body);
    expect(Array.isArray(response.body.agents)).toBe(true);
  });

  it('keeps devices list in the API envelope with array data', async () => {
    const response = await request(devicesApp).get('/api/devices');
    expect(response.status).toBe(200);
    assertEnvelope(response.body);
    expect(Array.isArray(response.body.devices)).toBe(true);
  });
});
