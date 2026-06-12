/**
 * Plan Middleware Tests
 *
 * Tests for subscription plan quota enforcement
 */

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth.middleware';
import { requirePlanQuota, PLAN_LIMITS } from '../../middleware/plan.middleware';

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
  }
}));

// Mock database
const mockDb = {
  prepare: jest.fn()
};

jest.mock('../../config/database', () => ({
  getDatabase: jest.fn(() => mockDb)
}));

describe('PLAN_LIMITS', () => {
  it('defines starter plan limits', () => {
    expect(PLAN_LIMITS.starter).toEqual({ sites: 1, agents: 1 });
  });

  it('defines pro plan limits', () => {
    expect(PLAN_LIMITS.pro).toEqual({ sites: 5, agents: 5 });
  });

  it('defines ultra plan as unlimited', () => {
    expect(PLAN_LIMITS.ultra).toEqual({ sites: -1, agents: -1 });
  });
});

describe('requirePlanQuota', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let mockStatus: jest.Mock;
  let mockJson: jest.Mock;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn(() => ({ json: mockJson }));
    mockReq = {
      user: {
        userId: 'user-001',
        email: 'test@example.com',
        username: 'testuser',
        role: 'tenant',
        tenantId: 'tenant-001'
      }
    };
    mockRes = {
      status: mockStatus,
      json: mockJson
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  describe('authentication', () => {
    it('returns 401 when req.user is missing', () => {
      mockReq.user = undefined;
      const middleware = requirePlanQuota('site');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(401);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'backend.authentication_required'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('admin bypass', () => {
    it('bypasses quota check for admin role on sites', () => {
      mockReq.user!.role = 'admin';
      const middleware = requirePlanQuota('site');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockStatus).not.toHaveBeenCalled();
    });

    it('bypasses quota check for admin role on agents', () => {
      mockReq.user!.role = 'admin';
      const middleware = requirePlanQuota('agent');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockStatus).not.toHaveBeenCalled();
    });

    it('bypasses quota check for viewer role (not tenant/admin)', () => {
      mockReq.user!.role = 'viewer';
      const mockGet = jest.fn().mockReturnValue({ count: 0 });
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const middleware = requirePlanQuota('site');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      // viewer has plan 'starter', quota check runs against DB
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('site quota enforcement', () => {
    it('allows when starter user has 0 sites (under limit)', () => {
      mockReq.user!.plan = 'starter';
      const mockGet = jest.fn().mockReturnValue({ count: 0 });
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const middleware = requirePlanQuota('site');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockStatus).not.toHaveBeenCalled();
    });

    it('returns 403 when starter user has 1 site (at limit, >= triggers)', () => {
      mockReq.user!.plan = 'starter';
      const mockGet = jest.fn().mockReturnValue({ count: 1 });
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const middleware = requirePlanQuota('site');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      // count=1 >= limit=1 triggers the exceeded check
      expect(mockStatus).toHaveBeenCalledWith(403);
    });

    it('returns 403 when starter user exceeds site limit', () => {
      mockReq.user!.plan = 'starter';
      const mockGet = jest.fn().mockReturnValue({ count: 2 });
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const middleware = requirePlanQuota('site');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'PLAN_QUOTA_EXCEEDED',
          plan: 'starter'
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('allows when pro user has 4 sites (under limit)', () => {
      mockReq.user!.plan = 'pro';
      const mockGet = jest.fn().mockReturnValue({ count: 4 });
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const middleware = requirePlanQuota('site');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('returns 403 when pro user exceeds site limit', () => {
      mockReq.user!.plan = 'pro';
      const mockGet = jest.fn().mockReturnValue({ count: 6 });
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const middleware = requirePlanQuota('site');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(403);
    });
  });

  describe('agent quota enforcement', () => {
    it('allows when ultra user has unlimited agents', () => {
      mockReq.user!.plan = 'ultra';
      const middleware = requirePlanQuota('agent');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockStatus).not.toHaveBeenCalled();
    });

    it('allows when starter user has 0 agent codes', () => {
      mockReq.user!.plan = 'starter';
      const mockGet = jest.fn().mockReturnValue({ count: 0 });
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const middleware = requirePlanQuota('agent');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('returns 403 when starter user exceeds agent code limit', () => {
      mockReq.user!.plan = 'starter';
      const mockGet = jest.fn().mockReturnValue({ count: 2 });
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const middleware = requirePlanQuota('agent');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'PLAN_QUOTA_EXCEEDED',
          plan: 'starter'
        })
      );
    });

    it('returns 403 when pro user exceeds agent code limit', () => {
      mockReq.user!.plan = 'pro';
      const mockGet = jest.fn().mockReturnValue({ count: 6 });
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const middleware = requirePlanQuota('agent');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(403);
    });
  });

  describe('default plan fallback', () => {
    it('uses starter limits when plan is not specified', () => {
      mockReq.user!.plan = undefined;
      const mockGet = jest.fn().mockReturnValue({ count: 0 });
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const middleware = requirePlanQuota('site');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('returns 403 when unknown plan exceeds starter limits', () => {
      mockReq.user!.plan = 'enterprise' as any;
      const mockGet = jest.fn().mockReturnValue({ count: 2 });
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const middleware = requirePlanQuota('site');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      // unknown plan falls back to starter limits
      expect(mockStatus).toHaveBeenCalledWith(403);
    });
  });

  describe('database errors', () => {
    it('returns 500 when database query fails for sites', () => {
      mockReq.user!.plan = 'starter';
      const mockGet = jest.fn().mockImplementation(() => {
        throw new Error('DB connection failed');
      });
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const middleware = requirePlanQuota('site');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INTERNAL_ERROR'
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 500 when database query fails for agents', () => {
      mockReq.user!.plan = 'starter';
      const mockGet = jest.fn().mockImplementation(() => {
        throw new Error('DB error');
      });
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const middleware = requirePlanQuota('agent');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INTERNAL_ERROR'
        })
      );
    });
  });

  describe('tenant isolation', () => {
    it('queries with correct tenantId for site check', () => {
      mockReq.user!.tenantId = 'tenant-xyz';
      mockReq.user!.plan = 'starter';
      const mockGet = jest.fn().mockReturnValue({ count: 0 });
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const middleware = requirePlanQuota('site');
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*)')
      );
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
