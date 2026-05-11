import express from 'express';
import request from 'supertest';
import configRouter from '../../api/routes/config.routes';
import { platformConfigService } from '../../services/platform-config.service';

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

jest.mock('../../services/platform-config.service', () => ({
  platformConfigService: {
    getConfig: jest.fn(),
    saveConfig: jest.fn(),
    listNotificationDeliveries: jest.fn()
  }
}));

jest.mock('../../security/audit-logger.service', () => ({
  __esModule: true,
  default: {
    log: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('../../services/notification-dispatcher.service', () => ({
  notificationDispatcherService: {
    testChannel: jest.fn()
  }
}));

describe('Config Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/config', configRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    (platformConfigService.getConfig as jest.Mock).mockResolvedValue({
      antiBot: { enabled: true, requestThreshold: 100, fastRequestThreshold: 10, blockDuration: 3600 },
      rateLimit: { requestsPerMinute: 60, windowSeconds: 60 },
      notifications: { enabled: true, dedupeWindowSeconds: 300, retryDelaysSeconds: [30], channels: [] },
      aiRouting: {
        mode: 'local_preferred',
        guardrailEndpointId: null,
        localEndpointId: null,
        localHotPathEndpointId: null,
        cloudEndpointId: null,
        fallbackAllowed: true,
        redactionEnabled: true
      },
      privacyMode: 'off',
      auditArchive: { bucket: 'audit', retentionDays: 30, objectLockRequired: true, verifyIntervalMinutes: 60 },
      fastpath: { enabled: true, baseUrl: 'http://fastpath:8081', transport: 'tcp', socketPath: null, timeoutMs: 1500, fallbackEnabled: true, trafficShadowEnabled: false, trafficShadowSampleRatePct: 10, trafficMaxBodyBytes: 65536, configCacheTtlMs: 30000 },
      detectionPipeline: { ruleFirstEnabled: true, aiEscalationMode: 'high_risk_allowed_only', classificationLevel: 'standard', blockingDiscussionTimeoutMs: 30000, hotPathRouteMode: 'local_only', asyncReviewEnabled: true, blockingReviewForHighRiskActions: true, enableHttpApi: true, enablePacketInterceptor: true, enableAgentAsyncReview: true, aiEscalationThreshold: 0.4, candidateMinConfidence: 0.85, learningMode: 'malicious_review_queue' },
      deploymentDefaults: { serverType: 'nginx', profileTemplates: {} },
      deviceGateway: { primaryPath: '/ws/device', aliases: [], syncMaskApiKeys: true, firmwareLocalHost: '192.168.4.1', wifiSSID: 'AetherGuard-Setup', localPort: 8080, firmwareChannel: 'stable', firmwareRetentionDays: 30, statusAliasEnabled: true },
      edgeAuto: {
        runtimeDefaults: {
          cpuCeilingPct: 1,
          sampleIntervalSec: 1,
          breachWindowSec: 30,
          recoveryWindowSec: 120,
          autoReadOnlyBypass: false
        },
        protocolDefaults: {
          modules: {
            mqtt: { relayEnabled: true }
          },
          legacy: {
            mqttRelayEnabled: true,
            mqttSuppressHighFrequency: false,
            mqttHeartbeatTopics: ['heartbeat'],
            mqttHeartbeatMinIntervalMs: 1000,
            ros2ObserverEnabled: false,
            ros2Allowlist: []
          }
        },
        arm64Enabled: true
      }
    });
  });

  it('returns canonical edge auto protocol defaults without legacy fields', async () => {
    const response = await request(app).get('/api/config');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.edgeAuto.protocolDefaults.modules.mqtt.relayEnabled).toBe(true);
    expect(response.body.data.edgeAuto.protocolDefaults.legacy).toBeUndefined();
  });
});
