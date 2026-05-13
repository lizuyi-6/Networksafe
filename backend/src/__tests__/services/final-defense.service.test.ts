import { createSign, generateKeyPairSync } from 'crypto';
import { initDatabase } from '../../config/database';
import { buildHardwareGrantMessage, hashPayload } from '../../security/hardware-grant';
import { normalizeInterlockState } from '../../security/final-defense-policy';
import { finalDefenseService } from '../../services/final-defense.service';
import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';

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

  it('blocks root-resistant high-risk actions until an external gateway is active', async () => {
    const tenantId = `tenant-root-action-${Date.now()}`;
    const companionId = `companion-root-action-${Date.now()}`;
    const gateId = `gate-root-action-${Date.now()}`;

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
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----',
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

    const allowed = await finalDefenseService.requestAction({
      tenantId,
      companionId,
      commandType: 'host_remove',
      actorId: 'tester'
    });

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

    const request = await finalDefenseService.requestGatewayAction({
      tenantId,
      gatewayId,
      action: 'release_temporary',
      actorId: 'tester',
      challenge: 'root-release-challenge'
    });

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

    const request = await finalDefenseService.requestAction({
      tenantId,
      companionId,
      commandType: 'interlock_release',
      actorId: 'tester',
      challenge: 'challenge-final-defense'
    });

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
