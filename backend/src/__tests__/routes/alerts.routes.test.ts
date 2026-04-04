import express from 'express';
import request from 'supertest';
import alertsRouter from '../../api/routes/alerts.routes';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'a@b.com', role: 'admin', tenantId: 't1' };
    next();
  }),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    listAlertsView: jest.fn().mockResolvedValue([]),
    createAlert: jest.fn().mockReturnValue({ alertId: 'a1' }),
    upsertAsset: jest.fn().mockReturnValue({ assetId: 'asset-1' }),
  }
}));

jest.mock('../../api/routes/ai-system.routes', () => ({
  getAgentSystem: jest.fn().mockReturnValue(null),
}));

const app = express();
app.use(alertsRouter);

describe('alerts.routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns 200 with array', async () => {
      const { securityOperationsService } = require('../../services/security-operations.service');
      securityOperationsService.listAlertsView.mockResolvedValueOnce([{ id: 'alert-1', title: 'Test Alert' }]);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('passes severity/status/limit query params to listAlertsView', async () => {
      const { securityOperationsService } = require('../../services/security-operations.service');
      securityOperationsService.listAlertsView.mockResolvedValue([]);

      await request(app).get('/?severity=Critical&status=open&limit=25');

      expect(securityOperationsService.listAlertsView).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({ severity: 'Critical', status: 'open', limit: 25 })
      );
    });

    it('passes tenantId from user', async () => {
      const { securityOperationsService } = require('../../services/security-operations.service');
      securityOperationsService.listAlertsView.mockResolvedValue([]);

      await request(app).get('/');

      expect(securityOperationsService.listAlertsView).toHaveBeenCalledWith(
        't1',
        expect.any(Object)
      );
    });

    it("uses 'all' as default for severity and status", async () => {
      const { securityOperationsService } = require('../../services/security-operations.service');
      securityOperationsService.listAlertsView.mockResolvedValue([]);

      await request(app).get('/');

      expect(securityOperationsService.listAlertsView).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({ severity: 'all', status: 'all' })
      );
    });
  });

  describe('addAlert', () => {
    const { addAlert } = require('../../api/routes/alerts.routes');
    const { securityOperationsService } = require('../../services/security-operations.service');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('creates alert via securityOperationsService', () => {
      addAlert({
        title: 'Test Alert',
        message: 'Something happened',
        severity: 'High',
        type: 'security',
        source: 'test-source',
        tenantId: 't1'
      });

      expect(securityOperationsService.createAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          title: 'Test Alert',
          message: 'Something happened',
          severity: 'high',
          alertType: 'security',
          sourceRef: 'test-source'
        })
      );
    });

    it('returns alert with generated alertId', () => {
      const result = addAlert({
        title: 'Test Alert',
        message: 'Something happened',
        severity: 'Critical',
        type: 'security',
        source: 'test-source'
      });

      expect(result).toHaveProperty('alertId', 'a1');
    });

    it('uses PLATFORM_TENANT_ID when no tenantId provided', () => {
      const { PLATFORM_TENANT_ID } = require('../../core/tenant/tenant-context');

      addAlert({
        title: 'Test Alert',
        message: 'Something happened',
        severity: 'Low',
        type: 'system',
        source: 'test-source'
      });

      expect(securityOperationsService.createAlert).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: PLATFORM_TENANT_ID })
      );
    });
  });

  describe('getAlerts', () => {
    const { getAlerts } = require('../../api/routes/alerts.routes');
    const { securityOperationsService } = require('../../services/security-operations.service');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('calls listAlertsView with limit 100', async () => {
      securityOperationsService.listAlertsView.mockResolvedValue([]);

      await getAlerts('t1');

      expect(securityOperationsService.listAlertsView).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({ limit: 100 })
      );
    });
  });
});
