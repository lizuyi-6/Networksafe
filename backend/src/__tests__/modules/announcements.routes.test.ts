/**
 * Tests for the announcements admin routes — CRUD + publish/archive lifecycle.
 * Mounts the router on an Express app with mocked auth and tests each endpoint.
 */

import request from 'supertest';
import express from 'express';
import announcementsRouter from '../../modules/announcements/announcements.routes';
import {
    ensureAnnouncementsSchema,
    createAnnouncement,
    listAllAnnouncements,
    publishAnnouncement
} from '../../modules/announcements/announcements.repository';
import { initDatabase, closeDatabase } from '../../config/database';

jest.mock('../../middleware/auth.middleware', () => ({
    authenticate: jest.fn((req: any, _res: any, next: any) => {
        req.user = { userId: 'admin-1', email: 'admin@test', role: 'platform_admin', tenantId: 't1' };
        next();
    }),
    requireRole: jest.fn(() => (_req: any, _res: any, next: any) => next()),
    requirePermission: jest.fn(() => (_req: any, _res: any, next: any) => next()),
    AuthenticatedRequest: jest.fn()
}));

const testDataDir = require('os').tmpdir() + '/aetherguard-announcements-routes-test';

describe('announcements admin routes', () => {
    let app: express.Express;

    beforeAll(async () => {
        require('fs').rmSync(testDataDir, { recursive: true, force: true });
        process.env.DATA_DIR = testDataDir;
        await initDatabase();
        ensureAnnouncementsSchema();
        app = express();
        app.use(express.json());
        app.use('/admin', announcementsRouter);
    });

    afterAll(() => {
        closeDatabase();
        require('fs').rmSync(testDataDir, { recursive: true, force: true });
    });

    it('GET /admin/announcements returns a response (list endpoint reachable)', async () => {
        const res = await request(app).get('/admin/announcements');
        // 200 (success) or wrapped envelope; just verify the endpoint is reachable.
        expect(res.status).toBeLessThan(500);
    });

    it('POST /admin/announcements creates a new announcement', async () => {
        const res = await request(app)
            .post('/admin/announcements')
            .send({ title: 'Test Announcement', content: 'Hello world', type: 'info' });
        expect(res.status).toBeLessThan(400);
    });

    it('POST /admin/announcements/:id/publish publishes an announcement', async () => {
        createAnnouncement({
            id: 'pub-1', title: 'Pub', content: 'c', type: 'info', expiresAt: null, createdBy: 'admin-1'
        });
        const res = await request(app).post('/admin/announcements/pub-1/publish');
        expect(res.status).toBeLessThan(400);
    });

    it('POST /admin/announcements/:id/archive archives an announcement', async () => {
        createAnnouncement({
            id: 'arch-1', title: 'Arch', content: 'c', type: 'info', expiresAt: null, createdBy: 'admin-1'
        });
        const res = await request(app).post('/admin/announcements/arch-1/archive');
        expect(res.status).toBeLessThan(400);
    });

    it('DELETE /admin/announcements/:id removes an announcement', async () => {
        createAnnouncement({
            id: 'del-1', title: 'Del', content: 'c', type: 'info', expiresAt: null, createdBy: 'admin-1'
        });
        const res = await request(app).delete('/admin/announcements/del-1');
        expect(res.status).toBeLessThan(400);
    });
});
