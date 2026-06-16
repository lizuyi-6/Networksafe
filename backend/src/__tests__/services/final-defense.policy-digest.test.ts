/**
 * SECURITY tests for the FinalDefenseService policy_digest update.
 *
 * Sprint 5 Wave 9 · R14 · V12.26
 * `upsertPolicy` used to recompute the digest and overwrite the
 * stored value unconditionally. We now require the caller to
 * supply `expectedPolicyDigest`; if the stored digest no longer
 * matches, the upsert is refused with `policy_digest_conflict`.
 */

import { initDatabase } from '../../config/database';
import { finalDefenseService } from '../../services/final-defense.service';
import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';

describe('finalDefenseService / V12.26 policy_digest optimistic concurrency', () => {
  beforeAll(async () => {
    await initDatabase();
    hardwareAuthorizationService.prepare();
    finalDefenseService.prepare();
  });

  beforeEach(() => {
    hardwareAuthorizationService.setGatewayEmitter(() => true);
  });

  it('refuses to overwrite a policy when the expected digest does not match', () => {
    const tenantId = `tenant-fd-v1226-${Date.now()}`;
    const companionId = `companion-fd-v1226-${Date.now()}`;
    const gateId = `gate-fd-v1226-${Date.now()}`;

    const first = finalDefenseService.upsertPolicy({
      tenantId,
      companionId,
      gateId,
      breakerTarget: 'mgmt-uplink',
      releaseTtlMs: 30_000,
      allowedActions: [
        { commandType: 'interlock_release', requiresInterlockRelease: true }
      ]
    });

    // A second caller submits an update claiming the *old* digest
    // matches. We changed the allowed actions in transit, so the
    // current digest is different. The expected-digest mismatch must
    // surface as a thrown error.
    expect(() => finalDefenseService.upsertPolicy({
      tenantId,
      companionId,
      gateId,
      policyId: first.policyId,
      expectedPolicyDigest: 'stale-digest-12345',
      breakerTarget: 'mgmt-uplink',
      releaseTtlMs: 30_000,
      allowedActions: [
        { commandType: 'host_remove', requiresInterlockRelease: true }
      ]
    })).toThrow(/policy_digest_conflict|digest/i);

    // The stored record must still be the original one (digest
    // unchanged).
    const current = finalDefenseService.getPolicy(first.policyId);
    expect(current?.policyDigest).toBe(first.policyDigest);
  });

  it('allows a same-digest overwrite (caller has the current value)', () => {
    const tenantId = `tenant-fd-same-${Date.now()}`;
    const companionId = `companion-fd-same-${Date.now()}`;
    const gateId = `gate-fd-same-${Date.now()}`;

    const first = finalDefenseService.upsertPolicy({
      tenantId,
      companionId,
      gateId,
      breakerTarget: 'mgmt-uplink',
      releaseTtlMs: 30_000,
      allowedActions: [
        { commandType: 'interlock_release', requiresInterlockRelease: true }
      ]
    });

    // Re-issue with the correct expectedPolicyDigest — must succeed
    // and the stored digest will change because the allowedActions
    // list changed.
    const updated = finalDefenseService.upsertPolicy({
      tenantId,
      companionId,
      gateId,
      policyId: first.policyId,
      expectedPolicyDigest: first.policyDigest,
      breakerTarget: 'mgmt-uplink',
      releaseTtlMs: 60_000,
      allowedActions: [
        { commandType: 'host_remove', requiresInterlockRelease: true }
      ]
    });

    expect(updated.policyId).toBe(first.policyId);
    expect(updated.policyDigest).not.toBe(first.policyDigest);
  });
});
