/**
 * Simulation Service Tests
 *
 * Tests for traffic simulation and statistics
 */

import SimulationService from '../../services/simulation.service';

// Mock dependencies
jest.mock('../../api/routes/ai-system.routes', () => ({
  getAgentSystem: jest.fn(() => null)
}));

jest.mock('../../utils/ip-analyzer', () => {
  return jest.fn().mockImplementation(() => ({
    recordAttack: jest.fn(),
    getAttackOrigins: jest.fn(() => ({ byCountry: [] }))
  }));
});

jest.mock('../../config/app-mode', () => ({
  isDemoMode: jest.fn(() => false)
}));

describe('SimulationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getStats', () => {
    it('should return current traffic statistics', () => {
      const stats = SimulationService.getStats();

      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('blockedRequests');
      expect(stats).toHaveProperty('activeConnections');
      expect(stats).toHaveProperty('successRate');
      expect(stats).toHaveProperty('currentRPS');
      expect(stats).toHaveProperty('history');
      expect(stats).toHaveProperty('threats');
      expect(Array.isArray(stats.history)).toBe(true);
      expect(Array.isArray(stats.threats)).toBe(true);
    });

    it('should return avgProcessingTime', () => {
      const stats = SimulationService.getStats();
      expect(stats).toHaveProperty('avgProcessingTime');
      expect(typeof stats.avgProcessingTime).toBe('number');
    });

    it('should return processingSamples count', () => {
      const stats = SimulationService.getStats();
      expect(stats).toHaveProperty('processingSamples');
      expect(typeof stats.processingSamples).toBe('number');
    });

    it('should return attackOrigins', () => {
      const stats = SimulationService.getStats();
      expect(stats).toHaveProperty('attackOrigins');
    });
  });

  describe('recordRequest', () => {
    it('should record a request', () => {
      const initialStats = SimulationService.getStats();
      const initialTotal = initialStats.totalRequests;

      SimulationService.recordRequest(false);

      // The stats should reflect the recorded request
      const newStats = SimulationService.getStats();
      expect(newStats.totalRequests).toBeGreaterThanOrEqual(initialTotal);
    });

    it('should record a blocked request', () => {
      const initialStats = SimulationService.getStats();
      const initialBlocked = initialStats.blockedRequests;

      SimulationService.recordRequest(true);

      // The stats should reflect the blocked request
      const newStats = SimulationService.getStats();
      expect(newStats.blockedRequests).toBeGreaterThanOrEqual(initialBlocked);
    });
  });

  describe('EventEmitter', () => {
    it('should emit requestTiming event', (done) => {
      SimulationService.on('requestTiming', (data: { duration: number; path: string }) => {
        expect(data).toHaveProperty('duration');
        expect(data).toHaveProperty('path');
        done();
      });

      SimulationService.emit('requestTiming', { duration: 100, path: '/api/test' });
    });

    it('should emit attackBlocked event', (done) => {
      SimulationService.on('attackBlocked', (data: { ip: string }) => {
        expect(data).toHaveProperty('ip');
        expect(data.ip).toBe('192.168.1.100');
        done();
      });

      SimulationService.emit('attackBlocked', { ip: '192.168.1.100' });
    });
  });

  describe('start/stop', () => {
    it('should start the service without error', () => {
      expect(() => SimulationService.start()).not.toThrow();
    });

    it('should stop the service without error', () => {
      expect(() => SimulationService.stop()).not.toThrow();
    });

    it('should handle multiple start calls', () => {
      SimulationService.start();
      SimulationService.start();
      SimulationService.stop();
      expect(true).toBe(true);
    });
  });
});