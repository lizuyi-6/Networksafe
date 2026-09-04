import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-minimum-32-characters-long';

jest.mock('../../services/platform-config.service', () => ({
  platformConfigService: {
    getConfig: jest.fn()
  }
}));

jest.mock('../../services/fastpath-client.service', () => ({
  fastpathClientService: {
    evaluateHttpTraffic: jest.fn()
  }
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn()
  }
}));

jest.mock('../../services/detection-pipeline.service', () => ({
  detectionPipelineService: {
    evaluateRequest: jest.fn(),
    getSettings: jest.fn()
  }
}));

import logger from '../../utils/logger';
import { apiTrafficShadowMiddleware } from '../../middleware/api-traffic-shadow.middleware';
import { detectionPipelineService } from '../../services/detection-pipeline.service';
import { fastpathTrafficShadowService } from '../../services/fastpath-traffic-shadow.service';
import { fastpathClientService } from '../../services/fastpath-client.service';
import { platformConfigService } from '../../services/platform-config.service';
import { ANONYMOUS_TENANT_ID } from '../../core/tenant/tenant-context';

const captureRawBody = (req: express.Request, _res: express.Response, buffer: Buffer): void => {
  if (buffer.length > 0) {
    (req as any).rawBody = Buffer.from(buffer);
  }
};

describe('apiTrafficShadowMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fastpathTrafficShadowService.resetForTests();
    (platformConfigService.getConfig as jest.Mock).mockResolvedValue({
      fastpath: {
        enabled: true,
        trafficShadowEnabled: true,
        trafficShadowSampleRatePct: 100,
        trafficMaxBodyBytes: 65536
      }
    });
    (fastpathClientService.evaluateHttpTraffic as jest.Mock).mockResolvedValue({
      protocol: 'http',
      verdict: 'allow',
      matchedRule: null,
      threats: [],
      truncated: false,
      decisionSource: 'rust-fastpath-traffic-http',
      processingTimeMicros: 10
    });
    (detectionPipelineService.evaluateRequest as jest.Mock).mockResolvedValue({
      verdict: 'allow',
      matchedRuleIds: [],
      riskScore: 0.1,
      escalatedToAI: false,
      queuedForAsyncReview: false,
      decisionSource: 'seed:allow',
      signals: [],
      attackFamily: 'benign',
      processingTimeMs: 1,
      ruleMatches: []
    });
    (detectionPipelineService.getSettings as jest.Mock).mockResolvedValue({
      ruleFirstEnabled: true
    });
  });

  afterEach(() => {
    fastpathTrafficShadowService.resetForTests();
  });

  function buildApp(): express.Express {
    const app = express();
    app.use(express.json({ verify: captureRawBody }));
    app.use(express.urlencoded({ extended: true, verify: captureRawBody }));
    app.use(express.text({ type: 'text/*', verify: captureRawBody }));
    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.use(apiTrafficShadowMiddleware);
    app.all('*', (_req, res) => res.status(200).json({ ok: true }));
    return app;
  }

  function buildMountedApiApp(): express.Express {
    const app = express();
    const apiRouter = express.Router();
    app.use(express.json({ verify: captureRawBody }));
    apiRouter.use(apiTrafficShadowMiddleware);
    apiRouter.post('/auth/login', (_req, res) => res.status(200).json({ reachedAuthRoute: true }));
    apiRouter.get('/auth/oidc/login', (_req, res) => res.status(200).json({ reachedOidcRoute: true }));
    apiRouter.post('/search', (_req, res) => res.status(200).json({ reachedSearchRoute: true }));
    app.use('/api', apiRouter);
    return app;
  }

  it('does not run shadow logic for health route', async () => {
    const app = buildApp();
    await request(app).get('/health').expect(200);

    await fastpathTrafficShadowService.awaitIdleForTests();
    expect(fastpathClientService.evaluateHttpTraffic).not.toHaveBeenCalled();
    expect(detectionPipelineService.evaluateRequest).not.toHaveBeenCalled();
  });

  it('bypasses auth login routes before fastpath and detection hooks when mounted under /api', async () => {
    (detectionPipelineService.evaluateRequest as jest.Mock).mockRejectedValue(new Error('pipeline unavailable'));

    const app = buildMountedApiApp();
    await request(app)
      .post('/api/auth/login')
      .set('x-request-id', 'auth-login-mounted')
      .send({ email: 'alice@example.com', password: 'secret-value' })
      .expect(200)
      .expect((response) => {
        expect(response.body.reachedAuthRoute).toBe(true);
      });

    await fastpathTrafficShadowService.awaitIdleForTests();
    expect(fastpathClientService.evaluateHttpTraffic).not.toHaveBeenCalled();
    expect(detectionPipelineService.evaluateRequest).not.toHaveBeenCalled();
  });

  it('bypasses OIDC login routes before detection fail-closed handling', async () => {
    (detectionPipelineService.evaluateRequest as jest.Mock).mockRejectedValue(new Error('pipeline unavailable'));

    const app = buildMountedApiApp();
    await request(app)
      .get('/api/auth/oidc/login')
      .set('x-request-id', 'oidc-login-mounted')
      .expect(200)
      .expect((response) => {
        expect(response.body.reachedOidcRoute).toBe(true);
      });

    expect(detectionPipelineService.evaluateRequest).not.toHaveBeenCalled();
  });

  it('queues textual API traffic and calls fastpath asynchronously', async () => {
    const app = buildApp();
    await request(app)
      .post('/login?from=test')
      .set('x-request-id', 'shadow-1')
      .send({ username: 'alice' })
      .expect(200);

    await fastpathTrafficShadowService.awaitIdleForTests();
    expect(fastpathClientService.evaluateHttpTraffic).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'shadow-1',
        method: 'POST',
        url: '/login?from=test'
      })
    );
    expect(detectionPipelineService.evaluateRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'http_api',
        requestId: 'shadow-1',
        method: 'POST',
        path: '/login?from=test',
        decodedPath: '/login?from=test',
        query: 'from=test',
        decodedQuery: 'from=test',
        parsedQuery: 'from=test\ntest'
      })
    );
  });

  it('does not derive an anonymous request tenant from spoofed tenant or API-key headers', async () => {
    const app = buildApp();
    await request(app)
      .get('/protected')
      .set('x-request-id', 'tenant-spoof-anonymous')
      .set('x-tenant-id', 'victim-tenant')
      .set('x-api-key', 'key_victim-tenant_unverified')
      .set('authorization', 'Bearer invalid-unverified-token')
      .expect(200);

    expect(detectionPipelineService.evaluateRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'tenant-spoof-anonymous',
        tenantId: ANONYMOUS_TENANT_ID
      })
    );
    expect((detectionPipelineService.evaluateRequest as jest.Mock).mock.calls[0][0].tenantId)
      .not.toBe('victim-tenant');
  });

  it('uses an upstream authenticated user tenant instead of request headers', async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = {
        userId: 'user-1',
        email: 'user@example.com',
        username: 'user',
        role: 'tenant',
        tenantId: 'verified-tenant'
      };
      next();
    });
    app.use(apiTrafficShadowMiddleware);
    app.get('/protected', (_req, res) => res.status(200).json({ ok: true }));

    await request(app)
      .get('/protected')
      .set('x-request-id', 'tenant-verified-user')
      .set('x-tenant-id', 'victim-tenant')
      .expect(200);

    expect(detectionPipelineService.evaluateRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'tenant-verified-user',
        tenantId: 'verified-tenant'
      })
    );
  });

  it('normalizes encoded query payloads before detection evaluation', async () => {
    const app = buildApp();
    await request(app)
      .get('/rules?q=union%20select%201')
      .set('x-request-id', 'query-encoded-1')
      .expect(200);

    expect(detectionPipelineService.evaluateRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'query-encoded-1',
        path: '/rules?q=union%20select%201',
        decodedPath: '/rules?q=union select 1',
        query: 'q=union%20select%201',
        decodedQuery: 'q=union select 1',
        parsedQuery: 'q=union select 1\nunion select 1'
      })
    );
  });

  it('normalizes form-urlencoded bodies before detection evaluation', async () => {
    const app = buildApp();
    await request(app)
      .post('/login')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('x-request-id', 'form-encoded-1')
      .send("username=%27+or+1%3D1&password=test")
      .expect(200);

    expect(detectionPipelineService.evaluateRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'form-encoded-1',
        body: 'username=%27+or+1%3D1&password=***REDACTED***',
        normalizedBody: "username=' or 1=1&password=***REDACTED***",
        parsedBody: expect.stringContaining('password=***REDACTED***')
      })
    );
    const evaluated = (detectionPipelineService.evaluateRequest as jest.Mock).mock.calls[0][0];
    expect(evaluated.body).not.toContain('password=test');
  });

  it('skips requests when sample rate is zero', async () => {
    (platformConfigService.getConfig as jest.Mock).mockResolvedValue({
      fastpath: {
        enabled: true,
        trafficShadowEnabled: true,
        trafficShadowSampleRatePct: 0,
        trafficMaxBodyBytes: 65536
      }
    });

    const app = buildApp();
    await request(app)
      .post('/login')
      .set('x-request-id', 'shadow-skip')
      .send({ username: 'bob' })
      .expect(200);

    await fastpathTrafficShadowService.awaitIdleForTests();
    expect(fastpathClientService.evaluateHttpTraffic).not.toHaveBeenCalled();
  });

  it('drops requests when the queue is full', async () => {
    fastpathTrafficShadowService.setWorkerConfigForTests({
      concurrency: 0,
      maxQueueSize: 1
    });

    const app = buildApp();
    await request(app)
      .post('/login')
      .set('x-request-id', 'shadow-drop-1')
      .send({ username: 'first' })
      .expect(200);

    await new Promise((resolve) => setImmediate(resolve));

    await request(app)
      .post('/login')
      .set('x-request-id', 'shadow-drop-2')
      .send({ username: 'second' })
      .expect(200);

    expect(logger.warn).toHaveBeenCalledWith(
      'fastpath_traffic_shadow_dropped',
      expect.objectContaining({
        requestId: 'shadow-drop-2'
      })
    );
  });

  it('logs mismatches without affecting the response', async () => {
    (fastpathClientService.evaluateHttpTraffic as jest.Mock).mockResolvedValue({
      protocol: 'http',
      verdict: 'block',
      matchedRule: 'fast_path:critical_threat',
      threats: [{ type: 'xss', severity: 'critical', description: 'Critical threat detected: xss' }],
      truncated: false,
      decisionSource: 'rust-fastpath-traffic-http',
      processingTimeMicros: 12
    });

    const app = buildApp();
    await request(app)
      .post('/comment')
      .set('x-request-id', 'shadow-mismatch')
      .send({ body: 'hello world' })
      .expect(200);

    await fastpathTrafficShadowService.awaitIdleForTests();
    expect(logger.warn).toHaveBeenCalledWith(
      'fastpath_traffic_shadow_mismatch',
      expect.objectContaining({
        requestId: 'shadow-mismatch'
      })
    );
  });

  it('blocks malicious requests before they reach downstream routes', async () => {
    (detectionPipelineService.evaluateRequest as jest.Mock).mockResolvedValue({
      verdict: 'block',
      matchedRuleIds: ['seed-sqli-union'],
      riskScore: 1,
      escalatedToAI: false,
      queuedForAsyncReview: false,
      aiVerdict: undefined,
      decisionSource: 'seed:block',
      signals: [],
      attackFamily: 'sqli',
      processingTimeMs: 2,
      ruleMatches: []
    });

    const app = buildApp();
    await request(app)
      .post('/search')
      .set('x-request-id', 'blocked-1')
      .send({ q: '1 UNION SELECT password FROM users' })
      .expect(403)
      .expect((response) => {
        expect(response.body?.error?.code).toBe('backend.request_blocked_by_detection_pipeline');
        expect(response.body?.error?.matchedRuleIds).toEqual(['seed-sqli-union']);
      });
  });

  it('blocks fail-closed when the detection pipeline throws', async () => {
    (detectionPipelineService.evaluateRequest as jest.Mock).mockRejectedValue(new Error('storage unavailable'));

    const app = buildApp();
    await request(app)
      .post('/search')
      .set('x-request-id', 'pipeline-down-1')
      .send({ q: 'normal query' })
      .expect(503)
      .expect((response) => {
        expect(response.body?.error?.code).toBe('backend.detection_pipeline_unavailable');
        expect(response.body?.error?.failClosed).toBe(true);
      });
  });
});
