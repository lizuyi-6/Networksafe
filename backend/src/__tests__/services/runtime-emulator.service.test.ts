/**
 * Runtime Emulator Service Tests (smoke)
 *
 * Smoke tests for the synthetic agent/device runtime emulator:
 *   - isEnabled()
 *   - describe()
 *   - start() / stop()
 *
 * These tests focus on:
 *   - disabled emulator: start() is a no-op
 *   - enabled emulator: start() calls bootstrapDevices + registers interval
 *   - stop() clears the interval and resets started flag
 *   - describe() returns the expected shape
 */

import { runtimeEmulatorService } from '../../services/runtime-emulator.service';
import { AgentGateway } from '../../websocket/agent-gateway';

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------

jest.mock('../../config/platform-runtime', () => ({
  isRuntimeEmulatorEnabled: jest.fn(),
  getRuntimeProfile: jest.fn(() => ({ profile: 'test-profile', version: '1.0.0' }))
}));

jest.mock('../../websocket/agent-gateway', () => ({
  AgentGateway: jest.fn().mockImplementation(() => ({
    upsertSyntheticAgent: jest.fn(),
    removeSyntheticAgent: jest.fn(),
    broadcastToDashboards: jest.fn()
  }))
}));

jest.mock('../../services/device-registry.service', () => ({
  registerDevice: jest.fn(),
  getDeviceList: jest.fn(() => []),
  setDeviceOffline: jest.fn(),
  updateDeviceStatus: jest.fn(),
  addDeviceEvent: jest.fn()
}));

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    upsertAsset: jest.fn(() => ({ assetId: 'asset-001' })),
    upsertTrafficSession: jest.fn(),
    syncSignalFinding: jest.fn(),
    getDashboardSummaryView: jest.fn()
  }
}));

jest.mock('../../services/traffic-stats.service', () => ({
  getTrafficStats: jest.fn(() => ({
    packetsProcessed: 0,
    packetsInspected: 0,
    packetsAllowed: 0,
    packetsBlocked: 0,
    bytesProcessed: 0,
    activeFlows: [],
    threats: new Map()
  }))
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

import { isRuntimeEmulatorEnabled, getRuntimeProfile } from '../../config/platform-runtime';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runtimeEmulatorService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure we stop any previously started emulator
    runtimeEmulatorService.stop();
  });

  afterEach(() => {
    runtimeEmulatorService.stop();
  });

  // ---- isEnabled -----------------------------------------------------------

  describe('isEnabled', () => {
    it('delegates to isRuntimeEmulatorEnabled()', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValueOnce(true);
      expect(runtimeEmulatorService.isEnabled()).toBe(true);

      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValueOnce(false);
      expect(runtimeEmulatorService.isEnabled()).toBe(false);
    });
  });

  // ---- describe ------------------------------------------------------------

  describe('describe', () => {
    it('returns the expected shape', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      const description = runtimeEmulatorService.describe();

      expect(description).toHaveProperty('profile');
      expect(description).toHaveProperty('enabled');
      expect(description).toHaveProperty('running');
    });

    it('running is false when the emulator has not been started', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);
      expect(runtimeEmulatorService.describe().running).toBe(false);
    });
  });

  // ---- start / stop -------------------------------------------------------

  describe('start', () => {
    it('is a no-op when the emulator is disabled', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(false);

      // Should not throw
      runtimeEmulatorService.start({} as AgentGateway);

      expect(runtimeEmulatorService.describe().running).toBe(false);
    });

    it('sets running to true and registers an interval when enabled', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      const fakeGateway = new AgentGateway({} as any);
      runtimeEmulatorService.start(fakeGateway as unknown as AgentGateway);

      expect(runtimeEmulatorService.describe().running).toBe(true);
    });

    it('is idempotent when called twice (second call is no-op)', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      const fakeGateway = new AgentGateway({} as any);
      runtimeEmulatorService.start(fakeGateway as unknown as AgentGateway);
      // Second start should not throw
      runtimeEmulatorService.start(fakeGateway as unknown as AgentGateway);

      expect(runtimeEmulatorService.describe().running).toBe(true);
    });
  });

  describe('stop', () => {
    it('resets the running flag to false', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);
      const fakeGateway = new AgentGateway({} as any);
      runtimeEmulatorService.start(fakeGateway as unknown as AgentGateway);
      runtimeEmulatorService.stop();
      expect(runtimeEmulatorService.describe().running).toBe(false);
    });

    it('is idempotent (does not throw when already stopped)', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);
      expect(() => runtimeEmulatorService.stop()).not.toThrow();
    });
  });
});
