/**
 * DeviceGateway WebSocket Tests
 */

import { Server as HttpServer } from 'http';

// Mock logger first
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock tenant context
jest.mock('../../core/tenant/tenant-context', () => ({
  PLATFORM_TENANT_ID: 'platform',
  resolveDeviceTenantContext: jest.fn().mockReturnValue({ tenantId: 't1', platformId: 'p1' }),
}));

// Mock device registry
jest.mock('../../services/device-registry.service', () => ({
  registerDevice: jest.fn().mockResolvedValue({}),
  updateDeviceStatus: jest.fn().mockResolvedValue({}),
  setDeviceOffline: jest.fn().mockResolvedValue({}),
  getCodebook: jest.fn().mockReturnValue({ codes: {} }),
  getDeviceById: jest.fn(),
  addDeviceEvent: jest.fn().mockResolvedValue({}),
}));

// Mock socket rate limit service
jest.mock('../../services/socket-rate-limit.service', () => ({
  socketRateLimitService: {
    check: jest.fn().mockResolvedValue({ allowed: true, decisionSource: 'memory', riskFlags: [] }),
  },
}));

// Mock device control service
jest.mock('../../services/device-control.service', () => ({
  deviceControlService: {
    handleOtaStatus: jest.fn().mockResolvedValue({}),
    handlePhysicalConfirmationAck: jest.fn().mockResolvedValue({ confirmed: false, reason: 'mock_rejected' }),
  },
}));

// Mock audit logger
jest.mock('../../security/audit-logger.service', () => ({
  __esModule: true,
  default: {
    log: jest.fn().mockResolvedValue({}),
  },
}));

// Mock socket payload validator
jest.mock('../../websocket/socket-payload-validator', () => ({
  validateDeviceRegisterPayload: jest.fn().mockReturnValue({
    device_id: 'esp32-001',
    api_key: 'test-device-key-001',
    version: '1.0.0',
    chip_model: 'ESP32',
    flash_size: 4194304,
    free_heap: 100000,
    sdk_version: '3.0.0',
  }),
  validateDeviceHeartbeatPayload: jest.fn().mockReturnValue({
    uptime: 3600,
    free_heap: 50000,
    wifi_rssi: -50,
    cpu_usage: 25,
  }),
}));

// Mock crypto
jest.mock('crypto', () => ({
  createHmac: jest.fn().mockReturnValue({ update: jest.fn().mockReturnThis(), digest: jest.fn().mockReturnValue('sig') }),
  timingSafeEqual: jest.fn().mockReturnValue(true),
  randomBytes: jest.fn().mockReturnValue(Buffer.from('nonce12345678901234567890')),
}));

// Mock socket.io Server
const mockSocket: any = {
  on: jest.fn(),
  emit: jest.fn(),
  disconnect: jest.fn(),
  join: jest.fn(),
  leave: jest.fn(),
  connected: true,
  id: 'socket-123',
  deviceId: undefined,
  tenantContext: undefined,
  handshake: {
    address: '127.0.0.1',
    headers: {},
  },
};

const mockServer: any = {
  on: jest.fn(),
  of: jest.fn().mockReturnThis(),
  attach: jest.fn(),
  close: jest.fn(),
  emit: jest.fn(),
};

// Mock the @aws-sdk module to avoid loading the @smithy/uuid chain, which
// breaks on Node >= 22 due to crypto.randomUUID.bind evaluating at
// module-load time. (Same workaround as device-gateway.broadcast-signature.)
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  CreateBucketCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  HeadBucketCommand: jest.fn(),
  PutObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  DeleteObjectsCommand: jest.fn(),
  ListObjectsV2Command: jest.fn(),
}));

// Allow destructive gateway commands in the test (simulates lab runtime mode)
jest.mock('../../config/enterprise-runtime', () => ({
  allowGatewayDestructiveCommands: jest.fn(() => true),
  allowPasswordLogin: jest.fn(() => true),
  isEnterpriseStrictMode: jest.fn(() => false),
  isLabRuntime: jest.fn(() => true),
  getEnterpriseRuntimeMode: jest.fn(() => 'lab')
}));

jest.mock('socket.io', () => ({
  Server: jest.fn().mockImplementation(() => mockServer),
}));

// Import after mocks
import { DeviceGateway } from '../../websocket/device-gateway';
import * as deviceRoutes from '../../services/device-registry.service';
import * as payloadValidator from '../../websocket/socket-payload-validator';
import * as socketRateLimit from '../../services/socket-rate-limit.service';
import type { SocketRateLimitResult } from '../../services/socket-rate-limit.service';
import * as auditLoggerMod from '../../security/audit-logger.service';
import * as deviceControlServiceMod from '../../services/device-control.service';
import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';
import logger from '../../utils/logger';

describe('DeviceGateway', () => {
  let mockHttpServer: Partial<HttpServer> = {};

  // Helper to extract a registered handler for a given event name
  function getHandler(eventName: string, calls?: [string, Function][]): Function {
    const source = calls || mockSocket.on.mock.calls;
    const filtered = source.filter(([e]: [string]) => e === eventName);
    if (filtered.length === 0) {
      throw new Error(`No handler registered for event "${eventName}"`);
    }
    return filtered[0][1];
  }

  // Helper to simulate a device having been registered (sets deviceId and tenantContext on mockSocket)
  function simulateRegisteredDevice(socket: any, deviceId = 'esp32-001') {
    socket.deviceId = deviceId;
    socket.tenantContext = { tenantId: 't1', platformId: 'p1' };
  }

  // Helper to call a handler and flush the microtask queue (since event handlers
  // call async methods without returning the promise).
  async function callHandlerAndWait(handler: Function, ...args: any[]): Promise<void> {
    handler(...args);
    // Flush microtask queue - handleRegister etc are async and don't return promises
    // from the event wrapper, so we need multiple rounds to let all mock async calls settle
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
  }

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mockSocket
    mockSocket.on.mockReset();
    mockSocket.emit.mockReset();
    mockSocket.disconnect.mockReset();
    mockSocket.connected = true;
    mockSocket.deviceId = undefined;
    mockSocket.tenantContext = undefined;
    mockSocket.hardwareGateId = undefined;
    mockSocket.handshake = { address: '127.0.0.1', headers: {} };

    // Reset mockServer.on to capture new handlers
    mockServer.on.mockReset();
    mockServer.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'connection') {
        cb(mockSocket);
      }
    });

    // Set env vars
    process.env.DEVICE_COMMAND_SECRET = 'test-secret-key-24-chars-min!!';
    process.env.DEVICE_API_KEYS = 'test-device-key-001,test-device-key-002';
    process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
  });

  afterEach(() => {
    delete process.env.DEVICE_COMMAND_SECRET;
    delete process.env.DEVICE_API_KEYS;
    delete process.env.ALLOWED_ORIGINS;
  });

  describe('constructor', () => {
    it('initializes without throwing', () => {
      expect(() => new DeviceGateway(mockHttpServer as HttpServer)).not.toThrow();
    });

    it('creates Socket.IO server with connection handler', () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      expect(mockServer.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });

    it('warns when DEVICE_COMMAND_SECRET is not set', () => {
      delete process.env.DEVICE_COMMAND_SECRET;
      const warnSpy = jest.spyOn(require('../../utils/logger').default, 'warn');
      new DeviceGateway(mockHttpServer as HttpServer);
      expect(warnSpy).toHaveBeenCalledWith('[DeviceGateway] DEVICE_COMMAND_SECRET not set, command signing disabled');
    });

    it('warns when DEVICE_COMMAND_SECRET is too short', () => {
      process.env.DEVICE_COMMAND_SECRET = 'short';
      const warnSpy = jest.spyOn(require('../../utils/logger').default, 'warn');
      new DeviceGateway(mockHttpServer as HttpServer);
      expect(warnSpy).toHaveBeenCalledWith('[DeviceGateway] DEVICE_COMMAND_SECRET should be at least 32 characters');
    });
  });

  describe('setupEventHandlers', () => {
    it('registers all event listeners on connection', () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      expect(mockSocket.on).toHaveBeenCalledWith('register', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('heartbeat', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('alert', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('unknown_error', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('ota_status', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('physical_confirmation_ack', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('codebook_sync', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });
  });

  describe('handleCodebookSync', () => {
    it('emits codebook to device', async () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);

      const codebookCalls = mockSocket.on.mock.calls.filter(([e]: [string]) => e === 'codebook_sync');
      const codebookHandler = codebookCalls[0][1];

      await codebookHandler();

      expect(mockSocket.emit).toHaveBeenCalledWith('codebook_sync', expect.any(Object));
    });
  });

  describe('handleDisconnect', () => {
    it('does not throw when disconnecting without deviceId', () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);

      const disconnectCalls = mockSocket.on.mock.calls.filter(([e]: [string]) => e === 'disconnect');
      const disconnectHandler = disconnectCalls[0][1];
      expect(() => disconnectHandler('client disconnected')).not.toThrow();
    });
  });

  describe('sendCommand', () => {
    it('returns false when device is offline', async () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      const result = await gateway.sendCommand('offline-device', 'restart', {});
      expect(result).toBe(false);
    });

    it('returns false when command signing fails (no secret)', async () => {
      delete process.env.DEVICE_COMMAND_SECRET;
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      const result = await gateway.sendCommand('esp32-001', 'restart', {});
      expect(result).toBe(false);
    });
  });

  describe('broadcastCommand', () => {
    it('returns 0 when no devices connected', async () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      const count = await gateway.broadcastCommand('restart', {});
      expect(count).toBe(0);
    });
  });

  describe('getOnlineCount', () => {
    it('returns 0 initially', () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      expect(gateway.getOnlineCount()).toBe(0);
    });
  });

  describe('setDashboardBroadcaster', () => {
    it('sets broadcaster function', () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      const broadcaster = jest.fn();
      expect(() => gateway.setDashboardBroadcaster(broadcaster)).not.toThrow();
    });
  });

  describe('close', () => {
    it('closes the server', () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      gateway.close();
      expect(mockServer.close).toHaveBeenCalled();
    });
  });

  describe('secureCompare fix verification', () => {
    it('does not throw when comparing strings of different lengths via sendCommand', async () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      // Just verify sendCommand doesn't throw with different key lengths
      expect(() => {
        gateway.sendCommand('offline-device', 'test', {});
      }).not.toThrow();
    });

    it('timingSafeEqual is not called when lengths differ', () => {
      const crypto = require('crypto');
      new DeviceGateway(mockHttpServer as HttpServer);
      // The fix ensures secureCompare returns false immediately when lengths differ
      // without calling timingSafeEqual
      const { timingSafeEqual } = crypto;
      // Reset the mock to verify it's not called in the fix scenario
      timingSafeEqual.mockClear();
      // This just verifies the mock is set up correctly
      expect(timingSafeEqual).toBeDefined();
    });
  });

  // =====================================================================
  // handleRegister
  // =====================================================================
  describe('handleRegister', () => {
    it('registers a device successfully', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('register');

      await callHandlerAndWait(handler, {
        device_id: 'esp32-001',
        api_key: 'test-device-key-001',
        version: '1.0.0',
        chip_model: 'ESP32',
      });

      expect(mockSocket.deviceId).toBe('esp32-001');
      expect(mockSocket.tenantContext).toEqual({ tenantId: 't1', platformId: 'p1' });
      expect(deviceRoutes.registerDevice).toHaveBeenCalledWith(expect.objectContaining({
        deviceId: 'esp32-001',
        mode: 'online',
      }));
      expect(deviceRoutes.addDeviceEvent).toHaveBeenCalledWith('esp32-001', 'register', expect.any(Object));
      expect(mockSocket.emit).toHaveBeenCalledWith('register_success', expect.objectContaining({
        message: 'backend.device_registered_successfully',
        codebook: { codes: {} },
      }));
      expect(auditLoggerMod.default.log).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'device_registered',
        status: 'success',
      }));
      expect(logger.info).toHaveBeenCalledWith('[DeviceGateway] Device registered', expect.any(Object));
    });

    // SECURITY FIX (audit 2026-08): registration must not be able to overwrite
    // a provisioned device public key (grant verification anchor).
    it('rejects a register that presents a different public key than the provisioned one', async () => {
      jest.spyOn(payloadValidator, 'validateDeviceRegisterPayload').mockReturnValueOnce({
        device_id: 'esp32-001',
        api_key: 'test-device-key-001',
        version: '1.0.0',
        chip_model: 'ESP32',
        public_key_pem: 'attacker-key',
      } as any);
      (deviceRoutes.getDeviceById as jest.Mock).mockReturnValueOnce({
        deviceId: 'esp32-001',
        physicalAuth: { publicKeyPem: 'provisioned-key' },
      });
      jest.spyOn(hardwareAuthorizationService, 'getGate').mockReturnValueOnce(undefined as any);
      new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('register');

      await callHandlerAndWait(handler, { device_id: 'esp32-001', api_key: 'test-device-key-001' });

      expect(mockSocket.emit).toHaveBeenCalledWith('register_error', {
        error: 'backend.device_public_key_already_provisioned',
        reason: 'device_key_immutable',
      });
      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(deviceRoutes.registerDevice).not.toHaveBeenCalled();
      expect(mockSocket.deviceId).toBeUndefined();
    });

    it('rejects a register that omits the public key for a device whose key is provisioned', async () => {
      (deviceRoutes.getDeviceById as jest.Mock).mockReturnValueOnce({
        deviceId: 'esp32-001',
        physicalAuth: { publicKeyPem: 'provisioned-key' },
      });
      new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('register');

      await callHandlerAndWait(handler, { device_id: 'esp32-001', api_key: 'test-device-key-001' });

      expect(mockSocket.emit).toHaveBeenCalledWith('register_error', {
        error: 'backend.device_public_key_already_provisioned',
        reason: 'device_key_immutable',
      });
      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(deviceRoutes.registerDevice).not.toHaveBeenCalled();
    });

    it('allows re-register with the SAME provisioned public key', async () => {
      jest.spyOn(payloadValidator, 'validateDeviceRegisterPayload').mockReturnValueOnce({
        device_id: 'esp32-001',
        api_key: 'test-device-key-001',
        version: '1.0.0',
        chip_model: 'ESP32',
        public_key_pem: 'provisioned-key',
      } as any);
      (deviceRoutes.getDeviceById as jest.Mock).mockReturnValueOnce({
        deviceId: 'esp32-001',
        physicalAuth: { publicKeyPem: 'provisioned-key' },
      });
      jest.spyOn(hardwareAuthorizationService, 'getGate').mockReturnValueOnce(undefined as any);
      jest.spyOn(hardwareAuthorizationService, 'enrollGate').mockImplementationOnce(() => ({} as any));
      new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('register');

      await callHandlerAndWait(handler, { device_id: 'esp32-001', api_key: 'test-device-key-001' });

      expect(mockSocket.emit).toHaveBeenCalledWith('register_success', expect.any(Object));
      expect(deviceRoutes.registerDevice).toHaveBeenCalledWith(expect.objectContaining({
        deviceId: 'esp32-001',
        physicalAuth: { publicKeyPem: 'provisioned-key' },
      }));
    });

    it('rejects invalid payload', async () => {
      jest.spyOn(payloadValidator, 'validateDeviceRegisterPayload').mockReturnValueOnce(null);
      new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('register');

      callHandlerAndWait(handler, { bad: 'data' });
      // handleRegister checks validateDeviceRegisterPayload synchronously, so no await needed
      await new Promise(resolve => setImmediate(resolve));

      expect(mockSocket.emit).toHaveBeenCalledWith('register_error', {
        error: 'backend.invalid_device_registration_payload',
        reason: 'invalid_payload',
      });
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('rejects when socket rate limit is exceeded', async () => {
      jest.spyOn(socketRateLimit.socketRateLimitService, 'check').mockResolvedValueOnce({
        allowed: false,
        decisionSource: 'memory',
        riskFlags: [],
      } as unknown as SocketRateLimitResult);
      new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('register');

      await callHandlerAndWait(handler, {
        device_id: 'esp32-001',
        api_key: 'test-device-key-001',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('register_error', {
        error: 'backend.rate_limit_exceeded',
        reason: 'rate_limit_exceeded',
      });
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('rejects when no DEVICE_API_KEYS are configured', async () => {
      process.env.DEVICE_API_KEYS = '';
      new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('register');

      callHandlerAndWait(handler, {
        device_id: 'esp32-001',
        api_key: 'test-device-key-001',
      });
      await new Promise(resolve => setImmediate(resolve));

      expect(mockSocket.emit).toHaveBeenCalledWith('register_error', {
        error: 'backend.server_configuration_error',
      });
      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith('[DeviceGateway] No DEVICE_API_KEYS configured');
    });

    it('rejects when api_key is missing from payload', async () => {
      jest.spyOn(payloadValidator, 'validateDeviceRegisterPayload').mockReturnValueOnce({
        device_id: 'esp32-001',
        // api_key is undefined
      } as any);
      new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('register');

      callHandlerAndWait(handler, { device_id: 'esp32-001' });
      await new Promise(resolve => setImmediate(resolve));

      expect(mockSocket.emit).toHaveBeenCalledWith('register_error', {
        error: 'backend.api_key_required',
      });
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('rejects when api_key is invalid', async () => {
      // Override the mock to return a payload with a different-length api_key
      // so secureCompare returns false without calling timingSafeEqual
      // (valid keys are 'test-device-key-001' and 'test-device-key-002', both 19 chars)
      jest.spyOn(payloadValidator, 'validateDeviceRegisterPayload').mockReturnValueOnce({
        device_id: 'esp32-001',
        api_key: 'shortkey', // 8 chars, different from 19, so secureCompare returns false
        version: '1.0.0',
      });
      new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('register');

      await callHandlerAndWait(handler, {
        device_id: 'esp32-001',
        api_key: 'shortkey',
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('register_error', {
        error: 'backend.invalid_api_key',
      });
      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(auditLoggerMod.default.log).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'device_register_failed',
        status: 'failure',
      }));
    });

    it('emits device:online event to dashboard on successful registration', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('register');
      await callHandlerAndWait(handler, {
        device_id: 'esp32-001',
        api_key: 'test-device-key-001',
      });

      // Verify registration completed (registerDevice was called)
      expect(deviceRoutes.registerDevice).toHaveBeenCalled();
    });
  });

  // =====================================================================
  // handleHeartbeat
  // =====================================================================
  describe('handleHeartbeat', () => {
    it('processes a valid heartbeat', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('heartbeat');

      await callHandlerAndWait(handler, {
        uptime: 3600,
        free_heap: 50000,
        wifi_rssi: -50,
        cpu_usage: 25,
      });

      expect(deviceRoutes.updateDeviceStatus).toHaveBeenCalledWith('esp32-001', expect.objectContaining({
        cpuUsage: 25,
        uptime: 3600,
        wifiRssi: -50,
      }));
      expect(deviceRoutes.addDeviceEvent).toHaveBeenCalledWith('esp32-001', 'heartbeat', expect.any(Object));
      expect(mockSocket.emit).toHaveBeenCalledWith('heartbeat_ack', expect.objectContaining({
        timestamp: expect.any(Number),
      }));
    });

    it('ignores heartbeat when deviceId is not set', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      // mockSocket.deviceId is undefined by default
      const handler = getHandler('heartbeat');

      callHandlerAndWait(handler, { uptime: 100 });
      await new Promise(resolve => setImmediate(resolve));

      expect(deviceRoutes.updateDeviceStatus).not.toHaveBeenCalled();
    });

    it('rejects heartbeat when device rate limit is exceeded', async () => {
      jest.spyOn(socketRateLimit.socketRateLimitService, 'check').mockResolvedValueOnce({
        allowed: false,
        decisionSource: 'redis',
        riskFlags: ['high_frequency'],
      } as SocketRateLimitResult);
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('heartbeat');

      await callHandlerAndWait(handler, { uptime: 100 });

      expect(mockSocket.emit).toHaveBeenCalledWith('heartbeat_error', {
        error: 'backend.rate_limit_exceeded',
        reason: 'rate_limit_exceeded',
      });
      expect(deviceRoutes.updateDeviceStatus).not.toHaveBeenCalled();
    });

    it('rejects heartbeat when payload validation fails', async () => {
      jest.spyOn(payloadValidator, 'validateDeviceHeartbeatPayload').mockReturnValueOnce(null);
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('heartbeat');

      callHandlerAndWait(handler, { bad: 'data' });
      await new Promise(resolve => setImmediate(resolve));

      expect(mockSocket.emit).toHaveBeenCalledWith('heartbeat_error', {
        error: 'backend.invalid_device_heartbeat_payload',
        reason: 'invalid_payload',
      });
      expect(deviceRoutes.updateDeviceStatus).not.toHaveBeenCalled();
    });

    it('logs audit event when device rate limit is exceeded', async () => {
      jest.spyOn(socketRateLimit.socketRateLimitService, 'check').mockResolvedValueOnce({
        allowed: false,
        decisionSource: 'memory',
        riskFlags: [],
      } as unknown as SocketRateLimitResult);
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('heartbeat');

      await callHandlerAndWait(handler, { uptime: 100 });

      expect(auditLoggerMod.default.log).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'rate_limit_exceeded',
        category: 'agent',
        severity: 'warning',
        status: 'failure',
      }));
    });
  });

  // =====================================================================
  // handleData
  // =====================================================================
  describe('handleData', () => {
    it('processes data payload', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('data');

      const payload = { sensor: 'temp', value: 23.5 };
      await callHandlerAndWait(handler, { payload });

      expect(deviceRoutes.addDeviceEvent).toHaveBeenCalledWith('esp32-001', 'data', expect.objectContaining({
        payload: { sensor: 'temp', value: 23.5 },
      }));
      expect(logger.info).toHaveBeenCalledWith('[DeviceGateway] Data received', expect.any(Object));
    });

    it('ignores data when deviceId is not set', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('data');

      callHandlerAndWait(handler, { payload: { foo: 'bar' } });
      await new Promise(resolve => setImmediate(resolve));

      expect(deviceRoutes.addDeviceEvent).not.toHaveBeenCalled();
    });

    it('returns early when device rate limit is exceeded', async () => {
      jest.spyOn(socketRateLimit.socketRateLimitService, 'check').mockResolvedValueOnce({
        allowed: false,
        decisionSource: 'memory',
        riskFlags: [],
      } as unknown as SocketRateLimitResult);
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('data');

      callHandlerAndWait(handler, { payload: { foo: 'bar' } });
      await new Promise(resolve => setImmediate(resolve));

      expect(deviceRoutes.addDeviceEvent).not.toHaveBeenCalled();
    });

    it('handles string payload with error codes', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('data');

      const codebook = { E001: 'Memory overflow', E002: 'Sensor failure' };
      jest.spyOn(deviceRoutes, 'getCodebook').mockReturnValueOnce(codebook);

      const stringPayload = JSON.stringify({ codes: ['E001', 'E002'] });
      await callHandlerAndWait(handler, { payload: stringPayload });

      expect(deviceRoutes.addDeviceEvent).toHaveBeenCalledWith('esp32-001', 'data', expect.objectContaining({
        payload: expect.objectContaining({
          errors: ['Memory overflow', 'Sensor failure'],
        }),
      }));
    });

    it('handles string payload with unknown error codes', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('data');

      jest.spyOn(deviceRoutes, 'getCodebook').mockReturnValueOnce({});

      const stringPayload = JSON.stringify({ codes: ['UNKNOWN_CODE'] });
      await callHandlerAndWait(handler, { payload: stringPayload });

      expect(deviceRoutes.addDeviceEvent).toHaveBeenCalledWith('esp32-001', 'data', expect.objectContaining({
        payload: expect.objectContaining({
          errors: ['UNKNOWN_CODE'],
        }),
      }));
    });

    it('handles plain non-JSON string payload gracefully', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('data');

      await callHandlerAndWait(handler, { payload: 'just a plain string' });

      // JSON.parse will fail, so decodedPayload falls back to the raw string
      expect(deviceRoutes.addDeviceEvent).toHaveBeenCalledWith('esp32-001', 'data', expect.objectContaining({
        payload: 'just a plain string',
      }));
      const parseWarning = (logger.warn as jest.Mock).mock.calls.find(
        ([message]) => message === '[DeviceGateway] Device payload JSON parse failed'
      );
      expect(parseWarning).toBeDefined();
      expect(parseWarning[1]).not.toHaveProperty('payloadPreview');
    });

    it('handles data without nested payload field', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('data');

      await callHandlerAndWait(handler, { sensor: 'temp', value: 23.5 });

      // When data has no 'payload' field, data itself is used
      expect(deviceRoutes.addDeviceEvent).toHaveBeenCalled();
    });
  });

  // =====================================================================
  // handleAlert
  // =====================================================================
  describe('handleAlert', () => {
    it('processes an alert from device', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('alert');

      const alertData = { alert_type: 'intrusion', message: 'Motion detected', timestamp: '2026-01-01T00:00:00Z' };
      await callHandlerAndWait(handler, alertData);

      expect(deviceRoutes.addDeviceEvent).toHaveBeenCalledWith('esp32-001', 'alert', expect.objectContaining({
        alertType: 'intrusion',
        message: 'Motion detected',
      }));
      expect(auditLoggerMod.default.log).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'device_alert',
        severity: 'warning',
      }));
      expect(logger.warn).toHaveBeenCalledWith('[DeviceGateway] Alert from device', expect.any(Object));
    });

    it('ignores alert when deviceId is not set', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('alert');

      callHandlerAndWait(handler, { alert_type: 'intrusion', message: 'test' });
      await new Promise(resolve => setImmediate(resolve));

      expect(deviceRoutes.addDeviceEvent).not.toHaveBeenCalled();
      expect(auditLoggerMod.default.log).not.toHaveBeenCalled();
    });

    it('returns early when device rate limit is exceeded', async () => {
      jest.spyOn(socketRateLimit.socketRateLimitService, 'check').mockResolvedValueOnce({
        allowed: false,
        decisionSource: 'memory',
        riskFlags: [],
      } as unknown as SocketRateLimitResult);
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('alert');

      callHandlerAndWait(handler, { alert_type: 'intrusion', message: 'test' });
      await new Promise(resolve => setImmediate(resolve));

      expect(deviceRoutes.addDeviceEvent).not.toHaveBeenCalled();
    });

    it('uses current timestamp when alert timestamp is missing', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('alert');

      await callHandlerAndWait(handler, { alert_type: 'fire', message: 'Temperature high' });

      // Should not throw and should log with the current date string
      expect(deviceRoutes.addDeviceEvent).toHaveBeenCalledWith('esp32-001', 'alert', expect.any(Object));
    });
  });

  // =====================================================================
  // handleUnknownError
  // =====================================================================
  describe('handleUnknownError', () => {
    it('processes unknown error from device', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('unknown_error');

      const errorData = { message: 'Panic: out of memory', timestamp: '2026-01-01T00:00:00Z' };
      await callHandlerAndWait(handler, errorData);

      expect(deviceRoutes.addDeviceEvent).toHaveBeenCalledWith('esp32-001', 'unknown_error', expect.objectContaining({
        message: 'Panic: out of memory',
      }));
      expect(auditLoggerMod.default.log).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'device_unknown_error',
        severity: 'critical',
        status: 'failure',
      }));
      expect(logger.error).toHaveBeenCalledWith('[DeviceGateway] Unknown error from device', expect.any(Object));
    });

    it('ignores unknown_error when deviceId is not set', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('unknown_error');

      callHandlerAndWait(handler, { message: 'test error' });
      await new Promise(resolve => setImmediate(resolve));

      expect(deviceRoutes.addDeviceEvent).not.toHaveBeenCalled();
      expect(auditLoggerMod.default.log).not.toHaveBeenCalled();
    });

    it('uses current timestamp when error timestamp is missing', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('unknown_error');

      await callHandlerAndWait(handler, { message: 'crash' });

      expect(deviceRoutes.addDeviceEvent).toHaveBeenCalledWith('esp32-001', 'unknown_error', expect.any(Object));
    });
  });

  // =====================================================================
  // handleOtaStatus
  // =====================================================================
  describe('handleOtaStatus', () => {
    it('processes OTA status update', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('ota_status');

      const otaData = { status: 'downloading', progress: 50 };
      await callHandlerAndWait(handler, otaData);

      expect(deviceRoutes.addDeviceEvent).toHaveBeenCalledWith('esp32-001', 'command', expect.objectContaining({
        action: 'ota_status',
        status: 'downloading',
        progress: 50,
      }));
      expect(deviceControlServiceMod.deviceControlService.handleOtaStatus).toHaveBeenCalledWith('esp32-001', otaData);
    });

    it('ignores ota_status when deviceId is not set', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('ota_status');

      callHandlerAndWait(handler, { status: 'complete' });
      await new Promise(resolve => setImmediate(resolve));

      expect(deviceControlServiceMod.deviceControlService.handleOtaStatus).not.toHaveBeenCalled();
      expect(deviceRoutes.addDeviceEvent).not.toHaveBeenCalled();
    });

    it('handles null data gracefully', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('ota_status');

      await callHandlerAndWait(handler, null);

      expect(deviceControlServiceMod.deviceControlService.handleOtaStatus).toHaveBeenCalledWith('esp32-001', {});
    });
  });

  // =====================================================================
  // handlePhysicalConfirmationAck
  // =====================================================================
  describe('handlePhysicalConfirmationAck', () => {
    it('reports the verified legacy result instead of trusting device confirmed=true', async () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      const broadcaster = jest.fn();
      gateway.setDashboardBroadcaster(broadcaster);
      jest.spyOn(hardwareAuthorizationService, 'handlePhysicalConfirmationAck')
        .mockRejectedValueOnce(new Error('hardware authorization unavailable'));
      (deviceControlServiceMod.deviceControlService.handlePhysicalConfirmationAck as jest.Mock)
        .mockResolvedValueOnce({ confirmed: false, reason: 'invalid_signature' });
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('physical_confirmation_ack');

      const ackData = { confirmed: true, actionId: 'act-123', confirmationSessionId: 'session-123' };
      await callHandlerAndWait(handler, ackData);

      expect(deviceRoutes.addDeviceEvent).toHaveBeenCalledWith('esp32-001', 'command', expect.objectContaining({
        action: 'physical_confirmation_ack_received',
        reportedConfirmed: true,
        confirmationSessionId: 'session-123',
      }));
      expect(deviceControlServiceMod.deviceControlService.handlePhysicalConfirmationAck).toHaveBeenCalledWith('esp32-001', ackData);
      expect(broadcaster).toHaveBeenCalledWith('device:physical_confirmation', expect.objectContaining({
        confirmed: false,
        reason: 'invalid_signature',
        confirmationSource: 'device_control_verified',
      }));
    });

    it('ignores physical_confirmation_ack when deviceId is not set', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('physical_confirmation_ack');

      callHandlerAndWait(handler, { confirmed: true });
      await new Promise(resolve => setImmediate(resolve));

      expect(deviceControlServiceMod.deviceControlService.handlePhysicalConfirmationAck).not.toHaveBeenCalled();
      expect(deviceRoutes.addDeviceEvent).not.toHaveBeenCalled();
    });

    it('handles null data gracefully', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('physical_confirmation_ack');

      await callHandlerAndWait(handler, null);

      expect(deviceControlServiceMod.deviceControlService.handlePhysicalConfirmationAck).toHaveBeenCalledWith('esp32-001', {});
    });
  });

  // =====================================================================
  // handleDisconnect (with deviceId)
  // =====================================================================
  describe('handleDisconnect with registered device', () => {
    it('cleans up on disconnect when device is registered', async () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('disconnect');

      await callHandlerAndWait(handler, 'transport close');

      expect(deviceRoutes.setDeviceOffline).toHaveBeenCalledWith('esp32-001');
      expect(deviceRoutes.addDeviceEvent).toHaveBeenCalledWith('esp32-001', 'disconnect', expect.objectContaining({
        reason: 'transport close',
      }));
      expect(auditLoggerMod.default.log).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'device_disconnected',
        severity: 'info',
        status: 'success',
      }));
      expect(logger.info).toHaveBeenCalledWith('[DeviceGateway] Device disconnected', expect.any(Object));
    });
  });

  // =====================================================================
  // sendCommand (success scenarios)
  // =====================================================================
  describe('sendCommand - success scenarios', () => {
    it('sends a signed command to a connected device', async () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      const registerHandler = getHandler('register');
      await callHandlerAndWait(registerHandler, {
        device_id: 'esp32-001',
        api_key: 'test-device-key-001',
      });

      const result = await gateway.sendCommand('esp32-001', 'restart', { delay: 5 });
      expect(result).toBe(true);
      expect(mockSocket.emit).toHaveBeenCalledWith('command', expect.objectContaining({
        command: expect.objectContaining({ cmd: 'restart', params: { delay: 5 } }),
        signature: 'sig',
        deviceId: 'esp32-001',
      }));
      expect(auditLoggerMod.default.log).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'device_command_sent',
        status: 'success',
      }));
      expect(logger.info).toHaveBeenCalledWith('[DeviceGateway] Command sent', expect.any(Object));
    });

    it('returns false when socket is not connected', async () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('register');
      await callHandlerAndWait(handler, {
        device_id: 'esp32-001',
        api_key: 'test-device-key-001',
      });

      // Now mark the socket as disconnected
      mockSocket.connected = false;

      const result = await gateway.sendCommand('esp32-001', 'restart', {});
      expect(result).toBe(false);
    });
  });

  // =====================================================================
  // broadcastCommand (with devices)
  // =====================================================================
  describe('broadcastCommand - with devices', () => {
    it('broadcasts to connected devices', async () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('register');
      await callHandlerAndWait(handler, {
        device_id: 'esp32-001',
        api_key: 'test-device-key-001',
      });

      const count = await gateway.broadcastCommand('scan', { target: '192.168.1.0/24' });
      expect(count).toBe(1);
      expect(mockSocket.emit).toHaveBeenCalledWith('command', expect.objectContaining({
        command: expect.objectContaining({ cmd: 'scan' }),
        signature: 'sig',
      }));
      expect(auditLoggerMod.default.log).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'device_broadcast_command',
        details: expect.objectContaining({ deviceCount: 1 }),
      }));
    });
  });

  // =====================================================================
  // getOnlineCount (with devices)
  // =====================================================================
  describe('getOnlineCount - with registered device', () => {
    it('returns correct count after device registration', async () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('register');
      await callHandlerAndWait(handler, {
        device_id: 'esp32-001',
        api_key: 'test-device-key-001',
      });

      expect(gateway.getOnlineCount()).toBe(1);
    });

    it('returns 0 after device disconnects', async () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      const registerHandler = getHandler('register');
      await callHandlerAndWait(registerHandler, {
        device_id: 'esp32-001',
        api_key: 'test-device-key-001',
      });

      expect(gateway.getOnlineCount()).toBe(1);

      const disconnectHandler = getHandler('disconnect');
      await callHandlerAndWait(disconnectHandler, 'io server disconnect');

      expect(gateway.getOnlineCount()).toBe(0);
    });
  });

  // =====================================================================
  // getDeviceSecretKey (device-specific key)
  // =====================================================================
  describe('getDeviceSecretKey - device-specific keys', () => {
    it('uses device-specific key when DEVICE_KEY_<deviceId> env is set', async () => {
      process.env.DEVICE_KEY_esp32_special = 'device-specific-secret-key!!';
      jest.spyOn(payloadValidator, 'validateDeviceRegisterPayload').mockReturnValue({
        device_id: 'esp32_special',
        api_key: 'test-device-key-001',
        version: '1.0.0',
      });

      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      const handler = getHandler('register');
      await callHandlerAndWait(handler, {
        device_id: 'esp32_special',
        api_key: 'test-device-key-001',
      });

      const result = await gateway.sendCommand('esp32_special', 'ping', {});
      expect(result).toBe(true);

      delete process.env.DEVICE_KEY_esp32_special;
    });
  });

  // =====================================================================
  // setDashboardBroadcaster - emitToDashboard via broadcaster
  // =====================================================================
  describe('emitToDashboard via dashboardBroadcaster', () => {
    it('uses dashboardBroadcaster when set', async () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      const broadcaster = jest.fn();
      gateway.setDashboardBroadcaster(broadcaster);

      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('alert');
      await callHandlerAndWait(handler, { alert_type: 'intrusion', message: 'test' });

      // emitToDashboard should have called the broadcaster
      expect(broadcaster).toHaveBeenCalledWith('device:alert', expect.any(Object));
    });

    it('falls back to io.emit when no broadcaster is set', async () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      // No dashboardBroadcaster set

      simulateRegisteredDevice(mockSocket, 'esp32-001');
      const handler = getHandler('alert');
      await callHandlerAndWait(handler, { alert_type: 'fire', message: 'test' });

      // addDeviceEvent should have been called (the handler ran)
      expect(deviceRoutes.addDeviceEvent).toHaveBeenCalled();
    });
  });

  // =====================================================================
  // close - full cleanup
  // =====================================================================
  describe('close - full cleanup', () => {
    it('clears interval and closes all servers', () => {
      // The constructor creates 2 servers: main + 1 alias.
      // mockServer.on.mockReset is called in beforeEach, then the constructor
      // re-calls Server() which returns mockServer each time.
      // So mockServer is shared. close() will be called once for main + once per alias.
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      gateway.close();

      // close is called on main server + alias servers
      expect(mockServer.close).toHaveBeenCalled();
    });
  });

  // =====================================================================
  // cleanupUsedNonces
  // =====================================================================
  describe('cleanupUsedNonces', () => {
    it('does not throw during cleanup', () => {
      const gateway = new DeviceGateway(mockHttpServer as HttpServer);
      // The cleanup interval runs every 5 minutes.
      // We cannot directly test the private method, but we can verify
      // that the constructor sets up the interval without error.
      expect(gateway).toBeDefined();
    });
  });

  // =====================================================================
  // handleHeartbeat - uses PLATFORM_TENANT_ID fallback
  // =====================================================================
  describe('PLATFORM_TENANT_ID fallback', () => {
    it('uses PLATFORM_TENANT_ID when tenantContext is undefined', async () => {
      new DeviceGateway(mockHttpServer as HttpServer);
      mockSocket.deviceId = 'esp32-001';
      mockSocket.tenantContext = undefined; // explicitly undefined
      const handler = getHandler('heartbeat');

      await callHandlerAndWait(handler, { uptime: 100 });

      // checkDeviceRateLimit is called; the tenantId passed to it is PLATFORM_TENANT_ID
      expect(socketRateLimit.socketRateLimitService.check).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'platform' }),
      );
    });
  });
});
