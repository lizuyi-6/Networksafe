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
});
