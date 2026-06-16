/**
 * Hardware Authorization Routes Tests (smoke)
 *
 * Smoke tests for the Hardware Authorization API endpoints. The router is
 * mounted at "/" inside the control plane (see control-plane-app.ts), so the
 * absolute paths from the test client's perspective are:
 *   - GET  /hardware-gates
 *   - POST /hardware-gates/enroll
 *   - GET  /deployment-runs
 *   - GET  /helpers
 *
 * The smoke coverage focuses on the security-relevant branches:
 *   - missing authentication        -> 401
 *   - authenticated GET             -> 200
 *   - authenticated POST validation -> 400 on missing fields
 */

import request from 'supertest';
import express from 'express';
import hardwareAuthorizationRouter from '../../api/routes/hardware-authorization.routes';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

jest.mock('../../services/hardware-authorization.service', () => ({
  hardwareAuthorizationService: {
    getConfirmationSession: jest.fn().mockReturnValue(null),
    enrollGate: jest.fn(),
    listGates: jest.fn().mockReturnValue([])
  }
}));

jest.mock('../../services/command-dispatcher.service', () => ({
  commandDispatcherService: {
    dispatchAgentCommand: jest.fn(),
    dispatchDeviceCommand: jest.fn()
  }
}));

jest.mock('../../services/deployment-run.service', () => ({
  deploymentRunService: {
    createRun: jest.fn(),
    listRuns: jest.fn().mockReturnValue([]),
    requestApproval: jest.fn(),
    readEvidence: jest.fn(),
    listHelpers: jest.fn().mockReturnValue([]),
    registerHelper: jest.fn(),
    heartbeatHelper: jest.fn().mockReturnValue(null)
  }
}));

import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';

// ---------------------------------------------------------------------------
// App under test
// ---------------------------------------------------------------------------

// The router is mounted at "/" in production, but we mount it at "/" here as
// well so the test paths match the route definitions directly.
const app = express();
app.use(express.json());
app.use('/', hardwareAuthorizationRouter);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Hardware Authorization Routes (smoke)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requirePermission as jest.Mock).mockImplementation(
      () => (_req: any, _res: any, next: any) => next()
    );
  });

  // ---- GET /hardware-gates -----------------------------------------------

  describe('GET /hardware-gates', () => {
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

      const response = await request(app).get('/hardware-gates');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTH_TOKEN_MISSING');
      expect(hardwareAuthorizationService.listGates).not.toHaveBeenCalled();
    });

    it('returns 200 with the list of gates when authenticated', async () => {
      (hardwareAuthorizationService.listGates as jest.Mock).mockReturnValueOnce([
        { gateId: 'gate-001', status: 'enrolled' },
        { gateId: 'gate-002', status: 'online' }
      ]);

      const response = await request(app).get('/hardware-gates');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.gates)).toBe(true);
      expect(response.body.data.gates).toHaveLength(2);
      expect(response.body.data.gates[0].gateId).toBe('gate-001');
      // The route also exposes a legacy `gates` field at the top level.
      expect(response.body.gates).toHaveLength(2);
      expect(hardwareAuthorizationService.listGates).toHaveBeenCalledWith('tenant-001');
    });
  });

  // ---- POST /hardware-gates/enroll ----------------------------------------

  describe('POST /hardware-gates/enroll', () => {
    it('returns 400 when gateId or publicKeyPem is missing', async () => {
      const response = await request(app)
        .post('/hardware-gates/enroll')
        .send({ displayName: 'incomplete' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('HARDWARE_GATE_REQUIRED_FIELDS');
    });

    it('returns 201 with the enrolled gate on success', async () => {
      (hardwareAuthorizationService.enrollGate as jest.Mock).mockReturnValueOnce({
        gateId: 'gate-001',
        status: 'enrolled',
        tenantId: 'tenant-001'
      });

      const response = await request(app)
        .post('/hardware-gates/enroll')
        .send({
          gateId: 'gate-001',
          publicKeyPem: '-----BEGIN PUBLIC KEY-----\nABCD\n-----END PUBLIC KEY-----'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.gateId).toBe('gate-001');
      expect(response.body.gate.gateId).toBe('gate-001');
      expect(hardwareAuthorizationService.enrollGate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-001',
          gateId: 'gate-001',
          status: 'enrolled'
        })
      );
    });
  });

  // ---- GET /deployment-runs -----------------------------------------------

  describe('GET /deployment-runs', () => {
    it('returns 200 with an empty list when no runs exist', async () => {
      const response = await request(app).get('/deployment-runs');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.runs)).toBe(true);
      expect(response.body.data.runs).toEqual([]);
    });
  });

  // ---- GET /helpers -------------------------------------------------------

  describe('GET /helpers', () => {
    it('returns 200 with the helper list', async () => {
      const response = await request(app).get('/helpers');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.helpers)).toBe(true);
    });
  });
});
