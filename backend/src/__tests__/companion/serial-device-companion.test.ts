import { createSign, generateKeyPairSync } from 'crypto';
import { buildHardwareGrantMessage, hashPayload } from '../../security/hardware-grant';
import { computeFinalDefensePolicyDigest } from '../../security/final-defense-policy';
import { validateLocalPolicyGrant, type LocalPolicy } from '../../companion/serial-device-companion';

describe('serial-device-companion local policy enforcement', () => {
  function buildPolicy(): LocalPolicy {
    const policy = {
      policyId: 'policy-test',
      tenantId: 'tenant-test',
      companionId: 'companion-test',
      gateId: 'gate-test',
      allowedActions: [
        { commandType: 'host_remove', scriptPath: '/opt/aetherguard/final-defense/remove.sh', requiresInterlockRelease: true },
        { commandType: 'interlock_release', requiresInterlockRelease: true }
      ],
      breakerTarget: 'mgmt-uplink',
      releaseTtlMs: 30_000,
      createdAt: '2026-05-13T00:00:00.000Z',
      status: 'active' as const
    };
    return {
      ...policy,
      policyDigest: computeFinalDefensePolicyDigest(policy)
    };
  }

  it('rejects high-risk commands that are not in the local signed policy allow-list', () => {
    const policy = buildPolicy();
    const result = validateLocalPolicyGrant({
      policy,
      commandType: 'wipe_data',
      payload: {},
      lastCounter: 0
    });

    expect(result).toEqual({ ok: false, reason: 'policy_action_not_allowed' });
  });

  it('fails closed on policy digest mismatch and counter rollback', () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const policy = buildPolicy();
    const payload = { path: '/opt/aetherguard' };
    const issuedAt = '2026-05-13T00:00:00.000Z';
    const expiresAt = '2026-05-13T00:05:00.000Z';
    const signature = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId: policy.gateId,
        sessionId: 'session-test',
        actionId: 'action-test',
        tenantId: policy.tenantId,
        scope: 'device',
        targetId: policy.companionId,
        commandType: 'host_remove',
        payloadHash: hashPayload(payload),
        policyDigest: 'wrong-digest',
        challenge: 'challenge-test',
        breakerTarget: policy.breakerTarget,
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter: 5
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const result = validateLocalPolicyGrant({
      policy,
      commandType: 'host_remove',
      payload,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      lastCounter: 0,
      now: new Date(issuedAt).getTime(),
      grant: {
        gateId: policy.gateId,
        sessionId: 'session-test',
        actionId: 'action-test',
        tenantId: policy.tenantId,
        scope: 'device',
        targetId: policy.companionId,
        commandType: 'host_remove',
        payloadHash: hashPayload(payload),
        policyDigest: 'wrong-digest',
        challenge: 'challenge-test',
        breakerTarget: policy.breakerTarget,
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter: 5,
        signature
      }
    });

    expect(result).toEqual({ ok: false, reason: 'policy_digest_mismatch' });

    const rollback = validateLocalPolicyGrant({
      policy,
      commandType: 'host_remove',
      payload,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      lastCounter: 5,
      now: new Date(issuedAt).getTime(),
      grant: {
        gateId: policy.gateId,
        sessionId: 'session-test',
        actionId: 'action-test',
        tenantId: policy.tenantId,
        scope: 'device',
        targetId: policy.companionId,
        commandType: 'host_remove',
        payloadHash: hashPayload(payload),
        policyDigest: policy.policyDigest,
        challenge: 'challenge-test',
        breakerTarget: policy.breakerTarget,
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter: 5,
        signature
      }
    });

    expect(rollback).toEqual({ ok: false, reason: 'counter_replay_or_rollback' });
  });

  it('fails closed when the grant expiry is unparseable (now > NaN is false)', () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const policy = buildPolicy();
    const payload = { path: '/opt/aetherguard' };
    const issuedAt = '2026-05-13T00:00:00.000Z';
    const expiresAt = 'not-a-real-date'; // getTime() -> NaN
    const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const signature = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId: policy.gateId,
        sessionId: 'session-test',
        actionId: 'action-test',
        tenantId: policy.tenantId,
        scope: 'device',
        targetId: policy.companionId,
        commandType: 'host_remove',
        payloadHash: hashPayload(payload),
        policyDigest: policy.policyDigest,
        challenge: 'challenge-test',
        breakerTarget: policy.breakerTarget,
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter: 7
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    // Every other check passes; only the malformed expiry must reject.
    const result = validateLocalPolicyGrant({
      policy,
      commandType: 'host_remove',
      payload,
      publicKeyPem,
      lastCounter: 0,
      now: new Date(issuedAt).getTime(),
      grant: {
        gateId: policy.gateId,
        sessionId: 'session-test',
        actionId: 'action-test',
        tenantId: policy.tenantId,
        scope: 'device',
        targetId: policy.companionId,
        commandType: 'host_remove',
        payloadHash: hashPayload(payload),
        policyDigest: policy.policyDigest,
        challenge: 'challenge-test',
        breakerTarget: policy.breakerTarget,
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter: 7,
        signature
      }
    });

    expect(result).toEqual({ ok: false, reason: 'hardware_grant_expired' });
  });
});
