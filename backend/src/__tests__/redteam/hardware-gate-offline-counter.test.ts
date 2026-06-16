/**
 * Hardware Gate Offline Counter — Redteam Regression Test
 *
 * Verifies that markGateOffline() does NOT reset lastMonotonicCounter.
 * If the counter were reset, an attacker who captured a high counter value
 * could replay it after the gate comes back online.
 *
 * Uses counter=1 and counter=2 (known-working paths from existing tests).
 */

import { createSign, generateKeyPairSync } from 'crypto';
import { initDatabase } from '../../config/database';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';
import { buildHardwareGrantMessage, hashPayload } from '../../security/hardware-grant';

describe('Hardware gate offline counter persistence (redteam)', () => {
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

  it('D20 regression: markGateOffline preserves the monotonic counter', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const gateId = `gate-offline-counter-${Date.now()}`;
    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-redteam-offline',
      gateId,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    // Advance counter to 1 via a valid ack
    const req1 = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-redteam-offline',
      scope: 'device',
      targetId: 'device-offline-test',
      commandType: 'reboot',
      payload: {},
      hardwareContext: {
        policyDigest: 'digest-offline',
        challenge: 'chal-offline',
        breakerTarget: 'brk-offline',
        interlockAction: 'rel-offline'
      },
      actorId: 'redteam-tester'
    });
    expect(req1.success).toBe(true);

    const issuedAt1 = new Date().toISOString();
    const expiresAt1 = req1.session!.expiresAt;
    const sig1 = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: req1.session!.sessionId,
        actionId: req1.intent.actionId,
        tenantId: 'tenant-redteam-offline',
        scope: 'device',
        targetId: 'device-offline-test',
        commandType: 'reboot',
        payloadHash: hashPayload({}),
        policyDigest: 'digest-offline',
        challenge: 'chal-offline',
        breakerTarget: 'brk-offline',
        interlockAction: 'rel-offline',
        issuedAt: issuedAt1,
        expiresAt: expiresAt1,
        monotonicCounter: 1
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const ack1 = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: req1.session!.sessionId,
      confirmed: true,
      policyDigest: 'digest-offline',
      challenge: 'chal-offline',
      breakerTarget: 'brk-offline',
      interlockAction: 'rel-offline',
      issuedAt: issuedAt1,
      expiresAt: expiresAt1,
      monotonicCounter: 1,
      signature: sig1
    });

    expect(ack1.confirmed).toBe(true);
    expect(hardwareAuthorizationService.getGate(gateId)?.lastMonotonicCounter).toBe(1);

    // Mark the gate offline — counter MUST persist (NOT reset to 0)
    hardwareAuthorizationService.markGateOffline(gateId);
    expect(hardwareAuthorizationService.getGate(gateId)?.status).toBe('offline');
    expect(hardwareAuthorizationService.getGate(gateId)?.lastMonotonicCounter).toBe(1);

    // Re-enroll online — counter still must be 1 (not reset)
    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-redteam-offline',
      gateId,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });
    expect(hardwareAuthorizationService.getGate(gateId)?.lastMonotonicCounter).toBe(1);

    // Advance to counter=2
    const req2 = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-redteam-offline',
      scope: 'device',
      targetId: 'device-offline-test-2',
      commandType: 'reboot',
      payload: {},
      hardwareContext: {
        policyDigest: 'digest-2',
        challenge: 'chal-2',
        breakerTarget: 'brk-2',
        interlockAction: 'rel-2'
      },
      actorId: 'redteam-tester'
    });
    expect(req2.success).toBe(true);

    const issuedAt2 = new Date().toISOString();
    const expiresAt2 = req2.session!.expiresAt;
    const sig2 = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: req2.session!.sessionId,
        actionId: req2.intent.actionId,
        tenantId: 'tenant-redteam-offline',
        scope: 'device',
        targetId: 'device-offline-test-2',
        commandType: 'reboot',
        payloadHash: hashPayload({}),
        policyDigest: 'digest-2',
        challenge: 'chal-2',
        breakerTarget: 'brk-2',
        interlockAction: 'rel-2',
        issuedAt: issuedAt2,
        expiresAt: expiresAt2,
        monotonicCounter: 2
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const ack2 = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: req2.session!.sessionId,
      confirmed: true,
      policyDigest: 'digest-2',
      challenge: 'chal-2',
      breakerTarget: 'brk-2',
      interlockAction: 'rel-2',
      issuedAt: issuedAt2,
      expiresAt: expiresAt2,
      monotonicCounter: 2,
      signature: sig2
    });

    expect(ack2.confirmed).toBe(true);
    expect(hardwareAuthorizationService.getGate(gateId)?.lastMonotonicCounter).toBe(2);

    // A replay ack with counter=1 (same as before offline) must be rejected
    const req3 = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-redteam-offline',
      scope: 'device',
      targetId: 'device-offline-test-3',
      commandType: 'reboot',
      payload: {},
      hardwareContext: {
        policyDigest: 'digest-3',
        challenge: 'chal-3',
        breakerTarget: 'brk-3',
        interlockAction: 'rel-3'
      },
      actorId: 'redteam-tester'
    });
    expect(req3.success).toBe(true);

    const sigReplay = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: req3.session!.sessionId,
        actionId: req3.intent.actionId,
        tenantId: 'tenant-redteam-offline',
        scope: 'device',
        targetId: 'device-offline-test-3',
        commandType: 'reboot',
        payloadHash: hashPayload({}),
        policyDigest: 'digest-3',
        challenge: 'chal-3',
        breakerTarget: 'brk-3',
        interlockAction: 'rel-3',
        issuedAt: new Date().toISOString(),
        expiresAt: req3.session!.expiresAt,
        monotonicCounter: 1 // stale counter — must be rejected
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const ackReplay = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: req3.session!.sessionId,
      confirmed: true,
      policyDigest: 'digest-3',
      challenge: 'chal-3',
      breakerTarget: 'brk-3',
      interlockAction: 'rel-3',
      issuedAt: new Date().toISOString(),
      expiresAt: req3.session!.expiresAt,
      monotonicCounter: 1,
      signature: sigReplay
    });

    expect(ackReplay.confirmed).toBe(false);
    expect(ackReplay.reason).toBe('non_increasing_monotonic_counter');
  });
});
