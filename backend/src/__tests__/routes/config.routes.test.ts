import express from 'express';
import request from 'supertest';
import configRouter from '../../api/routes/config.routes';
import { platformConfigService } from '../../services/platform-config.service';
import auditLogger from '../../security/audit-logger.service';

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
  },
  // Real implementation so the route's AG-B07 redaction is exercised, not a stub.
  redactPlatformConfigSecrets: jest.requireActual('../../services/platform-config.service').redactPlatformConfigSecrets
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

  it('rejects a preferred AI model outside the server catalog', async () => {
    const response = await request(app)
      .post('/api/config')
      .send({ aiRouting: { preferredModelId: 'not-a-real-model' } });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('backend.model_access_denied');
    expect(platformConfigService.saveConfig).not.toHaveBeenCalled();
  });

  it('persists a catalog model through the existing partial config contract', async () => {
    (platformConfigService.saveConfig as jest.Mock).mockImplementation(async (_tenantId, patch) => {
      const current = await (platformConfigService.getConfig as jest.Mock)();
      return {
        ...current,
        aiRouting: {
          ...current.aiRouting,
          ...patch.aiRouting
        }
      };
    });

    const response = await request(app)
      .post('/api/config')
      .send({ aiRouting: { preferredModelId: 'glm-5' } });

    expect(response.status).toBe(200);
    expect(response.body.data.config.aiRouting.preferredModelId).toBe('glm-5');
    expect(platformConfigService.saveConfig).toHaveBeenCalledWith(
      'tenant-001',
      { aiRouting: { preferredModelId: 'glm-5' } },
      'test-user'
    );
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'platform_config_updated',
      details: expect.objectContaining({ preferredModelId: 'glm-5' })
    }));
  });

  // ── AG-B07: notification-channel secrets must not reach non-admins ───────

  const SECRET_CHANNEL = {
    id: 'ch-1',
    name: 'ops-mail',
    type: 'smtp',
    enabled: true,
    target: 'ops@example.com',
    minimumSeverity: 'critical',
    headers: { Authorization: 'Bearer real-secret-token', 'X-Hook-Secret': 'hook-signing-secret' },
    smtp: { host: 'smtp.example.com', port: 587, secure: false, username: 'ops', password: 'real-smtp-password', from: 'ops@example.com' }
  };

  function authenticateAs(role: string): void {
    const { authenticate } = require('../../middleware/auth.middleware');
    (authenticate as jest.Mock).mockImplementationOnce((req: any, _res: any, next: any) => {
      req.user = { userId: 'test-user', email: 'test@example.com', role, tenantId: 'tenant-001' };
      next();
    });
  }

  it('AG-B07: admin still receives real smtp.password and webhook headers', async () => {
    (platformConfigService.getConfig as jest.Mock).mockResolvedValueOnce({
      notifications: { enabled: true, dedupeWindowSeconds: 300, retryDelaysSeconds: [30], channels: [SECRET_CHANNEL] }
    });
    authenticateAs('admin');

    const response = await request(app).get('/api/config');

    expect(response.status).toBe(200);
    const channel = response.body.data.notifications.channels[0];
    expect(channel.smtp.password).toBe('real-smtp-password');
    expect(channel.headers.Authorization).toBe('Bearer real-secret-token');
  });

  it('AG-B07: non-admin receives redacted smtp.password and webhook header values (keys kept)', async () => {
    (platformConfigService.getConfig as jest.Mock).mockResolvedValueOnce({
      notifications: { enabled: true, dedupeWindowSeconds: 300, retryDelaysSeconds: [30], channels: [SECRET_CHANNEL] }
    });
    authenticateAs('tenant_operator');

    const response = await request(app).get('/api/config');

    expect(response.status).toBe(200);
    const channel = response.body.data.notifications.channels[0];
    expect(channel.smtp.password).toBe('********');
    expect(channel.headers.Authorization).toBe('********');
    expect(channel.headers['X-Hook-Secret']).toBe('********');
    // Non-secret channel metadata stays intact for UI rendering.
    expect(channel.smtp.host).toBe('smtp.example.com');
    expect(channel.type).toBe('smtp');
  });

  it('AG-B07: redaction never mutates the service cache (admin sees real secrets afterwards)', async () => {
    const sharedCache = {
      notifications: { enabled: true, dedupeWindowSeconds: 300, retryDelaysSeconds: [30], channels: [SECRET_CHANNEL] }
    };
    (platformConfigService.getConfig as jest.Mock).mockResolvedValue(sharedCache);

    authenticateAs('tenant_operator');
    const redacted = await request(app).get('/api/config');
    expect(redacted.body.data.notifications.channels[0].smtp.password).toBe('********');

    // Same cached object, now read by an admin: real secret must survive.
    authenticateAs('admin');
    const admin = await request(app).get('/api/config');
    expect(admin.body.data.notifications.channels[0].smtp.password).toBe('real-smtp-password');
    // And the in-memory cache object itself was never touched.
    expect(sharedCache.notifications.channels[0].smtp.password).toBe('real-smtp-password');
  });
});
