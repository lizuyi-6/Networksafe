/**
 * Bug Investigation Agent Team - Test Suite
 *
 * Comprehensive tests for the investigation agent team.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { BugInvestigationTeam } from '../investigation';
import { BugReport, InvestigationContext } from '../investigation/types';

describe('Bug Investigation Agent Team', () => {
  let investigationTeam: BugInvestigationTeam;

  beforeAll(() => {
    investigationTeam = BugInvestigationTeam.getInstance();
  });

  describe('Team Initialization', () => {
    it('should initialize successfully', () => {
      expect(investigationTeam).toBeDefined();
    });

    it('should have all required agents', () => {
      const capabilities = investigationTeam.getAgentCapabilities();
      expect(capabilities.length).toBeGreaterThanOrEqual(6);
      expect(capabilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            agentType: expect.any(String)
          })
        ])
      );
    });
  });

  describe('Bug Report Creation', () => {
    it('should create a valid bug report', () => {
      const bugReport = BugInvestigationTeam.createBugReport({
        title: 'Test bug',
        description: 'This is a test bug',
        severity: 'high',
        category: 'functional',
        reproductionSteps: ['Step 1', 'Step 2'],
        environment: {
          os: 'Linux',
          runtime: 'Node.js v18',
          version: '1.0.0'
        },
        reporter: 'test-user'
      });

      expect(bugReport).toBeDefined();
      expect(bugReport.title).toBe('Test bug');
      expect(bugReport.severity).toBe('high');
      expect(bugReport.category).toBe('functional');
      expect(bugReport.timestamp).toBeDefined();
    });

    it('should handle missing optional fields', () => {
      const bugReport = BugInvestigationTeam.createBugReport({
        title: 'Minimal bug',
        description: 'Minimal description',
        severity: 'medium',
        category: 'performance'
      });

      expect(bugReport).toBeDefined();
      expect(bugReport.reproductionSteps).toBeUndefined();
      expect(bugReport.environment.os).toBe('unknown');
    });
  });

  describe('Context Creation', () => {
    it('should create investigation context', () => {
      const bugReport = BugInvestigationTeam.createBugReport({
        title: 'Test',
        description: 'Test',
        severity: 'low',
        category: 'functional'
      });

      const context = BugInvestigationTeam.createContext({
        bugReport,
        logs: [
          {
            timestamp: new Date(),
            level: 'error',
            service: 'test-service',
            message: 'backend.test_error_message'
          }
        ],
        traces: [],
        metrics: {
          cpu: { usage: 50, loadAverage: [1, 1, 1] },
          memory: { used: 1024, total: 4096, percentage: 25 }
        }
      });

      expect(context).toBeDefined();
      expect(context.systemState.logs.length).toBe(1);
      expect(context.systemState.metrics).toBeDefined();
    });
  });

  describe('Agent Capabilities', () => {
    it('should return agent capabilities', () => {
      const capabilities = investigationTeam.getAgentCapabilities();

      expect(Array.isArray(capabilities)).toBe(true);
      expect(capabilities.length).toBeGreaterThan(0);

      capabilities.forEach(cap => {
        expect(cap).toHaveProperty('agentType');
        expect(cap).toHaveProperty('capabilities');
        expect(cap).toHaveProperty('status');
      });
    });

    it('should have expected agent types', () => {
      const capabilities = investigationTeam.getAgentCapabilities();
      const agentTypes = capabilities.map(c => c.agentType);

      expect(agentTypes).toContain('log_analysis');
      expect(agentTypes).toContain('trace_analysis');
      expect(agentTypes).toContain('code_analysis');
      expect(agentTypes).toContain('bug_reproduction');
      expect(agentTypes).toContain('root_cause');
      expect(agentTypes).toContain('solution');
    });
  });

  describe('Active Investigations', () => {
    it('should return empty list initially', () => {
      const active = investigationTeam.getActiveInvestigations();

      expect(Array.isArray(active)).toBe(true);
    });
  });

  describe('Investigation Status', () => {
    it('should return not found for non-existent investigation', () => {
      const status = investigationTeam.getInvestigationStatus('non-existent-id');

      expect(status).toBeDefined();
      expect(status.status).toBe('not_found');
    });
  });

  // Integration tests (require actual AI models)
  describe.skip('Integration Tests', () => {
    it('should complete a full investigation', async () => {
      const bugReport = BugInvestigationTeam.createBugReport({
        title: 'Memory leak in payment service',
        description: 'Memory usage increases continuously',
        severity: 'high',
        category: 'memory',
        reproductionSteps: [
          'Process 1000 transactions',
          'Monitor memory usage'
        ],
        environment: {
          os: 'Ubuntu 22.04',
          runtime: 'Node.js v18',
          version: '1.2.3'
        }
      });

      const context = BugInvestigationTeam.createContext({
        bugReport,
        logs: [
          {
            timestamp: new Date(),
            level: 'error',
            service: 'payment-service',
            message: 'backend.outofmemoryerror_javascript_heap_out_of_memory',
            metadata: { heapUsed: '2048MB', heapTotal: '4096MB' }
          }
        ],
        traces: [],
        metrics: {
          cpu: { usage: 75, loadAverage: [2, 2, 2] },
          memory: { used: 2048, total: 4096, percentage: 50 }
        }
      });

      const result = await investigationTeam.investigate(bugReport, context);

      expect(result).toBeDefined();
      expect(result.investigationId).toBeDefined();
      expect(result.findings).toBeDefined();
      expect(Array.isArray(result.findings)).toBe(true);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.investigators).toBeDefined();
      expect(result.investigators.length).toBeGreaterThan(0);
    }, 300000); // 5 minute timeout

    it('should generate solutions for identified root cause', async () => {
      // Test implementation
    }, 300000);
  });
});
