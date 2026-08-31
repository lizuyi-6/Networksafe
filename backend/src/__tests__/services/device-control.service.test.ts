import { createSign, generateKeyPairSync, randomUUID } from 'crypto';
import { getDatabase, initDatabase } from '../../config/database';
import { registerDevice } from '../../services/device-registry.service';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { deviceControlService } from '../../services/device-control.service';
import { buildHardwareGrantMessage, hashPayload } from '../../security/hardware-grant';

describe('deviceControlService physical confirmation', () => {
  const testDevicePrefix = 'device-control-physical-confirmation-test';
  const uniqueDeviceId = (suffix: string) => `${testDevicePrefix}-${suffix}-${randomUUID()}`;

  beforeAll(async () => {
    await initDatabase();
    deviceControlService.prepare();
  });

  beforeEach(() => {
    getDatabase().prepare(`
      DELETE FROM device_confirmation_sessions
      WHERE device_id LIKE ?
    `).run(`${testDevicePrefix}-%`);
    deviceControlService.setGatewayEmitter(() => true);
    commandDispatcherService.setDeviceAdapter({
      getDevice: () => ({ isOnline: true }),
      executeCommand: async ({ deviceId, command }) => ({
        success: true,
        record: { deviceId, command },
        message: 'ok'
      })
    });
  });

  afterEach(() => {
    getDatabase().prepare(`
      DELETE FROM device_confirmation_sessions
      WHERE device_id LIKE ?
    `).run(`${testDevicePrefix}-%`);
    deviceControlService.setGatewayEmitter(null);
    commandDispatcherService.setDeviceAdapter(null);
  });

  it('accepts a signed physical confirmation ack', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const deviceId = uniqueDeviceId('confirm');
    registerDevice({
      deviceId,
      version: '1.0.0',
      chipModel: 'ESP32-S3-WROOM-1',
      flashSize: 8 * 1024 * 1024,
      freeHeap: 200000,
      sdkVersion: 'idf-5.x',
      mode: 'online',
      transport: 'usb_serial',
      secureElementPresent: true,
      physicalAuth: {
        publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
      }
    } as any);

    const session = await deviceControlService.createPhysicalConfirmation({
      tenantId: 'tenant-test',
      deviceId,
      commandType: 'host_remove',
      payload: { path: '/opt/AetherGuard' },
      hardwareContext: {
        policyDigest: 'sha256:deadbeef-test-policy-digest-0123456789abcdef',
        breakerTarget: 'server-nic-0'
      },
      actorId: 'tester'
    });

    const pendingRow = getDatabase().prepare(`
      SELECT result_json
      FROM device_confirmation_sessions
      WHERE id = ?
      LIMIT 1
    `).get(session.id) as any;
    expect(session.expiresAt).toBe(JSON.parse(pendingRow.result_json).expiresAt);

    const issuedAt = new Date().toISOString();
    const expiresAt = session.expiresAt as string;
    const monotonicCounter = 1;
    const message = buildHardwareGrantMessage({
      gateId: deviceId,
      sessionId: session.id,
      actionId: session.id,
      tenantId: 'tenant-test',
      scope: 'device',
      targetId: deviceId,
      commandType: 'host_remove',
      payloadHash: hashPayload({ path: '/opt/AetherGuard' }),
      policyDigest: 'sha256:deadbeef-test-policy-digest-0123456789abcdef',
      breakerTarget: 'server-nic-0',
      issuedAt,
      expiresAt,
      monotonicCounter,
    });
    const signature = createSign('SHA256').update(message).end().sign(keyPair.privateKey, 'base64');

    await deviceControlService.handlePhysicalConfirmationAck(deviceId, {
      confirmationSessionId: session.id,
      confirmed: true,
      monotonicCounter,
      issuedAt,
      expiresAt,
      policyDigest: 'sha256:deadbeef-test-policy-digest-0123456789abcdef',
      breakerTarget: 'server-nic-0',
      signature
    });

    const row = getDatabase().prepare(`
      SELECT status, result_json
      FROM device_confirmation_sessions
      WHERE id = ?
      LIMIT 1
    `).get(session.id) as any;

    expect(row.status).toBe('confirmed');
    expect(JSON.parse(row.result_json).verified).toBe(true);
  });

  it('rejects a replayed physical confirmation ack without redispatching', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const deviceId = uniqueDeviceId('replay');
    let dispatchCount = 0;
    commandDispatcherService.setDeviceAdapter({
      getDevice: () => ({ isOnline: true }),
      executeCommand: async ({ deviceId, command }) => {
        dispatchCount += 1;
        return {
          success: true,
          record: { deviceId, command },
          message: 'ok'
        };
      }
    });
    registerDevice({
      deviceId,
      version: '1.0.0',
      chipModel: 'ESP32-S3-WROOM-1',
      flashSize: 8 * 1024 * 1024,
      freeHeap: 200000,
      sdkVersion: 'idf-5.x',
      mode: 'online',
      transport: 'usb_serial',
      secureElementPresent: true,
      physicalAuth: {
        publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
      }
    } as any);

    const session = await deviceControlService.createPhysicalConfirmation({
      tenantId: 'tenant-test',
      deviceId,
      commandType: 'host_remove',
      payload: { path: '/opt/AetherGuard' },
      hardwareContext: {
        policyDigest: 'sha256:replay-test-policy-digest-0123456789abcdef',
        breakerTarget: 'server-nic-0'
      },
      actorId: 'tester'
    });

    const issuedAt = new Date().toISOString();
    const expiresAt = session.expiresAt as string;
    const monotonicCounter = 1;
    const message = buildHardwareGrantMessage({
      gateId: deviceId,
      sessionId: session.id,
      actionId: session.id,
      tenantId: 'tenant-test',
      scope: 'device',
      targetId: deviceId,
      commandType: 'host_remove',
      payloadHash: hashPayload({ path: '/opt/AetherGuard' }),
      policyDigest: 'sha256:replay-test-policy-digest-0123456789abcdef',
      breakerTarget: 'server-nic-0',
      issuedAt,
      expiresAt,
      monotonicCounter,
    });
    const signature = createSign('SHA256').update(message).end().sign(keyPair.privateKey, 'base64');
    const ack = {
      confirmationSessionId: session.id,
      confirmed: true,
      monotonicCounter,
      issuedAt,
      expiresAt,
      policyDigest: 'sha256:replay-test-policy-digest-0123456789abcdef',
      breakerTarget: 'server-nic-0',
      signature
    };

    await deviceControlService.handlePhysicalConfirmationAck(deviceId, ack);
    await deviceControlService.handlePhysicalConfirmationAck(deviceId, ack);

    const row = getDatabase().prepare(`
      SELECT status, result_json
      FROM device_confirmation_sessions
      WHERE id = ?
      LIMIT 1
    `).get(session.id) as any;

    expect(dispatchCount).toBe(1);
    expect(row.status).toBe('rejected');
    expect(JSON.parse(row.result_json).replayRejected.reason).toBe('confirmation_session_replay_or_not_pending');
  });

  it('rejects an expired physical confirmation ack without dispatching', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const deviceId = uniqueDeviceId('expired');
    let dispatchCount = 0;
    commandDispatcherService.setDeviceAdapter({
      getDevice: () => ({ isOnline: true }),
      executeCommand: async () => {
        dispatchCount += 1;
        return {
          success: true,
          record: {},
          message: 'ok'
        };
      }
    });
    registerDevice({
      deviceId,
      version: '1.0.0',
      chipModel: 'ESP32-S3-WROOM-1',
      flashSize: 8 * 1024 * 1024,
      freeHeap: 200000,
      sdkVersion: 'idf-5.x',
      mode: 'online',
      transport: 'usb_serial',
      secureElementPresent: true,
      physicalAuth: {
        publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
      }
    } as any);

    const session = await deviceControlService.createPhysicalConfirmation({
      tenantId: 'tenant-test',
      deviceId,
      commandType: 'host_remove',
      payload: { path: '/opt/AetherGuard' },
      hardwareContext: {
        policyDigest: 'sha256:expired-test-policy-digest-0123456789abcdef',
        breakerTarget: 'server-nic-0'
      },
      releaseTtlMs: -1,
      actorId: 'tester'
    });

    const result = JSON.parse((getDatabase().prepare(`
      SELECT result_json
      FROM device_confirmation_sessions
      WHERE id = ?
      LIMIT 1
    `).get(session.id) as any).result_json);
    result.expiresAt = new Date(Date.now() - 1000).toISOString();
    getDatabase().prepare(`
      UPDATE device_confirmation_sessions
      SET result_json = ?
      WHERE id = ?
    `).run(JSON.stringify(result), session.id);

    const issuedAt = new Date(Date.now() - 5000).toISOString();
    const expiresAt = result.expiresAt;
    const monotonicCounter = 1;
    const message = buildHardwareGrantMessage({
      gateId: deviceId,
      sessionId: session.id,
      actionId: session.id,
      tenantId: 'tenant-test',
      scope: 'device',
      targetId: deviceId,
      commandType: 'host_remove',
      payloadHash: hashPayload({ path: '/opt/AetherGuard' }),
      policyDigest: 'sha256:expired-test-policy-digest-0123456789abcdef',
      breakerTarget: 'server-nic-0',
      issuedAt,
      expiresAt,
      monotonicCounter,
    });
    const signature = createSign('SHA256').update(message).end().sign(keyPair.privateKey, 'base64');

    await deviceControlService.handlePhysicalConfirmationAck(deviceId, {
      confirmationSessionId: session.id,
      confirmed: true,
      monotonicCounter,
      issuedAt,
      expiresAt,
      policyDigest: 'sha256:expired-test-policy-digest-0123456789abcdef',
      breakerTarget: 'server-nic-0',
      signature
    });

    const row = getDatabase().prepare(`
      SELECT status, result_json
      FROM device_confirmation_sessions
      WHERE id = ?
      LIMIT 1
    `).get(session.id) as any;

    expect(dispatchCount).toBe(0);
    expect(row.status).toBe('rejected');
    expect(JSON.parse(row.result_json).reason).toBe('session_expired');
  });

  // SECURITY (audit 2026-08, AUD-07-1): firmware artifacts are content-addressed
  // and immutable; OTA is tenant-scoped and binds the payload digest.
  describe('firmware content addressing (AUD-07-1)', () => {
    const upload = (overrides: Record<string, any> = {}) => deviceControlService.uploadFirmware({
      tenantId: 'tenant-firmware-test',
      fileName: 'fw.bin',
      version: `1.0.${Date.now() % 100000}`,
      channel: 'stable',
      contentBase64: Buffer.from('firmware-bytes-canary').toString('base64'),
      actorId: 'tester',
      ...overrides
    });

    it('stores the artifact content-addressed and records its sha256', async () => {
      const firmware = await upload();
      const expectedDigest = require('crypto').createHash('sha256')
        .update(Buffer.from('firmware-bytes-canary')).digest('hex');

      expect(firmware.sha256).toBe(expectedDigest);
      expect(firmware.artifactRef).toContain(`sha256/${expectedDigest}`);
    });

    it('is idempotent for identical content (same digest, no duplicate bytes)', async () => {
      const first = await upload({ version: `2.0.${Date.now() % 100000}` });
      const second = await upload({ version: `2.1.${Date.now() % 100000}` });
      // Same bytes → same digest → the SAME content-addressed artifact is
      // reused; each logical version still anchors to it.
      expect(second.sha256).toBe(first.sha256);
      expect(second.artifactRef).toBe(first.artifactRef);
    });

    it('refuses replacing an existing logical version with different bytes', async () => {
      const version = `3.0.${Date.now() % 100000}`;
      await upload({ version });
      await expect(upload({
        version,
        contentBase64: Buffer.from('tampered-firmware-bytes').toString('base64')
      })).rejects.toThrow('backend.firmware_version_immutable');
    });

    it('refuses flashing another tenant\'s firmware via OTA', async () => {
      const firmware = await upload({ tenantId: 'tenant-firmware-owner' });
      await expect(deviceControlService.triggerOta({
        tenantId: 'tenant-firmware-intruder',
        deviceId: uniqueDeviceId('ota'),
        firmwareId: firmware.id,
        actorId: 'tester'
      })).rejects.toThrow('backend.firmware_tenant_mismatch');
    });

    it('binds the sha256 digest into the OTA dispatch payload', async () => {
      const firmware = await upload({ tenantId: 'tenant-firmware-ota' });
      let forwarded: any = null;
      deviceControlService.setGatewayEmitter((_deviceId, frame, payload) => {
        void frame;
        forwarded = payload;
        return true;
      });

      try {
        await deviceControlService.triggerOta({
          tenantId: 'tenant-firmware-ota',
          deviceId: uniqueDeviceId('ota'),
          firmwareId: firmware.id,
          actorId: 'tester'
        });
        expect(forwarded?.sha256).toBe(firmware.sha256);
      } finally {
        deviceControlService.setGatewayEmitter(null);
      }
    });
  });
});
