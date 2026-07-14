/**
 * DeviceGateway.broadcastCommand — fail-closed signature gate (V4.1)
 *
 * SECURITY FIX: When `signCommand` returns null (no DEVICE_COMMAND_SECRET,
 * secret too short, or no device-specific key), the device gateway must NOT
 * silently fall back to emitting an unsigned command. Unsigned packets would
 * bypass the HMAC gate that ESP32 firmware is supposed to enforce, allowing
 * destructive operations (reboot / factory_reset / wipe_data / recovery_flash)
 * to be triggered from any path that can inject a frame on the bus.
 *
 * The three tests below pin down the new contract:
 *   1. signCommand fails  -> socket.emit is NOT called for that device
 *   2. signCommand succeeds -> socket.emit IS called with the signed packet
 *   3. caller / audit pipeline observes a 'failure' audit event when signing
 *      is refused (so an operator can detect & investigate the misconfig)
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
    handlePhysicalConfirmationAck: jest.fn().mockResolvedValue({}),
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

// Mock crypto — `randomBytes` returns deterministic 16-byte buffer,
// `createHmac(...).update(...).digest(...)` returns a deterministic hex string
// so we can assert on the produced signature.
jest.mock('crypto', () => ({
  createHmac: jest.fn().mockReturnValue({ update: jest.fn().mockReturnThis(), digest: jest.fn().mockReturnValue('deadbeefsignature') }),
  timingSafeEqual: jest.fn().mockReturnValue(true),
  randomBytes: jest.fn().mockReturnValue(Buffer.from('nonce12345678901234567890')),
}));

// Mock the @aws-sdk module to avoid loading the @smithy/uuid chain, which
// breaks on Node >= 22 due to `crypto.randomUUID.bind(crypto)` evaluating
// at module-load time when the global crypto randomUUID export shape changed.
// This is the same workaround that lets the existing device-gateway test
// run on newer Node runtimes; without it the import graph
// (device-gateway -> command-dispatcher -> deployment-run -> artifact-store
//  -> @aws-sdk/client-s3 -> @smithy/uuid) crashes before any test executes.
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

// Mock socket.io Server — we capture per-socket `emit` calls so we can assert
// exactly which frames a connected device would see.
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

jest.mock('socket.io', () => ({
  Server: jest.fn().mockImplementation(() => mockServer),
}));

// Import after mocks
import { DeviceGateway } from '../../websocket/device-gateway';
import * as deviceRoutes from '../../services/device-registry.service';
import * as payloadValidator from '../../websocket/socket-payload-validator';
import auditLogger from '../../security/audit-logger.service';
import logger from '../../utils/logger';

describe('DeviceGateway.broadcastCommand - fail-closed signature gate (V4.1)', () => {
  const inheritedDeviceCommandSecret = process.env.DEVICE_COMMAND_SECRET;
  let mockHttpServer: Partial<HttpServer> = {};

  function getHandler(eventName: string): Function {
    const filtered = mockSocket.on.mock.calls.filter(([e]: [string]) => e === eventName);
    if (filtered.length === 0) {
      throw new Error(`No handler registered for event "${eventName}"`);
    }
    return filtered[0][1];
  }

  async function callHandlerAndWait(handler: Function, ...args: any[]): Promise<void> {
    handler(...args);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
  }

  beforeEach(() => {
    delete process.env.DEVICE_COMMAND_SECRET;
    jest.clearAllMocks();

    mockSocket.on.mockReset();
    mockSocket.emit.mockReset();
    mockSocket.disconnect.mockReset();
    mockSocket.connected = true;
    mockSocket.deviceId = undefined;
    mockSocket.tenantContext = undefined;
    mockSocket.handshake = { address: '127.0.0.1', headers: {} };

    mockServer.on.mockReset();
    mockServer.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'connection') {
        cb(mockSocket);
      }
    });
  });

  afterEach(() => {
    delete process.env.DEVICE_COMMAND_SECRET;
    delete process.env.DEVICE_API_KEYS;
    delete process.env.ALLOWED_ORIGINS;
  });

  afterAll(() => {
    if (inheritedDeviceCommandSecret === undefined) {
      delete process.env.DEVICE_COMMAND_SECRET;
    } else {
      process.env.DEVICE_COMMAND_SECRET = inheritedDeviceCommandSecret;
    }
  });

  // ---------------------------------------------------------------------
  // 1. FAIL-CLOSED: signCommand failure must NOT emit any frame
  // ---------------------------------------------------------------------
  it('does NOT emit any command frame when signCommand fails (no secret configured)', async () => {
    // Arrange: construct the gateway WITHOUT DEVICE_COMMAND_SECRET so the
    // signCommand() path inside broadcastCommand hits the `!secretKey`
    // branch and returns null. Registration still works because that
    // path uses DEVICE_API_KEYS, not DEVICE_COMMAND_SECRET.
    process.env.DEVICE_API_KEYS = 'test-device-key-001';
    process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

    const gateway = new DeviceGateway(mockHttpServer as HttpServer);
    const registerHandler = getHandler('register');
    await callHandlerAndWait(registerHandler, {
      device_id: 'esp32-001',
      api_key: 'test-device-key-001',
    });

    // Sanity: device is registered and the gateway has a socket for it.
    expect(gateway.getOnlineCount()).toBe(1);

    mockSocket.emit.mockClear();
    (auditLogger.log as jest.Mock).mockClear();
    (logger.error as jest.Mock).mockClear();

    // Act
    const count = await gateway.broadcastCommand('reboot', { force: true });

    // Assert: no command frame of any shape was emitted
    expect(count).toBe(0);
    const commandEmits = mockSocket.emit.mock.calls.filter(
      ([event]: [string]) => event === 'command'
    );
    expect(commandEmits).toHaveLength(0);

    // Refusal was logged loudly with the expected reason
    expect(logger.error).toHaveBeenCalledWith(
      '[DeviceGateway] Refusing to broadcast unsigned command (signCommand failed)',
      expect.objectContaining({
        deviceId: 'esp32-001',
        command: 'reboot',
        reason: 'sign_failed',
      })
    );

    // A failure-status rejection audit event was recorded
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'device_broadcast_rejected',
        status: 'failure',
        details: expect.objectContaining({
          command: 'reboot',
          reason: 'sign_failed',
          rejectedCount: 1,
          rejectedDeviceIds: ['esp32-001'],
        }),
      })
    );
  });

  // ---------------------------------------------------------------------
  // 2. HAPPY PATH: when signing succeeds, the signed frame is emitted
  // ---------------------------------------------------------------------
  it('emits the signed command frame when signCommand succeeds', async () => {
    process.env.DEVICE_COMMAND_SECRET = 'test-secret-key-24-chars-min!!';
    process.env.DEVICE_API_KEYS = 'test-device-key-001';
    process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

    const gateway = new DeviceGateway(mockHttpServer as HttpServer);
    const registerHandler = getHandler('register');
    await callHandlerAndWait(registerHandler, {
      device_id: 'esp32-001',
      api_key: 'test-device-key-001',
    });

    mockSocket.emit.mockClear();
    (auditLogger.log as jest.Mock).mockClear();

    // Act
    const count = await gateway.broadcastCommand('scan', { target: '10.0.0.0/24' });

    // Assert: a single signed command frame was emitted
    expect(count).toBe(1);
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'command',
      expect.objectContaining({
        command: expect.objectContaining({
          cmd: 'scan',
          params: { target: '10.0.0.0/24' },
        }),
        signature: 'deadbeefsignature',
        deviceId: 'esp32-001',
      })
    );

    // And the unsigned fallback shape is never produced
    const unsignedCalls = mockSocket.emit.mock.calls.filter(
      ([event, payload]: [string, any]) =>
        event === 'command' && payload && payload.signature === undefined
    );
    expect(unsignedCalls).toHaveLength(0);

    // A success audit event was recorded with deviceCount=1 and no rejections
    const successAudit = (auditLogger.log as jest.Mock).mock.calls
      .map(([arg]) => arg)
      .find((arg) => arg?.eventType === 'device_broadcast_command');
    expect(successAudit).toBeDefined();
    expect(successAudit.status).toBe('success');
    expect(successAudit.details).toEqual(
      expect.objectContaining({
        command: 'scan',
        deviceCount: 1,
        rejectedCount: 0,
      })
    );

    // No failure audit event for the rejection path
    const rejectionAudits = (auditLogger.log as jest.Mock).mock.calls
      .map(([arg]) => arg)
      .filter((arg) => arg?.eventType === 'device_broadcast_rejected');
    expect(rejectionAudits).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // 3. CALLER OBSERVABILITY: a caller reading the return value / audit log
  //    can detect the broadcast was refused and react fail-closed
  // ---------------------------------------------------------------------
  it('lets a caller detect broadcast refusal and record an audit failure (caller-side fail-closed)', async () => {
    // Construct without DEVICE_COMMAND_SECRET so signCommand returns null
    process.env.DEVICE_API_KEYS = 'test-device-key-001';
    process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

    const gateway = new DeviceGateway(mockHttpServer as HttpServer);
    const registerHandler = getHandler('register');
    await callHandlerAndWait(registerHandler, {
      device_id: 'esp32-001',
      api_key: 'test-device-key-001',
    });

    // Simulate a caller (e.g., a REST route or a higher-level scheduler)
    // that wraps broadcastCommand and refuses to mark the operation as
    // "dispatched" when the count is zero and a rejection was recorded.
    const callerAuditSpy = jest.fn();
    const callerResult = await (async () => {
      const sent = await gateway.broadcastCommand('factory_reset', { confirmed: false });
      const wasRefused = sent === 0;
      if (wasRefused) {
        callerAuditSpy({
          eventType: 'broadcast_failed_at_caller',
          status: 'failure',
          reason: 'sign_failed_no_emit',
          sent,
        });
      }
      return { sent, wasRefused };
    })();

    // Caller observed the refusal
    expect(callerResult.sent).toBe(0);
    expect(callerResult.wasRefused).toBe(true);

    // Caller recorded its own audit failure
    expect(callerAuditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failure',
        reason: 'sign_failed_no_emit',
        sent: 0,
      })
    );

    // The gateway's own audit pipeline also recorded the refusal
    const gatewayRejection = (auditLogger.log as jest.Mock).mock.calls
      .map(([arg]) => arg)
      .find((arg) => arg?.eventType === 'device_broadcast_rejected');
    expect(gatewayRejection).toBeDefined();
    expect(gatewayRejection.status).toBe('failure');
    expect(gatewayRejection.details).toEqual(
      expect.objectContaining({
        command: 'factory_reset',
        reason: 'sign_failed',
        rejectedCount: 1,
        rejectedDeviceIds: ['esp32-001'],
      })
    );
  });
});
