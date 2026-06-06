/**
 * /metrics endpoint route tests
 *
 * Verifies the Prometheus text-format endpoint registered on the
 * root control plane app.
 */

import express from 'express';
import request from 'supertest';
import { metricsMiddleware } from '../../middleware/metrics.middleware';
import metrics from '../../observability/metrics';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

function buildApp(): express.Express {
  const app = express();
  app.use(metricsMiddleware);
  app.get('/metrics', (_req, res) => {
    try {
      const body = metrics.render();
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.status(200).send(body);
    } catch (error: any) {
      res.status(500).send('# metrics rendering failed\n');
    }
  });
  app.get('/probe', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('GET /metrics endpoint', () => {
  beforeEach(() => {
    metrics.reset();
  });

  it('returns 200 and Prometheus text-format content', async () => {
    const app = buildApp();
    // Generate at least one observation so render() returns content.
    await request(app).get('/probe').expect(200);

    const response = await request(app).get('/metrics').expect(200);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toContain('# HELP http_requests_total');
    expect(response.text).toContain('# TYPE http_request_duration_ms histogram');
    expect(response.text).toMatch(/^http_requests_total\{[^}]*\} \d+$/m);
  });

  it('includes the Prometheus version 0.0.4 content-type', async () => {
    const app = buildApp();
    const response = await request(app).get('/metrics').expect(200);
    expect(response.headers['content-type']).toContain('version=0.0.4');
  });
});
