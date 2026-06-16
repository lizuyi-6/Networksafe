/**
 * Hardware Grant Monotonic Counter Edge-Case Redteam Tests
 *
 * Covers the following attack scenarios against the monotonic counter validation
 * in hardwareAuthorizationService.validateGrantPayload():
 *
 *  1. Counter = -1          — negative value (rejected by isFinite)
 *  2. Counter = 0 when stored = 0 — not strictly increasing (rejected by <= check)
 *  3. Counter = 'abc'        — string instead of number (NaN, rejected by isFinite)
 *  4. Counter = 1.5         — float / non-integer (NEW: rejected by isInteger)
 *  5. Counter = MAX_SAFE_INTEGER + 1 — overflow beyond safe integer range (NEW: rejected)
 *
 * All of these must be rejected with 'invalid_monotonic_counter' or
 * 'non_increasing_monotonic_counter' to maintain fail-closed behavior.
 */

import { createSign, generateKeyPairSync } from 'crypto';
import { initDatabase } from '../../config/database';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';
import { buildHardwareGrantMessage, hashPayload } from '../../security/hardware-grant';

describe('Hardware grant monotonic counter edge cases (redteam)', () => {
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

  // -------------------------------------------------------------------------
  // Helper: build a valid grant envelope for a given counter value, then
  // inject the bad counter directly into the ack payload.
  // -------------------------------------------------------------------------
  async function buildAck(gateId: string, sessionId: string, actionId: string,
    monotonicCounter: number) {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-redteam-edge',
      gateId,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-redteam-edge',
      scope: 'device',
      targetId: `device-${gateId}`,
      commandType: 'reboot',
      payload: { delay: 1 },
      hardwareContext: {
        policyDigest: 'edge-policy',
        challenge: 'edge-challenge',
        breakerTarget: 'mgmt-uplink',
        interlockAction: 'interlock_release'
      },
      actorId: 'redteam'
    });

    const issuedAt = new Date().toISOString();
    const expiresAt = request.session!.expiresAt;
    const signature = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: request.session!.sessionId,
        actionId: request.intent.actionId,
        tenantId: 'tenant-redteam-edge',
        scope: 'device',
        targetId: `device-${gateId}`,
        commandType: 'reboot',
        payloadHash: hashPayload({ delay: 1 }),
        policyDigest: 'edge-policy',
        challenge: 'edge-challenge',
        breakerTarget: 'mgmt-uplink',
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    return { ack: request.session!, signature, issuedAt, expiresAt };
  }

  // -------------------------------------------------------------------------
  // EDGE CASE 1: Counter = -1 (negative integer)
  // Expected: rejected — negative values fail Number.isFinite
  // -------------------------------------------------------------------------
  it('rejects negative monotonic counter (-1)', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const gateId = `gate-neg-${Date.now()}`;
    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-redteam-edge',
      gateId,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-redteam-edge',
      scope: 'device',
      targetId: `device-${gateId}`,
      commandType: 'reboot',
      payload: {},
      hardwareContext: {
        policyDigest: 'edge-policy',
        challenge: 'edge-challenge',
        breakerTarget: 'mgmt-uplink',
        interlockAction: 'interlock_release'
      },
      actorId: 'redteam'
    });

    expect(request.session).toBeDefined();

    const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: request.session!.sessionId,
      confirmed: true,
      policyDigest: 'edge-policy',
      challenge: 'edge-challenge',
      breakerTarget: 'mgmt-uplink',
      interlockAction: 'interlock_release',
      issuedAt: new Date().toISOString(),
      expiresAt: request.session!.expiresAt,
      // @ts-ignore — deliberately passing invalid input
      monotonicCounter: -1,
      signature: 'invalid-signature'
    });

    expect(ack.confirmed).toBe(false);
    expect(['invalid_monotonic_counter', 'non_increasing_monotonic_counter']).toContain(ack.reason);
  });

  // -------------------------------------------------------------------------
  // EDGE CASE 2: Counter = 0 when stored = 0 (not strictly increasing)
  // Expected: rejected — 0 <= 0 is TRUE, returns 'non_increasing_monotonic_counter'
  // -------------------------------------------------------------------------
  it('rejects monotonic counter = 0 on a fresh gate (stored = 0)', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const gateId = `gate-zero-${Date.now()}`;
    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-redteam-edge',
      gateId,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-redteam-edge',
      scope: 'device',
      targetId: `device-${gateId}`,
      commandType: 'reboot',
      payload: {},
      hardwareContext: {
        policyDigest: 'edge-zero',
        challenge: 'challenge-zero',
        breakerTarget: 'mgmt-uplink',
        interlockAction: 'interlock_release'
      },
      actorId: 'redteam'
    });

    const issuedAt = new Date().toISOString();
    const expiresAt = request.session!.expiresAt;
    const sig = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: request.session!.sessionId,
        actionId: request.intent.actionId,
        tenantId: 'tenant-redteam-edge',
        scope: 'device',
        targetId: `device-${gateId}`,
        commandType: 'reboot',
        payloadHash: hashPayload({}),
        policyDigest: 'edge-zero',
        challenge: 'challenge-zero',
        breakerTarget: 'mgmt-uplink',
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter: 0
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: request.session!.sessionId,
      confirmed: true,
      policyDigest: 'edge-zero',
      challenge: 'challenge-zero',
      breakerTarget: 'mgmt-uplink',
      interlockAction: 'interlock_release',
      issuedAt,
      expiresAt,
      monotonicCounter: 0,
      signature: sig
    });

    expect(ack.confirmed).toBe(false);
    expect(ack.reason).toBe('non_increasing_monotonic_counter');

    // Counter must not have advanced
    const gate = hardwareAuthorizationService.getGate(gateId);
    expect(gate?.lastMonotonicCounter).toBe(0);
  });

  // -------------------------------------------------------------------------
  // EDGE CASE 3: Counter = 'abc' (string instead of number)
  // Expected: rejected — Number('abc') = NaN, fails Number.isFinite
  // -------------------------------------------------------------------------
  it('rejects string counter value (non-numeric)', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const gateId = `gate-string-${Date.now()}`;
    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-redteam-edge',
      gateId,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-redteam-edge',
      scope: 'device',
      targetId: `device-${gateId}`,
      commandType: 'reboot',
      payload: {},
      hardwareContext: {
        policyDigest: 'edge-string',
        challenge: 'challenge-string',
        breakerTarget: 'mgmt-uplink',
        interlockAction: 'interlock_release'
      },
      actorId: 'redteam'
    });

    const issuedAt = new Date().toISOString();
    const expiresAt = request.session!.expiresAt;
    const sig = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: request.session!.sessionId,
        actionId: request.intent.actionId,
        tenantId: 'tenant-redteam-edge',
        scope: 'device',
        targetId: `device-${gateId}`,
        commandType: 'reboot',
        payloadHash: hashPayload({}),
        policyDigest: 'edge-string',
        challenge: 'challenge-string',
        breakerTarget: 'mgmt-uplink',
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter: 0 // placeholder; signature uses 0
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    // @ts-ignore — deliberately passing invalid type
    const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: request.session!.sessionId,
      confirmed: true,
      policyDigest: 'edge-string',
      challenge: 'challenge-string',
      breakerTarget: 'mgmt-uplink',
      interlockAction: 'interlock_release',
      issuedAt,
      expiresAt,
      monotonicCounter: 'abc',  // string instead of number
      signature: sig
    });

    expect(ack.confirmed).toBe(false);
    expect(ack.reason).toBe('invalid_monotonic_counter');
  });

  // -------------------------------------------------------------------------
  // EDGE CASE 4: Counter = 1.5 (float / non-integer)
  // Expected: rejected — fails Number.isInteger (NEW fix in D20)
  // Previously this would pass because 1.5 > stored_counter=1 and isFinite(1.5) = true.
  // -------------------------------------------------------------------------
  it('rejects non-integer float counter (1.5)', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const gateId = `gate-float-${Date.now()}`;
    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-redteam-edge',
      gateId,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    // Bump the gate to counter=1 so that 1.5 would be "greater than stored"
    const bumpRequest = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-redteam-edge',
      scope: 'device',
      targetId: `device-${gateId}`,
      commandType: 'reboot',
      payload: {},
      hardwareContext: {
        policyDigest: 'edge-float-bump',
        challenge: 'challenge-float-bump',
        breakerTarget: 'mgmt-uplink',
        interlockAction: 'interlock_release'
      },
      actorId: 'redteam'
    });
    const bumpIssuedAt = new Date().toISOString();
    const bumpExpiresAt = bumpRequest.session!.expiresAt;
    const bumpSig = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: bumpRequest.session!.sessionId,
        actionId: bumpRequest.intent.actionId,
        tenantId: 'tenant-redteam-edge',
        scope: 'device',
        targetId: `device-${gateId}`,
        commandType: 'reboot',
        payloadHash: hashPayload({}),
        policyDigest: 'edge-float-bump',
        challenge: 'challenge-float-bump',
        breakerTarget: 'mgmt-uplink',
        interlockAction: 'interlock_release',
        issuedAt: bumpIssuedAt,
        expiresAt: bumpExpiresAt,
        monotonicCounter: 1
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');
    await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: bumpRequest.session!.sessionId,
      confirmed: true,
      policyDigest: 'edge-float-bump',
      challenge: 'challenge-float-bump',
      breakerTarget: 'mgmt-uplink',
      interlockAction: 'interlock_release',
      issuedAt: bumpIssuedAt,
      expiresAt: bumpExpiresAt,
      monotonicCounter: 1,
      signature: bumpSig
    });

    // Now send a float counter=1.5 — should be rejected by isInteger check
    const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-redteam-edge',
      scope: 'device',
      targetId: `device-${gateId}`,
      commandType: 'reboot',
      payload: {},
      hardwareContext: {
        policyDigest: 'edge-float',
        challenge: 'challenge-float',
        breakerTarget: 'mgmt-uplink',
        interlockAction: 'interlock_release'
      },
      actorId: 'redteam'
    });

    const issuedAt = new Date().toISOString();
    const expiresAt = request.session!.expiresAt;
    const sig = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: request.session!.sessionId,
        actionId: request.intent.actionId,
        tenantId: 'tenant-redteam-edge',
        scope: 'device',
        targetId: `device-${gateId}`,
        commandType: 'reboot',
        payloadHash: hashPayload({}),
        policyDigest: 'edge-float',
        challenge: 'challenge-float',
        breakerTarget: 'mgmt-uplink',
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter: 1.5
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: request.session!.sessionId,
      confirmed: true,
      policyDigest: 'edge-float',
      challenge: 'challenge-float',
      breakerTarget: 'mgmt-uplink',
      interlockAction: 'interlock_release',
      issuedAt,
      expiresAt,
      monotonicCounter: 1.5,
      signature: sig
    });

    expect(ack.confirmed).toBe(false);
    expect(ack.reason).toBe('invalid_monotonic_counter');
  });

  // -------------------------------------------------------------------------
  // EDGE CASE 5: Counter = MAX_SAFE_INTEGER + 1 (JavaScript integer overflow)
  // Expected: rejected — exceeds Number.MAX_SAFE_INTEGER (NEW fix in D20)
  // -------------------------------------------------------------------------
  it('rejects counter at MAX_SAFE_INTEGER + 1 (overflow)', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const gateId = `gate-maxsafe-${Date.now()}`;
    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-redteam-edge',
      gateId,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-redteam-edge',
      scope: 'device',
      targetId: `device-${gateId}`,
      commandType: 'reboot',
      payload: {},
      hardwareContext: {
        policyDigest: 'edge-maxsafe',
        challenge: 'challenge-maxsafe',
        breakerTarget: 'mgmt-uplink',
        interlockAction: 'interlock_release'
      },
      actorId: 'redteam'
    });

    const overflowCounter = Number.MAX_SAFE_INTEGER + 1;
    const issuedAt = new Date().toISOString();
    const expiresAt = request.session!.expiresAt;
    const sig = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: request.session!.sessionId,
        actionId: request.intent.actionId,
        tenantId: 'tenant-redteam-edge',
        scope: 'device',
        targetId: `device-${gateId}`,
        commandType: 'reboot',
        payloadHash: hashPayload({}),
        policyDigest: 'edge-maxsafe',
        challenge: 'challenge-maxsafe',
        breakerTarget: 'mgmt-uplink',
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter: overflowCounter
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: request.session!.sessionId,
      confirmed: true,
      policyDigest: 'edge-maxsafe',
      challenge: 'challenge-maxsafe',
      breakerTarget: 'mgmt-uplink',
      interlockAction: 'interlock_release',
      issuedAt,
      expiresAt,
      monotonicCounter: overflowCounter,
      signature: sig
    });

    expect(ack.confirmed).toBe(false);
    expect(ack.reason).toBe('invalid_monotonic_counter');
  });
});
