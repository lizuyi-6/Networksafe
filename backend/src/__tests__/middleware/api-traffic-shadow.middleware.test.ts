import express from 'express';
import request from 'supertest';

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

import logger from '../../utils/logger';
import { apiTrafficShadowMiddleware } from '../../middleware/api-traffic-shadow.middleware';
import { fastpathTrafficShadowService } from '../../services/fastpath-traffic-shadow.service';
import { fastpathClientService } from '../../services/fastpath-client.service';
import { platformConfigService } from '../../services/platform-config.service';

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

  it('does not run shadow logic for health route', async () => {
    const app = buildApp();
    await request(app).get('/health').expect(200);

    await fastpathTrafficShadowService.awaitIdleForTests();
    expect(fastpathClientService.evaluateHttpTraffic).not.toHaveBeenCalled();
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
});
