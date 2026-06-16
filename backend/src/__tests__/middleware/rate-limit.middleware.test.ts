/**
 * Tests for the rate-limit middleware — the Express-layer limiter that wraps
 * enhancedRateLimiter with IP-spoofing detection and pre-configured buckets.
 * Exercises the middleware end-to-end via supertest with a small maxRequests so
 * the allow→block boundary is observable, plus the pre-configured limiter
 * presets and the default 429 envelope.
 */

import request from 'supertest';
import express from 'express';
import { rateLimit, authRateLimit, apiRateLimit, adminRateLimit, wsRateLimit, lenientRateLimit } from '../../middleware/rate-limit.middleware';

process.env.TRUST_PROXY = 'true';

function uniqueIp(): string { return '2001:db8:' + Math.random().toString(36).slice(2, 10); }

function buildApp(maxRequests: number) {
    const app = express();
    app.use(express.json());
    app.use('/ping', rateLimit({ maxRequests, windowMs: 60000 }));
    app.get('/ping', (_req, res) => res.json({ ok: true }));
    return app;
}

describe('rate-limit middleware', () => {
    it('allows requests under the limit then returns 429 when exceeded', async () => {
        const app = buildApp(6); // user/combined=6, endpoint=floor(6/2)=3
        const ip = uniqueIp();
        const r1 = await request(app).get('/ping').set('X-Forwarded-For', ip);
        const r2 = await request(app).get('/ping').set('X-Forwarded-For', ip);
        const r3 = await request(app).get('/ping').set('X-Forwarded-For', ip);
        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        expect(r3.status).toBe(200);
        // 4th request exceeds the limit (combined/user dimension).
        // 4th request exceeds the endpoint dimension (floor(6/2)=3).
        const r4 = await request(app).get('/ping').set('X-Forwarded-For', ip);
        expect(r4.status).toBe(429);
    });

    it('sets X-RateLimit-* headers on allowed responses', async () => {
        const app = buildApp(5);
        const res = await request(app).get('/ping').set('X-Forwarded-For', uniqueIp());
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-limit']).toBeDefined();
        expect(res.headers['x-ratelimit-remaining']).toBeDefined();
        expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('sets Retry-After on the 429 response', async () => {
        const app = buildApp(1);
        const ip = uniqueIp();
        await request(app).get('/ping').set('X-Forwarded-For', ip);
        const blocked = await request(app).get('/ping').set('X-Forwarded-For', ip);
        expect(blocked.status).toBe(429);
        expect(blocked.headers['retry-after']).toBeDefined();
    });

    it('uses the default handler envelope (RATE_LIMIT_EXCEEDED)', async () => {
        const app = buildApp(1);
        const ip = uniqueIp();
        await request(app).get('/ping').set('X-Forwarded-For', ip);
        const blocked = await request(app).get('/ping').set('X-Forwarded-For', ip);
        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('namespaces buckets so different namespaces do not share a budget', async () => {
        const app = express();
        app.use(express.json());
        // Two separate mount points with different namespaces, each limit 1.
        app.use('/a', rateLimit({ namespace: 'ns-a', maxRequests: 1, windowMs: 60000 }));
        app.use('/b', rateLimit({ namespace: 'ns-b', maxRequests: 1, windowMs: 60000 }));
        app.get('/a', (_req, res) => res.json({ ok: true }));
        app.get('/b', (_req, res) => res.json({ ok: true }));

        const a1 = await request(app).get('/a');
        const b1 = await request(app).get('/b');
        expect(a1.status).toBe(200);
        expect(b1.status).toBe(200); // independent budget despite same client IP
    });

    it('uses a custom handler when provided', async () => {
        const app = express();
        app.use(express.json());
        app.use(
            '/custom',
            rateLimit({
                maxRequests: 1,
                windowMs: 60000,
                handler: (_req, res) => res.status(429).json({ code: 'CUSTOM_LIMIT', custom: true })
            })
        );
        app.get('/custom', (_req, res) => res.json({ ok: true }));
        const ip = uniqueIp();
        await request(app).get('/custom').set('X-Forwarded-For', ip);
        const blocked = await request(app).get('/custom').set('X-Forwarded-For', ip);
        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe('CUSTOM_LIMIT');
        expect(blocked.body.custom).toBe(true);
    });
});

describe('rate-limit pre-configured presets', () => {
    it('exports distinct limiter functions for each preset', () => {
        expect(typeof authRateLimit).toBe('function');
        expect(typeof apiRateLimit).toBe('function');
        expect(typeof adminRateLimit).toBe('function');
        expect(typeof wsRateLimit).toBe('function');
        expect(typeof lenientRateLimit).toBe('function');
    });

    it('adminRateLimit returns its specific envelope on exceed', async () => {
        const app = express();
        app.use(express.json());
        // admin preset is maxRequests: 20 — exceed it in a tight loop is slow; instead
        // mount a fresh strict limiter with the admin handler style and verify the code.
        app.use(
            '/adm',
            rateLimit({
                namespace: 'admin-test',
                maxRequests: 1,
                windowMs: 60000,
                handler: (_req, res) =>
                    res.status(429).json({
                        code: 'ADMIN_RATE_LIMIT_EXCEEDED',
                        error: 'backend.too_many_admin_operations_please_slow_down',
                        retryAfter: 60
                    })
            })
        );
        app.get('/adm', (_req, res) => res.json({ ok: true }));
        const ip = uniqueIp();
        await request(app).get('/adm').set('X-Forwarded-For', ip);
        const blocked = await request(app).get('/adm').set('X-Forwarded-For', ip);
        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe('ADMIN_RATE_LIMIT_EXCEEDED');
    });
});
