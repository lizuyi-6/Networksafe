/**
 * REDTEAM SECURITY TEST — Hardware Grant Forgery (V2.4/V2.5 fail-closed bypass)
 * ============================================================================
 *
 * Product claim (V2.4 "Final Defense Mode"): The control plane can REQUEST
 * dangerous actions and audit them, but the FINAL GRANT is enforced by hardware.
 * A valid signed hardware grant is required; a forged or mismatched grant must
 * NOT dispatch.
 *
 * Original exploit (V2.4 / V2.5 / V2.7 defects):
 * ──────────────────────────────────────────────────
 * 1. createPhysicalConfirmation() was called WITHOUT hardwareContext (or all
 *    fields were empty strings). The session's summary_json was persisted as:
 *    {"policyDigest":"","breakerTarget":"","interlockAction":"factory_reset","challenge":""}
 *
 * 2. At device-control.service.ts:522 the policy-digest check was:
 *      if (summary.policyDigest && reportedPolicyDigest !== summary.policyDigest)
 *    Since summary.policyDigest === '' (falsy), the condition short-circuited
 *    to FALSE and the mismatch check was SILENTLY SKIPPED. The attacker could
 *    supply any policyDigest they wanted.
 *
 * 3. Same short-circuit at :526 for breakerTarget and :530 for
 *    interlockAction (when the stored value was '').
 *
 * 4. At :538 the expiry check was:
 *      if (sessionExpiresAt && Date.now() > new Date(sessionExpiresAt).getTime())
 *    A legacy / corrupted expires_at (e.g. '0000-00-00', 'null') yielded
 *    NaN from `new Date(...).getTime()` and `Date.now() > NaN === false` —
 *    the session_expired rejection was never reached.
 *
 * 5. At :568 the confirmed flag was coerced:
 *      const confirmed = Boolean(payload?.confirmed) && Boolean(payload.signature) && verified;
 *    payload.confirmed = "false" (string) was coerced to `true` by
 *    Boolean("false"). Any non-empty string passed the check.
 *
 * Patches applied (redteam R3):
 * ──────────────────────────────
 * 1. createPhysicalConfirmation now THROWS if policyDigest or breakerTarget
 *    is empty. There is no legitimate legacy path that should have empty
 *    context — refuse to create such a session.
 * 2. handlePhysicalConfirmationAck uses `Number.isFinite()` to guard
 *    against NaN poisoning of the expiresAt comparison. Corrupted /
 *    unparseable expires_at now hits `session_expires_at_unparseable`
 *    rejection rather than silently passing.
 * 3. The confirmed flag is now checked with strict equality:
 *      payload?.confirmed === true
 *    The literal JSON boolean true is required; strings / numbers are
 *    rejected.
 *
 * These tests assert the patched behavior: the original exploits are now
 * rejected at session creation or at the ack handler, and the legitimate
 * happy path (full hardwareContext + signed grant + expiresAt) still
 * dispatches.
 */

import { createSign, generateKeyPairSync } from 'crypto';
import { getDatabase, initDatabase } from '../../config/database';
import { registerDevice } from '../../services/device-registry.service';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { deviceControlService } from '../../services/device-control.service';
import { buildHardwareGrantMessage, hashPayload } from '../../security/hardware-grant';

describe('REDTEAM hardware-grant forgery — V2.4 fail-closed fix', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    deviceControlService.setGatewayEmitter(() => true);
    commandDispatcherService.setDeviceAdapter({
      getDevice: () => ({ isOnline: true }),
      executeCommand: async () => ({ success: true, record: {}, message: 'ok' })
    });
  });

  function freshDevice() {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const deviceId = `device-forgery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    return { keyPair, deviceId };
  }

  it('REFUSES to create a session when hardwareContext is omitted (R3 fix)', async () => {
    const { deviceId } = freshDevice();
    await expect(
      deviceControlService.createPhysicalConfirmation({
        tenantId: 'tenant-redteam',
        deviceId,
        commandType: 'factory_reset',
        payload: { target: '/opt/everything' },
        // hardwareContext omitted entirely
        releaseTtlMs: 120_000,
        actorId: 'redteam'
      })
    ).rejects.toThrow(/hardware_context_policy_digest_required/);
  });

  it('REFUSES to create a session when hardwareContext fields are empty strings (R3 fix)', async () => {
    const { deviceId } = freshDevice();
    await expect(
      deviceControlService.createPhysicalConfirmation({
        tenantId: 'tenant-redteam',
        deviceId,
        commandType: 'wipe_data',
        payload: { partition: 'data' },
        hardwareContext: {
          policyDigest: '',
          challenge: '',
          breakerTarget: '',
          interlockAction: ''
        },
        releaseTtlMs: 60_000,
        actorId: 'redteam'
      })
    ).rejects.toThrow(/hardware_context_(policy_digest|breaker_target)_required/);
  });

  it('REFUSES to accept a forged ack whose policyDigest does not match the session (regression)', async () => {
    const { keyPair, deviceId } = freshDevice();
    const session = await deviceControlService.createPhysicalConfirmation({
      tenantId: 'tenant-redteam',
      deviceId,
      commandType: 'factory_reset',
      payload: { target: '/opt/everything' },
      hardwareContext: {
        policyDigest: 'GENUINE-POLICY-DIGEST',
        breakerTarget: 'genuine-uplink',
        interlockAction: 'factory_reset',
        challenge: 'random-challenge'
      },
      releaseTtlMs: 120_000,
      actorId: 'redteam'
    });

    const forgedPolicyDigest = 'FORGED-POLICY-DIGEST-0123456789abcdef';
    const issuedAt = new Date().toISOString();
    const expiresAt = session.expiresAt as string;
    const monotonicCounter = 1;

    // Attacker forges policyDigest in the signed grant (signs with the real
    // private key — i.e. the attacker also has the device's hardware key
    // in this scenario, perhaps via a compromised ATECC608C).
    const message = buildHardwareGrantMessage({
      gateId: deviceId,
      sessionId: session.id,
      actionId: session.id,
      tenantId: 'tenant-redteam',
      scope: 'device',
      targetId: deviceId,
      commandType: 'factory_reset',
      payloadHash: hashPayload({ target: '/opt/everything' }),
      policyDigest: forgedPolicyDigest,
      challenge: 'random-challenge',
      breakerTarget: 'genuine-uplink',
      interlockAction: 'factory_reset',
      issuedAt,
      expiresAt,
      monotonicCounter
    });
    const signature = createSign('SHA256').update(message).end().sign(keyPair.privateKey, 'base64');

    await deviceControlService.handlePhysicalConfirmationAck(deviceId, {
      confirmationSessionId: session.id,
      confirmed: true,                       // strict boolean
      monotonicCounter,
      policyDigest: forgedPolicyDigest,
      breakerTarget: 'genuine-uplink',
      interlockAction: 'factory_reset',
      challenge: 'random-challenge',
      issuedAt,
      expiresAt,
      signature
    });

    const row = getDatabase().prepare(`
      SELECT status, result_json FROM device_confirmation_sessions WHERE id = ? LIMIT 1
    `).get(session.id) as any;
    expect(row.status).toBe('rejected');
    const result = JSON.parse(row.result_json);
    expect(result.reason).toBe('policy_digest_mismatch');
  });

  it('REFUSES a string "true" or "false" for the confirmed flag (R3 strict-equality fix)', async () => {
    const { keyPair, deviceId } = freshDevice();
    const session = await deviceControlService.createPhysicalConfirmation({
      tenantId: 'tenant-redteam',
      deviceId,
      commandType: 'factory_reset',
      payload: { target: '/opt/everything' },
      hardwareContext: {
        policyDigest: 'GENUINE-POLICY-DIGEST',
        breakerTarget: 'genuine-uplink',
        interlockAction: 'factory_reset',
        challenge: 'random-challenge'
      },
      releaseTtlMs: 120_000,
      actorId: 'redteam'
    });

    const issuedAt = new Date().toISOString();
    const expiresAt = session.expiresAt as string;
    const monotonicCounter = 1;

    const message = buildHardwareGrantMessage({
      gateId: deviceId,
      sessionId: session.id,
      actionId: session.id,
      tenantId: 'tenant-redteam',
      scope: 'device',
      targetId: deviceId,
      commandType: 'factory_reset',
      payloadHash: hashPayload({ target: '/opt/everything' }),
      policyDigest: 'GENUINE-POLICY-DIGEST',
      challenge: 'random-challenge',
      breakerTarget: 'genuine-uplink',
      interlockAction: 'factory_reset',
      issuedAt,
      expiresAt,
      monotonicCounter
    });
    const signature = createSign('SHA256').update(message).end().sign(keyPair.privateKey, 'base64');

    // Send `confirmed: "true"` (string) — should now be rejected because
    // the strict `=== true` check rejects the string. The signature is
    // valid; the only issue is the string confirmed.
    await deviceControlService.handlePhysicalConfirmationAck(deviceId, {
      confirmationSessionId: session.id,
      confirmed: 'true',                     // ← string, not boolean
      monotonicCounter,
      policyDigest: 'GENUINE-POLICY-DIGEST',
      breakerTarget: 'genuine-uplink',
      interlockAction: 'factory_reset',
      challenge: 'random-challenge',
      issuedAt,
      expiresAt,
      signature
    });

    const row = getDatabase().prepare(`
      SELECT status, result_json FROM device_confirmation_sessions WHERE id = ? LIMIT 1
    `).get(session.id) as any;
    expect(row.status).toBe('rejected');
    const result = JSON.parse(row.result_json);
    // The signature is valid, so the rejection reason is the
    // strict-equality confirmed check (recorded as 'missing_signature_or_confirm'
    // in the code path, since the strict check fails before signature matters).
    expect(['missing_signature_or_confirm', 'invalid_signature']).toContain(result.reason);
  });

  it('REFUSES an unparseable expires_at (R3 NaN-poisoning fix)', async () => {
    // Simulate a corrupted / legacy expires_at column by inserting a row
    // directly with a non-parseable string.
    const { keyPair, deviceId } = freshDevice();
    const id = require('crypto').randomUUID();
    const createdAt = new Date().toISOString();
    getDatabase().prepare(`
      INSERT INTO device_confirmation_sessions (
        id, tenant_id, device_id, command_type, payload_json, summary_json, expires_at,
        last_monotonic_counter, status, requested_by, result_json, created_at, updated_at, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      'tenant-redteam',
      deviceId,
      'factory_reset',
      JSON.stringify({ target: '/opt/everything' }),
      JSON.stringify({
        policyDigest: 'GENUINE-POLICY-DIGEST',
        breakerTarget: 'genuine-uplink',
        interlockAction: 'factory_reset',
        challenge: 'random-challenge'
      }),
      '0000-00-00',                          // ← unparseable
      0,
      'pending_physical_confirmation',
      'redteam',
      JSON.stringify({ accepted: true }),
      createdAt,
      createdAt,
      null
    );

    const issuedAt = new Date().toISOString();
    const monotonicCounter = 1;
    const message = buildHardwareGrantMessage({
      gateId: deviceId,
      sessionId: id,
      actionId: id,
      tenantId: 'tenant-redteam',
      scope: 'device',
      targetId: deviceId,
      commandType: 'factory_reset',
      payloadHash: hashPayload({ target: '/opt/everything' }),
      policyDigest: 'GENUINE-POLICY-DIGEST',
      challenge: 'random-challenge',
      breakerTarget: 'genuine-uplink',
      interlockAction: 'factory_reset',
      issuedAt,
      expiresAt: '0000-00-00',
      monotonicCounter
    });
    const signature = createSign('SHA256').update(message).end().sign(keyPair.privateKey, 'base64');

    await deviceControlService.handlePhysicalConfirmationAck(deviceId, {
      confirmationSessionId: id,
      confirmed: true,
      monotonicCounter,
      policyDigest: 'GENUINE-POLICY-DIGEST',
      breakerTarget: 'genuine-uplink',
      interlockAction: 'factory_reset',
      challenge: 'random-challenge',
      issuedAt,
      expiresAt: '0000-00-00',
      signature
    });

    const row = getDatabase().prepare(`
      SELECT status, result_json FROM device_confirmation_sessions WHERE id = ? LIMIT 1
    `).get(id) as any;
    expect(row.status).toBe('rejected');
    const result = JSON.parse(row.result_json);
    expect(result.reason).toBe('session_expires_at_unparseable');
  });

  it('still allows the legitimate happy path (regression check)', async () => {
    const { keyPair, deviceId } = freshDevice();
    const session = await deviceControlService.createPhysicalConfirmation({
      tenantId: 'tenant-redteam',
      deviceId,
      commandType: 'factory_reset',
      payload: { target: '/opt/everything' },
      hardwareContext: {
        policyDigest: 'GENUINE-POLICY-DIGEST',
        breakerTarget: 'genuine-uplink',
        interlockAction: 'factory_reset',
        challenge: 'random-challenge'
      },
      releaseTtlMs: 120_000,
      actorId: 'redteam'
    });

    const issuedAt = new Date().toISOString();
    const expiresAt = session.expiresAt as string;
    const monotonicCounter = 1;
    const message = buildHardwareGrantMessage({
      gateId: deviceId,
      sessionId: session.id,
      actionId: session.id,
      tenantId: 'tenant-redteam',
      scope: 'device',
      targetId: deviceId,
      commandType: 'factory_reset',
      payloadHash: hashPayload({ target: '/opt/everything' }),
      policyDigest: 'GENUINE-POLICY-DIGEST',
      challenge: 'random-challenge',
      breakerTarget: 'genuine-uplink',
      interlockAction: 'factory_reset',
      issuedAt,
      expiresAt,
      monotonicCounter
    });
    const signature = createSign('SHA256').update(message).end().sign(keyPair.privateKey, 'base64');

    await deviceControlService.handlePhysicalConfirmationAck(deviceId, {
      confirmationSessionId: session.id,
      confirmed: true,
      monotonicCounter,
      policyDigest: 'GENUINE-POLICY-DIGEST',
      breakerTarget: 'genuine-uplink',
      interlockAction: 'factory_reset',
      challenge: 'random-challenge',
      issuedAt,
      expiresAt,
      signature
    });

    const row = getDatabase().prepare(`
      SELECT status FROM device_confirmation_sessions WHERE id = ? LIMIT 1
    `).get(session.id) as any;
    expect(row.status).toBe('confirmed');
  });
});
