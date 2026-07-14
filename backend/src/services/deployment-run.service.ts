import { createHash, randomUUID } from 'crypto';
import { getDatabase } from '../config/database';
import { artifactStoreService } from './artifact-store.service';
import { hardwareAuthorizationService, type CommandIntentRecord, type HardwareGrantRecord } from './hardware-authorization.service';
import { finalDefenseService, type FinalDefensePolicyRecord } from './final-defense.service';
import { signDeploymentBundlePayload, verifyDeploymentBundlePayload } from '../security/deployment-bundle-signing';
import type { DeploymentTarget } from './platform-config.service';
import logger from '../utils/logger';

export type DeploymentRunStatus =
  | 'prepared'
  | 'helper_attested'
  | 'backup_completed'
  | 'hardware_confirmation_pending'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'rolled_back';

export type HelperStatus = 'online' | 'offline' | 'stale';
export type EvidencePackStatus = 'pending' | 'ready' | 'failed';
export type SerialRequestType = 'ENV' | 'BACKUP' | 'INSTALL' | 'REMOVE';

interface BundleDocument {
  deploymentId: string;
  serverType: DeploymentTarget;
  requestType: 'install' | 'remove';
  files: Array<{ path: string; checksum: string }>;
}

export interface DeploymentHelperRecord {
  helperId: string;
  tenantId: string;
  fingerprint: string;
  version: string;
  hostname: string;
  systemdStatus: string;
  writablePaths: string[];
  targetHost: string;
  status: HelperStatus;
  createdAt: string;
  updatedAt: string;
  lastHeartbeatAt?: string;
}

export interface DeploymentRunRecord {
  id: string;
  tenantId: string;
  helperId: string;
  gateId: string;
  requestType: 'install' | 'remove';
  serverType: DeploymentTarget;
  status: DeploymentRunStatus;
  bundleChecksum: string;
  bundleSignature: string;
  checksumShortCode: string;
  bundleArtifactRef: string;
  bundleArtifactLocation: string;
  profile: Record<string, any>;
  requestedBy: string;
  approvedBy?: string;
  helperAttestation?: Record<string, any>;
  hardwareGrantId?: string;
  backupRef?: string;
  executionLog: Record<string, any>[];
  evidenceArtifactRef?: string;
  evidenceArtifactLocation?: string;
  evidenceStatus: EvidencePackStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastError?: string;
}

function parseJson<T>(value: any, fallback: T): T {
  if (!value || typeof value !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

function shortCode(checksum: string): string {
  return checksum.slice(0, 8).toUpperCase();
}

function ensureBuffer(value: string): Buffer {
  return Buffer.from(value, 'utf8');
}

function sanitizeText(value: string): string {
  return String(value || '').replace(/\r/g, '').trim();
}

function scriptFile(path: string, content: string) {
  return {
    path,
    content,
    checksum: createHash('sha256').update(content).digest('hex')
  };
}

// Coerce a deployment profile port to a safe integer in the valid range,
// falling back to 8080 for missing/non-numeric/out-of-range values. Avoids
// emitting `http://127.0.0.1:NaN/...` or `${NaN}:8080` in generated scripts.
function resolvePort(profile: Record<string, any>): number {
  const raw = Number(profile?.port);
  return Number.isFinite(raw) && raw > 0 && raw <= 65535 ? raw : 8080;
}

function renderInstallScript(profile: Record<string, any>, serverType: DeploymentTarget): string {
  const port = resolvePort(profile);
  if (serverType === 'docker_compose') {
    return `#!/usr/bin/env bash
set -euo pipefail
# Back up any prior compose file so rollback can restore it.
if [ -f docker-compose.enterprise.yml ]; then
  cp -a docker-compose.enterprise.yml "docker-compose.enterprise.yml.$(date +%Y%m%d%H%M%S).prev"
fi

cat > docker-compose.enterprise.yml <<'EOF'
version: "3.9"
services:
  aetherguard-agent:
    image: ${String(profile.image || 'ghcr.io/aetherguard/agent:latest')}
    restart: unless-stopped
    environment:
      AETHERGUARD_SERVER_NAME: ${String(profile.serverName || 'localhost')}
      AETHERGUARD_RATE_LIMIT: "${Number(profile.rateLimit || 100)}"
      AETHERGUARD_UPSTREAM: ${String(profile.upstream || 'http://backend:3005')}
    ports:
      - "${port}:8080"
EOF
docker compose -f docker-compose.enterprise.yml up -d
`;
  }

  return `#!/usr/bin/env bash
set -euo pipefail
install -d /etc/aetherguard
# Back up any prior agent.env so rollback can restore it.
if [ -f /etc/aetherguard/agent.env ]; then
  cp -a /etc/aetherguard/agent.env "/etc/aetherguard/agent.env.$(date +%Y%m%d%H%M%S).prev"
fi

cat > /etc/aetherguard/agent.env <<'EOF'
AETHERGUARD_SERVER_NAME=${String(profile.serverName || 'localhost')}
AETHERGUARD_RATE_LIMIT=${Number(profile.rateLimit || 100)}
AETHERGUARD_UPSTREAM=${String(profile.upstream || 'http://backend:3005')}
LISTEN_PORT=${port}
EOF
echo "AetherGuard enterprise install prepared"
`;
}

function renderRemoveScript(serverType: DeploymentTarget): string {
  if (serverType === 'docker_compose') {
    return `#!/usr/bin/env bash
set -euo pipefail
if [ -f docker-compose.enterprise.yml ]; then
  docker compose -f docker-compose.enterprise.yml down
fi
`;
  }

  return `#!/usr/bin/env bash
set -euo pipefail
rm -f /etc/aetherguard/agent.env
`;
}

export function renderRollbackScript(serverType: DeploymentTarget): string {
  if (serverType === 'docker_compose') {
    return `#!/usr/bin/env bash
set -euo pipefail
# Restore the prior compose file captured at install time, if any.
LATEST_COMPOSE=$(ls -1t docker-compose.enterprise.yml.*.prev 2>/dev/null | head -n 1 || true)
if [ -n "$LATEST_COMPOSE" ] && [ -f "$LATEST_COMPOSE" ]; then
  mv -f "$LATEST_COMPOSE" docker-compose.enterprise.yml
  docker compose -f docker-compose.enterprise.yml up -d
  echo "Rolled back docker-compose.enterprise.yml from $(basename "$LATEST_COMPOSE")"
elif [ -f docker-compose.enterprise.yml ]; then
  echo "No prior compose backup found; leaving current deployment running (nothing to roll back to)"
else
  echo "No enterprise deployment to roll back"
fi
`;
  }

  return `#!/usr/bin/env bash
set -euo pipefail
# Restore the most recent agent.env backup captured at install time, if any.
LATEST=$(ls -1t /etc/aetherguard/agent.env.*.prev 2>/dev/null | head -n 1 || true)
if [ -n "$LATEST" ] && [ -f "$LATEST" ]; then
  mv -f "$LATEST" /etc/aetherguard/agent.env
  echo "Rolled back agent.env from $(basename "$LATEST")"
else
  echo "No prior agent.env backup found; nothing to roll back"
fi
`;
}
export function renderHealthcheckScript(profile: Record<string, any>): string {
  const port = resolvePort(profile);
  return `#!/usr/bin/env bash
set -euo pipefail
if ! curl -fsS "http://127.0.0.1:${port}/health/ready" >/dev/null 2>&1; then
  echo "healthcheck FAILED: /health/ready not reachable on port ${port}"
  exit 1
fi
echo "healthcheck passed: /health/ready reachable"
`;
}

function renderBackupScript(runId: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail
TS="$(date +%Y%m%d%H%M%S)"
DEST="/tmp/aetherguard-enterprise-${runId}-$TS"
mkdir -p "$DEST"
tar -czf "$DEST/etc-aetherguard.tgz" /etc/aetherguard 2>/dev/null || true
printf '%s' "$DEST"
`;
}

class DeploymentRunService {
  private schemaReady = false;

  prepare(): void {
    if (this.schemaReady) {
      return;
    }

    const db = getDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS deployment_helpers (
        helper_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        version TEXT NOT NULL,
        hostname TEXT NOT NULL,
        systemd_status TEXT NOT NULL,
        writable_paths_json TEXT NOT NULL,
        target_host TEXT NOT NULL,
        status TEXT NOT NULL,
        last_heartbeat_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deployment_helpers_tenant_status ON deployment_helpers(tenant_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS deployment_runs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        helper_id TEXT NOT NULL,
        gate_id TEXT NOT NULL,
        request_type TEXT NOT NULL,
        server_type TEXT NOT NULL,
        status TEXT NOT NULL,
        bundle_checksum TEXT NOT NULL,
        bundle_signature TEXT NOT NULL,
        checksum_short_code TEXT NOT NULL,
        bundle_artifact_ref TEXT NOT NULL,
        bundle_artifact_location TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        approved_by TEXT,
        helper_attestation_json TEXT,
        hardware_grant_id TEXT,
        backup_ref TEXT,
        execution_log_json TEXT NOT NULL,
        evidence_artifact_ref TEXT,
        evidence_artifact_location TEXT,
        evidence_status TEXT NOT NULL DEFAULT 'pending',
        completed_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deployment_runs_helper_status ON deployment_runs(helper_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_deployment_runs_tenant_created ON deployment_runs(tenant_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS deployment_evidence (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        status TEXT NOT NULL,
        artifact_ref TEXT NOT NULL,
        artifact_location TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deployment_evidence_run ON deployment_evidence(run_id, created_at DESC);
    `);

    this.schemaReady = true;
  }

  private assertPrepared(): void {
    if (!this.schemaReady) {
      this.prepare();
    }
  }

  private buildBundle(runId: string, requestType: 'install' | 'remove', serverType: DeploymentTarget, profile: Record<string, any>) {
    const install = scriptFile('install.sh', renderInstallScript(profile, serverType));
    const remove = scriptFile('remove.sh', renderRemoveScript(serverType));
    const rollback = scriptFile('rollback.sh', renderRollbackScript(serverType));
    const healthcheck = scriptFile('healthcheck.sh', renderHealthcheckScript(profile));
    const backup = scriptFile('backup.sh', renderBackupScript(runId));
    const manifest: BundleDocument = {
      deploymentId: runId,
      serverType,
      requestType,
      files: [install, remove, rollback, healthcheck, backup].map((file) => ({
        path: file.path,
        checksum: file.checksum
      }))
    };
    const checksum = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    const signedPayload = {
      runId,
      requestType,
      serverType,
      checksum,
      files: manifest.files
    };
    const signature = signDeploymentBundlePayload(signedPayload);
    return {
      checksum,
      signature,
      signedPayload,
      bundleJson: JSON.stringify({
        manifest,
        signature,
        scripts: {
          backup: backup.content,
          install: install.content,
          remove: remove.content,
          rollback: rollback.content,
          healthcheck: healthcheck.content
        }
      }, null, 2)
    };
  }

  async registerHelper(input: {
    helperId: string;
    tenantId: string;
    fingerprint: string;
    version: string;
    hostname: string;
    systemdStatus: string;
    writablePaths: string[];
    targetHost: string;
  }): Promise<DeploymentHelperRecord> {
    this.assertPrepared();
    const now = isoNow();
    getDatabase().prepare(`
      INSERT INTO deployment_helpers (
        helper_id, tenant_id, fingerprint, version, hostname, systemd_status,
        writable_paths_json, target_host, status, last_heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, ?, ?)
      ON CONFLICT(helper_id) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        fingerprint = excluded.fingerprint,
        version = excluded.version,
        hostname = excluded.hostname,
        systemd_status = excluded.systemd_status,
        writable_paths_json = excluded.writable_paths_json,
        target_host = excluded.target_host,
        status = 'online',
        last_heartbeat_at = excluded.last_heartbeat_at,
        updated_at = excluded.updated_at
    `).run(
      input.helperId,
      input.tenantId,
      input.fingerprint,
      input.version,
      input.hostname,
      input.systemdStatus,
      JSON.stringify(input.writablePaths || []),
      input.targetHost,
      now,
      now,
      now
    );
    return this.getHelper(input.helperId) as DeploymentHelperRecord;
  }

  heartbeatHelper(helperId: string, input: {
    systemdStatus: string;
    targetHost?: string;
    writablePaths?: string[];
  }): DeploymentHelperRecord | null {
    this.assertPrepared();
    const existing = this.getHelper(helperId);
    if (!existing) {
      return null;
    }
    const now = isoNow();
    getDatabase().prepare(`
      UPDATE deployment_helpers
      SET systemd_status = ?, target_host = ?, writable_paths_json = ?, status = 'online', last_heartbeat_at = ?, updated_at = ?
      WHERE helper_id = ?
    `).run(
      input.systemdStatus || existing.systemdStatus,
      input.targetHost || existing.targetHost,
      JSON.stringify(input.writablePaths || existing.writablePaths || []),
      now,
      now,
      helperId
    );
    return this.getHelper(helperId);
  }

  getHelper(helperId: string): DeploymentHelperRecord | null {
    this.assertPrepared();
    const row = getDatabase().prepare(`
      SELECT *
      FROM deployment_helpers
      WHERE helper_id = ?
      LIMIT 1
    `).get(helperId) as any;
    if (!row) return null;
    return {
      helperId: row.helper_id,
      tenantId: row.tenant_id,
      fingerprint: row.fingerprint,
      version: row.version,
      hostname: row.hostname,
      systemdStatus: row.systemd_status,
      writablePaths: parseJson(row.writable_paths_json, []),
      targetHost: row.target_host,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastHeartbeatAt: row.last_heartbeat_at || undefined
    };
  }

  listHelpers(tenantId: string): DeploymentHelperRecord[] {
    this.assertPrepared();
    const rows = getDatabase().prepare(`
      SELECT *
      FROM deployment_helpers
      WHERE tenant_id = ?
      ORDER BY updated_at DESC
    `).all(tenantId) as any[];
    return rows.map((row) => this.getHelper(row.helper_id) as DeploymentHelperRecord);
  }

  async createRun(input: {
    tenantId: string;
    helperId: string;
    gateId: string;
    requestType: 'install' | 'remove';
    serverType: DeploymentTarget;
    profile: Record<string, any>;
    requestedBy: string;
  }): Promise<DeploymentRunRecord> {
    this.assertPrepared();
    const id = randomUUID();
    const now = isoNow();
    const bundle = this.buildBundle(id, input.requestType, input.serverType, input.profile);
    const artifact = await artifactStoreService.writeText(
      `enterprise/deployment-runs/${id}`,
      'bundle.json',
      bundle.bundleJson,
      'application/json'
    );

    getDatabase().prepare(`
      INSERT INTO deployment_runs (
        id, tenant_id, helper_id, gate_id, request_type, server_type, status,
        bundle_checksum, bundle_signature, checksum_short_code, bundle_artifact_ref, bundle_artifact_location,
        profile_json, requested_by, execution_log_json, evidence_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      id,
      input.tenantId,
      input.helperId,
      input.gateId,
      input.requestType,
      input.serverType,
      bundle.checksum,
      bundle.signature,
      shortCode(bundle.checksum),
      artifact.artifactRef,
      artifact.location,
      JSON.stringify(input.profile || {}),
      input.requestedBy,
      JSON.stringify([
        {
          at: now,
          actor: input.requestedBy,
          message: `Prepared deployment run for ${input.requestType}.`
        }
      ]),
      now,
      now
    );

    return this.getRun(id, input.tenantId) as DeploymentRunRecord;
  }

  listRuns(tenantId: string, limit = 50): DeploymentRunRecord[] {
    this.assertPrepared();
    const rows = getDatabase().prepare(`
      SELECT id
      FROM deployment_runs
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(tenantId, limit) as Array<{ id: string }>;
    return rows.map((row) => this.getRun(row.id, tenantId)).filter(Boolean) as DeploymentRunRecord[];
  }

  getRun(id: string, tenantId: string): DeploymentRunRecord | null {
    this.assertPrepared();
    const row = getDatabase().prepare(`
      SELECT *
      FROM deployment_runs
      WHERE id = ? AND tenant_id = ?
      LIMIT 1
    `).get(id, tenantId) as any;
    if (!row) {
      return null;
    }
    return this.mapRunRow(row);
  }

  async requestApproval(runId: string, actor: {
    tenantId: string;
    userId: string;
    email?: string;
    ip?: string;
  }): Promise<{
    run: DeploymentRunRecord;
    intent: CommandIntentRecord;
    sessionId?: string;
  }> {
    this.assertPrepared();
    const run = this.getRun(runId, actor.tenantId);
    if (!run) {
      throw new Error('backend.deployment_run_not_found');
    }
    if (run.status !== 'backup_completed') {
      throw new Error('backend.deployment_run_backup_required_before_approval');
    }

    const commandType = run.requestType === 'remove' ? 'host_remove' : 'host_install';
    const policy = this.resolveFinalDefensePolicyForRun(run, commandType);
    const challenge = randomUUID();
    const interlockAction = 'interlock_release';

    const approval = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: actor.tenantId,
      scope: 'deployment',
      targetId: run.id,
      commandType,
      gateId: run.gateId,
      payload: {
        runId: run.id,
        helperId: run.helperId,
        gateId: run.gateId,
        bundleChecksum: run.bundleChecksum,
        checksumShortCode: run.checksumShortCode,
        requestType: run.requestType,
        policyDigest: policy.policyDigest,
        challenge,
        breakerTarget: policy.breakerTarget,
        interlockAction
      },
      hardwareContext: {
        policyDigest: policy.policyDigest,
        challenge,
        breakerTarget: policy.breakerTarget,
        interlockAction
      },
      actorId: actor.userId,
      actorEmail: actor.email,
      actorIp: actor.ip,
      actionId: run.id
    });

    if (!approval.success) {
      throw new Error(approval.reason || 'backend.deployment_run_approval_failed');
    }

    this.updateRunState(run.id, actor.tenantId, {
      status: 'hardware_confirmation_pending',
      approvedBy: actor.email || actor.userId,
      appendLog: [
        {
          at: isoNow(),
          actor: actor.email || actor.userId,
          message: 'Waiting for hardware confirmation.'
        }
      ]
    });

    return {
      run: this.getRun(run.id, actor.tenantId) as DeploymentRunRecord,
      intent: approval.intent,
      sessionId: approval.session?.sessionId
    };
  }

  private resolveFinalDefensePolicyForRun(run: DeploymentRunRecord, commandType: string): FinalDefensePolicyRecord {
    const policy = finalDefenseService.getActivePolicyForCompanion(run.helperId);
    if (!policy || policy.tenantId !== run.tenantId) {
      throw new Error('backend.deployment_run_final_defense_policy_required');
    }
    if (policy.gateId !== run.gateId) {
      throw new Error('backend.deployment_run_final_defense_gate_mismatch');
    }
    if (!policy.policyDigest || !policy.breakerTarget) {
      throw new Error('backend.deployment_run_final_defense_context_required');
    }
    const allowed = policy.allowedActions.some((action) => action.commandType === commandType);
    if (!allowed) {
      throw new Error('backend.deployment_run_final_defense_action_not_allowed');
    }
    return policy;
  }

  confirmApprovedRun(intent: CommandIntentRecord, grant: HardwareGrantRecord): DeploymentRunRecord | null {
    this.assertPrepared();
    const run = this.getRun(intent.actionId, intent.tenantId);
    if (!run) {
      return null;
    }

    this.updateRunState(run.id, run.tenantId, {
      status: 'approved',
      hardwareGrantId: grant.grantId,
      appendLog: [
        {
          at: isoNow(),
          actor: `gate:${grant.gateId}`,
          message: 'Hardware confirmation grant verified.',
          hardwareGrantId: grant.grantId
        }
      ]
    });
    return this.getRun(run.id, run.tenantId);
  }

  private helperInstructionPayload(run: DeploymentRunRecord, requestType: SerialRequestType, script: string) {
    return {
      runId: run.id,
      helperId: run.helperId,
      tenantId: run.tenantId,
      requestType,
      bundleChecksum: run.bundleChecksum,
      checksumShortCode: run.checksumShortCode,
      scriptChecksum: createHash('sha256').update(script).digest('hex')
    };
  }

  async resolveSerialRequest(helperId: string, requestType: SerialRequestType): Promise<{
    ok: boolean;
    run?: DeploymentRunRecord;
    script?: string;
    payload?: Record<string, any>;
    signature?: string;
    message?: string;
  }> {
    this.assertPrepared();
    const helper = this.getHelper(helperId);
    if (!helper) {
      return { ok: false, message: 'backend.helper_not_registered' };
    }

    const statusFilter = requestType === 'BACKUP'
      ? ['prepared', 'helper_attested'] as DeploymentRunStatus[]
      : requestType === 'INSTALL'
        ? ['approved', 'executing'] as DeploymentRunStatus[]
        : requestType === 'REMOVE'
          ? ['approved', 'executing'] as DeploymentRunStatus[]
          : [] as DeploymentRunStatus[];

    const rows = getDatabase().prepare(`
      SELECT *
      FROM deployment_runs
      WHERE helper_id = ?
      ORDER BY created_at DESC
    `).all(helperId) as any[];

    const row = rows.find((candidate) => statusFilter.includes(candidate.status));
    if (!row) {
      return { ok: false, message: 'backend.no_matching_deployment_run' };
    }

    const run = this.mapRunRow(row);
    const bundleText = await artifactStoreService.readText(run.bundleArtifactRef, run.bundleArtifactLocation);
    const bundle = parseJson<any>(bundleText, {});
    const scripts = bundle.scripts || {};

    let script = '';
    if (requestType === 'BACKUP') {
      script = String(scripts.backup || '');
      if (run.status === 'prepared') {
        this.updateRunState(run.id, run.tenantId, {
          status: 'helper_attested',
          helperAttestation: {
            helperId: helper.helperId,
            fingerprint: helper.fingerprint,
            version: helper.version,
            hostname: helper.hostname,
            systemdStatus: helper.systemdStatus,
            writablePaths: helper.writablePaths,
            targetHost: helper.targetHost
          },
          appendLog: [
            {
              at: isoNow(),
              actor: `helper:${helper.helperId}`,
              message: 'Helper attested and backup requested.'
            }
          ]
        });
      }
    } else if (requestType === 'INSTALL') {
      script = String(scripts.install || '');
      this.updateRunState(run.id, run.tenantId, {
        status: 'executing',
        appendLog: [
          {
            at: isoNow(),
            actor: `helper:${helper.helperId}`,
            message: 'Install stage started.'
          }
        ]
      });
    } else if (requestType === 'REMOVE') {
      script = String(scripts.remove || '');
      this.updateRunState(run.id, run.tenantId, {
        status: 'executing',
        appendLog: [
          {
            at: isoNow(),
            actor: `helper:${helper.helperId}`,
            message: 'Remove stage started.'
          }
        ]
      });
    }

    if (!script) {
      return { ok: false, message: 'backend.deployment_script_missing' };
    }

    const payload = this.helperInstructionPayload(run, requestType, script);
    const signature = signDeploymentBundlePayload(payload);
    return {
      ok: true,
      run: this.getRun(run.id, run.tenantId) as DeploymentRunRecord,
      script,
      payload,
      signature
    };
  }

  async reportSerialRequestResult(input: {
    helperId: string;
    runId: string;
    tenantId: string;
    requestType: SerialRequestType;
    success: boolean;
    output?: string;
    signature?: string;
    payload?: Record<string, any>;
  }): Promise<DeploymentRunRecord | null> {
    this.assertPrepared();
    const run = this.getRun(input.runId, input.tenantId);
    if (!run || run.helperId !== input.helperId) {
      return null;
    }

    if (input.payload && input.signature && !verifyDeploymentBundlePayload(input.payload, input.signature)) {
      this.updateRunState(run.id, run.tenantId, {
        status: 'failed',
        lastError: 'invalid_helper_signature',
        appendLog: [
          {
            at: isoNow(),
            actor: `helper:${input.helperId}`,
            message: 'Helper result rejected because signature verification failed.'
          }
        ]
      });
      return this.getRun(run.id, run.tenantId);
    }

    const nextStatus: DeploymentRunStatus =
      input.requestType === 'BACKUP'
        ? (input.success ? 'backup_completed' : 'failed')
        : input.requestType === 'REMOVE'
          ? (input.success ? 'rolled_back' : 'failed')
          : (input.success ? 'completed' : 'failed');

    this.updateRunState(run.id, run.tenantId, {
      status: nextStatus,
      backupRef: input.requestType === 'BACKUP' && input.success ? sanitizeText(input.output || '') : run.backupRef,
      completedAt: input.requestType === 'BACKUP' ? undefined : isoNow(),
      lastError: input.success ? undefined : sanitizeText(input.output || 'execution_failed'),
      appendLog: [
        {
          at: isoNow(),
          actor: `helper:${input.helperId}`,
          message: input.success
            ? `${input.requestType} stage completed.`
            : `${input.requestType} stage failed.`,
          output: sanitizeText(input.output || '')
        }
      ]
    });

    const next = this.getRun(run.id, run.tenantId);
    if (next && next.status !== 'backup_completed') {
      await this.writeEvidencePack(next);
    }
    return next;
  }

  private updateRunState(runId: string, tenantId: string, patch: {
    status?: DeploymentRunStatus;
    approvedBy?: string;
    helperAttestation?: Record<string, any>;
    hardwareGrantId?: string;
    backupRef?: string;
    completedAt?: string;
    lastError?: string;
    appendLog?: Record<string, any>[];
  }): void {
    const current = this.getRun(runId, tenantId);
    if (!current) {
      return;
    }

    const executionLog = [...(current.executionLog || []), ...(patch.appendLog || [])];
    const updatedAt = isoNow();
    getDatabase().prepare(`
      UPDATE deployment_runs
      SET status = ?, approved_by = ?, helper_attestation_json = ?, hardware_grant_id = ?, backup_ref = ?,
          execution_log_json = ?, evidence_status = ?, completed_at = ?, last_error = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(
      patch.status || current.status,
      patch.approvedBy ?? current.approvedBy ?? null,
      JSON.stringify(patch.helperAttestation ?? current.helperAttestation ?? {}),
      patch.hardwareGrantId ?? current.hardwareGrantId ?? null,
      patch.backupRef ?? current.backupRef ?? null,
      JSON.stringify(executionLog),
      current.evidenceStatus,
      patch.completedAt ?? current.completedAt ?? null,
      patch.lastError ?? current.lastError ?? null,
      updatedAt,
      runId,
      tenantId
    );
  }

  async writeEvidencePack(run: DeploymentRunRecord): Promise<DeploymentRunRecord> {
    this.assertPrepared();
    const payload = {
      runId: run.id,
      tenantId: run.tenantId,
      helperId: run.helperId,
      gateId: run.gateId,
      status: run.status,
      bundleChecksum: run.bundleChecksum,
      checksumShortCode: run.checksumShortCode,
      backupRef: run.backupRef || null,
      hardwareGrantId: run.hardwareGrantId || null,
      helperAttestation: run.helperAttestation || null,
      executionLog: run.executionLog || [],
      rollbackNotes: run.requestType === 'remove'
        ? 'Host remove path executed through signed enterprise bundle.'
        : 'Use rollback.sh from the signed bundle if validation fails.',
      generatedAt: isoNow()
    };

    const artifact = await artifactStoreService.writeJson(
      `enterprise/evidence/${run.id}`,
      'evidence-pack',
      payload
    );

    const existing = getDatabase().prepare(`
      SELECT id
      FROM deployment_evidence
      WHERE run_id = ?
      LIMIT 1
    `).get(run.id) as any;
    const now = isoNow();
    if (existing?.id) {
      getDatabase().prepare(`
        UPDATE deployment_evidence
        SET status = 'ready', artifact_ref = ?, artifact_location = ?, updated_at = ?
        WHERE id = ?
      `).run(artifact.artifactRef, artifact.location, now, existing.id);
    } else {
      getDatabase().prepare(`
        INSERT INTO deployment_evidence (
          id, run_id, tenant_id, status, artifact_ref, artifact_location, created_at, updated_at
        ) VALUES (?, ?, ?, 'ready', ?, ?, ?, ?)
      `).run(randomUUID(), run.id, run.tenantId, artifact.artifactRef, artifact.location, now, now);
    }

    getDatabase().prepare(`
      UPDATE deployment_runs
      SET evidence_artifact_ref = ?, evidence_artifact_location = ?, evidence_status = 'ready', updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(artifact.artifactRef, artifact.location, now, run.id, run.tenantId);

    return this.getRun(run.id, run.tenantId) as DeploymentRunRecord;
  }

  async readEvidence(runId: string, tenantId: string): Promise<{ run: DeploymentRunRecord; payload: string } | null> {
    this.assertPrepared();
    const run = this.getRun(runId, tenantId);
    if (!run || !run.evidenceArtifactRef) {
      return null;
    }
    const payload = await artifactStoreService.readText(run.evidenceArtifactRef, run.evidenceArtifactLocation);
    return { run, payload };
  }

  private mapRunRow(row: any): DeploymentRunRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      helperId: row.helper_id,
      gateId: row.gate_id,
      requestType: row.request_type,
      serverType: row.server_type,
      status: row.status,
      bundleChecksum: row.bundle_checksum,
      bundleSignature: row.bundle_signature,
      checksumShortCode: row.checksum_short_code,
      bundleArtifactRef: row.bundle_artifact_ref,
      bundleArtifactLocation: row.bundle_artifact_location,
      profile: parseJson(row.profile_json, {}),
      requestedBy: row.requested_by,
      approvedBy: row.approved_by || undefined,
      helperAttestation: parseJson(row.helper_attestation_json, {}),
      hardwareGrantId: row.hardware_grant_id || undefined,
      backupRef: row.backup_ref || undefined,
      executionLog: parseJson(row.execution_log_json, []),
      evidenceArtifactRef: row.evidence_artifact_ref || undefined,
      evidenceArtifactLocation: row.evidence_artifact_location || undefined,
      evidenceStatus: row.evidence_status || 'pending',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined,
      lastError: row.last_error || undefined
    };
  }
}

export const deploymentRunService = new DeploymentRunService();
