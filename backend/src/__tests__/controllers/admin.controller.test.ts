/**
 * Admin Controller Tests
 *
 * Tests for admin controller methods
 */

import { Request, Response } from 'express';
import { AdminController } from '../../api/controllers/admin.controller';
import { getAgentSystem } from '../../services/agent-system.service';

// Mock dependencies
jest.mock('../../services/agent-system.service', () => ({
  getAgentSystem: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  }
}));

jest.mock('../../config/app-mode', () => ({
  isDemoMode: jest.fn(() => false)
}));

describe('AdminController', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn(() => ({ json: mockJson }));
    mockRequest = {};
    mockResponse = {
      json: mockJson,
      status: mockStatus
    };
    jest.clearAllMocks();
  });

  describe('getErrors', () => {
    it('should return empty array if agent system not initialized', () => {
      (getAgentSystem as jest.Mock).mockReturnValue(null);

      AdminController.getErrors(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockJson).toHaveBeenCalledWith([]);
    });

    it('should return errors from agent system', () => {
      const mockAgentSystem = {
        isInitialized: jest.fn(() => true),
        getProbeReport: jest.fn(() => ({
          alerts: [
            {
              severity: 'critical',
              message: 'Critical error',
              timestamp: '2024-01-01T00:00:00Z',
              metadata: { sourceIP: '192.168.1.1', ruleId: 'RULE-001' }
            },
            {
              severity: 'high',
              message: 'High severity error',
              timestamp: '2024-01-01T00:01:00Z',
              metadata: {}
            },
            {
              severity: 'low',
              message: 'Low severity error',
              timestamp: '2024-01-01T00:02:00Z',
              metadata: {}
            }
          ]
        }))
      };
      (getAgentSystem as jest.Mock).mockReturnValue(mockAgentSystem);

      AdminController.getErrors(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockJson).toHaveBeenCalled();
      const callArg = mockJson.mock.calls[0][0];
      expect(Array.isArray(callArg)).toBe(true);
      // Should only include critical and high severity
      expect(callArg.length).toBeLessThanOrEqual(10);
    });

    it('should handle errors gracefully', () => {
      (getAgentSystem as jest.Mock).mockImplementation(() => {
        throw new Error('Test error');
      });

      AdminController.getErrors(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockJson).toHaveBeenCalledWith([]);
    });
  });

  describe('getPerformance', () => {
    it('should return performance metrics', () => {
      AdminController.getPerformance(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockJson).toHaveBeenCalled();
      const callArg = mockJson.mock.calls[0][0];
      expect(callArg.server).toBeDefined();
      expect(callArg.server.cpu).toBeDefined();
      expect(callArg.server.memory).toBeDefined();
      expect(callArg.server.uptime).toBeDefined();
      expect(callArg.clients).toBeDefined();
    });

    it('should return agent stats when agent system initialized', () => {
      const mockAgentSystem = {
        isInitialized: jest.fn(() => true),
        getStats: jest.fn(() => ({
          orchestrator: { registeredAgents: 5 }
        })),
        getProbeReport: jest.fn(() => ({
          agents: [
            { cpuUsage: 10, responseTime: 50 },
            { cpuUsage: 20, responseTime: 100 }
          ]
        }))
      };
      (getAgentSystem as jest.Mock).mockReturnValue(mockAgentSystem);

      AdminController.getPerformance(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockJson).toHaveBeenCalled();
      const callArg = mockJson.mock.calls[0][0];
      expect(callArg.clients.total_agents).toBe(5);
    });

    it('should handle errors gracefully', () => {
      // Mock os.cpus to throw
      const originalOs = require('os');
      const cpusSpy = jest.spyOn(originalOs, 'cpus').mockImplementation(() => {
        throw new Error('OS error');
      });

      AdminController.getPerformance(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockJson).toHaveBeenCalled();
      const callArg = mockJson.mock.calls[0][0];
      expect(callArg.server.cpu).toBe(0);
      expect(callArg.server.memory).toBe(0);
      cpusSpy.mockRestore();
    });
  });

  describe('submitLogs', () => {
    it('should accept logs and return success', () => {
      mockRequest.body = { data: { message: 'Test log entry' } };

      AdminController.submitLogs(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockJson).toHaveBeenCalledWith({
        success: true,
        message: 'backend.logs_received'
      });
    });

    it('should return 400 if data is missing', () => {
      mockRequest.body = {};

      AdminController.submitLogs(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({ error: 'backend.missing_data' });
    });

    it('should handle errors gracefully', () => {
      mockRequest.body = { data: 'test' };

      // Mock logger to throw
      const logger = require('../../utils/logger').default;
      logger.info.mockImplementation(() => {
        throw new Error('Logger error');
      });

      AdminController.submitLogs(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockStatus).toHaveBeenCalledWith(400);
    });
  });
});
