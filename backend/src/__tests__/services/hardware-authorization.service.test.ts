import { createSign, generateKeyPairSync } from 'crypto';
import { initDatabase } from '../../config/database';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';
import { buildHardwareGrantMessage, hashPayload } from '../../security/hardware-grant';

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
      hardwareContext: {
        policyDigest: 'policy-digest-test',
        challenge: 'challenge-test',
        breakerTarget: 'mgmt-uplink-a',
        interlockAction: 'interlock_release'
      },
      actorId: 'tester'
    });

    expect(request.success).toBe(true);
    expect(request.session?.gateId).toBe(gateId);

    const issuedAt = new Date().toISOString();
    const expiresAt = request.session!.expiresAt;
    const monotonicCounter = 1;
    const signature = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: request.session!.sessionId,
        actionId: request.intent.actionId,
        tenantId: 'tenant-test',
        scope: 'device',
        targetId: deviceId,
        commandType: 'reboot',
        payloadHash: hashPayload({ delay: 5 }),
        policyDigest: 'policy-digest-test',
        challenge: 'challenge-test',
        breakerTarget: 'mgmt-uplink-a',
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: request.session!.sessionId,
      confirmed: true,
      policyDigest: 'policy-digest-test',
      challenge: 'challenge-test',
      breakerTarget: 'mgmt-uplink-a',
      interlockAction: 'interlock_release',
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

  it('rejects a hardware grant when signed final-defense context is tampered', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const gateId = `gate-tamper-${Date.now()}`;
    const deviceId = `device-tamper-${Date.now()}`;
    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-test',
      gateId,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-test',
      scope: 'device',
      targetId: deviceId,
      commandType: 'host_remove',
      payload: { path: '/opt/aetherguard' },
      hardwareContext: {
        policyDigest: 'expected-policy-digest',
        challenge: 'challenge-a',
        breakerTarget: 'mgmt-uplink-a',
        interlockAction: 'interlock_release'
      },
      actorId: 'tester'
    });

    const issuedAt = new Date().toISOString();
    const expiresAt = request.session!.expiresAt;
    const monotonicCounter = 1;
    const signature = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: request.session!.sessionId,
        actionId: request.intent.actionId,
        tenantId: 'tenant-test',
        scope: 'device',
        targetId: deviceId,
        commandType: 'host_remove',
        payloadHash: hashPayload({ path: '/opt/aetherguard' }),
        policyDigest: 'expected-policy-digest',
        challenge: 'challenge-a',
        breakerTarget: 'mgmt-uplink-a',
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: request.session!.sessionId,
      confirmed: true,
      policyDigest: 'tampered-policy-digest',
      challenge: 'challenge-a',
      breakerTarget: 'mgmt-uplink-a',
      interlockAction: 'interlock_release',
      issuedAt,
      expiresAt,
      monotonicCounter,
      signature
    });

    expect(ack.confirmed).toBe(false);
    expect(ack.reason).toBe('policyDigest_mismatch');
  });
});
