import { createHash, createSign, generateKeyPairSync } from 'crypto';
import { initDatabase } from '../../config/database';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { deploymentRunService, renderRollbackScript, renderHealthcheckScript } from '../../services/deployment-run.service';
import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';
import { buildHardwareGrantMessage, hashPayload } from '../../security/hardware-grant';

describe('deploymentRunService', () => {
  beforeAll(async () => {
    process.env.DEPLOYMENT_BUNDLE_SIGNING_SECRET = 'test-deployment-signing-secret-32';
    await initDatabase();
    hardwareAuthorizationService.prepare();
    deploymentRunService.prepare();
  });

  beforeEach(() => {
    hardwareAuthorizationService.setGatewayEmitter(() => true);
  });

  it('requires helper backup before requesting hardware approval', async () => {
    const tenantId = `tenant-${Date.now()}`;
    const helperId = `helper-${Date.now()}`;
    const gateId = `gate-${Date.now()}`;

    await deploymentRunService.registerHelper({
      tenantId,
      helperId,
      fingerprint: 'fp',
      version: '1.0.0-test',
      hostname: 'host-a',
      systemdStatus: 'active',
      writablePaths: ['/tmp'],
      targetHost: 'host-a'
    });

    const run = await deploymentRunService.createRun({
      tenantId,
      helperId,
      gateId,
      requestType: 'install',
      serverType: 'docker_compose',
      profile: { port: 8080 },
      requestedBy: 'operator@test.local'
    });

    await expect(deploymentRunService.requestApproval(run.id, {
      tenantId,
      userId: 'approver'
    })).rejects.toThrow('backend.deployment_run_backup_required_before_approval');
  });

  it('moves a backed-up run to approved after a valid hardware grant', async () => {
    const tenantId = `tenant-${Date.now()}-approved`;
    const helperId = `helper-${Date.now()}-approved`;
    const gateId = `gate-${Date.now()}-approved`;
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

    hardwareAuthorizationService.enrollGate({
      tenantId,
      gateId,
      displayName: 'Approval gate',
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    await deploymentRunService.registerHelper({
      tenantId,
      helperId,
      fingerprint: 'fp-approved',
      version: '1.0.0-test',
      hostname: 'host-b',
      systemdStatus: 'active',
      writablePaths: ['/tmp'],
      targetHost: 'host-b'
    });

    const run = await deploymentRunService.createRun({
      tenantId,
      helperId,
      gateId,
      requestType: 'install',
      serverType: 'docker_compose',
      profile: { port: 8081 },
      requestedBy: 'operator@test.local'
    });

    const backup = await deploymentRunService.resolveSerialRequest(helperId, 'BACKUP');
    expect(backup.ok).toBe(true);
    const backupPayload = backup.payload || {};
    const backupSignature = backup.signature || '';
    const backupResult = await deploymentRunService.reportSerialRequestResult({
      helperId,
      runId: run.id,
      tenantId,
      requestType: 'BACKUP',
      success: true,
      output: '/tmp/backup-ref',
      payload: backupPayload,
      signature: backupSignature
    });
    expect(backupResult?.status).toBe('backup_completed');

    const approval = await deploymentRunService.requestApproval(run.id, {
      tenantId,
      userId: 'approver',
      email: 'approver@test.local'
    });
    expect(approval.sessionId).toBeTruthy();

    const approvedRun = approval.run;
    const grantPayload = {
      runId: approvedRun.id,
      helperId,
      gateId,
      bundleChecksum: approvedRun.bundleChecksum,
      checksumShortCode: approvedRun.checksumShortCode,
      requestType: approvedRun.requestType
    };
    expect(hashPayload(grantPayload)).toBe(approval.intent.payloadHash);
    expect(createHash('sha256').update(JSON.stringify(grantPayload)).digest('hex')).not.toBe(approval.intent.payloadHash);

    const issuedAt = new Date().toISOString();
    const expiresAt = approval.sessionId
      ? hardwareAuthorizationService.getConfirmationSession(approval.sessionId)!.expiresAt
      : new Date(Date.now() + 120_000).toISOString();
    const monotonicCounter = 1;
    const signature = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: approval.sessionId!,
        actionId: run.id,
        tenantId,
        scope: 'deployment',
        targetId: run.id,
        commandType: 'host_install',
        payloadHash: approval.intent.payloadHash,
        issuedAt,
        expiresAt,
        monotonicCounter
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: approval.sessionId,
      confirmed: true,
      issuedAt,
      expiresAt,
      monotonicCounter,
      signature
    });

    expect(ack.confirmed).toBe(true);
    await commandDispatcherService.dispatchHardwareConfirmedIntent(ack.intent!, ack.grant!);

    const nextRun = deploymentRunService.getRun(run.id, tenantId);
    expect(nextRun?.status).toBe('approved');
    expect(nextRun?.hardwareGrantId).toBe(ack.grant?.grantId);
  });
});

describe('deployment-run render scripts (real, not placeholders)', () => {
  it('rollback restores the prior backup instead of echoing a placeholder', () => {
    const rollback = renderRollbackScript('binary_agent');
    expect(rollback).not.toContain('Rollback placeholder executed');
    expect(rollback).toContain('agent.env.*.prev');
    expect(rollback).toContain('mv -f');

    const dockerRollback = renderRollbackScript('docker_compose');
    expect(dockerRollback).not.toContain('Rollback placeholder executed');
    expect(dockerRollback).toContain('.prev');
  });

  it('healthcheck fails (exit 1) when /api/health is unreachable, not always-success', () => {
    const hc = renderHealthcheckScript({ port: 8080 });
    expect(hc).not.toMatch(/\|\|\s*true/);
    expect(hc).toContain('exit 1');
    expect(hc).toContain('8080');
  });
});
