/**
 * System Routes Tests
 *
 * Tests for system mode management routes
 */

import request from 'supertest';
import express from 'express';
import systemRouter from '../../api/routes/system.routes';

// Mock auth
jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-001', role: 'platform_admin', tenantId: 'tenant-001' };
    next();
  }),
  optionalAuth: jest.fn((req: any, _res: any, next: any) => {
    if (req.headers['x-test-authenticated'] === 'true') {
      req.user = { userId: 'admin-001', role: 'platform_admin', tenantId: 'tenant-001' };
    }
    next();
  }),
  requireRole: jest.fn(() => (req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
}));

// Mock runtime capabilities
// Mock enterprise-runtime so allowDemoFeatures() is true (lab mode) —
// otherwise POST /mode refuses to switch to demo with a 403.
jest.mock('../../config/enterprise-runtime', () => ({
  allowDemoFeatures: jest.fn(() => true),
  allowPasswordLogin: jest.fn(() => true),
  isEnterpriseStrictMode: jest.fn(() => false),
  isEnterpriseRuntime: jest.fn(() => false),
  isLabRuntime: jest.fn(() => true),
  getEnterpriseRuntimeMode: jest.fn(() => 'lab')
}));

jest.mock('../../config/runtime-capabilities', () => ({
  getRuntimeCapabilities: jest.fn(() => ({
    devLoginEnabled: false,
    passwordLoginEnabled: false,
    oidcEnabled: true,
    enterpriseRuntimeMode: 'prod-enterprise',
    demoModeAllowed: false,
    enterpriseStrictMode: true,
    profile: 'standard',
    dbMode: 'sqlite'
  }))
}));

// Mock app-mode config
let currentMode = 'demo';
jest.mock('../../config/app-mode', () => ({
  getAppMode: jest.fn(() => currentMode),
  setAppMode: jest.fn((mode: string) => { currentMode = mode; }),
  isDemoMode: jest.fn(() => currentMode === 'demo'),
  isAttackSimulatorEnabled: jest.fn(() => false),
  AppMode: { PRODUCTION: 'production', DEMO: 'demo' }
}));

describe('System Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/system', systemRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    currentMode = 'demo';
  });

  describe('GET /mode', () => {
    it('returns current mode and capabilities', async () => {
      const response = await request(app)
        .get('/api/system/mode')
        .set('x-test-authenticated', 'true');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.appMode).toBeDefined();
      expect(response.body.data.canToggleMode).toBe(true);
      expect(response.body.data.devLoginEnabled).toBe(false);
    });

    it('works without authentication', async () => {
      // optionalAuth is used for GET /mode
      const response = await request(app).get('/api/system/mode');

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({
        passwordLoginEnabled: false,
        oidcEnabled: true
      });
      expect(response.body.data.profile).toBeUndefined();
      expect(response.body.data.dbMode).toBeUndefined();
      expect(response.body.data.enterpriseRuntimeMode).toBeUndefined();
    });
  });

  describe('POST /mode', () => {
    it('switches to production mode', async () => {
      const response = await request(app)
        .post('/api/system/mode')
        .send({ appMode: 'production' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.appMode).toBe('production');
    });

    it('switches back to demo mode', async () => {
      currentMode = 'production';
      const response = await request(app)
        .post('/api/system/mode')
        .send({ appMode: 'demo' });

      expect(response.status).toBe(200);
      expect(response.body.data.appMode).toBe('demo');
    });

    it('returns 400 for invalid mode', async () => {
      const response = await request(app)
        .post('/api/system/mode')
        .send({ appMode: 'invalid_mode' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('backend.invalid_app_mode');
    });

    it('returns success without re-switching if already in mode', async () => {
      currentMode = 'demo';
      const response = await request(app)
        .post('/api/system/mode')
        .send({ appMode: 'demo' });

      expect(response.status).toBe(200);
      expect(response.body.data.seeded).toBe(false);
    });

    it('handles setAppMode error gracefully', async () => {
      currentMode = 'demo';
      const { setAppMode } = require('../../config/app-mode');
      (setAppMode as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Permission denied');
      });

      const response = await request(app)
        .post('/api/system/mode')
        .send({ appMode: 'production' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('backend.switch_app_mode_failed');
    });
  });
});
