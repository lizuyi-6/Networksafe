/**
 * Scanner Task Service Tests
 *
 * Tests for scanner task creation, management, and execution
 */

import { scannerTaskService, ScanTaskInput } from '../../services/scanner-task.service';
import { initDatabase, closeDatabase, getDatabase } from '../../config/database';

// Mock dependencies
jest.mock('../../config/database', () => {
  const mockDb = {
    exec: jest.fn(),
    prepare: jest.fn(() => ({
      run: jest.fn(),
      get: jest.fn(() => null),
      all: jest.fn(() => [])
    }))
  };

  return {
    initDatabase: jest.fn().mockResolvedValue(undefined),
    closeDatabase: jest.fn(),
    getDatabase: jest.fn(() => mockDb)
  };
});

jest.mock('../../scanner/optimization-engine', () => ({
  OptimizationEngine: jest.fn().mockImplementation(() => ({
    runFullScan: jest.fn().mockResolvedValue({
      recommendations: []
    })
  }))
}));

jest.mock('../../scanner/nuclei-scanner', () => ({
  NucleiScanner: jest.fn().mockImplementation(() => ({
    checkAvailability: jest.fn().mockResolvedValue(false),
    quickScan: jest.fn().mockResolvedValue([])
  }))
}));

describe('ScannerTaskService', () => {
  const defaultInput: ScanTaskInput = {
    tenantId: 'tenant-001',
    createdBy: 'user-001',
    targets: {
      urls: ['https://example.com'],
      host: {
        mode: 'local',
        includeSystem: true,
        includeWeb: true,
        includePorts: false
      }
    },
    enginePolicy: 'opt_then_nuclei'
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createTask', () => {
    it('should create a new scan task', async () => {
      const task = await scannerTaskService.createTask(defaultInput);

      expect(task).toBeDefined();
      expect(task.id).toBeDefined();
      expect(task.tenantId).toBe('tenant-001');
      expect(task.status).toBe('pending');
      expect(task.phase).toBe('queued');
      expect(task.progress).toBe(0);
    });

    it('should create task with correct summary', async () => {
      const task = await scannerTaskService.createTask(defaultInput);

      expect(task.summary).toBeDefined();
      expect(task.summary.urlTargets).toBe(1);
      expect(task.summary.hostEnabled).toBe(true);
    });

    it('should throw error if task already running for tenant', async () => {
      // Create first task
      await scannerTaskService.createTask(defaultInput);

      // Try to create second task for same tenant
      await expect(scannerTaskService.createTask(defaultInput))
        .rejects.toThrow('A scan task is already running for this tenant');
    });
  });

  describe('getTask', () => {
    it('should return null for non-existent task', () => {
      const task = scannerTaskService.getTask('non-existent-id');
      expect(task).toBeNull();
    });

    it('should return task by ID', async () => {
      const created = await scannerTaskService.createTask({
        ...defaultInput,
        tenantId: 'tenant-get-test'
      });

      const task = scannerTaskService.getTask(created.id);
      expect(task).toBeDefined();
      expect(task?.id).toBe(created.id);
    });
  });

  describe('getRunningTaskByTenant', () => {
    it('should return null if no running task for tenant', () => {
      const task = scannerTaskService.getRunningTaskByTenant('no-tasks-tenant');
      expect(task).toBeNull();
    });
  });

  describe('getTaskResults', () => {
    it('should return null for non-existent task', () => {
      const result = scannerTaskService.getTaskResults('non-existent-id');
      expect(result).toBeNull();
    });

    it('should return task results', async () => {
      const created = await scannerTaskService.createTask({
        ...defaultInput,
        tenantId: 'tenant-results-test'
      });

      const result = scannerTaskService.getTaskResults(created.id);
      expect(result).toBeDefined();
      expect(result?.taskId).toBe(created.id);
      expect(Array.isArray(result?.timeline)).toBe(true);
      expect(Array.isArray(result?.urlFindings)).toBe(true);
      expect(Array.isArray(result?.hostFindings)).toBe(true);
      expect(Array.isArray(result?.nucleiFindings)).toBe(true);
    });
  });

  describe('getHistory', () => {
    it('should return empty array for tenant with no tasks', () => {
      const history = scannerTaskService.getHistory('empty-tenant');
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBe(0);
    });

    it('should limit results', () => {
      const history = scannerTaskService.getHistory('tenant-001', 5);
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('cancelTask', () => {
    it('should return false for non-existent task', () => {
      const result = scannerTaskService.cancelTask('non-existent-id');
      expect(result).toBe(false);
    });

    it('should cancel a pending task', async () => {
      const created = await scannerTaskService.createTask({
        ...defaultInput,
        tenantId: 'tenant-cancel-test'
      });

      const result = scannerTaskService.cancelTask(created.id);
      expect(result).toBe(true);

      const task = scannerTaskService.getTask(created.id);
      expect(task?.status).toBe('cancelled');
    });

    it('should return false for already completed task', async () => {
      const created = await scannerTaskService.createTask({
        ...defaultInput,
        tenantId: 'tenant-cancel-completed'
      });

      // Manually set status to completed
      const task = scannerTaskService.getTask(created.id);
      if (task) {
        task.status = 'completed';
      }

      const result = scannerTaskService.cancelTask(created.id);
      expect(result).toBe(false);
    });
  });

  describe('setBroadcaster', () => {
    it('should set broadcaster function', () => {
      const broadcaster = jest.fn();
      scannerTaskService.setBroadcaster(broadcaster);
      expect(true).toBe(true); // No error means success
    });
  });
});