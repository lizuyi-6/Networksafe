/**
 * Tests for investigation routes — all controller methods mocked.
 */

import request from 'supertest';
import express from 'express';

jest.mock('../../middleware/auth.middleware', () => ({
    authenticate: jest.fn((_req: any, _res: any, next: any) => next()),
    authenticateAgent: jest.fn((_req: any, _res: any, next: any) => next()),
    authenticateApiKey: jest.fn((_req: any, _res: any, next: any) => next()),
    requirePermission: jest.fn(() => (_req: any, _res: any, next: any) => next()),
    AuthenticatedRequest: jest.fn()
}));

jest.mock('../../middleware/validation.middleware', () => ({
    validateRequest: jest.fn(() => (_req: any, _res: any, next: any) => next())
}));

jest.mock('../../utils/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

const mockHandler = (body: any) => jest.fn((_req: any, res: any) => res.status(200).json(body));

jest.mock('../../api/controllers/investigation.controller', () => ({
    InvestigationController: jest.fn().mockImplementation(() => ({
        startInvestigation: mockHandler({ investigationId: 'inv-mock-1' }),
        getCapabilities: mockHandler([{ agentType: 'bug_reproduction', status: 'active' }]),
        getActiveInvestigations: mockHandler([]),
        getInvestigationStatus: mockHandler({ status: 'not_found' }),
        getInvestigationResult: mockHandler({ result: null }),
        getInvestigationHistory: mockHandler([]),
        cancelInvestigation: mockHandler({ cancelled: true })
    }))
}));

import investigationRouter from '../../api/routes/investigation.routes';

describe('investigation routes', () => {
    let app: express.Express;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/investigation', investigationRouter);
    });

    it('GET /investigation/capabilities returns agent capabilities', async () => {
        const res = await request(app).get('/investigation/capabilities');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /investigation/active returns a list', async () => {
        const res = await request(app).get('/investigation/active');
        expect(res.status).toBe(200);
    });

    it('GET /investigation/:id/status returns status', async () => {
        const res = await request(app).get('/investigation/unknown/status');
        expect(res.status).toBe(200);
    });

    it('GET /investigation/:id/result returns result', async () => {
        const res = await request(app).get('/investigation/unknown/result');
        expect(res.status).toBe(200);
    });

    it('GET /investigation/history returns history', async () => {
        const res = await request(app).get('/investigation/history');
        expect(res.status).toBe(200);
    });

    it('POST /investigation/start returns an id', async () => {
        const res = await request(app)
            .post('/investigation/start')
            .send({
                bugReport: {
                    id: 'bug-1', title: 'test', description: 'test desc', severity: 'high',
                    category: 'functional', environment: { os: 'linux', runtime: 'node', version: '1' }, reporter: 'tester'
                }
            });
        expect(res.status).toBe(200);
        expect(res.body.investigationId).toBe('inv-mock-1');
    });

    it('POST /investigation/:id/cancel returns a cancel result', async () => {
        const res = await request(app).post('/investigation/inv-1/cancel');
        expect(res.status).toBe(200);
        expect(res.body.cancelled).toBe(true);
    });
});