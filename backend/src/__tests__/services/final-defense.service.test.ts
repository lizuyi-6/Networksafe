import { createSign, generateKeyPairSync } from 'crypto';
import { initDatabase } from '../../config/database';
import { buildHardwareGrantMessage, hashPayload } from '../../security/hardware-grant';
import { normalizeInterlockState } from '../../security/final-defense-policy';
import { finalDefenseService } from '../../services/final-defense.service';
import {
  hardwareAuthorizationService,
  type HardwareConfirmationSessionRecord,
  type CommandIntentRecord
} from '../../services/hardware-authorization.service';

// requestAction()/requestGatewayAction() return a success | failure union.
// In success-path tests we already assert success === true; this helper narrows
// the union to the success member so .session / .intent are accessible without
// weakening assertions.
interface RequestSuccess {
  success: true;
  intent: CommandIntentRecord;
  session?: HardwareConfirmationSessionRecord;
}
function asSuccess(result: unknown): RequestSuccess {
  return result as unknown as RequestSuccess;
}

describe('finalDefenseService', () => {
  beforeAll(async () => {
    await initDatabase();
    hardwareAuthorizationService.prepare();
    finalDefenseService.prepare();
  });

  beforeEach(() => {
    hardwareAuthorizationService.setGatewayEmitter(() => true);
  });

  it('maps legacy asserted interlock state to isolated', () => {
    expect(normalizeInterlockState('asserted')).toBe('isolated');
  });

  it('defaults non-finite release TTL before applying the safety clamp', () => {
    const policy = finalDefenseService.upsertPolicy({
      tenantId: 'tenant-release-ttl-nan',
      companionId: 'companion-release-ttl-nan',
      gateId: 'gate-release-ttl-nan',
      breakerTarget: 'mgmt-uplink',
      releaseTtlMs: 'abc' as any,
      allowedActions: [{ commandType: 'interlock_release', requiresInterlockRelease: true }]
    });

    expect(Number.isFinite(policy.releaseTtlMs)).toBe(true);
    expect(policy.releaseTtlMs).toBe(120_000);
  });

  it('reports active only when the companion and hardware conditions match', () => {
    const policy = finalDefenseService.upsertPolicy({
      tenantId: 'tenant-final-defense',
      companionId: 'companion-active',
      gateId: 'gate-active',
      breakerTarget: 'mgmt-uplink',
      releaseTtlMs: 30_000,
      allowedActions: [
        { commandType: 'interlock_release', requiresInterlockRelease: true },
        { commandType: 'host_remove', scriptPath: '/opt/aetherguard/final-defense/remove.sh', requiresInterlockRelease: true }
      ]
    });

    const status = finalDefenseService.reportStatus({
      tenantId: 'tenant-final-defense',
      companionId: 'companion-active',
      gateId: 'gate-active',
      policyId: policy.policyId,
      policyDigest: policy.policyDigest,
      breakerTarget: 'mgmt-uplink',
      interlockState: 'asserted',
      externalPowerPresent: true,
      secureElementPresent: true,
      feedbackOk: true
    });

    expect(status.active).toBe(true);
    expect(status.interlockState).toBe('isolated');
    expect(status.degradedReasons).toEqual([]);

    const degraded = finalDefenseService.reportStatus({
      tenantId: 'tenant-final-defense',
      companionId: 'companion-active',
      gateId: 'gate-active',
      policyId: policy.policyId,
      policyDigest: 'wrong-digest',
      breakerTarget: 'mgmt-uplink',
      interlockState: 'released',
      externalPowerPresent: true,
      secureElementPresent: true,
      feedbackOk: false
    });

    expect(degraded.active).toBe(false);
    expect(degraded.degradedReasons).toEqual(expect.arrayContaining([
      'feedback_not_verified',
      'interlock_released',
      'policy_digest_mismatch'
    ]));
  });

  it('requires an external network gateway for root-resistant active status', () => {
    const tenantId = `tenant-root-gateway-${Date.now()}`;
    // sql.js persists rows across runs; these IDs anchor the new
    // tenant/binding ownership checks in upsertPolicy, so they must be
    // unique per run to avoid colliding with rows from a previous run's
    // different tenant.
    const companionId = `root-companion-only-${Date.now()}`;
    const gateId = `root-companion-gate-${Date.now()}`;

    const policy = finalDefenseService.upsertPolicy({
      tenantId,
      companionId,
      gateId,
      breakerTarget: 'mgmt-uplink',
      releaseTtlMs: 30_000,
      allowedActions: [{ commandType: 'host_remove', requiresInterlockRelease: true }]
    });
    const companionStatus = finalDefenseService.reportStatus({
      tenantId,
      companionId,
      gateId,
      policyId: policy.policyId,
      policyDigest: policy.policyDigest,
      breakerTarget: 'mgmt-uplink',
      interlockState: 'isolated',
      externalPowerPresent: true,
      secureElementPresent: true,
      feedbackOk: true
    });

    expect(companionStatus.active).toBe(true);
    expect(finalDefenseService.listRootResistantGateways(tenantId)).toHaveLength(0);

    const degradedGateway = finalDefenseService.reportRootResistantGatewayStatus({
      tenantId,
      gatewayId: `external-gateway-degraded-${Date.now()}`,
      policyDigest: 'digest-a',
      reportedPolicyDigest: 'digest-b',
      bridgeState: 'fault',
      serverPortLink: true,
      lanPortLink: false,
      mgmtPath: 'shared',
      secureElementPresent: true
    });

    expect(degradedGateway.active).toBe(false);
    expect(degradedGateway.degradedReasons).toEqual(expect.arrayContaining([
      'policy_digest_mismatch',
      'firmware_digest_missing',
      'attestation_missing',
      'lan_port_link_down',
      'mgmt_path_not_independent',
      'bridge_fault'
    ]));

    const activeGateway = finalDefenseService.reportRootResistantGatewayStatus({
      tenantId,
      gatewayId: `external-gateway-active-${Date.now()}`,
      policyDigest: 'digest-root-active',
      reportedPolicyDigest: 'digest-root-active',
      firmwareDigest: 'firmware-root-active',
      bridgeState: 'isolated',
      serverPortLink: true,
      lanPortLink: true,
      mgmtPath: 'dedicated_mgmt',
      secureElementPresent: true
    });

    // SECURITY (audit 2026-08, batch 0): every field above is SELF-REPORTED.
    // Attestation is server-owned and batch 6 (quote verification) has not
    // landed, so a fully green self-report must stay DEGRADED, never active.
    expect(activeGateway.active).toBe(false);
    expect(activeGateway.verificationLevel).toBe('reported');
    expect(activeGateway.degradedReasons).toEqual(expect.arrayContaining([
      'attestation_missing'
    ]));
  });

  it('creates an appliance GatewayDaemon bound to a registered gateway\'s SE key', () => {
    const tenantId = `tenant-daemon-seam-${Date.now()}`;
    const { generateKeyPairSync } = require('crypto');
    const kp = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKeyPem = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const gatewayId = `gateway-daemon-${Date.now()}`;

    // Register the root-resistant gateway and enroll its gate (SE public key).
    finalDefenseService.reportRootResistantGatewayStatus({
      tenantId,
      gatewayId,
      policyDigest: 'digest-daemon',
      reportedPolicyDigest: 'digest-daemon',
      firmwareDigest: 'firmware-daemon',
      bridgeState: 'isolated',
      serverPortLink: true,
      lanPortLink: true,
      mgmtPath: 'dedicated_mgmt',
      secureElementPresent: true
    });
    hardwareAuthorizationService.enrollGate({
      tenantId,
      gateId: gatewayId,
      publicKeyPem,
      status: 'online'
    });

    // FW-001: the daemon requires the M1<->M2 serial channel key to arm.
    const daemon = finalDefenseService.createGatewayDaemon(gatewayId, {
      serialChannelKey: 'd4'.repeat(32)
    });
    expect(daemon).not.toBeNull();
    try {
      // Daemon boots fail-closed (isolated / deny-forward ruleset).
      expect(daemon!.getBridgeState()).toBe('isolated');
      expect(daemon!.isReleased()).toBe(false);

      // A grant signed by the gateway's own SE key releases the bridge.
      const { buildHardwareGrantMessage } = require('../../security/hardware-grant');
      const grant = {
        gateId: gatewayId, sessionId: 's', actionId: 'a', tenantId,
        scope: 'device', targetId: gatewayId, commandType: 'interlock_release',
        payloadHash: '0'.repeat(64), policyDigest: 'digest-daemon',
        challenge: 'c', breakerTarget: 'server-lan-transparent-bridge',
        interlockAction: 'release', issuedAt: '1700000000',
        expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
        monotonicCounter: 1,
        signature: require('crypto').createSign('SHA256')
          .update(buildHardwareGrantMessage({
            gateId: gatewayId, sessionId: 's', actionId: 'a', tenantId,
            scope: 'device', targetId: gatewayId, commandType: 'interlock_release',
            payloadHash: '0'.repeat(64), policyDigest: 'digest-daemon',
            challenge: 'c', breakerTarget: 'server-lan-transparent-bridge',
            interlockAction: 'release', issuedAt: '1700000000',
            expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
            monotonicCounter: 1
          })).end().sign(kp.privateKey, 'base64')
      };
      expect(daemon!.requestRelease(grant)).toBe(true);
      daemon!.handleControllerFrame({ type: 'interlock_result', interlockState: 'released', feedbackOk: true });
      expect(daemon!.isReleased()).toBe(true);
    } finally {
      daemon!.shutdown();
    }

    // Unknown gateway -> null (graceful degrade).
    expect(finalDefenseService.createGatewayDaemon('does-not-exist')).toBeNull();
  });

  it('marks a gateway stale at the PRD-mandated 45s controller-heartbeat threshold (not 90s)', () => {
    const tenantId = `tenant-root-stale-${Date.now()}`;
    const gatewayId = `gateway-heartbeat-stale-${Date.now()}`;
    // Register an otherwise-healthy gateway so the only variable is heartbeat age.
    finalDefenseService.reportRootResistantGatewayStatus({
      tenantId,
      gatewayId,
      policyDigest: 'digest-stale',
      reportedPolicyDigest: 'digest-stale',
      firmwareDigest: 'firmware-stale',
      bridgeState: 'isolated',
      serverPortLink: true,
      lanPortLink: true,
      mgmtPath: 'dedicated_mgmt',
      secureElementPresent: true
    });

    const findGateway = () => finalDefenseService
      .listRootResistantGateways(tenantId)
      .find((g) => g.gatewayId === gatewayId);

    // Fresh heartbeat, fully green self-report: still NOT active, because
    // attestation is server-owned and 'reported' can never drive active
    // (batch 0). The gateway_stale reason, however, must be absent.
    const fresh = findGateway();
    expect(fresh?.gatewayOnline).toBe(true);
    expect(fresh?.active).toBe(false);
    expect(fresh?.degradedReasons).not.toContain('gateway_stale');

    // Backdate the heartbeat to 50s ago — beyond the PRD §4.4 trigger-#7 45s
    // threshold but well inside the old (incorrect) 90s window. A compliant
    // implementation must treat this gateway as stale.
    const { getDatabase } = require('../../config/database');
    const staleHeartbeat = new Date(Date.now() - 50_000).toISOString();
    getDatabase().prepare(`UPDATE root_resistant_gateways SET last_heartbeat_at = ? WHERE gateway_id = ?`)
      .run(staleHeartbeat, gatewayId);

    const staleStatus = findGateway();
    expect(staleStatus?.gatewayOnline).toBe(false);
    expect(staleStatus?.degradedReasons).toEqual(expect.arrayContaining(['gateway_stale']));
    expect(staleStatus?.active).toBe(false);
  });

  it('treats an unparseable heartbeat timestamp as stale, not fresh (fail-closed)', () => {
    const tenantId = `tenant-root-badhb-${Date.now()}`;
    const gatewayId = `gateway-badhb-${Date.now()}`;
    finalDefenseService.reportRootResistantGatewayStatus({
      tenantId,
      gatewayId,
      policyDigest: 'digest-badhb',
      reportedPolicyDigest: 'digest-badhb',
      firmwareDigest: 'firmware-badhb',
      bridgeState: 'isolated',
      serverPortLink: true,
      lanPortLink: true,
      mgmtPath: 'dedicated_mgmt',
      secureElementPresent: true
    });

    // Corrupt the stored heartbeat to a non-parseable value. new Date(x).getTime()
    // is NaN and Date.now() > NaN is false, so an un-guarded check would report
    // this gateway as fresh/online.
    const { getDatabase } = require('../../config/database');
    getDatabase().prepare(`UPDATE root_resistant_gateways SET last_heartbeat_at = ? WHERE gateway_id = ?`)
      .run('not-a-timestamp', gatewayId);

    const status = finalDefenseService.listRootResistantGateways(tenantId).find(g => g.gatewayId === gatewayId);
    expect(status?.gatewayOnline).toBe(false);
    expect(status?.degradedReasons).toEqual(expect.arrayContaining(['gateway_stale']));
    expect(status?.active).toBe(false);
  });

  it('blocks root-resistant high-risk actions until an external gateway is active', async () => {
    const tenantId = `tenant-root-action-${Date.now()}`;
    const companionId = `companion-root-action-${Date.now()}`;
    const gateId = `gate-root-action-${Date.now()}`;
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

    finalDefenseService.upsertPolicy({
      tenantId,
      companionId,
      gateId,
      breakerTarget: 'server-lan-transparent-bridge',
      releaseTtlMs: 30_000,
      allowedActions: [{ commandType: 'host_remove', requiresInterlockRelease: true }]
    });
    hardwareAuthorizationService.enrollGate({
      tenantId,
      gateId,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      algorithm: 'ECDSA_P256_SHA256',
      status: 'online'
    });

    const blocked = await finalDefenseService.requestAction({
      tenantId,
      companionId,
      commandType: 'host_remove',
      actorId: 'tester'
    });

    expect(blocked.success).toBe(false);
    expect(blocked.reason).toBe('root_resistant_gateway_unavailable');

    // SECURITY (audit 2026-08, batch 0): a fully green SELF-REPORTED gateway
    // status must not unblock high-risk actions. Attestation is server-owned
    // (batch 6 quote verification); until then root-resistant actions stay
    // fail-closed regardless of what the gateway reports about itself.
    const reported = finalDefenseService.reportRootResistantGatewayStatus({
      tenantId,
      gatewayId: gateId,
      policyDigest: 'digest-root-action',
      reportedPolicyDigest: 'digest-root-action',
      firmwareDigest: 'firmware-root-action',
      bridgeState: 'armed',
      serverPortLink: true,
      lanPortLink: true,
      mgmtPath: 'cellular',
      secureElementPresent: true
    });
    expect(reported.active).toBe(false);
    expect(reported.verificationLevel).toBe('reported');
    expect(reported.degradedReasons).toContain('attestation_missing');

    const stillBlocked = await finalDefenseService.requestAction({
      tenantId,
      companionId,
      commandType: 'host_remove',
      actorId: 'tester'
    });

    expect(stillBlocked.success).toBe(false);
    expect(stillBlocked.reason).toBe('root_resistant_gateway_unavailable');
  });

  it('unblocks root-resistant actions only from a server-owned attested record', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const tenantId = `tenant-root-action-attested-${Date.now()}`;
    const companionId = `companion-root-attested-${Date.now()}`;
    const gateId = `gate-root-attested-${Date.now()}`;

    finalDefenseService.upsertPolicy({
      tenantId,
      companionId,
      gateId,
      breakerTarget: 'server-lan-transparent-bridge',
      releaseTtlMs: 30_000,
      allowedActions: [{ commandType: 'host_remove', requiresInterlockRelease: true }]
    });
    hardwareAuthorizationService.enrollGate({
      tenantId,
      gateId,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      algorithm: 'ECDSA_P256_SHA256',
      status: 'online'
    });

    finalDefenseService.reportRootResistantGatewayStatus({
      tenantId,
      gatewayId: gateId,
      policyDigest: 'digest-root-attested',
      reportedPolicyDigest: 'digest-root-attested',
      firmwareDigest: 'firmware-root-attested',
      bridgeState: 'armed',
      serverPortLink: true,
      lanPortLink: true,
      mgmtPath: 'cellular',
      secureElementPresent: true
    });

    // Simulate the batch-6 attestation verifier by writing the server-owned
    // attestation record directly (the only writer allowed to do this).
    const { getDatabase } = require('../../config/database');
    getDatabase().prepare(`
      UPDATE root_resistant_gateways
      SET attestation_level = 'attested', last_attestation_at = ?
      WHERE gateway_id = ?
    `).run(new Date().toISOString(), gateId);

    // A subsequent self-report must PRESERVE the attested level (reports
    // cannot overwrite server-owned attestation state).
    const preserved = finalDefenseService.reportRootResistantGatewayStatus({
      tenantId,
      gatewayId: gateId,
      policyDigest: 'digest-root-attested',
      reportedPolicyDigest: 'digest-root-attested',
      firmwareDigest: 'firmware-root-attested',
      bridgeState: 'armed',
      serverPortLink: true,
      lanPortLink: true,
      mgmtPath: 'cellular',
      secureElementPresent: true
    });
    expect(preserved.verificationLevel).toBe('attested');
    expect(preserved.active).toBe(true);

    const allowedRaw = await finalDefenseService.requestAction({
      tenantId,
      companionId,
      commandType: 'host_remove',
      actorId: 'tester'
    });
    const allowed = asSuccess(allowedRaw);

    expect(allowed.success).toBe(true);
    expect(allowed.session?.summary.policyDigest).toBeDefined();
  });

  it('requests root gateway temporary release through hardware confirmation', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const tenantId = `tenant-root-release-${Date.now()}`;
    const gatewayId = `external-root-gateway-${Date.now()}`;

    hardwareAuthorizationService.enrollGate({
      tenantId,
      gateId: gatewayId,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });
    finalDefenseService.reportRootResistantGatewayStatus({
      tenantId,
      gatewayId,
      policyDigest: 'digest-root-release',
      reportedPolicyDigest: 'digest-root-release',
      firmwareDigest: 'firmware-root-release',
      bridgeState: 'isolated',
      serverPortLink: true,
      lanPortLink: true,
      mgmtPath: 'dedicated_mgmt',
      secureElementPresent: true
    });

    // Server-owned attestation record (batch-6 verifier seam).
    const { getDatabase } = require('../../config/database');
    getDatabase().prepare(`
      UPDATE root_resistant_gateways
      SET attestation_level = 'attested', last_attestation_at = ?
      WHERE gateway_id = ?
    `).run(new Date().toISOString(), gatewayId);

    const requestRaw = await finalDefenseService.requestGatewayAction({
      tenantId,
      gatewayId,
      action: 'release_temporary',
      actorId: 'tester',
      challenge: 'root-release-challenge'
    });
    const request = asSuccess(requestRaw);

    expect(request.success).toBe(true);
    expect(request.session?.summary.policyDigest).toBe('digest-root-release');
    expect(request.session?.summary.challenge).toBe('root-release-challenge');
    expect(request.session?.summary.interlockAction).toBe('bridge_release_temporary');
  });

  it('includes policy digest, challenge, breaker target, and interlock action in grants', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const tenantId = `tenant-fd-${Date.now()}`;
    const companionId = `companion-fd-${Date.now()}`;
    const gateId = `gate-fd-${Date.now()}`;

    hardwareAuthorizationService.enrollGate({
      tenantId,
      gateId,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    const policy = finalDefenseService.upsertPolicy({
      tenantId,
      companionId,
      gateId,
      breakerTarget: 'mgmt-uplink',
      releaseTtlMs: 30_000,
      allowedActions: [{ commandType: 'interlock_release', requiresInterlockRelease: true }]
    });

    const requestRaw = await finalDefenseService.requestAction({
      tenantId,
      companionId,
      commandType: 'interlock_release',
      actorId: 'tester',
      challenge: 'challenge-final-defense'
    });
    const request = asSuccess(requestRaw);

    expect(request.success).toBe(true);
    expect(request.session?.summary.policyDigest).toBe(policy.policyDigest);
    expect(request.session?.summary.challenge).toBe('challenge-final-defense');

    const issuedAt = new Date().toISOString();
    const expiresAt = request.session!.expiresAt;
    const monotonicCounter = 1;
    const grantPayload = {
      companionId,
      policyDigest: policy.policyDigest,
      challenge: 'challenge-final-defense',
      breakerTarget: 'mgmt-uplink',
      interlockAction: 'interlock_release'
    };
    const signature = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: request.session!.sessionId,
        actionId: request.intent.actionId,
        tenantId,
        scope: 'device',
        targetId: companionId,
        commandType: 'interlock_release',
        payloadHash: hashPayload(grantPayload),
        policyDigest: policy.policyDigest,
        challenge: 'challenge-final-defense',
        breakerTarget: 'mgmt-uplink',
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
      policyDigest: policy.policyDigest,
      challenge: 'challenge-final-defense',
      breakerTarget: 'mgmt-uplink',
      interlockAction: 'interlock_release',
      issuedAt,
      expiresAt,
      monotonicCounter,
      signature
    });

    expect(ack.confirmed).toBe(true);
    expect(ack.grant?.grant.policyDigest).toBe(policy.policyDigest);
  });

  // SECURITY (audit 2026-08, P0): policies/companions/gates are tenant-owned.
  // Self-declared IDs must never let one tenant touch another tenant's
  // Final Defense objects.
  describe('tenant ownership guards', () => {
    it('refuses a cross-tenant policy update even with the current digest', () => {
      const runTag = Date.now();
      const tenantA = `tenant-fd-owner-${runTag}`;
      const companionId = `companion-fd-owner-${runTag}`;
      const gateId = `gate-fd-owner-${runTag}`;

      const policy = finalDefenseService.upsertPolicy({
        tenantId: tenantA,
        companionId,
        gateId,
        breakerTarget: 'mgmt-uplink',
        releaseTtlMs: 30_000,
        allowedActions: [{ commandType: 'interlock_release', requiresInterlockRelease: true }]
      });

      expect(() => finalDefenseService.upsertPolicy({
        tenantId: `tenant-fd-intruder-${runTag}`,
        companionId,
        gateId,
        policyId: policy.policyId,
        expectedPolicyDigest: policy.policyDigest,
        breakerTarget: 'mgmt-uplink',
        releaseTtlMs: 30_000,
        allowedActions: [{ commandType: 'interlock_release', requiresInterlockRelease: true }]
      })).toThrow(/tenant_mismatch/);
    });

    it('refuses re-provisioning a companion reported by another tenant', () => {
      const runTag = Date.now();
      const tenantA = `tenant-fd-squat-a-${runTag}`;
      const companionId = `companion-fd-squat-${runTag}`;
      const gateId = `gate-fd-squat-${runTag}`;

      const policy = finalDefenseService.upsertPolicy({
        tenantId: tenantA,
        companionId,
        gateId,
        breakerTarget: 'mgmt-uplink',
        releaseTtlMs: 30_000,
        allowedActions: [{ commandType: 'interlock_release', requiresInterlockRelease: true }]
      });
      // reportStatus is the server-side ownership anchor for the companion.
      finalDefenseService.reportStatus({
        tenantId: tenantA,
        companionId,
        gateId,
        policyId: policy.policyId,
        policyDigest: policy.policyDigest,
        breakerTarget: 'mgmt-uplink',
        interlockState: 'isolated',
        externalPowerPresent: true,
        secureElementPresent: true,
        feedbackOk: true
      });

      expect(() => finalDefenseService.upsertPolicy({
        tenantId: `tenant-fd-squat-b-${runTag}`,
        companionId,
        gateId,
        breakerTarget: 'mgmt-uplink',
        releaseTtlMs: 30_000,
        allowedActions: [{ commandType: 'interlock_release', requiresInterlockRelease: true }]
      })).toThrow(/companion_tenant_mismatch/);
    });

    it('refuses a status report that would rebind a gateway to another tenant', () => {
      const runTag = Date.now();
      const tenantA = `tenant-fd-gw-a-${runTag}`;
      const gatewayId = `gateway-fd-gw-${runTag}`;

      finalDefenseService.reportRootResistantGatewayStatus({
        tenantId: tenantA,
        gatewayId,
        policyDigest: 'digest-gw',
        reportedPolicyDigest: 'digest-gw',
        bridgeState: 'isolated',
        serverPortLink: true,
        lanPortLink: true,
        mgmtPath: 'dedicated_mgmt',
        secureElementPresent: true
      });

      expect(() => finalDefenseService.reportRootResistantGatewayStatus({
        tenantId: `tenant-fd-gw-b-${runTag}`,
        gatewayId,
        bridgeState: 'isolated',
        serverPortLink: true,
        lanPortLink: true,
        mgmtPath: 'dedicated_mgmt',
        secureElementPresent: true
      })).toThrow(/root_gateway_tenant_mismatch/);

      // The original ownership is untouched.
      const gateway = finalDefenseService.getRootResistantGatewayStatus(gatewayId);
      expect(gateway?.tenantId).toBe(tenantA);
    });

    it('returns a tenant-scoped failure when another tenant requests an action', async () => {
      const runTag = Date.now();
      const tenantA = `tenant-fd-action-${runTag}`;
      const companionId = `companion-fd-action-${runTag}`;
      const gateId = `gate-fd-action-${runTag}`;

      finalDefenseService.upsertPolicy({
        tenantId: tenantA,
        companionId,
        gateId,
        breakerTarget: 'mgmt-uplink',
        releaseTtlMs: 30_000,
        allowedActions: [{ commandType: 'interlock_release', requiresInterlockRelease: true }]
      });

      const result = await finalDefenseService.requestAction({
        tenantId: `tenant-fd-action-other-${runTag}`,
        companionId,
        commandType: 'interlock_release',
        actorId: 'tester'
      });

      expect(result.success).toBe(false);
      expect((result as { reason?: string }).reason).toBe('final_defense_policy_tenant_mismatch');
    });
  });

  describe('N2-4 gateway status report replay guard', () => {
    it('rejects sequence regression within one boot and accepts a new boot', () => {
      const runTag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const tenantId = `tenant-fd-replay-${runTag}`;
      const gatewayId = `gw-replay-${runTag}`;
      const bootA = 'a'.repeat(16);
      const bootB = 'b'.repeat(16);
      const base = {
        tenantId,
        gatewayId,
        bridgeState: 'isolated',
        serverPortLink: true,
        lanPortLink: true,
        mgmtPath: 'dedicated_mgmt',
        secureElementPresent: true
      } as const;

      // Boot A: strictly advancing sequences accepted.
      expect(() => finalDefenseService.reportRootResistantGatewayStatus({ ...base, bootId: bootA, sequence: 1 })).not.toThrow();
      expect(() => finalDefenseService.reportRootResistantGatewayStatus({ ...base, bootId: bootA, sequence: 2 })).not.toThrow();

      // Replay of an already-seen (or older) report within the same boot is rejected.
      expect(() => finalDefenseService.reportRootResistantGatewayStatus({ ...base, bootId: bootA, sequence: 2 }))
        .toThrow('backend.root_gateway_status_replay');
      expect(() => finalDefenseService.reportRootResistantGatewayStatus({ ...base, bootId: bootA, sequence: 1 }))
        .toThrow('backend.root_gateway_status_replay');

      // A captured "isolated" report cannot mask a later "released" state.
      expect(() => finalDefenseService.reportRootResistantGatewayStatus({ ...base, bootId: bootA, sequence: 3, bridgeState: 'released' }))
        .not.toThrow();
      expect(() => finalDefenseService.reportRootResistantGatewayStatus({ ...base, bootId: bootA, sequence: 3, bridgeState: 'isolated' }))
        .toThrow('backend.root_gateway_status_replay');

      // New boot restarts the sequence space (appliance reboot).
      expect(() => finalDefenseService.reportRootResistantGatewayStatus({ ...base, bootId: bootB, sequence: 1 })).not.toThrow();
      expect(finalDefenseService.getRootResistantGatewayStatus(gatewayId)?.reportBootId).toBe(bootB);
      expect(finalDefenseService.getRootResistantGatewayStatus(gatewayId)?.reportSequence).toBe(1);
    });

    it('rejects malformed sequence/bootId pairs (fail-closed)', () => {
      const runTag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const base = {
        tenantId: `tenant-fd-replay-invalid-${runTag}`,
        gatewayId: `gw-replay-invalid-${runTag}`,
        bridgeState: 'isolated',
        serverPortLink: true,
        lanPortLink: true,
        mgmtPath: 'dedicated_mgmt',
        secureElementPresent: true
      } as const;

      expect(() => finalDefenseService.reportRootResistantGatewayStatus({ ...base, bootId: 'c'.repeat(16), sequence: 0 }))
        .toThrow('backend.root_gateway_status_sequence_invalid');
      expect(() => finalDefenseService.reportRootResistantGatewayStatus({ ...base, bootId: 'c'.repeat(16), sequence: 1.5 }))
        .toThrow('backend.root_gateway_status_sequence_invalid');
      expect(() => finalDefenseService.reportRootResistantGatewayStatus({ ...base, bootId: 'c'.repeat(16) }))
        .toThrow('backend.root_gateway_status_sequence_invalid');
      expect(() => finalDefenseService.reportRootResistantGatewayStatus({ ...base, bootId: 'short', sequence: 1 }))
        .toThrow('backend.root_gateway_status_sequence_invalid');
    });

    it('still accepts legacy reports without sequence/bootId (self-report only)', () => {
      const runTag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const gatewayId = `gw-replay-legacy-${runTag}`;
      expect(() => finalDefenseService.reportRootResistantGatewayStatus({
        tenantId: `tenant-fd-replay-legacy-${runTag}`,
        gatewayId,
        bridgeState: 'isolated',
        serverPortLink: true,
        lanPortLink: true,
        mgmtPath: 'dedicated_mgmt',
        secureElementPresent: true
      })).not.toThrow();
      expect(finalDefenseService.getRootResistantGatewayStatus(gatewayId)?.verificationLevel).toBe('reported');
    });

    it('N3-3: binds the status channel to the first helper credential and rejects any other (TOFU)', () => {
      const runTag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const gatewayId = `gw-helper-bind-${runTag}`;
      const base = {
        tenantId: `tenant-fd-helper-bind-${runTag}`,
        gatewayId,
        bridgeState: 'isolated',
        serverPortLink: true,
        lanPortLink: true,
        mgmtPath: 'dedicated_mgmt',
        secureElementPresent: true
      } as const;

      // First report binds the channel to helper key gw-key-a.
      expect(() => finalDefenseService.reportRootResistantGatewayStatus({ ...base, helperKeyId: 'gw-key-a' })).not.toThrow();
      expect(finalDefenseService.getRootResistantGatewayStatus(gatewayId)?.boundHelperKeyId).toBe('gw-key-a');

      // A different appliance's credential cannot spoof this gateway's status.
      expect(() => finalDefenseService.reportRootResistantGatewayStatus({ ...base, helperKeyId: 'gw-key-b' }))
        .toThrow('backend.root_gateway_helper_key_mismatch');
      // Anonymous reports are equally rejected once a binding exists.
      expect(() => finalDefenseService.reportRootResistantGatewayStatus({ ...base }))
        .toThrow('backend.root_gateway_helper_key_mismatch');

      // The bound key keeps working.
      expect(() => finalDefenseService.reportRootResistantGatewayStatus({ ...base, helperKeyId: 'gw-key-a' })).not.toThrow();
    });
  });
});
