import { createHash, createSign, generateKeyPairSync } from 'crypto';
import { initDatabase } from '../../config/database';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';

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
    String(input.monotonicCounter)
  ].join('\n');
}

describe('hardwareAuthorizationService', () => {
  beforeAll(async () => {
    await initDatabase();
    hardwareAuthorizationService.prepare();
  });

  beforeEach(() => {
    hardwareAuthorizationService.setGatewayEmitter(() => true);
    commandDispatcherService.setDeviceAdapter({
      getDevice: () => ({ isOnline: true }),
      executeCommand: jest.fn().mockResolvedValue({
        success: true,
        record: { ok: true },
        message: 'executed'
      })
    });
  });

  it('verifies a hardware grant and dispatches the confirmed command', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const gateId = `gate-${Date.now()}`;
    const deviceId = `device-${Date.now()}`;
    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-test',
      gateId,
      displayName: 'Main gate',
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-test',
      scope: 'device',
      targetId: deviceId,
      commandType: 'reboot',
      payload: { delay: 5 },
      actorId: 'tester'
    });

    expect(request.success).toBe(true);
    expect(request.session?.gateId).toBe(gateId);

    const issuedAt = new Date().toISOString();
    const expiresAt = request.session!.expiresAt;
    const monotonicCounter = 1;
    const signature = createSign('SHA256')
      .update(buildMessage({
        gateId,
        sessionId: request.session!.sessionId,
        actionId: request.intent.actionId,
        tenantId: 'tenant-test',
        scope: 'device',
        targetId: deviceId,
        commandType: 'reboot',
        payloadHash: payloadHash({ delay: 5 }),
        issuedAt,
        expiresAt,
        monotonicCounter
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: request.session!.sessionId,
      confirmed: true,
      issuedAt,
      expiresAt,
      monotonicCounter,
      signature
    });

    expect(ack.confirmed).toBe(true);
    expect(ack.grant?.gateId).toBe(gateId);

    const dispatch = await commandDispatcherService.dispatchHardwareConfirmedIntent(
      ack.intent!,
      ack.grant!
    );

    expect(dispatch.success).toBe(true);
    expect(dispatch.status).toBe('completed');
  });
});
