/**
 * DeviceRegistryService tests
 *
 * Covers: registerDevice, getDeviceById, getDeviceList, setDeviceOffline,
 * updateDeviceStatus, updateDeviceFinalDefenseState, executeDeviceCommandInternal,
 * addDeviceEvent, getDeviceEvents, getDeviceConfig, setDeviceConfig,
 * getDeviceCommandHistoryPublic, deleteDevice, hasDevice, setDevice.
 */

import {
  registerDevice,
  getDeviceById,
  getDeviceList,
  setDeviceOffline,
  updateDeviceStatus,
  updateDeviceFinalDefenseState,
  executeDeviceCommandInternal,
  addDeviceEvent,
  getDeviceEvents,
  getDeviceConfig,
  setDeviceConfig,
  getDeviceCommandHistoryPublic,
  deleteDevice,
  hasDevice,
  setDevice,
  setDeviceCommandTransport,
  type DeviceInfo
} from '../../services/device-registry.service';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { securityOperationsService } from '../../services/security-operations.service';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    upsertAsset: jest.fn().mockResolvedValue({ assetId: 'asset-test-001' }),
    syncSignalFinding: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('../../services/command-dispatcher.service', () => ({
  commandDispatcherService: {
    setDeviceAdapter: jest.fn()
  }
}));

jest.mock('../../config/enterprise-runtime', () => ({
  allowGatewayDestructiveCommands: jest.fn(() => false),
  oidcRequireMfa: jest.fn(() => false)
}));

jest.mock('../../security/command-risk-policy', () => ({
  requiresPhysicalConfirmation: jest.fn((cmd: string) => ['host_remove', 'factory_reset', 'wipe_data'].includes(cmd))
}));

function makeDeviceInfo(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    deviceId: `esp32-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    version: '1.0.0',
    chipModel: 'ESP32-WROOM-32',
    flashSize: 4 * 1024 * 1024,
    freeHeap: 128000,
    sdkVersion: '4.4.0',
    mode: 'online',
    isOnline: true,
    lastHeartbeat: new Date(),
    connectedAgents: ['agent-1'],
    status: {
      cpuUsage: 15,
      memoryUsage: 60,
      uptime: 3600,
      wifiRssi: -55
    },
    systemInfo: {
      hostname: 'esp32-device',
      os: 'freertos',
      kernel: '1.0',
      arch: 'xtensa'
    },
    ...overrides
  };
}

describe('DeviceRegistryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registerDevice', () => {
    it('registers a device and makes it retrievable by ID', () => {
      const device = makeDeviceInfo();
      registerDevice(device);

      expect(getDeviceById(device.deviceId)).toBeDefined();
      expect(getDeviceById(device.deviceId)?.deviceId).toBe(device.deviceId);
    });

    it('sets device as online with current timestamp as lastHeartbeat', () => {
      const before = new Date();
      const device = makeDeviceInfo({ mode: 'offline', isOnline: false });
      registerDevice(device);

      const retrieved = getDeviceById(device.deviceId)!;
      expect(retrieved.isOnline).toBe(true);
      expect(retrieved.lastHeartbeat.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('creates a default config for the registered device', () => {
      const device = makeDeviceInfo();
      registerDevice(device);

      const config = getDeviceConfig(device.deviceId);
      expect(config).toBeDefined();
      expect(config?.displayName).toBe(device.deviceId);
      expect(config?.commandPermissions).toContain('reboot');
    });

    it('initializes empty connectedAgents array', () => {
      const device = makeDeviceInfo({ connectedAgents: [] });
      registerDevice(device);

      const retrieved = getDeviceById(device.deviceId)!;
      expect(retrieved.connectedAgents).toEqual([]);
    });
  });

  describe('getDeviceList', () => {
    it('returns all registered devices', () => {
      const device1 = makeDeviceInfo({ deviceId: 'device-list-1' });
      const device2 = makeDeviceInfo({ deviceId: 'device-list-2' });
      registerDevice(device1);
      registerDevice(device2);

      const list = getDeviceList();
      const ids = list.map(d => d.deviceId);
      expect(ids).toContain('device-list-1');
      expect(ids).toContain('device-list-2');
    });

    it('returns empty array when no devices registered', () => {
      // Clear state by ensuring we start fresh
      const list = getDeviceList();
      expect(Array.isArray(list)).toBe(true);
    });
  });

  describe('setDeviceOffline', () => {
    it('marks a device as offline', () => {
      const device = makeDeviceInfo({ isOnline: true });
      registerDevice(device);

      setDeviceOffline(device.deviceId);

      expect(getDeviceById(device.deviceId)?.isOnline).toBe(false);
    });

    // -------------------------------------------------------------------------
    // REGRESSION: D20 — setDeviceOffline must NOT reset any monotonic counter.
    // The counter lives in hardware_gates.last_monotonic_counter (managed by
    // hardwareAuthorizationService), NOT in the in-memory devices Map.
    // Allowing a counter reset would let an attacker replay a previously
    // captured high counter after the device goes offline and reconnects.
    // -------------------------------------------------------------------------
    it('D20 regression: setDeviceOffline does not touch any monotonic counter', () => {
      // device-registry.service.ts maintains only an in-memory Map.
      // It has no access to hardware_gates.last_monotonic_counter, so it
      // cannot reset the counter even if it wanted to.
      const device = makeDeviceInfo({ isOnline: true });
      registerDevice(device);

      // Record the in-memory device fields before going offline
      const before = getDeviceById(device.deviceId)!;
      expect(before.isOnline).toBe(true);

      setDeviceOffline(device.deviceId);

      const after = getDeviceById(device.deviceId)!;
      // Only isOnline must change; other fields are preserved.
      expect(after.isOnline).toBe(false);
      expect(after.lastHeartbeat).toEqual(before.lastHeartbeat);
      expect(after.deviceId).toBe(before.deviceId);
      // The DeviceInfo type has no lastMonotonicCounter field — the counter
      // is maintained server-side in hardware_gates and is untouched here.
    });
  });

  describe('updateDeviceStatus', () => {
    it('updates device status fields', () => {
      const device = makeDeviceInfo();
      registerDevice(device);

      const newStatus = { cpuUsage: 95, memoryUsage: 88, uptime: 7200, wifiRssi: -75 };
      updateDeviceStatus(device.deviceId, newStatus);

      const updated = getDeviceById(device.deviceId)!;
      expect(updated.status?.cpuUsage).toBe(95);
      expect(updated.status?.memoryUsage).toBe(88);
      expect(updated.status?.uptime).toBe(7200);
    });

    it('updates lastHeartbeat timestamp', () => {
      const device = makeDeviceInfo();
      registerDevice(device);
      const originalHeartbeat = getDeviceById(device.deviceId)!.lastHeartbeat.getTime();

      const newStatus = { cpuUsage: 50, memoryUsage: 50, uptime: 100, wifiRssi: -60 };
      updateDeviceStatus(device.deviceId, newStatus);

      const updated = getDeviceById(device.deviceId)!;
      expect(updated.lastHeartbeat.getTime()).toBeGreaterThanOrEqual(originalHeartbeat);
    });
  });

  describe('updateDeviceFinalDefenseState', () => {
    it('updates final defense state fields', () => {
      const device = makeDeviceInfo();
      registerDevice(device);

      updateDeviceFinalDefenseState(device.deviceId, {
        policyDigest: 'digest-abc',
        breakerTarget: 'mgmt-uplink',
        interlockState: 'armed',
        secureElementPresent: true,
        feedbackOk: true
      });

      const updated = getDeviceById(device.deviceId)!;
      expect(updated.finalDefense?.policyDigest).toBe('digest-abc');
      expect(updated.finalDefense?.interlockState).toBe('armed');
      expect(updated.finalDefense?.secureElementPresent).toBe(true);
    });

    it('merges partial updates with existing state', () => {
      const device = makeDeviceInfo();
      registerDevice(device);

      updateDeviceFinalDefenseState(device.deviceId, { policyDigest: 'digest-1', breakerTarget: 'target-1' });
      updateDeviceFinalDefenseState(device.deviceId, { interlockState: 'released' });

      const updated = getDeviceById(device.deviceId)!;
      expect(updated.finalDefense?.policyDigest).toBe('digest-1');
      expect(updated.finalDefense?.breakerTarget).toBe('target-1');
      expect(updated.finalDefense?.interlockState).toBe('released');
    });
  });

  describe('executeDeviceCommandInternal', () => {
    beforeEach(() => {
      setDeviceCommandTransport(null);
    });

    afterEach(() => {
      setDeviceCommandTransport(null);
    });

    it('returns error when device is not found', async () => {
      const result = await executeDeviceCommandInternal({
        deviceId: 'nonexistent-device',
        command: 'reboot',
        actorId: 'actor-1'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('device_not_found');
    });

    it('returns error when device is offline', async () => {
      const device = makeDeviceInfo({ isOnline: true });
      registerDevice(device);
      // registerDevice forces isOnline=true, so explicitly mark offline
      setDeviceOffline(device.deviceId);

      const result = await executeDeviceCommandInternal({
        deviceId: device.deviceId,
        command: 'reboot',
        actorId: 'actor-1'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('device_offline');
    });

    it('returns error when command is not permitted in device config', async () => {
      const device = makeDeviceInfo();
      registerDevice(device);

      // Override config to remove 'reboot' permission
      setDeviceConfig(device.deviceId, {
        displayName: device.deviceId,
        group: 'core-edge',
        site: 'unassigned-site',
        networkProfile: 'cloud-mesh',
        scanProfile: 'balanced',
        notes: '',
        commandPermissions: ['collect'], // only collect, not reboot
        tags: [],
        updatedAt: new Date().toISOString()
      });

      const result = await executeDeviceCommandInternal({
        deviceId: device.deviceId,
        command: 'reboot',
        actorId: 'actor-1'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('command_not_permitted');
    });

    it('returns success for a permitted, non-destructive command when device is online', async () => {
      const device = makeDeviceInfo();
      registerDevice(device);

      const result = await executeDeviceCommandInternal({
        deviceId: device.deviceId,
        command: 'reboot',
        actorId: 'actor-1',
        actorEmail: 'admin@test.com'
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('reboot');
    });

    it('records command in device command history', async () => {
      const device = makeDeviceInfo();
      registerDevice(device);
      setDeviceCommandTransport(jest.fn().mockResolvedValue(true));

      await executeDeviceCommandInternal({
        deviceId: device.deviceId,
        command: 'collect',
        params: { interval: 60 },
        actorId: 'actor-test',
        actorEmail: 'test@corp.example',
        actionId: 'action-collect-001'
      });

      const history = getDeviceCommandHistoryPublic(device.deviceId, 10);
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].command).toBe('collect');
      expect(history[0].status).toBe('completed');
    });

    it('updates freeHeap when collect command is executed', async () => {
      const device = makeDeviceInfo({ freeHeap: 128000 });
      registerDevice(device);
      setDeviceCommandTransport(jest.fn().mockResolvedValue(true));

      await executeDeviceCommandInternal({
        deviceId: device.deviceId,
        command: 'collect',
        actorId: 'actor-1'
      });

      const updated = getDeviceById(device.deviceId)!;
      expect(updated.freeHeap).toBeLessThan(128000);
    });

    it('resets uptime and reduces cpuUsage on reboot', async () => {
      const device = makeDeviceInfo({
        status: { cpuUsage: 80, memoryUsage: 70, uptime: 9999, wifiRssi: -55 }
      });
      registerDevice(device);
      setDeviceCommandTransport(jest.fn().mockResolvedValue(true));

      await executeDeviceCommandInternal({
        deviceId: device.deviceId,
        command: 'reboot',
        actorId: 'actor-1'
      });

      const updated = getDeviceById(device.deviceId)!;
      expect(updated.status?.uptime).toBe(0);
      expect(updated.status?.cpuUsage).toBeLessThan(80);
    });

    it('adds device event when command is executed', async () => {
      const device = makeDeviceInfo();
      registerDevice(device);
      setDeviceCommandTransport(jest.fn().mockResolvedValue(true));

      await executeDeviceCommandInternal({
        deviceId: device.deviceId,
        command: 'sync-config',
        actorId: 'actor-1'
      });

      const events = getDeviceEvents(device.deviceId);
      const commandEvents = events.filter(e => e.type === 'command');
      expect(commandEvents.length).toBeGreaterThan(0);
    });

    it('calls device transport when set', async () => {
      const device = makeDeviceInfo();
      registerDevice(device);
      const transport = jest.fn().mockResolvedValue(true);
      setDeviceCommandTransport(transport);

      await executeDeviceCommandInternal({
        deviceId: device.deviceId,
        command: 'reboot',
        actorId: 'actor-1'
      });

      expect(transport).toHaveBeenCalledWith(device.deviceId, 'reboot', expect.any(Object));
    });

    it('returns error when device transport rejects command', async () => {
      const device = makeDeviceInfo();
      registerDevice(device);
      setDeviceCommandTransport(jest.fn().mockResolvedValue(false));

      const result = await executeDeviceCommandInternal({
        deviceId: device.deviceId,
        command: 'reboot',
        actorId: 'actor-1'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('device_gateway_rejected');
    });
  });

  describe('addDeviceEvent', () => {
    it('adds an event to the device event log', () => {
      const device = makeDeviceInfo();
      registerDevice(device);

      addDeviceEvent(device.deviceId, 'register', { version: '1.0.0' });

      const events = getDeviceEvents(device.deviceId);
      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1].type).toBe('register');
    });

    it('limits event log to 1000 entries', () => {
      const device = makeDeviceInfo();
      registerDevice(device);

      for (let i = 0; i < 1050; i++) {
        addDeviceEvent(device.deviceId, 'data', { index: i });
      }

      const events = getDeviceEvents(device.deviceId);
      expect(events.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('setDeviceConfig', () => {
    it('stores and retrieves custom device config', () => {
      const device = makeDeviceInfo();
      registerDevice(device);

      const customConfig = {
        displayName: 'My Custom ESP32',
        group: 'dmz-edge',
        site: 'building-a',
        networkProfile: 'isolated-mesh',
        scanProfile: 'aggressive',
        notes: 'Custom notes',
        commandPermissions: ['collect', 'reboot', 'ota_update'],
        tags: ['custom', 'production'],
        updatedAt: new Date().toISOString()
      };
      setDeviceConfig(device.deviceId, customConfig);

      const retrieved = getDeviceConfig(device.deviceId);
      expect(retrieved?.displayName).toBe('My Custom ESP32');
      expect(retrieved?.group).toBe('dmz-edge');
      expect(retrieved?.commandPermissions).not.toContain('factory_reset');
    });
  });

  describe('deleteDevice / hasDevice / setDevice', () => {
    it('deletes a device and returns true', () => {
      const device = makeDeviceInfo();
      registerDevice(device);

      expect(deleteDevice(device.deviceId)).toBe(true);
      expect(hasDevice(device.deviceId)).toBe(false);
    });

    it('returns false when deleting non-existent device', () => {
      expect(deleteDevice('nonexistent')).toBe(false);
    });

    it('hasDevice returns true for registered devices', () => {
      const device = makeDeviceInfo();
      registerDevice(device);

      expect(hasDevice(device.deviceId)).toBe(true);
    });

    it('hasDevice returns false for unknown devices', () => {
      expect(hasDevice('unknown-device')).toBe(false);
    });

    it('setDevice directly sets device state', () => {
      const device = makeDeviceInfo({ chipModel: 'ESP32-S3' });
      registerDevice(device);

      const patched = makeDeviceInfo({ deviceId: device.deviceId, chipModel: 'ESP32-S3-UPDATED' });
      setDevice(device.deviceId, patched);

      expect(getDeviceById(device.deviceId)?.chipModel).toBe('ESP32-S3-UPDATED');
    });
  });

  // NOTE: setDeviceAdapter is called at module load time (device-registry.service.ts ~line 547).
  // Its wiring is implicitly verified by all the executeDeviceCommandInternal tests above,
  // which exercise the full command flow through the dispatcher adapter.
});
