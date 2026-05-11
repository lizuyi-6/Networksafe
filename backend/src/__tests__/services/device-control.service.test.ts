import { createHash, createSign, generateKeyPairSync } from 'crypto';
import { getDatabase, initDatabase } from '../../config/database';
import { registerDevice } from '../../services/device-registry.service';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { deviceControlService } from '../../services/device-control.service';

function payloadHash(value: Record<string, any>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildMessage(input: {
  gateId: string;
  sessionId: string;
  actionId: string;
  tenantId: string;
  scope: 'device';
  targetId: string;
  commandType: string;
  payloadHash: string;
  issuedAt: string;
  expiresAt: string;
  monotonicCounter: number;
}): string {
  return [
    input.gateId,
    input.sessionId,
    input.actionId,
    input.tenantId,
    input.scope,
    input.targetId,
    input.commandType,
    input.payloadHash,
    input.issuedAt,
    input.expiresAt,
    String(input.monotonicCounter),
  ].join('\n');
}

describe('deviceControlService physical confirmation', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
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

  it('accepts a signed physical confirmation ack', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const deviceId = `device-confirm-${Date.now()}`;
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
    });

    const session = await deviceControlService.createPhysicalConfirmation({
      tenantId: 'tenant-test',
      deviceId,
      commandType: 'host_remove',
      payload: { path: '/opt/AetherGuard' },
      actorId: 'tester'
    });

    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 120000).toISOString();
    const monotonicCounter = 1;
    const message = buildMessage({
      gateId: deviceId,
      sessionId: session.id,
      actionId: session.id,
      tenantId: 'tenant-test',
      scope: 'device',
      targetId: deviceId,
      commandType: 'host_remove',
      payloadHash: payloadHash({ path: '/opt/AetherGuard' }),
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
});
