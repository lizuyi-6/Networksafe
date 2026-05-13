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
