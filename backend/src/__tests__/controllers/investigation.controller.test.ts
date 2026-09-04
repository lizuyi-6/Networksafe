/**
 * Investigation Controller Tests
 *
 * Tests for investigation API controller
 */

import { Request, Response, NextFunction } from 'express';

// Minimal user shapes for tenant-scoped access tests (AUD-02-5).
function userWith(tenantId: string | null, role = 'viewer') {
    return { user: { userId: 'u1', role, tenantId } };
}
import { InvestigationController } from '../../api/controllers/investigation.controller';
import { BugInvestigationTeam } from '../../ai-agents/investigation';
import { InvestigationService } from '../../services/investigation.service';

const mockTeam = {
  investigate: jest.fn().mockResolvedValue({
    investigationId: 'inv-001',
    rootCause: 'Test root cause',
    confidence: 0.85
  }),
  getInvestigationStatus: jest.fn(),
  getActiveInvestigations: jest.fn(() => []),
  getAgentCapabilities: jest.fn(() => []),
  cancelInvestigation: jest.fn()
};

// Mock dependencies
jest.mock('../../ai-agents/investigation', () => ({
  BugInvestigationTeam: {
    getInstance: jest.fn(() => mockTeam),
    createBugReport: jest.fn(() => ({
      id: 'bug-001',
      title: 'Test Bug',
      severity: 'high',
      createdAt: new Date().toISOString()
    })),
    createContext: jest.fn(() => ({
      bugReportId: 'bug-001'
    }))
  }
}));

jest.mock('../../services/investigation.service', () => ({
  InvestigationService: jest.fn().mockImplementation(() => ({
    saveInvestigation: jest.fn().mockResolvedValue(undefined),
    getInvestigation: jest.fn(),
    updateInvestigationStatus: jest.fn().mockResolvedValue(undefined),
    getInvestigationHistory: jest.fn().mockResolvedValue({
      investigations: [],
      total: 0
    })
  }))
}));

describe('InvestigationController', () => {
  let controller: InvestigationController;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    controller = new InvestigationController();
    mockJson = jest.fn();
    mockStatus = jest.fn(() => ({ json: mockJson }));
    // Legacy tests exercise the platform super-set; the AUD-02-5 tests
    // override with tenant-scoped viewers.
    mockRequest = { user: { userId: 'admin-1', role: 'platform_admin' } } as any;
    mockResponse = {
      json: mockJson,
      status: mockStatus
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
    mockTeam.investigate.mockResolvedValue({
      investigationId: 'inv-001',
      rootCause: 'Test root cause',
      confidence: 0.85
    });
    mockTeam.getInvestigationStatus.mockReset();
    mockTeam.getActiveInvestigations.mockReset();
    mockTeam.getAgentCapabilities.mockReset();
    mockTeam.cancelInvestigation.mockReset();
    mockTeam.getActiveInvestigations.mockReturnValue([]);
    mockTeam.getAgentCapabilities.mockReturnValue([]);
    mockTeam.cancelInvestigation.mockReturnValue({
      cancelled: true,
      status: 'cancelled',
      investigationId: 'inv-001',
      message: 'backend.investigation_cancelled'
    });
  });

  describe('startInvestigation', () => {
    it('should start investigation and return result', async () => {
      mockRequest.body = {
        title: 'Test Bug',
        description: 'A test bug',
        severity: 'high',
        category: 'runtime'
      };

      await controller.startInvestigation(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalled();
      const callArg = mockJson.mock.calls[0][0];
      expect(callArg.success).toBe(true);
      expect(callArg.data.investigationId).toBeDefined();
    });

    it('should handle errors', async () => {
      mockRequest.body = {};

      const team = BugInvestigationTeam.getInstance() as any;
      team.investigate.mockRejectedValueOnce(new Error('Investigation failed'));

      await controller.startInvestigation(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('getInvestigationStatus', () => {
    it('should return investigation status', async () => {
      mockRequest.params = { investigationId: 'inv-001' };

      const team = BugInvestigationTeam.getInstance() as any;
      team.getInvestigationStatus.mockReturnValueOnce({
        investigationId: 'inv-001',
        status: 'completed'
      });

      await controller.getInvestigationStatus(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalled();
    });

    it('should return 404 for non-existent investigation', async () => {
      mockRequest.params = { investigationId: 'non-existent' };

      const team = BugInvestigationTeam.getInstance() as any;
      team.getInvestigationStatus.mockReturnValueOnce({ status: 'not_found' });

      await controller.getInvestigationStatus(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockStatus).toHaveBeenCalledWith(404);
    });
  });

  describe('getInvestigationResult', () => {
    it('should return saved investigation result', async () => {
      mockRequest.params = { investigationId: 'inv-001' };

      const service = (controller as any).investigationService;
      service.getInvestigation.mockResolvedValueOnce({
        investigationId: 'inv-001',
        status: 'completed'
      });

      await controller.getInvestigationResult(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockStatus).toHaveBeenCalledWith(200);
    });

    it('should return 404 if investigation not found', async () => {
      mockRequest.params = { investigationId: 'non-existent' };

      const service = (controller as any).investigationService;
      service.getInvestigation.mockResolvedValueOnce(null);

      const team = BugInvestigationTeam.getInstance() as any;
      team.getInvestigationStatus.mockReturnValueOnce({ status: 'not_found' });

      await controller.getInvestigationResult(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockStatus).toHaveBeenCalledWith(404);
    });

    it('should return 202 if investigation in progress', async () => {
      mockRequest.params = { investigationId: 'inv-in-progress' };

      const service = (controller as any).investigationService;
      service.getInvestigation.mockResolvedValueOnce(null);

      const team = BugInvestigationTeam.getInstance() as any;
      team.getInvestigationStatus.mockReturnValueOnce({ status: 'in_progress' });

      await controller.getInvestigationResult(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockStatus).toHaveBeenCalledWith(202);
    });
  });

  describe('getActiveInvestigations', () => {
    it('should return active investigations', async () => {
      const team = BugInvestigationTeam.getInstance() as any;
      team.getActiveInvestigations.mockReturnValueOnce([]);

      await controller.getActiveInvestigations(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalled();
      const callArg = mockJson.mock.calls[0][0];
      expect(callArg.success).toBe(true);
      expect(Array.isArray(callArg.data)).toBe(true);
    });
  });

  describe('getCapabilities', () => {
    it('should return agent capabilities', async () => {
      const team = BugInvestigationTeam.getInstance() as any;
      team.getAgentCapabilities.mockReturnValueOnce([]);

      await controller.getCapabilities(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockStatus).toHaveBeenCalledWith(200);
    });
  });

  describe('cancelInvestigation', () => {
    it('should cancel an active investigation', async () => {
      mockRequest.params = { investigationId: 'inv-001' };

      await controller.cancelInvestigation(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({
        success: true,
        data: {
          investigationId: 'inv-001',
          status: 'cancelled'
        }
      });
    });

    it('should return 404 when cancelling a missing investigation', async () => {
      mockRequest.params = { investigationId: 'missing' };
      mockTeam.cancelInvestigation.mockReturnValueOnce({
        cancelled: false,
        status: 'not_found',
        investigationId: 'missing',
        message: 'backend.investigation_not_found'
      });

      await controller.cancelInvestigation(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockStatus).toHaveBeenCalledWith(404);
    });

    it('should return 409 when investigation is already completed', async () => {
      mockRequest.params = { investigationId: 'inv-001' };
      mockTeam.cancelInvestigation.mockReturnValueOnce({
        cancelled: false,
        status: 'already_completed',
        investigationId: 'inv-001',
        message: 'backend.investigation_already_completed'
      });

      await controller.cancelInvestigation(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockStatus).toHaveBeenCalledWith(409);
    });
  });

  describe('getInvestigationHistory', () => {
    it('should return investigation history', async () => {
      mockRequest.query = { limit: '10', offset: '0' };

      const service = (controller as any).investigationService;
      service.getInvestigationHistory.mockResolvedValueOnce({
        investigations: [],
        total: 0
      });

      await controller.getInvestigationHistory(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalled();
      const callArg = mockJson.mock.calls[0][0];
      expect(callArg.success).toBe(true);
      expect(callArg.pagination).toBeDefined();
    });
  });

  // SECURITY (audit 2026-08, AUD-02-5): investigations are tenant-owned.
  // Ownership is recorded at start; cross-tenant reads/cancels are 404
  // (indistinguishable from missing); platform requesters see everything;
  // active/history listings are tenant-filtered.
  describe('cross-tenant object-level access (AUD-02-5)', () => {
    function withUser(tenantId: string | null, role = 'viewer') {
      (mockRequest as any).user = tenantId === null && role === 'platform_admin'
        ? { userId: 'admin-1', role: 'platform_admin' }
        : { userId: 'u1', role, tenantId };
    }

    beforeEach(() => {
      mockRequest.body = {
        title: 'Bug',
        description: 'Desc',
        severity: 'high',
        category: 'runtime'
      };
    });

    it('records the requester tenant as owner at start', async () => {
      withUser('tenant-A');
      await controller.startInvestigation(mockRequest as Request, mockResponse as Response, mockNext);
      expect(mockStatus).toHaveBeenCalledWith(200);

      // Owner can read.
      const team = BugInvestigationTeam.getInstance() as any;
      team.getInvestigationStatus.mockReturnValue({ investigationId: 'inv-001', status: 'completed' });
      mockRequest.params = { investigationId: 'inv-001' };
      await controller.getInvestigationStatus(mockRequest as Request, mockResponse as Response, mockNext);
      expect(mockStatus).toHaveBeenLastCalledWith(200);
    });

    it('returns 404 (not 403) to a different tenant — ownership not probeable', async () => {
      withUser('tenant-A');
      await controller.startInvestigation(mockRequest as Request, mockResponse as Response, mockNext);

      withUser('tenant-B');
      mockRequest.params = { investigationId: 'inv-001' };
      await controller.getInvestigationStatus(mockRequest as Request, mockResponse as Response, mockNext);
      expect(mockStatus).toHaveBeenLastCalledWith(404);
    });

    it('lets a platform requester read any tenant investigation', async () => {
      withUser('tenant-A');
      await controller.startInvestigation(mockRequest as Request, mockResponse as Response, mockNext);

      withUser(null, 'platform_admin');
      mockRequest.params = { investigationId: 'inv-001' };
      const team = BugInvestigationTeam.getInstance() as any;
      team.getInvestigationStatus.mockReturnValue({ investigationId: 'inv-001', status: 'completed' });
      await controller.getInvestigationStatus(mockRequest as Request, mockResponse as Response, mockNext);
      expect(mockStatus).toHaveBeenLastCalledWith(200);
    });

    it('blocks cross-tenant cancel with 404 and does not cancel', async () => {
      withUser('tenant-A');
      await controller.startInvestigation(mockRequest as Request, mockResponse as Response, mockNext);

      withUser('tenant-B');
      mockRequest.params = { investigationId: 'inv-001' };
      await controller.cancelInvestigation(mockRequest as Request, mockResponse as Response, mockNext);
      expect(mockStatus).toHaveBeenLastCalledWith(404);
      const team = BugInvestigationTeam.getInstance() as any;
      expect(team.cancelInvestigation).not.toHaveBeenCalled();
    });

    it('filters the active list to the requester tenant', async () => {
      const team = BugInvestigationTeam.getInstance() as any;
      team.getActiveInvestigations.mockReturnValue([
        { investigationId: 'inv-owned' },
        { investigationId: 'inv-foreign' },
        { investigationId: 'inv-legacy' }
      ]);

      withUser('tenant-A');
      await controller.startInvestigation(mockRequest as Request, mockResponse as Response, mockNext);

      mockTeam.getActiveInvestigations.mockReturnValue([
        { investigationId: 'inv-001' },
        { investigationId: 'inv-foreign' }
      ]);
      await controller.getActiveInvestigations(mockRequest as Request, mockResponse as Response, mockNext);
      const payload = mockJson.mock.calls[mockJson.mock.calls.length - 1][0];
      expect(payload.data).toEqual([{ investigationId: 'inv-001' }]);
    });
  });
});
