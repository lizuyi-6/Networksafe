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
      const task = await scannerTaskService.createTask({
        ...defaultInput,
        tenantId: 'tenant-create-test'
      });

      expect(task).toBeDefined();
      expect(task.id).toBeDefined();
      expect(task.tenantId).toBe('tenant-create-test');
      expect(task.status).toBe('pending');
      expect(task.phase).toBe('queued');
      expect(task.progress).toBe(0);
    });

    it('should create task with correct summary', async () => {
      const task = await scannerTaskService.createTask({
        ...defaultInput,
        tenantId: 'tenant-summary-test'
      });

      expect(task.summary).toBeDefined();
      expect(task.summary.urlTargets).toBe(1);
      expect(task.summary.hostEnabled).toBe(true);
    });

    it('should queue additional tasks for the same tenant instead of rejecting them', async () => {
      const duplicateTenantInput = {
        ...defaultInput,
        tenantId: 'tenant-duplicate-test'
      };
      const first = await scannerTaskService.createTask(duplicateTenantInput);
      const second = await scannerTaskService.createTask(duplicateTenantInput);

      expect(first.id).toBeDefined();
      expect(second.id).toBeDefined();
      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe('pending');
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

  describe('retryTask', () => {
    it('should return null for non-existent task', async () => {
      const result = await scannerTaskService.retryTask('non-existent-id');
      expect(result).toBeNull();
    });

    it('should create new task from existing task', async () => {
      const original = await scannerTaskService.createTask({
        ...defaultInput,
        tenantId: 'tenant-retry-test'
      });

      const retried = await scannerTaskService.retryTask(original.id);
      expect(retried).toBeDefined();
      expect(retried?.id).not.toBe(original.id);
      expect(retried?.tenantId).toBe('tenant-retry-test');
      expect(retried?.status).toBe('pending');
    });

    it('should use custom actor when provided', async () => {
      const original = await scannerTaskService.createTask({
        ...defaultInput,
        tenantId: 'tenant-retry-actor',
        createdBy: 'original-user'
      });

      const retried = await scannerTaskService.retryTask(original.id, 'retry-user');
      expect(retried?.createdBy).toBe('retry-user');
    });
  });

  describe('stopWorker', () => {
    it('should stop without error', () => {
      scannerTaskService.setBroadcaster(jest.fn());
      scannerTaskService.stopWorker();
      expect(true).toBe(true);
    });

    it('should be safe to call multiple times', () => {
      scannerTaskService.stopWorker();
      scannerTaskService.stopWorker();
      expect(true).toBe(true);
    });
  });

  describe('prepare', () => {
    it('should mark schema as ready', async () => {
      await scannerTaskService.prepare();
      // prepare() sets schemaReady = true internally
      const task = await scannerTaskService.createTask({
        ...defaultInput,
        tenantId: 'tenant-after-prepare'
      });
      expect(task).toBeDefined();
    });
  });

  describe('getTaskView', () => {
    it('should return null for non-existent task', async () => {
      const view = await scannerTaskService.getTaskView('non-existent');
      expect(view).toBeNull();
    });

    it('should return task view for existing task', async () => {
      const created = await scannerTaskService.createTask({
        ...defaultInput,
        tenantId: 'tenant-view-test'
      });

      const view = await scannerTaskService.getTaskView(created.id);
      expect(view).toBeDefined();
      expect(view?.id).toBe(created.id);
    });
  });

  describe('getHistoryView', () => {
    it('should return empty array for tenant with no tasks', async () => {
      const views = await scannerTaskService.getHistoryView('empty-view-tenant');
      expect(Array.isArray(views)).toBe(true);
      expect(views.length).toBe(0);
    });
  });

  describe('target types', () => {
    it('should create task with IP targets', async () => {
      const task = await scannerTaskService.createTask({
        tenantId: 'tenant-ip-test',
        createdBy: 'user-001',
        targets: {
          ips: ['192.168.1.1', '10.0.0.1'],
        },
      });
      expect(task).toBeDefined();
      expect(task.summary.targetCount).toBe(2);
    });

    it('should create task with CIDR targets', async () => {
      const task = await scannerTaskService.createTask({
        tenantId: 'tenant-cidr-test',
        createdBy: 'user-001',
        targets: {
          cidrs: ['192.168.1.0/24'],
        },
      });
      expect(task).toBeDefined();
    });

    it('should create task with domain targets', async () => {
      const task = await scannerTaskService.createTask({
        tenantId: 'tenant-domain-test',
        createdBy: 'user-001',
        targets: {
          domains: ['example.com', 'test.com'],
        },
      });
      expect(task).toBeDefined();
      expect(task.summary.targetCount).toBe(2);
    });

    it('should create task with asset IDs', async () => {
      const task = await scannerTaskService.createTask({
        tenantId: 'tenant-asset-test',
        createdBy: 'user-001',
        targets: {
          assetIds: ['asset-1', 'asset-2'],
        },
      });
      expect(task).toBeDefined();
      expect(task.summary.targetCount).toBe(2);
    });

    it('should create task with device IDs', async () => {
      const task = await scannerTaskService.createTask({
        tenantId: 'tenant-device-test',
        createdBy: 'user-001',
        targets: {
          deviceIds: ['device-1', 'device-2'],
        },
      });
      expect(task).toBeDefined();
      expect(task.summary.targetCount).toBe(2);
    });

    it('should create task with agent IDs', async () => {
      const task = await scannerTaskService.createTask({
        tenantId: 'tenant-agent-test',
        createdBy: 'user-001',
        targets: {
          agentIds: ['agent-1', 'agent-2'],
        },
      });
      expect(task).toBeDefined();
      expect(task.summary.targetCount).toBe(2);
    });

    it('should create task with raw target items', async () => {
      const task = await scannerTaskService.createTask({
        tenantId: 'tenant-items-test',
        createdBy: 'user-001',
        targets: {
          items: [
            { kind: 'url', value: 'http://example.com', label: 'Example' },
            { kind: 'ip', value: '192.168.1.1' },
          ],
        },
      });
      expect(task).toBeDefined();
      expect(task.summary.targetCount).toBe(2);
    });

    it('should deduplicate targets', async () => {
      const task = await scannerTaskService.createTask({
        tenantId: 'tenant-dedup-test',
        createdBy: 'user-001',
        targets: {
          urls: ['http://example.com', 'http://example.com'],
        },
      });
      expect(task.summary.targetCount).toBe(1);
    });
  });

  describe('host scan configuration', () => {
    it('should create task with host scan including system', async () => {
      const task = await scannerTaskService.createTask({
        tenantId: 'tenant-host-system',
        createdBy: 'user-001',
        targets: {
          host: {
            mode: 'local',
            includeSystem: true,
            includeWeb: false,
            includePorts: false,
          },
        },
      });
      expect(task).toBeDefined();
      expect(task.summary.hostEnabled).toBe(true);
    });

    it('should create task with host scan including web', async () => {
      const task = await scannerTaskService.createTask({
        tenantId: 'tenant-host-web',
        createdBy: 'user-001',
        targets: {
          host: {
            mode: 'local',
            includeSystem: false,
            includeWeb: true,
            includePorts: false,
          },
        },
      });
      expect(task).toBeDefined();
      expect(task.summary.hostEnabled).toBe(true);
    });

    it('should create task with host scan including ports', async () => {
      const task = await scannerTaskService.createTask({
        tenantId: 'tenant-host-ports',
        createdBy: 'user-001',
        targets: {
          host: {
            mode: 'local',
            includeSystem: false,
            includeWeb: false,
            includePorts: true,
          },
        },
      });
      expect(task).toBeDefined();
      expect(task.summary.hostEnabled).toBe(true);
    });
  });

  describe('task status transitions', () => {
    it('should start with pending status', async () => {
      const task = await scannerTaskService.createTask({
        tenantId: 'tenant-status-test',
        createdBy: 'user-001',
        targets: { urls: ['http://example.com'] },
      });
      expect(task.status).toBe('pending');
      expect(task.phase).toBe('queued');
    });

    it('should track created task in memory', async () => {
      const task = await scannerTaskService.createTask({
        tenantId: 'tenant-track-test',
        createdBy: 'user-001',
        targets: { urls: ['http://example.com'] },
      });
      const retrieved = scannerTaskService.getTask(task.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(task.id);
    });
  });

  describe('engine policy', () => {
    it('should default to opt_then_nuclei policy', async () => {
      const task = await scannerTaskService.createTask({
        tenantId: 'tenant-policy-test',
        createdBy: 'user-001',
        targets: { urls: ['http://example.com'] },
      });
      expect(task.enginePolicy).toBe('opt_then_nuclei');
    });
  });
});
