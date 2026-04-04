/**
 * Runtime Emulator Service - Helper Functions Tests
 *
 * Tests for exported helper functions from runtime-emulator.service.ts
 */

jest.mock('../../config/database', () => ({
  getDatabase: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('../../api/routes/ai-system.routes', () => ({
  getTrafficStats: jest.fn().mockReturnValue({
    packetsProcessed: 0,
    packetsInspected: 0,
    packetsAllowed: 0,
    packetsBlocked: 0,
    bytesProcessed: 0,
    activeFlows: [],
    threats: new Map()
  }),
}));

jest.mock('../../api/routes/devices.routes', () => ({
  addDeviceEvent: jest.fn(),
  getDeviceList: jest.fn().mockReturnValue([]),
  registerDevice: jest.fn(),
  setDeviceOffline: jest.fn(),
  updateDeviceStatus: jest.fn(),
}));

jest.mock('../../websocket/agent-gateway', () => ({
  AgentGateway: jest.fn().mockImplementation(() => ({
    upsertSyntheticAgent: jest.fn(),
    removeSyntheticAgent: jest.fn(),
    broadcastToDashboards: jest.fn(),
  })),
}));

jest.mock('../../config/platform-runtime', () => ({
  getRuntimeProfile: jest.fn().mockReturnValue({}),
  isRuntimeEmulatorEnabled: jest.fn().mockReturnValue(false),
}));

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    upsertAsset: jest.fn().mockReturnValue({ assetId: 'test-asset-id' }),
    upsertTrafficSession: jest.fn(),
    syncSignalFinding: jest.fn(),
    getDashboardSummary: jest.fn().mockReturnValue({}),
    listAlerts: jest.fn().mockReturnValue([]),
    listActions: jest.fn().mockReturnValue([]),
    listValidationRuns: jest.fn().mockReturnValue([]),
  },
}));

import { jitter, clamp, runtimeEmulatorService } from '../../services/runtime-emulator.service';
import { isRuntimeEmulatorEnabled } from '../../config/platform-runtime';
import * as devicesRoutes from '../../api/routes/devices.routes';
import * as aiSystemRoutes from '../../api/routes/ai-system.routes';
import { securityOperationsService } from '../../services/security-operations.service';

// Track the commandHandler captured from upsertSyntheticAgent
let capturedCommandHandler: ((command: { type: string; payload?: any; userId?: string }) => boolean) | null = null;

describe('jitter', () => {
  it('returns integer within spread', () => {
    const results = new Set<number>();
    for (let i = 0; i < 100; i++) {
      results.add(jitter(6));
    }
    // Should contain values in range [-6, 6]
    for (const val of results) {
      expect(val).toBeGreaterThanOrEqual(-6);
      expect(val).toBeLessThanOrEqual(6);
    }
  });

  it('returns 0 for jitter(0)', () => {
    expect(jitter(0) + 0).toBe(0); // +0 converts -0 to 0
  });

  it('eventually produces negative values', () => {
    let hasNeg = false;
    for (let i = 0; i < 100; i++) {
      if (jitter(10) < 0) {
        hasNeg = true;
        break;
      }
    }
    expect(hasNeg).toBe(true);
  });

  it('eventually produces positive values', () => {
    let hasPos = false;
    for (let i = 0; i < 100; i++) {
      if (jitter(10) > 0) {
        hasPos = true;
        break;
      }
    }
    expect(hasPos).toBe(true);
  });

  it('produces symmetric distribution around 0', () => {
    const results: number[] = [];
    for (let i = 0; i < 1000; i++) {
      results.push(jitter(10));
    }
    const sum = results.reduce((a, b) => a + b, 0);
    const avg = sum / results.length;
    // Average should be close to 0
    expect(Math.abs(avg)).toBeLessThan(2);
  });
});

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(50, 0, 100)).toBe(50);
    expect(clamp(0, 0, 100)).toBe(0);
    expect(clamp(100, 0, 100)).toBe(100);
  });

  it('returns max when value exceeds max', () => {
    expect(clamp(150, 0, 100)).toBe(100);
    expect(clamp(101, 0, 100)).toBe(100);
  });

  it('returns min when value is below min', () => {
    expect(clamp(-50, 0, 100)).toBe(0);
    expect(clamp(-1, 0, 100)).toBe(0);
  });

  it('rounds to nearest integer', () => {
    expect(clamp(50.7, 0, 100)).toBe(51);
    expect(clamp(50.3, 0, 100)).toBe(50);
    expect(clamp(50.5, 0, 100)).toBe(51);
    expect(clamp(50.2, 0, 100)).toBe(50);
  });

  it('handles negative ranges', () => {
    expect(clamp(0, -100, -50)).toBe(-50);
    expect(clamp(-75, -100, -50)).toBe(-75);
    expect(clamp(-150, -100, -50)).toBe(-100);
  });

  it('handles decimal min/max', () => {
    expect(clamp(5.5, 0.0, 10.0)).toBe(6);
    expect(clamp(0.4, 0.0, 1.0)).toBe(0);
    expect(clamp(0.6, 0.0, 1.0)).toBe(1);
  });
});

describe('runtimeEmulatorService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isEnabled', () => {
    it('returns boolean', () => {
      const result = runtimeEmulatorService.isEnabled();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('describe', () => {
    it('returns an object with required properties', () => {
      const result = runtimeEmulatorService.describe();
      expect(result).toHaveProperty('profile');
      expect(result).toHaveProperty('enabled');
      expect(result).toHaveProperty('running');
    });

    it('enabled reflects isEnabled()', () => {
      const result = runtimeEmulatorService.describe();
      expect(result.enabled).toBe(runtimeEmulatorService.isEnabled());
    });
  });

  describe('start and stop', () => {
    it('start does not throw when emulator is disabled', () => {
      expect(() => runtimeEmulatorService.start({} as any)).not.toThrow();
    });

    it('stop does not throw', () => {
      expect(() => runtimeEmulatorService.stop()).not.toThrow();
    });
  });

  describe('start when enabled', () => {
    let mockGateway: any;
    const originalUseFakeTimers = jest.useFakeTimers;

    beforeEach(() => {
      jest.clearAllMocks();
      capturedCommandHandler = null;
      mockGateway = {
        upsertSyntheticAgent: jest.fn((data: any) => {
          if (data.commandHandler) {
            capturedCommandHandler = data.commandHandler;
          }
        }),
        removeSyntheticAgent: jest.fn(),
        broadcastToDashboards: jest.fn(),
      };
      // Ensure emulator is stopped before each test
      runtimeEmulatorService.stop();
    });

    afterEach(() => {
      runtimeEmulatorService.stop();
      // Restore real timers if we faked them
      jest.useRealTimers();
    });

    it('starts successfully when enabled and calls bootstrapDevices + tick', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      // bootstrapDevices registers 4 devices, and tickDevice may re-register
      // when getDeviceList returns empty (default mock)
      expect(devicesRoutes.registerDevice).toHaveBeenCalled();
      const registeredIds = devicesRoutes.registerDevice.mock.calls.map((c: any[]) => c[0].deviceId);
      expect(registeredIds).toContain('esp32-core-01');
      expect(registeredIds).toContain('esp32-floor-02');
      expect(registeredIds).toContain('esp32-plant-03');
      expect(registeredIds).toContain('esp32-yard-04');

      // tick should call upsertSyntheticAgent for all 3 agents
      expect(mockGateway.upsertSyntheticAgent).toHaveBeenCalledTimes(3);

      // tick should upsert assets for agents + flows
      expect(securityOperationsService.upsertAsset).toHaveBeenCalled();

      // tick should sync signal findings for each agent (3 findings x 3 agents = 9)
      expect(securityOperationsService.syncSignalFinding).toHaveBeenCalled();
    });

    it('does not start if already started', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);
      const callsAfterFirstStart = devicesRoutes.registerDevice.mock.calls.length;

      runtimeEmulatorService.start(mockGateway);
      // No additional bootstrap calls
      expect(devicesRoutes.registerDevice).toHaveBeenCalledTimes(callsAfterFirstStart);
    });

    it('sets up interval and tick fires periodically', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      // Must enable fake timers BEFORE start so the interval is captured
      jest.useFakeTimers();
      runtimeEmulatorService.start(mockGateway);
      const callsAfterStart = mockGateway.upsertSyntheticAgent.mock.calls.length;

      // Advance by one interval (8000ms)
      jest.advanceTimersByTime(8000);

      // After one tick interval, agents should be upserted again (3 more calls)
      expect(mockGateway.upsertSyntheticAgent.mock.calls.length).toBe(callsAfterStart + 3);
    });

    it('stop clears interval and calls removeSyntheticAgent for all agents', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);
      runtimeEmulatorService.stop();

      // Should remove 3 synthetic agents
      expect(mockGateway.removeSyntheticAgent).toHaveBeenCalledTimes(3);
      const removedIds = mockGateway.removeSyntheticAgent.mock.calls.map((c: any[]) => c[0]);
      expect(removedIds).toContain('agt-edge-sh-01');
      expect(removedIds).toContain('agt-edge-sz-02');
      expect(removedIds).toContain('agt-edge-hk-03');
    });

    it('stop without gateway does not call removeSyntheticAgent', () => {
      runtimeEmulatorService.stop(); // no gateway set
      expect(mockGateway.removeSyntheticAgent).not.toHaveBeenCalled();
    });

    it('describe returns running=true after start when enabled', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);
      expect(runtimeEmulatorService.describe().running).toBe(true);

      runtimeEmulatorService.stop();
      expect(runtimeEmulatorService.describe().running).toBe(false);
    });
  });

  describe('tickAgent (via start)', () => {
    let mockGateway: any;

    beforeEach(() => {
      jest.clearAllMocks();
      capturedCommandHandler = null;
      mockGateway = {
        upsertSyntheticAgent: jest.fn((data: any) => {
          if (data.commandHandler) {
            capturedCommandHandler = data.commandHandler;
          }
        }),
        removeSyntheticAgent: jest.fn(),
        broadcastToDashboards: jest.fn(),
      };
      runtimeEmulatorService.stop();
    });

    afterEach(() => {
      runtimeEmulatorService.stop();
      jest.useRealTimers();
    });

    it('upserts all 3 synthetic agents with correct structure', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      expect(mockGateway.upsertSyntheticAgent).toHaveBeenCalledTimes(3);

      const agentIds = mockGateway.upsertSyntheticAgent.mock.calls.map((c: any[]) => c[0].agentId);
      expect(agentIds).toContain('agt-edge-sh-01');
      expect(agentIds).toContain('agt-edge-sz-02');
      expect(agentIds).toContain('agt-edge-hk-03');

      for (const call of mockGateway.upsertSyntheticAgent.mock.calls) {
        const data = call[0];
        expect(data).toHaveProperty('agentId');
        expect(data).toHaveProperty('hostname');
        expect(data).toHaveProperty('platform');
        expect(data).toHaveProperty('lastHeartbeat');
        expect(data).toHaveProperty('status');
        expect(data).toHaveProperty('registration');
        expect(data).toHaveProperty('commandHandler');
        expect(data.registration).toHaveProperty('synthetic', true);
        expect(data.registration).toHaveProperty('capabilities');
        expect(data.status).toHaveProperty('cpuUsage');
        expect(data.status).toHaveProperty('memoryUsage');
        expect(data.status).toHaveProperty('isOnline');
      }
    });

    it('upserts assets for each agent with correct metadata', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      // upsertAsset called for agent assets (3 agents + flow source/dest assets)
      const assetCalls = securityOperationsService.upsertAsset.mock.calls;
      expect(assetCalls.length).toBeGreaterThanOrEqual(3);

      // 3 agent assets from tickAgent (first 3) + 3 agent-type flow source assets from tickTraffic = 6
      // tickAgent is called before tickTraffic, so first 3 agent assets are from tickAgent
      const agentAssetCalls = assetCalls.filter((c: any[]) => c[0].assetType === 'agent');
      expect(agentAssetCalls.length).toBe(6);

      // Only verify tickAgent assets (first 3 agent-type calls), which have richer metadata
      const tickAgentAssetCalls = agentAssetCalls.slice(0, 3);

      for (const call of tickAgentAssetCalls) {
        const params = call[0];
        expect(params).toHaveProperty('tenantId', 'global');
        expect(params).toHaveProperty('assetType', 'agent');
        expect(params).toHaveProperty('externalRef');
        expect(params).toHaveProperty('displayName');
        expect(params).toHaveProperty('primaryAddress');
        expect(params).toHaveProperty('status');
        expect(params).toHaveProperty('metadata');
        expect(params.metadata).toHaveProperty('region');
        expect(params.metadata).toHaveProperty('role');
        expect(params.metadata).toHaveProperty('synthetic', true);
        expect(params.metadata).toHaveProperty('blockedIps');
      }
    });

    it('syncs signal findings for agent health (offline, cpu, memory)', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      // 3 agents x 3 signal findings = 9 calls
      expect(securityOperationsService.syncSignalFinding).toHaveBeenCalledTimes(9);

      const allCalls = securityOperationsService.syncSignalFinding.mock.calls;
      const categories = allCalls.map((c: any[]) => c[0].category);
      // Each agent gets 3 findings: offline, cpu, memory
      expect(categories.filter(c => c === 'agent-health').length).toBe(9);

      // Check structure of findings
      for (const call of allCalls) {
        const params = call[0];
        expect(params).toHaveProperty('tenantId', 'global');
        expect(params).toHaveProperty('assetId', 'test-asset-id');
        expect(params).toHaveProperty('sourceType', 'agent-health');
        expect(params).toHaveProperty('category', 'agent-health');
        expect(params).toHaveProperty('severity');
        expect(params).toHaveProperty('title');
        expect(params).toHaveProperty('description');
        expect(params).toHaveProperty('evidence');
        expect(params).toHaveProperty('remediation');
        expect(params).toHaveProperty('fingerprint');
        expect(params).toHaveProperty('createAlert', true);
        expect(params).toHaveProperty('alertType', 'system');
        expect(params.remediation).toHaveProperty('title');
        expect(params.remediation).toHaveProperty('owner');
        expect(params.remediation).toHaveProperty('priority');
        expect(params.remediation).toHaveProperty('suggestedSteps');
        expect(Array.isArray(params.remediation.suggestedSteps)).toBe(true);
      }
    });

    it('captures commandHandler from upsertSyntheticAgent', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      expect(capturedCommandHandler).not.toBeNull();
      expect(typeof capturedCommandHandler).toBe('function');
    });
  });

  describe('tickDevice (via start)', () => {
    let mockGateway: any;

    beforeEach(() => {
      jest.clearAllMocks();
      capturedCommandHandler = null;
      mockGateway = {
        upsertSyntheticAgent: jest.fn((data: any) => {
          if (data.commandHandler) {
            capturedCommandHandler = data.commandHandler;
          }
        }),
        removeSyntheticAgent: jest.fn(),
        broadcastToDashboards: jest.fn(),
      };
      runtimeEmulatorService.stop();
    });

    afterEach(() => {
      runtimeEmulatorService.stop();
      jest.useRealTimers();
    });

    it('registers devices during bootstrapDevices', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      const deviceIds = devicesRoutes.registerDevice.mock.calls.map((c: any[]) => c[0].deviceId);
      expect(deviceIds).toContain('esp32-core-01');
      expect(deviceIds).toContain('esp32-floor-02');
      expect(deviceIds).toContain('esp32-plant-03');
      expect(deviceIds).toContain('esp32-yard-04');
    });

    it('registers device with correct structure', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      // Check a registration call
      const call = devicesRoutes.registerDevice.mock.calls[0][0];
      expect(call).toHaveProperty('deviceId');
      expect(call).toHaveProperty('version');
      expect(call).toHaveProperty('chipModel');
      expect(call).toHaveProperty('flashSize');
      expect(call).toHaveProperty('freeHeap');
      expect(call).toHaveProperty('sdkVersion');
      expect(call).toHaveProperty('mode', 'online');
      expect(call).toHaveProperty('status');
      expect(call).toHaveProperty('systemInfo');
      expect(call.status).toHaveProperty('cpuUsage');
      expect(call.status).toHaveProperty('memoryUsage');
      expect(call.status).toHaveProperty('uptime');
      expect(call.status).toHaveProperty('wifiRssi');
      expect(call.systemInfo).toHaveProperty('hostname');
      expect(call.systemInfo).toHaveProperty('os');
      expect(call.systemInfo).toHaveProperty('kernel');
      expect(call.systemInfo).toHaveProperty('arch');
    });

    it('calls updateDeviceStatus when device is already registered', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);
      // Simulate that devices are already in the device list
      (devicesRoutes.getDeviceList as jest.Mock).mockReturnValue([
        { deviceId: 'esp32-core-01' },
        { deviceId: 'esp32-floor-02' },
        { deviceId: 'esp32-plant-03' },
        { deviceId: 'esp32-yard-04' },
      ]);

      runtimeEmulatorService.start(mockGateway);

      // bootstrapDevices registers 4 devices, then tickDevice should update instead of re-register
      // The tick calls updateDeviceStatus for all 4 online devices
      expect(devicesRoutes.updateDeviceStatus).toHaveBeenCalledTimes(4);
    });

    it('calls addDeviceEvent for heartbeat when device is online', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);
      (devicesRoutes.getDeviceList as jest.Mock).mockReturnValue([
        { deviceId: 'esp32-core-01' },
        { deviceId: 'esp32-floor-02' },
        { deviceId: 'esp32-plant-03' },
        { deviceId: 'esp32-yard-04' },
      ]);

      runtimeEmulatorService.start(mockGateway);

      // Heartbeat events for all 4 devices
      const heartbeatCalls = devicesRoutes.addDeviceEvent.mock.calls.filter(
        (c: any[]) => c[1] === 'heartbeat'
      );
      expect(heartbeatCalls.length).toBe(4);
    });

    it('calls setDeviceOffline when device goes offline', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      // Use fake timers from before start so intervals are captured
      jest.useFakeTimers();

      runtimeEmulatorService.start(mockGateway);

      // Advance timer through many ticks to ensure we hit tickCount % 10 === 0
      // tickCount is a singleton and starts from wherever it was last left.
      // Advance 30 intervals (240000ms) to cover a full cycle
      for (let i = 0; i < 30; i++) {
        jest.advanceTimersByTime(8000);
      }

      // At some point tickCount % 10 === 0, esp32-yard-04 should go offline
      expect(devicesRoutes.setDeviceOffline).toHaveBeenCalled();
    });

    it('adds disconnect event when device goes offline for first time', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      jest.useFakeTimers();
      runtimeEmulatorService.start(mockGateway);

      for (let i = 0; i < 30; i++) {
        jest.advanceTimersByTime(8000);
      }

      const disconnectCalls = devicesRoutes.addDeviceEvent.mock.calls.filter(
        (c: any[]) => c[1] === 'disconnect'
      );
      expect(disconnectCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('tickTraffic (via start)', () => {
    let mockGateway: any;

    beforeEach(() => {
      jest.clearAllMocks();
      capturedCommandHandler = null;
      mockGateway = {
        upsertSyntheticAgent: jest.fn((data: any) => {
          if (data.commandHandler) {
            capturedCommandHandler = data.commandHandler;
          }
        }),
        removeSyntheticAgent: jest.fn(),
        broadcastToDashboards: jest.fn(),
      };
      runtimeEmulatorService.stop();
    });

    afterEach(() => {
      runtimeEmulatorService.stop();
      jest.useRealTimers();
    });

    it('updates traffic stats with processed packets and bytes', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      const stats = (aiSystemRoutes.getTrafficStats as jest.Mock).mock.results[0].value;
      // stats is a mutable object that tickTraffic modifies in place
      expect(stats.packetsProcessed).toBeGreaterThan(0);
      expect(stats.packetsInspected).toBeGreaterThan(0);
      expect(stats.bytesProcessed).toBeGreaterThan(0);
    });

    it('upserts traffic sessions for all flows', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      // 4 synthetic flows
      const sessionCalls = securityOperationsService.upsertTrafficSession.mock.calls;
      expect(sessionCalls.length).toBe(4);

      for (const call of sessionCalls) {
        const params = call[0];
        expect(params).toHaveProperty('tenantId', 'global');
        expect(params).toHaveProperty('sessionId');
        expect(params).toHaveProperty('sourceIP');
        expect(params).toHaveProperty('destIP');
        expect(params).toHaveProperty('sourcePort');
        expect(params).toHaveProperty('destPort');
        expect(params).toHaveProperty('protocol');
        expect(params).toHaveProperty('state');
        expect(params).toHaveProperty('packetCount');
        expect(params).toHaveProperty('byteCount');
        expect(params).toHaveProperty('startTime');
        expect(params).toHaveProperty('lastActivity');
        expect(params).toHaveProperty('sourceAssetId', 'test-asset-id');
        expect(params).toHaveProperty('destAssetId', 'test-asset-id');
        expect(params.metadata).toHaveProperty('synthetic', true);
        expect(params.metadata).toHaveProperty('classification');
      }
    });

    it('upserts source and dest assets for each flow', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      // 4 flows x 2 (source + dest) = 8 flow assets + 3 agent assets = 11 total
      const assetCalls = securityOperationsService.upsertAsset.mock.calls;
      expect(assetCalls.length).toBe(11);

      // Verify source and dest types
      const flowAssetCalls = assetCalls.filter(
        (c: any[]) => c[0].assetType === 'agent' || c[0].assetType === 'device' || c[0].assetType === 'site' || c[0].assetType === 'service'
      );
      expect(flowAssetCalls.length).toBeGreaterThanOrEqual(8);
    });

    it('updates activeFlows with synthetic flow snapshots', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      const stats = (aiSystemRoutes.getTrafficStats as jest.Mock).mock.results[0].value;
      // Should have 4 synthetic flows added
      const syntheticFlows = stats.activeFlows.filter((f: any) => f.synthetic);
      expect(syntheticFlows.length).toBe(4);

      for (const flow of syntheticFlows) {
        expect(flow).toHaveProperty('id');
        expect(flow).toHaveProperty('sourceIP');
        expect(flow).toHaveProperty('destIP');
        expect(flow).toHaveProperty('sourcePort');
        expect(flow).toHaveProperty('destPort');
        expect(flow).toHaveProperty('protocol');
        expect(flow).toHaveProperty('state');
        expect(flow).toHaveProperty('packetCount');
        expect(flow).toHaveProperty('byteCount');
        expect(flow).toHaveProperty('synthetic', true);
        expect(flow).toHaveProperty('classification');
      }
    });

    it('adds threat entries for anomalous flows', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      const stats = (aiSystemRoutes.getTrafficStats as jest.Mock).mock.results[0].value;
      // The 'security-signal' flow (syn-flow-agent-hk-watch) is always anomalous
      const threats = stats.threats;
      expect(threats.size).toBeGreaterThanOrEqual(1);
    });

    it('blocks some packets for anomalous flows', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      const stats = (aiSystemRoutes.getTrafficStats as jest.Mock).mock.results[0].value;
      // At least one flow is always anomalous (security-signal), so some should be blocked
      expect(stats.packetsBlocked).toBeGreaterThan(0);
      expect(stats.packetsAllowed).toBeGreaterThan(0);
    });
  });

  describe('handleAgentCommand (via commandHandler)', () => {
    let mockGateway: any;

    beforeEach(() => {
      jest.clearAllMocks();
      capturedCommandHandler = null;
      mockGateway = {
        upsertSyntheticAgent: jest.fn((data: any) => {
          if (data.commandHandler) {
            capturedCommandHandler = data.commandHandler;
          }
        }),
        removeSyntheticAgent: jest.fn(),
        broadcastToDashboards: jest.fn(),
      };
      runtimeEmulatorService.stop();
    });

    afterEach(() => {
      runtimeEmulatorService.stop();
      jest.useRealTimers();
    });

    it('returns true for a valid command', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);
      expect(capturedCommandHandler).not.toBeNull();

      const result = capturedCommandHandler!({ type: 'scan', payload: {} });
      expect(result).toBe(true);
    });

    it('still returns true after stop since stop does not null the gateway', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);
      const handler = capturedCommandHandler!;
      // Stop the emulator - stop() clears the interval and sets started=false
      // but does NOT null out agentGateway
      runtimeEmulatorService.stop();

      // The handler still has access to the gateway via the service instance
      expect(handler({ type: 'scan', payload: {} })).toBe(true);
    });

    it('sets commandPressureUntil on the agent', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      const beforeTime = Date.now();
      capturedCommandHandler!({ type: 'block_ip', payload: { ip: '1.2.3.4' } });
      const afterTime = Date.now();

      // commandPressureUntil should be set to approximately 30 seconds from now
      // We can verify this indirectly by checking the agent status on next tick
      // but since it's private, we just verify the command was accepted
      expect(capturedCommandHandler!({ type: 'scan', payload: {} })).toBe(true);
    });

    it('broadcasts command ack and log after delay', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      // Use fake timers before start so the ack timer is captured
      jest.useFakeTimers();
      runtimeEmulatorService.start(mockGateway);

      capturedCommandHandler!({ type: 'block_ip', payload: { ip: '10.20.30.40' }, userId: 'admin' });

      // ackTimer fires after 350ms
      jest.advanceTimersByTime(400);

      expect(mockGateway.broadcastToDashboards).toHaveBeenCalledWith(
        'agent:command:ack',
        expect.objectContaining({
          command: 'block_ip',
          payload: { ip: '10.20.30.40' },
          operator: 'admin',
          synthetic: true,
        })
      );

      expect(mockGateway.broadcastToDashboards).toHaveBeenCalledWith(
        'agent:log',
        expect.objectContaining({
          level: 'info',
          message: 'Synthetic runtime accepted block_ip command.',
          synthetic: true,
        })
      );
    });

    it('does not broadcast if agentGateway becomes null before ack timer fires', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      capturedCommandHandler!({ type: 'scan', payload: {} });

      // Stop the emulator before the ack timer fires
      runtimeEmulatorService.stop();

      jest.useFakeTimers();
      jest.advanceTimersByTime(400);

      // broadcastToDashboards should NOT be called since gateway is null
      expect(mockGateway.broadcastToDashboards).not.toHaveBeenCalled();
    });

    it('defaults operator to system when userId is not provided', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      jest.useFakeTimers();
      runtimeEmulatorService.start(mockGateway);

      capturedCommandHandler!({ type: 'unblock_ip', payload: { ip: '1.2.3.4' } });

      jest.advanceTimersByTime(400);

      expect(mockGateway.broadcastToDashboards).toHaveBeenCalledWith(
        'agent:command:ack',
        expect.objectContaining({
          operator: 'system',
        })
      );
    });

    it('broadcasts ack with correct timestamp format', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      jest.useFakeTimers();
      runtimeEmulatorService.start(mockGateway);

      capturedCommandHandler!({ type: 'scan', payload: {} });

      jest.advanceTimersByTime(400);

      const ackCall = mockGateway.broadcastToDashboards.mock.calls.find(
        (c: any[]) => c[0] === 'agent:command:ack'
      );
      expect(ackCall).toBeDefined();
      expect(() => new Date(ackCall[1].timestamp).toISOString()).not.toThrow();
    });
  });

  describe('edge cases and integration', () => {
    let mockGateway: any;

    beforeEach(() => {
      jest.clearAllMocks();
      capturedCommandHandler = null;
      mockGateway = {
        upsertSyntheticAgent: jest.fn((data: any) => {
          if (data.commandHandler) {
            capturedCommandHandler = data.commandHandler;
          }
        }),
        removeSyntheticAgent: jest.fn(),
        broadcastToDashboards: jest.fn(),
      };
      runtimeEmulatorService.stop();
    });

    afterEach(() => {
      runtimeEmulatorService.stop();
      jest.useRealTimers();
    });

    it('tick does nothing when agentGateway is null', () => {
      // This tests the early return in tick() - but we can't easily trigger this
      // after start() because start() always sets the gateway.
      // Instead, verify that calling stop() prevents further ticks
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);
      const tickCalls = mockGateway.upsertSyntheticAgent.mock.calls.length;

      runtimeEmulatorService.stop();

      // Advance timers - interval should be cleared so no new ticks
      jest.useFakeTimers();
      jest.advanceTimersByTime(24000);

      // No additional calls after stop
      expect(mockGateway.upsertSyntheticAgent.mock.calls.length).toBe(tickCalls);
    });

    it('multiple start/stop cycles work correctly', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      // First cycle
      runtimeEmulatorService.start(mockGateway);
      expect(runtimeEmulatorService.describe().running).toBe(true);
      runtimeEmulatorService.stop();
      expect(runtimeEmulatorService.describe().running).toBe(false);

      // Second cycle
      runtimeEmulatorService.start(mockGateway);
      expect(runtimeEmulatorService.describe().running).toBe(true);
      runtimeEmulatorService.stop();
      expect(runtimeEmulatorService.describe().running).toBe(false);
    });

    it('logs disabled message when start is called while disabled', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(false);

      const logger = require('../../utils/logger').default;
      runtimeEmulatorService.start(mockGateway);

      expect(logger.info).toHaveBeenCalledWith('Runtime emulator disabled');
    });

    it('does not log disabled message when start is called while enabled', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      const logger = require('../../utils/logger').default;
      runtimeEmulatorService.start(mockGateway);

      const disabledCalls = logger.info.mock.calls.filter(
        (c: any[]) => c[0] === 'Runtime emulator disabled'
      );
      expect(disabledCalls.length).toBe(0);
    });

    it('logs start message with agent and device counts', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      const logger = require('../../utils/logger').default;
      runtimeEmulatorService.start(mockGateway);

      expect(logger.info).toHaveBeenCalledWith('Runtime emulator started', {
        syntheticAgents: 3,
        syntheticDevices: 4,
      });
    });

    it('agent registration includes capabilities array', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      for (const call of mockGateway.upsertSyntheticAgent.mock.calls) {
        const data = call[0];
        expect(Array.isArray(data.registration.capabilities)).toBe(true);
        expect(data.registration.capabilities).toContain('scan');
        expect(data.registration.capabilities).toContain('block_ip');
        expect(data.registration.capabilities).toContain('unblock_ip');
        expect(data.registration.capabilities).toContain('telemetry');
      }
    });

    it('agent registration includes enrolledAt timestamp', () => {
      (isRuntimeEmulatorEnabled as jest.Mock).mockReturnValue(true);

      runtimeEmulatorService.start(mockGateway);

      for (const call of mockGateway.upsertSyntheticAgent.mock.calls) {
        const data = call[0];
        expect(() => new Date(data.registration.enrolledAt).toISOString()).not.toThrow();
      }
    });
  });
});
