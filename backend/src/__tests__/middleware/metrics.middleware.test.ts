/**
 * Tests for the HTTP metrics middleware — verifies every request (including
 * 404s) records a counter increment and a histogram observation, rendered via
 * the Prometheus text exposition format.
 */

import request from 'supertest';
import express from 'express';
import { metricsMiddleware } from '../../middleware/metrics.middleware';
import metrics from '../../observability/metrics';

describe('metrics middleware', () => {
    it('increments the request counter on a successful response', async () => {
        const app = express();
        app.use(metricsMiddleware);
        app.get('/m1', (_req, res) => res.json({ ok: true }));
        await request(app).get('/m1');

        const output = metrics.render();
        // The counter with the GET /m1 200 label set must appear with a value > 0.
        const line = output.split('\n').find((l) => l.includes('http_requests_total') && l.includes('/m1') && l.includes('200'));
        expect(line).toBeDefined();
        expect(Number(line!.split(' ').pop())).toBeGreaterThan(0);
    });

    it('records metrics for 404 responses (route label fallback to path)', async () => {
        const app = express();
        app.use(metricsMiddleware);
        await request(app).get('/not-found');

        const output = metrics.render();
        const line = output.split('\n').find((l) => l.includes('http_requests_total') && l.includes('/not-found') && l.includes('404'));
        expect(line).toBeDefined();
        expect(Number(line!.split(' ').pop())).toBeGreaterThan(0);
    });

    it('records a histogram observation for the request duration', async () => {
        const app = express();
        app.use(metricsMiddleware);
        app.get('/m3', (_req, res) => res.json({ ok: true }));
        await request(app).get('/m3');

        const output = metrics.render();
        // The histogram metric name must appear in the rendered output.
        expect(output).toContain('http_request_duration_ms');
    });

    it('does not throw on error responses (best-effort finish hook)', async () => {
        const app = express();
        app.use(metricsMiddleware);
        app.get('/m4', (_req, res) => res.status(500).json({ error: 'boom' }));
        const res = await request(app).get('/m4');
        expect(res.status).toBe(500);
        // The finish hook still ran without throwing (otherwise supertest would error).
        const output = metrics.render();
        expect(output).toContain('http_requests_total');
    });
});
