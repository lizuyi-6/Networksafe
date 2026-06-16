/**
 * Final Defense Routes Tests (smoke)
 *
 * Smoke tests for the Final Defense API endpoints:
 *   - GET  /api/final-defense/status
 *   - POST /api/final-defense/actions
 *   - POST /api/final-defense/policies
 *
 * These tests focus on the security-relevant branches:
 *   - missing authentication  -> 401
 *   - authenticated request   -> 200
 *   - missing required fields -> 400
 */

import request from 'supertest';
import express from 'express';
import finalDefenseRouter from '../../api/routes/final-defense.routes';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// We control authentication, role/permission gating, and the underlying service
// so the smoke tests stay focused on the routing layer.

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = {
      userId: 'admin-001',
      email: 'admin@example.com',
      role: 'platform_admin',
      tenantId: 'tenant-001'
    };
    next();
  }),
  requirePermission: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  requireRole: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../middleware/helper-auth.middleware', () => ({
  authenticateHelperRequest: jest.fn((_req: any, _res: any, next: any) => next())
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../../services/final-defense.service', () => ({
  finalDefenseService: {
    listStatus: jest.fn().mockReturnValue([]),
    listRootResistantGateways: jest.fn().mockReturnValue([]),
    listPolicies: jest.fn().mockReturnValue([]),
    getStatus: jest.fn().mockReturnValue(null),
    getRootResistantGatewayStatus: jest.fn().mockReturnValue(null),
    reportStatus: jest.fn(),
    reportRootResistantGatewayStatus: jest.fn(),
    upsertPolicy: jest.fn(),
    requestAction: jest.fn(),
    requestGatewayAction: jest.fn()
  }
}));

import { finalDefenseService } from '../../services/final-defense.service';

// ---------------------------------------------------------------------------
// App under test
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use('/api/final-defense', finalDefenseRouter);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Final Defense Routes (smoke)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default to a permissive permission gate for each test; specific cases
    // override the per-test behaviour to assert 401/403.
    (requirePermission as jest.Mock).mockImplementation(
      () => (_req: any, _res: any, next: any) => next()
    );
  });

  // ---- GET /api/final-defense/status --------------------------------------

  describe('GET /status', () => {
    it('returns 401 when the request is not authenticated', async () => {
      (authenticate as jest.Mock).mockImplementationOnce(
        (_req: any, res: any, _next: any) => {
          res.status(401).json({
            success: false,
            data: null,
            error: { code: 'AUTH_TOKEN_MISSING', message: 'backend.authentication_required' }
          });
        }
      );

      const response = await request(app).get('/api/final-defense/status');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTH_TOKEN_MISSING');
    });

    it('returns 200 with status payload when the request is authenticated', async () => {
      (finalDefenseService.listStatus as jest.Mock).mockReturnValueOnce([
        {
          gatewayProtectionMode: 'host_companion',
          companionId: 'companion-001',
          gateId: 'gate-001',
          interlockState: 'isolated',
          active: true,
          degradedReasons: []
        }
      ]);
      (finalDefenseService.listRootResistantGateways as jest.Mock).mockReturnValueOnce([]);
      (finalDefenseService.listPolicies as jest.Mock).mockReturnValueOnce([
        { policyId: 'policy-001', status: 'active' }
      ]);

      const response = await request(app).get('/api/final-defense/status');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      // The GET /status envelope exposes aggregate flags + the raw collections.
      expect(typeof response.body.data.active).toBe('boolean');
      expect(typeof response.body.data.rootResistantActive).toBe('boolean');
      expect(typeof response.body.data.hostCompanionActive).toBe('boolean');
      expect(['active', 'degraded', 'not_configured']).toContain(response.body.data.mode);
      expect(response.body.data.statuses).toHaveLength(1);
      expect(response.body.data.policies).toHaveLength(1);
      expect(response.body.data.rootResistantGateways).toEqual([]);
      expect(finalDefenseService.listStatus).toHaveBeenCalledWith('tenant-001');
    });

    it('returns 500 when the service throws', async () => {
      (finalDefenseService.listStatus as jest.Mock).mockImplementationOnce(() => {
        throw new Error('boom');
      });

      const response = await request(app).get('/api/final-defense/status');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  // ---- POST /api/final-defense/actions ------------------------------------

  describe('POST /actions', () => {
    it('returns 400 when required fields are missing', async () => {
      const response = await request(app)
        .post('/api/final-defense/actions')
        .send({ payload: { note: 'no companion or commandType' } });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FINAL_DEFENSE_ACTION_REQUIRED_FIELDS');
    });

    it('returns the success envelope when the service accepts the action', async () => {
      (finalDefenseService.requestAction as jest.Mock).mockResolvedValueOnce({
        success: true,
        actionId: 'action-001',
        status: 'pending_hardware_confirmation',
        message: 'waiting for hardware',
        intent: { actionId: 'action-001', status: 'pending_hardware_confirmation' },
        session: { sessionId: 'session-001', expiresAt: '2099-01-01T00:00:00.000Z' }
      });

      const response = await request(app)
        .post('/api/final-defense/actions')
        .send({ companionId: 'companion-001', commandType: 'host_remove' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.actionId).toBe('action-001');
      expect(finalDefenseService.requestAction).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-001',
          companionId: 'companion-001',
          commandType: 'host_remove'
        })
      );
    });
  });

  // ---- POST /api/final-defense/policies -----------------------------------

  describe('POST /policies', () => {
    it('returns 400 when allowed actions or required fields are missing', async () => {
      const response = await request(app)
        .post('/api/final-defense/policies')
        .send({ companionId: 'companion-001', gateId: 'gate-001' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FINAL_DEFENSE_POLICY_REQUIRED_FIELDS');
    });
  });

  // ---- POST /api/final-defense/status/report -----------------------------

  describe('POST /status/report (V2.2: tenant from provisioning, not body)', () => {
    it('derives the tenant from the existing provisioned status, not from the body', async () => {
      (finalDefenseService.getStatus as jest.Mock).mockReturnValueOnce({
        companionId: 'companion-001',
        tenantId: 'tenant-from-provisioning',
        interlockState: 'isolated',
        active: true,
        degradedReasons: []
      });
      (finalDefenseService.reportStatus as jest.Mock).mockReturnValueOnce({
        companionId: 'companion-001',
        tenantId: 'tenant-from-provisioning',
        interlockState: 'isolated',
        active: true,
        degradedReasons: []
      });

      // SECURITY FIX (Sprint 5 R5 / V2.2): the body's `tenantId` is
      // intentionally a DIFFERENT tenant. The route must ignore it and
      // use the tenantId that was bound at provisioning time, otherwise
      // an attacker with the helper secret could re-tenant any companion.
      const response = await request(app)
        .post('/api/final-defense/status/report')
        .send({
          tenantId: 'tenant-from-body-attacker',
          companionId: 'companion-001',
          gateId: 'gate-001',
          interlockState: 'isolated',
          externalPowerPresent: true,
          secureElementPresent: true,
          feedbackOk: true
        });

      expect(response.status).toBe(200);
      expect(finalDefenseService.reportStatus).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-from-provisioning' })
      );
      expect(finalDefenseService.reportStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-from-body-attacker' })
      );
    });

    it('returns 403 when the companion has not been provisioned', async () => {
      (finalDefenseService.getStatus as jest.Mock).mockReturnValueOnce(null);

      const response = await request(app)
        .post('/api/final-defense/status/report')
        .send({
          tenantId: 'tenant-001',
          companionId: 'companion-unprovisioned',
          gateId: 'gate-001',
          interlockState: 'isolated'
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FINAL_DEFENSE_COMPANION_NOT_PROVISIONED');
      expect(finalDefenseService.reportStatus).not.toHaveBeenCalled();
    });
  });

  // ---- POST /api/final-defense/gateways/status/report ---------------------

  describe('POST /gateways/status/report (V2.2: tenant from provisioning, not body)', () => {
    it('derives the tenant from the existing provisioned gateway, not from the body', async () => {
      (finalDefenseService.getRootResistantGatewayStatus as jest.Mock).mockReturnValueOnce({
        gatewayId: 'gateway-001',
        tenantId: 'tenant-from-provisioning',
        bridgeState: 'isolated',
        active: true,
        degradedReasons: []
      });
      (finalDefenseService.reportRootResistantGatewayStatus as jest.Mock).mockReturnValueOnce({
        gatewayId: 'gateway-001',
        tenantId: 'tenant-from-provisioning',
        bridgeState: 'armed',
        active: true,
        degradedReasons: []
      });

      const response = await request(app)
        .post('/api/final-defense/gateways/status/report')
        .send({
          tenantId: 'tenant-from-body-attacker',
          gatewayId: 'gateway-001',
          bridgeState: 'armed',
          serverPortLink: true,
          lanPortLink: true,
          mgmtPath: 'dedicated_mgmt',
          secureElementPresent: true,
          policyDigest: 'digest-x',
          reportedPolicyDigest: 'digest-x',
          firmwareDigest: 'firmware-x',
          lastAttestationAt: '2026-06-05T00:00:00.000Z'
        });

      expect(response.status).toBe(200);
      expect(finalDefenseService.reportRootResistantGatewayStatus).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-from-provisioning' })
      );
      expect(finalDefenseService.reportRootResistantGatewayStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-from-body-attacker' })
      );
    });
  });
});
