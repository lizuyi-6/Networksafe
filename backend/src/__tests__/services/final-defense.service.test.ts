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
    const attestedAt = new Date().toISOString();

    const policy = finalDefenseService.upsertPolicy({
      tenantId,
      companionId: 'root-companion-only',
      gateId: 'root-companion-gate',
      breakerTarget: 'mgmt-uplink',
      releaseTtlMs: 30_000,
      allowedActions: [{ commandType: 'host_remove', requiresInterlockRelease: true }]
    });
    const companionStatus = finalDefenseService.reportStatus({
      tenantId,
      companionId: 'root-companion-only',
      gateId: 'root-companion-gate',
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
      gatewayId: 'external-gateway-degraded',
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
      gatewayId: 'external-gateway-active',
      policyDigest: 'digest-root-active',
      reportedPolicyDigest: 'digest-root-active',
      firmwareDigest: 'firmware-root-active',
      lastAttestationAt: attestedAt,
      bridgeState: 'isolated',
      serverPortLink: true,
      lanPortLink: true,
      mgmtPath: 'dedicated_mgmt',
      secureElementPresent: true
    });

    expect(activeGateway.active).toBe(true);
    expect(activeGateway.gatewayProtectionMode).toBe('external_network_gateway');
    expect(activeGateway.degradedReasons).toEqual([]);
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
      lastAttestationAt: new Date().toISOString(),
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
    // Register an otherwise-healthy gateway so the only variable is heartbeat age.
    finalDefenseService.reportRootResistantGatewayStatus({
      tenantId,
      gatewayId: 'gateway-heartbeat-stale',
      policyDigest: 'digest-stale',
      reportedPolicyDigest: 'digest-stale',
      firmwareDigest: 'firmware-stale',
      lastAttestationAt: new Date().toISOString(),
      bridgeState: 'isolated',
      serverPortLink: true,
      lanPortLink: true,
      mgmtPath: 'dedicated_mgmt',
      secureElementPresent: true
    });

    const fresh = finalDefenseService.listRootResistantGateways(tenantId).find(g => g.gatewayId === 'gateway-heartbeat-stale');
    expect(fresh?.gatewayOnline).toBe(true);
    expect(fresh?.active).toBe(true);

    // Backdate the heartbeat to 50s ago — beyond the PRD §4.4 trigger-#7 45s
    // threshold but well inside the old (incorrect) 90s window. A compliant
    // implementation must treat this gateway as stale.
    const { getDatabase } = require('../../config/database');
    const staleHeartbeat = new Date(Date.now() - 50_000).toISOString();
    getDatabase().prepare(`UPDATE root_resistant_gateways SET last_heartbeat_at = ? WHERE gateway_id = ?`)
      .run(staleHeartbeat, 'gateway-heartbeat-stale');

    const staleStatus = finalDefenseService.listRootResistantGateways(tenantId).find(g => g.gatewayId === 'gateway-heartbeat-stale');
    expect(staleStatus?.gatewayOnline).toBe(false);
    expect(staleStatus?.degradedReasons).toEqual(expect.arrayContaining(['gateway_stale']));
    expect(staleStatus?.active).toBe(false);
  });

  it('treats an unparseable heartbeat timestamp as stale, not fresh (fail-closed)', () => {
    const tenantId = `tenant-root-badhb-${Date.now()}`;
    finalDefenseService.reportRootResistantGatewayStatus({
      tenantId,
      gatewayId: 'gateway-badhb',
      policyDigest: 'digest-badhb',
      reportedPolicyDigest: 'digest-badhb',
      firmwareDigest: 'firmware-badhb',
      lastAttestationAt: new Date().toISOString(),
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
      .run('not-a-timestamp', 'gateway-badhb');

    const status = finalDefenseService.listRootResistantGateways(tenantId).find(g => g.gatewayId === 'gateway-badhb');
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

    finalDefenseService.reportRootResistantGatewayStatus({
      tenantId,
      gatewayId: gateId,
      policyDigest: 'digest-root-action',
      reportedPolicyDigest: 'digest-root-action',
      firmwareDigest: 'firmware-root-action',
      lastAttestationAt: new Date().toISOString(),
      bridgeState: 'armed',
      serverPortLink: true,
      lanPortLink: true,
      mgmtPath: 'cellular',
      secureElementPresent: true
    });

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
      lastAttestationAt: new Date().toISOString(),
      bridgeState: 'isolated',
      serverPortLink: true,
      lanPortLink: true,
      mgmtPath: 'dedicated_mgmt',
      secureElementPresent: true
    });

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
});
