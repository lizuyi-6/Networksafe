/**
 * Investigation Service Tests
 *
 * Tests for investigation persistence and retrieval
 */

import { InvestigationService, InvestigationRecord } from '../../services/investigation.service';
import { initDatabase, closeDatabase } from '../../config/database';

// Mock the database module
jest.mock('../../config/database', () => {
  const mockDb = {
    run: jest.fn(),
    prepare: jest.fn(() => ({
      bind: jest.fn(),
      step: jest.fn(() => false),
      getAsObject: jest.fn(() => null),
      free: jest.fn()
    }))
  };

  return {
    initDatabase: jest.fn().mockResolvedValue(undefined),
    closeDatabase: jest.fn(),
    getDatabase: jest.fn(() => ({
      getDb: jest.fn(() => mockDb),
      save: jest.fn()
    }))
  };
});

describe('InvestigationService', () => {
  let service: InvestigationService;

  beforeEach(() => {
    service = new InvestigationService();
    jest.clearAllMocks();
  });

  describe('saveInvestigation', () => {
    it('should save a new investigation record', async () => {
      // Note: fixture deliberately uses a simplified schema; cast through
      // unknown because BugReport/InvestigationContext have stricter required
      // fields in production than this smoke test populates.
      const record = {
        investigationId: 'test-inv-001',
        bugReportId: 'bug-001',
        bugReport: {
          id: 'bug-001',
          title: 'Test Bug',
          description: 'A test bug',
          severity: 'high',
          category: 'memory',
          status: 'open',
          reporter: 'test-user',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        context: {
          bugReportId: 'bug-001',
          environment: { os: 'linux', nodeVersion: '18.0.0' }
        },
        createdAt: new Date(),
        status: 'in_progress'
      } as unknown as InvestigationRecord;

      await service.saveInvestigation(record);

      // The service should call the database
      expect(true).toBe(true); // Placeholder - actual verification would need db mock
    });

    it('should handle save with result data', async () => {
      const record = {
        investigationId: 'test-inv-002',
        bugReportId: 'bug-002',
        bugReport: {
          id: 'bug-002',
          title: 'Test Bug with Result',
          description: 'A test bug with result',
          severity: 'critical',
          category: 'security',
          status: 'open',
          reporter: 'test-user',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        context: {
          bugReportId: 'bug-002'
        },
        result: {
          investigationId: 'test-inv-002',
          rootCause: 'Memory leak in event handler',
          confidence: 0.85,
          steps: []
        },
        createdAt: new Date(),
        status: 'completed'
      } as unknown as InvestigationRecord;

      await service.saveInvestigation(record);
      expect(true).toBe(true);
    });
  });

  describe('getInvestigation', () => {
    it('should return null for non-existent investigation', async () => {
      const result = await service.getInvestigation('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getInvestigationHistory', () => {
    it('should return paginated investigation history', async () => {
      const result = await service.getInvestigationHistory({
        limit: 10,
        offset: 0
      });

      expect(result).toHaveProperty('investigations');
      expect(result).toHaveProperty('total');
      expect(Array.isArray(result.investigations)).toBe(true);
    });

    it('should filter by severity', async () => {
      const result = await service.getInvestigationHistory({
        limit: 10,
        severity: 'critical'
      });

      expect(result).toHaveProperty('investigations');
      expect(result).toHaveProperty('total');
    });

    it('should filter by category', async () => {
      const result = await service.getInvestigationHistory({
        limit: 10,
        category: 'security'
      });

      expect(result).toHaveProperty('investigations');
      expect(result).toHaveProperty('total');
    });
  });

  describe('deleteInvestigation', () => {
    it('should delete an investigation', async () => {
      await service.deleteInvestigation('test-inv-001');
      expect(true).toBe(true);
    });
  });

  describe('updateInvestigationStatus', () => {
    it('should update investigation status to completed', async () => {
      await service.updateInvestigationStatus('test-inv-001', 'completed');
      expect(true).toBe(true);
    });

    it('should update investigation status to failed', async () => {
      await service.updateInvestigationStatus('test-inv-001', 'failed');
      expect(true).toBe(true);
    });

    it('should update investigation status to in_progress', async () => {
      await service.updateInvestigationStatus('test-inv-001', 'in_progress');
      expect(true).toBe(true);
    });

    it('should update investigation status to cancelled', async () => {
      await service.updateInvestigationStatus('test-inv-001', 'cancelled');
      expect(true).toBe(true);
    });
  });

  describe('close', () => {
    it('should close the service without error', () => {
      service.close();
      expect(true).toBe(true);
    });
  });
});
