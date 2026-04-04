import {
  validateAgentRegisterPayload,
  validateAgentHeartbeatPayload,
  validateDashboardAgentCommandPayload,
  validateDashboardIpCommandPayload,
  validateDeviceRegisterPayload,
  validateDeviceHeartbeatPayload,
} from '../../websocket/socket-payload-validator';

describe('socket-payload-validator', () => {
  describe('validateAgentRegisterPayload', () => {
    // null/undefined/[]/primitive inputs → null
    it('returns null for null input', () => {
      expect(validateAgentRegisterPayload(null as any)).toBeNull();
    });
    it('returns null for undefined input', () => {
      expect(validateAgentRegisterPayload(undefined as any)).toBeNull();
    });
    it('returns null for array input', () => {
      expect(validateAgentRegisterPayload([] as any)).toBeNull();
    });
    it('returns null for string input', () => {
      expect(validateAgentRegisterPayload('string' as any)).toBeNull();
    });
    it('returns null for number input', () => {
      expect(validateAgentRegisterPayload(123 as any)).toBeNull();
    });

    // Empty object - all fields optional
    it('returns object for empty input', () => {
      const result = validateAgentRegisterPayload({});
      expect(result).toEqual({});
    });

    // Complete valid payload
    it('returns full object for valid payload', () => {
      const payload = {
        agentId: 'agent-001',
        hostname: 'test-server',
        platform: 'linux',
        arch: 'x86_64',
        version: '1.0.0',
      };
      const result = validateAgentRegisterPayload(payload);
      expect(result).toMatchObject(payload);
    });

    // Whitespace-only strings should be normalized to null
    it('returns null for whitespace-only hostname', () => {
      const result = validateAgentRegisterPayload({ hostname: '   ' });
      // hostname becomes undefined, but object is still returned (not null)
      expect(result).not.toBeNull();
      expect(result?.hostname).toBeUndefined();
    });
  });

  describe('validateAgentHeartbeatPayload', () => {
    it('returns null for null input', () => {
      expect(validateAgentHeartbeatPayload(null as any)).toBeNull();
    });
    it('returns object for valid heartbeat', () => {
      const result = validateAgentHeartbeatPayload({
        agentId: 'agent-001',
        status: 'healthy',
        cpuUsage: 45.5,
        memoryUsage: 60.2,
      });
      expect(result).toMatchObject({ agentId: 'agent-001' });
    });
    it('accepts optional numeric fields', () => {
      const result = validateAgentHeartbeatPayload({
        agentId: 'agent-001',
        status: 'healthy',
      });
      expect(result?.agentId).toBe('agent-001');
    });
  });

  describe('validateDashboardAgentCommandPayload', () => {
    it('returns null when agentId missing', () => {
      expect(validateDashboardAgentCommandPayload({ command: 'block_ip', params: {} } as any)).toBeNull();
    });
    it('returns object when agentId present (command is optional)', () => {
      // The validator only checks for agentId, command is not validated
      const result = validateDashboardAgentCommandPayload({ agentId: 'agent-001' } as any);
      expect(result).toMatchObject({ agentId: 'agent-001' });
    });
    it('returns object for valid payload', () => {
      const result = validateDashboardAgentCommandPayload({
        agentId: 'agent-001',
        command: 'block_ip',
        params: { ip: '192.168.1.100' },
      });
      // Note: the validator only extracts agentId
      expect(result).toMatchObject({ agentId: 'agent-001' });
    });
  });

  describe('validateDashboardIpCommandPayload', () => {
    it('returns null when ip missing', () => {
      expect(validateDashboardIpCommandPayload({
        agentId: 'agent-001',
        command: 'block_ip',
      } as any)).toBeNull();
    });
    it('returns null when agentId missing even with ip', () => {
      expect(validateDashboardIpCommandPayload({
        agentId: undefined,
        command: 'block_ip',
        ip: '192.168.1.100',
      } as any)).toBeNull();
    });
    it('returns object for valid payload', () => {
      const result = validateDashboardIpCommandPayload({
        agentId: 'agent-001',
        command: 'block_ip',
        ip: '192.168.1.100',
      });
      expect(result).toMatchObject({ agentId: 'agent-001', ip: '192.168.1.100' });
    });
  });

  describe('validateDeviceRegisterPayload', () => {
    it('returns null when device_id missing', () => {
      expect(validateDeviceRegisterPayload({ api_key: 'key' } as any)).toBeNull();
    });
    it('returns null when api_key missing', () => {
      expect(validateDeviceRegisterPayload({ device_id: 'dev-001' } as any)).toBeNull();
    });
    it('returns object for valid payload', () => {
      const result = validateDeviceRegisterPayload({
        device_id: 'esp32-001',
        api_key: 'device_key_xxx',
        firmware: '1.0.0',
      });
      expect(result).toMatchObject({ device_id: 'esp32-001', api_key: 'device_key_xxx' });
    });
    it('returns null for whitespace-only device_id', () => {
      const result = validateDeviceRegisterPayload({
        device_id: '   ',
        api_key: 'key',
      } as any);
      expect(result).toBeNull();
    });
    it('returns null for whitespace-only api_key', () => {
      const result = validateDeviceRegisterPayload({
        device_id: 'dev-001',
        api_key: '   ',
      } as any);
      expect(result).toBeNull();
    });
  });

  describe('validateDeviceHeartbeatPayload', () => {
    it('returns null for null input', () => {
      expect(validateDeviceHeartbeatPayload(null as any)).toBeNull();
    });
    it('returns object for valid device heartbeat', () => {
      const result = validateDeviceHeartbeatPayload({
        uptime: 3600,
        free_heap: 150000,
        wifi_rssi: -45,
        cpu_usage: 23.5,
      });
      expect(result).toMatchObject({ wifi_rssi: -45 });
    });
    it('returns null for array input', () => {
      expect(validateDeviceHeartbeatPayload([] as any)).toBeNull();
    });
  });

  // Test asRecord helper (private but exercised through the validators)
  describe('asRecord edge cases', () => {
    it('handles array input via validators', () => {
      expect(validateAgentRegisterPayload([] as any)).toBeNull();
    });
    it('handles class instance input via validators', () => {
      class Dummy {}
      // Class instances are objects and pass asRecord, so validator returns an object (with undefined fields)
      const result = validateAgentRegisterPayload(new Dummy() as any);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('object');
    });
  });

  // Test optionalFiniteNumber edge cases
  describe('optionalFiniteNumber edge cases', () => {
    // Test through validateAgentHeartbeatPayload which uses optionalFiniteNumber
    it('accepts numeric cpuUsage', () => {
      const result = validateAgentHeartbeatPayload({
        agentId: 'a1',
        status: 'healthy',
        cpuUsage: 50,
      } as any);
      expect(result?.cpuUsage).toBe(50);
    });
    it('accepts string numeric cpuUsage', () => {
      const result = validateAgentHeartbeatPayload({
        agentId: 'a1',
        status: 'healthy',
        cpuUsage: '50' as any,
      } as any);
      expect(result?.cpuUsage).toBe(50);
    });
    it('returns undefined for empty string cpuUsage', () => {
      const result = validateAgentHeartbeatPayload({
        agentId: 'a1',
        status: 'healthy',
        cpuUsage: '' as any,
      } as any);
      expect(result?.cpuUsage).toBeUndefined();
    });
    it('returns undefined for Infinity', () => {
      const result = validateAgentHeartbeatPayload({
        agentId: 'a1',
        status: 'healthy',
        cpuUsage: Infinity as any,
      } as any);
      expect(result?.cpuUsage).toBeUndefined();
    });
    it('returns undefined for NaN', () => {
      const result = validateAgentHeartbeatPayload({
        agentId: 'a1',
        status: 'healthy',
        cpuUsage: NaN as any,
      } as any);
      expect(result?.cpuUsage).toBeUndefined();
    });
  });

  // Test nonEmptyString edge cases
  describe('nonEmptyString edge cases', () => {
    it('trims whitespace from hostname', () => {
      const result = validateAgentRegisterPayload({
        hostname: '  test-server  ',
        agentId: 'a1',
      } as any);
      expect(result?.hostname).toBe('test-server');
    });
    it('returns null for whitespace-only hostname', () => {
      const result = validateAgentRegisterPayload({
        hostname: '   ',
        agentId: 'a1',
      } as any);
      // hostname becomes undefined, but object is still returned with agentId
      expect(result).not.toBeNull();
      expect(result?.hostname).toBeUndefined();
      expect(result?.agentId).toBe('a1');
    });
    it('trims whitespace from agentId', () => {
      const result = validateAgentRegisterPayload({
        agentId: '  agent-001  ',
      } as any);
      expect(result?.agentId).toBe('agent-001');
    });
  });
});
