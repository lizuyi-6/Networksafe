/**
 * Hardware Authorization First-Ack TOCTOU — Redteam Regression Test
 *
 * Verifies the edge case documented in the task:
 *   A fresh gate (last_monotonic_counter=0) receives its first ack with
 *   monotonicCounter=0. The ack must be REJECTED (not accepted or deadlocked).
 *
 * Flow trace through handlePhysicalConfirmationAck():
 *
 *   1. gate = getGate(gateId)  →  gate.lastMonotonicCounter = 0
 *   2. validateGrantPayload()
 *      - grant.monotonicCounter = 0
 *      - gate.lastMonotonicCounter = 0
 *      - Check: 0 <= 0  →  TRUE
 *      - Returns: 'non_increasing_monotonic_counter'
 *   3. rejectSession() is called — grant is NOT inserted
 *
 * The conditional UPDATE at line 632 is NOT reached for this combination
 * because validation rejects first. The UNIQUE(session_id) collision path
 * is therefore safe: a malicious agent cannot forge a grant by sending
 * monotonicCounter=0 on a fresh gate.
 *
 * This test exercises the correct (rejecting) path.
 * A companion test verifies the normal first-ack succeeds when the agent
 * sends the required monotonicCounter=1 on a fresh gate.
 */

import { createSign, generateKeyPairSync } from 'crypto';
import { initDatabase } from '../../config/database';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';
import { buildHardwareGrantMessage, hashPayload } from '../../security/hardware-grant';

describe('Hardware authorization first-ack TOCTOU (redteam)', () => {
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

  /**
   * Fresh gate, first ack with monotonicCounter=0 — must be rejected.
   * This is the documented edge case: lastMonotonicCounter=0, agent sends 0.
   * The validation check 0 <= 0 is TRUE, so rejection is correct behavior.
   */
  it('rejects first ack when fresh gate (lastMonotonicCounter=0) receives monotonicCounter=0', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const gateId = `gate-first-ack-0-${Date.now()}`;
    const deviceId = `device-first-ack-0-${Date.now()}`;

    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-redteam',
      gateId,
      displayName: 'First-ack edge-case gate',
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-redteam',
      scope: 'device',
      targetId: deviceId,
      commandType: 'reboot',
      payload: { delay: 3 },
      hardwareContext: {
        policyDigest: 'policy-edge-case',
        challenge: 'challenge-edge-case',
        breakerTarget: 'mgmt-uplink-a',
        interlockAction: 'interlock_release'
      },
      actorId: 'redteam-tester'
    });

    expect(request.success).toBe(true);
    const session = request.session!;

    // Verify gate starts with counter=0
    const freshGate = hardwareAuthorizationService.getGate(gateId);
    expect(freshGate?.lastMonotonicCounter).toBe(0);

    const issuedAt = new Date().toISOString();
    const expiresAt = session.expiresAt;

    // Agent sends monotonicCounter=0 on a fresh gate (counter=0)
    // This MUST be rejected — 0 is not strictly greater than 0
    const badSignature = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: session.sessionId,
        actionId: request.intent.actionId,
        tenantId: 'tenant-redteam',
        scope: 'device',
        targetId: deviceId,
        commandType: 'reboot',
        payloadHash: hashPayload({ delay: 3 }),
        policyDigest: 'policy-edge-case',
        challenge: 'challenge-edge-case',
        breakerTarget: 'mgmt-uplink-a',
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter: 0   // Same as gate's initial counter — must be rejected
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: session.sessionId,
      confirmed: true,
      policyDigest: 'policy-edge-case',
      challenge: 'challenge-edge-case',
      breakerTarget: 'mgmt-uplink-a',
      interlockAction: 'interlock_release',
      issuedAt,
      expiresAt,
      monotonicCounter: 0,
      signature: badSignature
    });

    expect(ack.confirmed).toBe(false);
    expect(ack.reason).toBe('non_increasing_monotonic_counter');

    // Gate counter must remain 0 (no bump)
    const gateAfter = hardwareAuthorizationService.getGate(gateId);
    expect(gateAfter?.lastMonotonicCounter).toBe(0);

    // No grant should have been inserted
    const grants = (hardwareAuthorizationService as any).getGrant
      ? []
      : [];
    expect(ack.grant).toBeUndefined();
  });

  /**
   * Fresh gate, first ack with the CORRECT monotonicCounter=1 — must succeed.
   * This confirms the normal first-ack path works end-to-end.
   */
  it('accepts first ack when fresh gate (lastMonotonicCounter=0) receives monotonicCounter=1', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const gateId = `gate-first-ack-1-${Date.now()}`;
    const deviceId = `device-first-ack-1-${Date.now()}`;

    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-redteam',
      gateId,
      displayName: 'First-ack normal gate',
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-redteam',
      scope: 'device',
      targetId: deviceId,
      commandType: 'reboot',
      payload: { delay: 5 },
      hardwareContext: {
        policyDigest: 'policy-normal',
        challenge: 'challenge-normal',
        breakerTarget: 'mgmt-uplink-a',
        interlockAction: 'interlock_release'
      },
      actorId: 'redteam-tester'
    });

    expect(request.success).toBe(true);
    const session = request.session!;

    // Verify gate starts with counter=0
    const freshGate = hardwareAuthorizationService.getGate(gateId);
    expect(freshGate?.lastMonotonicCounter).toBe(0);

    const issuedAt = new Date().toISOString();
    const expiresAt = session.expiresAt;

    // Correct first ack: monotonicCounter=1 on a fresh gate (counter=0)
    // 1 > 0 → passes validation, UPDATE matches, INSERT succeeds
    const goodSignature = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: session.sessionId,
        actionId: request.intent.actionId,
        tenantId: 'tenant-redteam',
        scope: 'device',
        targetId: deviceId,
        commandType: 'reboot',
        payloadHash: hashPayload({ delay: 5 }),
        policyDigest: 'policy-normal',
        challenge: 'challenge-normal',
        breakerTarget: 'mgmt-uplink-a',
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter: 1   // Correct: strictly greater than gate's initial 0
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: session.sessionId,
      confirmed: true,
      policyDigest: 'policy-normal',
      challenge: 'challenge-normal',
      breakerTarget: 'mgmt-uplink-a',
      interlockAction: 'interlock_release',
      issuedAt,
      expiresAt,
      monotonicCounter: 1,
      signature: goodSignature
    });

    expect(ack.confirmed).toBe(true);
    expect(ack.grant).toBeDefined();
    expect(ack.grant?.gateId).toBe(gateId);

    // Gate counter must have advanced to 1
    const gateAfter = hardwareAuthorizationService.getGate(gateId);
    expect(gateAfter?.lastMonotonicCounter).toBe(1);
  });
});
