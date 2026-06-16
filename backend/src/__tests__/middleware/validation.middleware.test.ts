/**
 * Tests for the lightweight request validator middleware.
 */

import request from 'supertest';
import express from 'express';
import { validateRequest } from '../../middleware/validation.middleware';

function buildApp(schema: any) {
    const app = express();
    app.use(express.json());
    app.post('/submit', validateRequest(schema), (_req, res) => res.json({ ok: true }));
    return app;
}

describe('validation middleware', () => {
    it('calls next when all required fields are present', async () => {
        const app = buildApp({ body: { required: ['name', 'email'] } });
        const res = await request(app).post('/submit').send({ name: 'x', email: 'y@z' });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    it('returns 400 when a required field is missing', async () => {
        const app = buildApp({ body: { required: ['name', 'email'] } });
        const res = await request(app).post('/submit').send({ name: 'x' }); // missing email
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('email');
    });

    it('returns 400 when a required field is null', async () => {
        const app = buildApp({ body: { required: ['value'] } });
        const res = await request(app).post('/submit').send({ value: null });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('value');
    });

    it('passes through when no required fields are declared', async () => {
        const app = buildApp({ body: {} });
        const res = await request(app).post('/submit').send({});
        expect(res.status).toBe(200);
    });

    it('passes through when schema has no body key', async () => {
        const app = buildApp({});
        const res = await request(app).post('/submit').send({});
        expect(res.status).toBe(200);
    });
});
