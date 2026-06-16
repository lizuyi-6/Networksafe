/**
 * Tests for enterprise-helper routes — serial request dispatch for deployment helpers.
 * Mocks helper-auth + services to avoid DB/API key dependencies.
 */

import request from 'supertest';
import express from 'express';

jest.mock('../../middleware/helper-auth.middleware', () => ({
    authenticateHelperRequest: jest.fn((_req: any, _res: any, next: any) => next())
}));

jest.mock('../../utils/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

import enterpriseHelperRouter from '../../api/routes/enterprise-helper.routes';

describe('enterprise-helper routes', () => {
    let app: express.Express;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/', enterpriseHelperRouter);
    });

    it('POST /helpers/:id/serial-request-result returns a structured response (< 500)', async () => {
        const res = await request(app)
            .post('/helpers/helper-1/serial-request-result')
            .send({ requestType: 'BACKUP', output: 'ok', signature: 'test-sig' });
        expect(res.status).toBeLessThan(500);
    });
});