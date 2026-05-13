import { randomUUID } from 'crypto';
import { getDatabase } from '../config/database';
import {
  computeFinalDefensePolicyDigest,
  FinalDefenseAllowedAction,
  FinalDefensePolicyStatus,
  InterlockState,
  normalizeInterlockState
} from '../security/final-defense-policy';
import { hardwareAuthorizationService } from './hardware-authorization.service';

export interface FinalDefensePolicyRecord {
  policyId: string;
  tenantId: string;
  companionId: string;
  gateId: string;
  policyDigest: string;
  allowedActions: FinalDefenseAllowedAction[];
  breakerTarget: string;
  releaseTtlMs: number;
  createdAt: string;
  updatedAt: string;
  status: FinalDefensePolicyStatus;
}

export interface FinalDefenseStatusRecord {
  tenantId: string;
  companionId: string;
  gateId: string;
  policyId?: string;
  policyDigest?: string;
  reportedPolicyDigest?: string;
  breakerTarget?: string;
  interlockState: InterlockState;
  externalPowerPresent: boolean;
  secureElementPresent: boolean;
  feedbackOk: boolean;
  companionOnline: boolean;
  lastHeartbeatAt?: string;
  lastVerifiedAt?: string;
  lastError?: string;
  active: boolean;
  degradedReasons: string[];
  createdAt: string;
  updatedAt: string;
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

function asBoolean(value: any): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function isoNow(): string {
  return new Date().toISOString();
}

function stale(lastHeartbeatAt?: string): boolean {
  if (!lastHeartbeatAt) {
    return true;
  }
  return Date.now() - new Date(lastHeartbeatAt).getTime() > 90_000;
}

class FinalDefenseService {
  private schemaReady = false;

  prepare(): void {
    if (this.schemaReady) {
      return;
    }

    getDatabase().exec(`
      CREATE TABLE IF NOT EXISTS final_defense_policies (
        policy_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        companion_id TEXT NOT NULL,
        gate_id TEXT NOT NULL,
        policy_digest TEXT NOT NULL,
        allowed_actions_json TEXT NOT NULL,
        breaker_target TEXT NOT NULL,
        release_ttl_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_final_defense_policies_tenant_status
        ON final_defense_policies(tenant_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_final_defense_policies_companion
        ON final_defense_policies(companion_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS final_defense_status (
        companion_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        gate_id TEXT NOT NULL,
        policy_id TEXT,
        policy_digest TEXT,
        reported_policy_digest TEXT,
        breaker_target TEXT,
        interlock_state TEXT NOT NULL,
        external_power_present INTEGER NOT NULL DEFAULT 0,
        secure_element_present INTEGER NOT NULL DEFAULT 0,
        feedback_ok INTEGER NOT NULL DEFAULT 0,
        companion_online INTEGER NOT NULL DEFAULT 0,
        last_heartbeat_at TEXT,
        last_verified_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_final_defense_status_tenant
        ON final_defense_status(tenant_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_final_defense_status_gate
        ON final_defense_status(gate_id, updated_at DESC);
    `);

    this.schemaReady = true;
  }

  private assertPrepared(): void {
    if (this.schemaReady) {
      return;
    }
    if (process.env.NODE_ENV === 'test') {
      this.prepare();
      return;
    }
    throw new Error('Final defense schema not initialized. Call finalDefenseService.prepare() during bootstrap.');
  }

  upsertPolicy(input: {
    tenantId: string;
    companionId: string;
    gateId: string;
    allowedActions: FinalDefenseAllowedAction[];
    breakerTarget: string;
    releaseTtlMs?: number;
    status?: FinalDefensePolicyStatus;
    policyId?: string;
    createdAt?: string;
  }): FinalDefensePolicyRecord {
    this.assertPrepared();
    const now = isoNow();
    const policyId = input.policyId || randomUUID();
    const createdAt = input.createdAt || now;
    const status = input.status || 'active';
    const releaseTtlMs = Math.max(5_000, Math.min(Number(input.releaseTtlMs || 120_000), 15 * 60_000));
    const policyDigest = computeFinalDefensePolicyDigest({
      policyId,
      tenantId: input.tenantId,
      companionId: input.companionId,
      gateId: input.gateId,
      allowedActions: input.allowedActions,
      breakerTarget: input.breakerTarget,
      releaseTtlMs,
      createdAt,
      status
    });

    getDatabase().prepare(`
      INSERT INTO final_defense_policies (
        policy_id, tenant_id, companion_id, gate_id, policy_digest,
        allowed_actions_json, breaker_target, release_ttl_ms, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(policy_id) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        companion_id = excluded.companion_id,
        gate_id = excluded.gate_id,
        policy_digest = excluded.policy_digest,
        allowed_actions_json = excluded.allowed_actions_json,
        breaker_target = excluded.breaker_target,
        release_ttl_ms = excluded.release_ttl_ms,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      policyId,
      input.tenantId,
      input.companionId,
      input.gateId,
      policyDigest,
      JSON.stringify(input.allowedActions || []),
      input.breakerTarget,
      releaseTtlMs,
      status,
      createdAt,
      now
    );

    return this.getPolicy(policyId) as FinalDefensePolicyRecord;
  }

  getPolicy(policyId: string): FinalDefensePolicyRecord | null {
    this.assertPrepared();
    const row = getDatabase().prepare(`
      SELECT *
      FROM final_defense_policies
      WHERE policy_id = ?
      LIMIT 1
    `).get(policyId) as any;
    return row ? this.mapPolicy(row) : null;
  }

  getActivePolicyForCompanion(companionId: string): FinalDefensePolicyRecord | null {
    this.assertPrepared();
    const row = getDatabase().prepare(`
      SELECT *
      FROM final_defense_policies
      WHERE companion_id = ? AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(companionId) as any;
    return row ? this.mapPolicy(row) : null;
  }

  listPolicies(tenantId: string): FinalDefensePolicyRecord[] {
    this.assertPrepared();
    const rows = getDatabase().prepare(`
      SELECT *
      FROM final_defense_policies
      WHERE tenant_id = ?
      ORDER BY status = 'active' DESC, updated_at DESC
    `).all(tenantId) as any[];
    return rows.map((row) => this.mapPolicy(row));
  }

  reportStatus(input: {
    tenantId: string;
    companionId: string;
    gateId: string;
    policyId?: string;
    policyDigest?: string;
    breakerTarget?: string;
    interlockState?: string;
    externalPowerPresent?: boolean;
    secureElementPresent?: boolean;
    feedbackOk?: boolean;
    lastError?: string;
  }): FinalDefenseStatusRecord {
    this.assertPrepared();
    const now = isoNow();
    const policy = input.policyId
      ? this.getPolicy(input.policyId)
      : this.getActivePolicyForCompanion(input.companionId);
    const policyDigest = policy?.policyDigest || null;

    getDatabase().prepare(`
      INSERT INTO final_defense_status (
        companion_id, tenant_id, gate_id, policy_id, policy_digest, reported_policy_digest,
        breaker_target, interlock_state, external_power_present, secure_element_present,
        feedback_ok, companion_online, last_heartbeat_at, last_verified_at, last_error,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(companion_id) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        gate_id = excluded.gate_id,
        policy_id = excluded.policy_id,
        policy_digest = excluded.policy_digest,
        reported_policy_digest = excluded.reported_policy_digest,
        breaker_target = excluded.breaker_target,
        interlock_state = excluded.interlock_state,
        external_power_present = excluded.external_power_present,
        secure_element_present = excluded.secure_element_present,
        feedback_ok = excluded.feedback_ok,
        companion_online = 1,
        last_heartbeat_at = excluded.last_heartbeat_at,
        last_verified_at = excluded.last_verified_at,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).run(
      input.companionId,
      input.tenantId,
      input.gateId,
      policy?.policyId || input.policyId || null,
      policyDigest,
      input.policyDigest || null,
      input.breakerTarget || policy?.breakerTarget || null,
      normalizeInterlockState(input.interlockState),
      input.externalPowerPresent ? 1 : 0,
      input.secureElementPresent ? 1 : 0,
      input.feedbackOk ? 1 : 0,
      now,
      input.policyDigest && policyDigest && input.policyDigest === policyDigest ? now : null,
      input.lastError || null,
      now,
      now
    );

    return this.getStatus(input.companionId) as FinalDefenseStatusRecord;
  }

  getStatus(companionId: string): FinalDefenseStatusRecord | null {
    this.assertPrepared();
    const row = getDatabase().prepare(`
      SELECT *
      FROM final_defense_status
      WHERE companion_id = ?
      LIMIT 1
    `).get(companionId) as any;
    return row ? this.mapStatus(row) : null;
  }

  listStatus(tenantId: string): FinalDefenseStatusRecord[] {
    this.assertPrepared();
    const rows = getDatabase().prepare(`
      SELECT *
      FROM final_defense_status
      WHERE tenant_id = ?
      ORDER BY updated_at DESC
    `).all(tenantId) as any[];
    return rows.map((row) => this.mapStatus(row));
  }

  async requestAction(input: {
    tenantId: string;
    companionId: string;
    commandType: string;
    actorId: string;
    actorEmail?: string;
    actorIp?: string;
    payload?: Record<string, any>;
    challenge?: string;
  }) {
    this.assertPrepared();
    const policy = this.getActivePolicyForCompanion(input.companionId);
    if (!policy) {
      return {
        success: false,
        message: 'Final Defense policy is not active for this companion.',
        reason: 'final_defense_policy_unavailable'
      };
    }

    const allowed = policy.allowedActions.find((action) => action.commandType === input.commandType);
    if (!allowed) {
      return {
        success: false,
        message: `Command ${input.commandType} is not allowed by the local Final Defense policy.`,
        reason: 'final_defense_action_not_allowed',
        policy
      };
    }

    const challenge = input.challenge || randomUUID();
    const interlockAction = input.commandType === 'interlock_assert'
      ? 'interlock_assert'
      : 'interlock_release';

    return hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: input.tenantId,
      scope: 'device',
      targetId: input.companionId,
      commandType: input.commandType,
      gateId: policy.gateId,
      payload: {
        ...(input.payload || {}),
        companionId: input.companionId,
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
      actorId: input.actorId,
      actorEmail: input.actorEmail,
      actorIp: input.actorIp
    });
  }

  private degradedReasons(row: any): string[] {
    const reasons: string[] = [];
    if (stale(row.last_heartbeat_at)) {
      reasons.push('companion_stale');
    }
    if (!asBoolean(row.companion_online)) {
      reasons.push('companion_offline');
    }
    if (!asBoolean(row.secure_element_present)) {
      reasons.push('secure_element_missing');
    }
    if (!asBoolean(row.external_power_present)) {
      reasons.push('external_power_missing');
    }
    if (!asBoolean(row.feedback_ok)) {
      reasons.push('feedback_not_verified');
    }
    const state = normalizeInterlockState(row.interlock_state);
    if (state !== 'armed' && state !== 'isolated') {
      reasons.push(`interlock_${state}`);
    }
    if (!row.policy_digest || row.reported_policy_digest !== row.policy_digest) {
      reasons.push('policy_digest_mismatch');
    }
    if (row.last_error) {
      reasons.push('last_error');
    }
    return [...new Set(reasons)];
  }

  private mapPolicy(row: any): FinalDefensePolicyRecord {
    return {
      policyId: String(row.policy_id),
      tenantId: String(row.tenant_id),
      companionId: String(row.companion_id),
      gateId: String(row.gate_id),
      policyDigest: String(row.policy_digest),
      allowedActions: parseJson(row.allowed_actions_json, []),
      breakerTarget: String(row.breaker_target),
      releaseTtlMs: Number(row.release_ttl_ms || 0),
      status: String(row.status || 'staged') as FinalDefensePolicyStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  private mapStatus(row: any): FinalDefenseStatusRecord {
    const degradedReasons = this.degradedReasons(row);
    return {
      tenantId: String(row.tenant_id),
      companionId: String(row.companion_id),
      gateId: String(row.gate_id),
      policyId: row.policy_id || undefined,
      policyDigest: row.policy_digest || undefined,
      reportedPolicyDigest: row.reported_policy_digest || undefined,
      breakerTarget: row.breaker_target || undefined,
      interlockState: normalizeInterlockState(row.interlock_state),
      externalPowerPresent: asBoolean(row.external_power_present),
      secureElementPresent: asBoolean(row.secure_element_present),
      feedbackOk: asBoolean(row.feedback_ok),
      companionOnline: asBoolean(row.companion_online) && !stale(row.last_heartbeat_at),
      lastHeartbeatAt: row.last_heartbeat_at || undefined,
      lastVerifiedAt: row.last_verified_at || undefined,
      lastError: row.last_error || undefined,
      active: degradedReasons.length === 0,
      degradedReasons,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }
}

export const finalDefenseService = new FinalDefenseService();
