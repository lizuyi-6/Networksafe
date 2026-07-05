import { randomUUID } from 'crypto';
import { getDatabase } from '../config/database';
import { postgresShadowStoreService } from './postgres-shadow-store.service';
import auditLogger from '../security/audit-logger.service';
import { classifyCommandRisk, RiskClass } from '../security/command-risk-policy';
import {
  HardwareGrantEnvelope,
  hashPayload,
  stableStringify,
  verifyHardwareGrantSignature
} from '../security/hardware-grant';
import logger from '../utils/logger';
import { PLATFORM_TENANT_ID } from '../core/tenant/tenant-context';

export type CommandScope = 'agent' | 'device' | 'deployment';
export type HardwareGateStatus = 'enrolled' | 'online' | 'offline' | 'revoked';
export interface HardwareGrantContext {
  policyDigest?: string;
  challenge?: string;
  breakerTarget?: string;
  interlockAction?: string;
}
export type CommandIntentStatus =
  | 'pending_hardware_confirmation'
  | 'hardware_confirmed'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'rejected';

export interface CommandIntentRecord {
  actionId: string;
  tenantId: string;
  scope: CommandScope;
  targetId: string;
  commandType: string;
  riskClass: RiskClass;
  payload: Record<string, any>;
  payloadHash: string;
  status: CommandIntentStatus;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  confirmationSessionId?: string;
  grantId?: string;
  result?: Record<string, any>;
}

export interface HardwareGateRecord {
  gateId: string;
  tenantId: string;
  displayName: string;
  publicKeyPem: string;
  algorithm: string;
  status: HardwareGateStatus;
  lastMonotonicCounter: number;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
}

export interface HardwareConfirmationSessionRecord {
  sessionId: string;
  actionId: string;
  tenantId: string;
  gateId: string;
  status: string;
  prompt: string;
  summary: Record<string, any>;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  result?: Record<string, any>;
  intent?: CommandIntentRecord;
}

export interface HardwareGrantRecord {
  grantId: string;
  sessionId: string;
  actionId: string;
  tenantId: string;
  gateId: string;
  payloadHash: string;
  issuedAt: string;
  expiresAt: string;
  monotonicCounter: number;
  signature: string;
  grant: HardwareGrantEnvelope;
  createdAt: string;
}

type GatewayEmitter = (gateId: string, command: string, params?: Record<string, any>) => Promise<boolean> | boolean;

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

function isoPlusMs(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

class HardwareAuthorizationService {
  private schemaReady = false;
  private gatewayEmitter: GatewayEmitter | null = null;

  setGatewayEmitter(emitter: GatewayEmitter | null): void {
    this.gatewayEmitter = emitter;
  }

  prepare(): void {
    if (this.schemaReady) {
      return;
    }

    const db = getDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS hardware_gates (
        gate_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        public_key_pem TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        status TEXT NOT NULL,
        last_monotonic_counter INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_hardware_gates_tenant_status ON hardware_gates(tenant_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS command_intents (
        action_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        target_id TEXT NOT NULL,
        command_type TEXT NOT NULL,
        risk_class TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        confirmation_session_id TEXT,
        grant_id TEXT,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_command_intents_target ON command_intents(tenant_id, scope, target_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_command_intents_status ON command_intents(tenant_id, status, created_at DESC);

      CREATE TABLE IF NOT EXISTS hardware_confirmation_sessions (
        session_id TEXT PRIMARY KEY,
        action_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        gate_id TEXT NOT NULL,
        status TEXT NOT NULL,
        prompt TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_hardware_sessions_action ON hardware_confirmation_sessions(action_id);
      CREATE INDEX IF NOT EXISTS idx_hardware_sessions_gate ON hardware_confirmation_sessions(gate_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS hardware_grants (
        grant_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        gate_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        monotonic_counter INTEGER NOT NULL,
        signature TEXT NOT NULL,
        grant_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_hardware_grants_action ON hardware_grants(action_id);
      CREATE INDEX IF NOT EXISTS idx_hardware_grants_gate_counter ON hardware_grants(gate_id, monotonic_counter);
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
    throw new Error('Hardware authorization schema not initialized. Call hardwareAuthorizationService.prepare() during bootstrap.');
  }

  enrollGate(input: {
    tenantId: string;
    gateId: string;
    displayName?: string;
    publicKeyPem: string;
    algorithm?: string;
    metadata?: Record<string, any>;
    status?: HardwareGateStatus;
  }): HardwareGateRecord {
    this.assertPrepared();
    const now = new Date().toISOString();
    const existing = this.getGate(input.gateId);
    const status = input.status || existing?.status || 'enrolled';
    const displayName = input.displayName || existing?.displayName || input.gateId;
    const algorithm = input.algorithm || existing?.algorithm || 'ECDSA_P256_SHA256';
    const metadata = {
      ...(existing?.metadata || {}),
      ...(input.metadata || {})
    };

    getDatabase().prepare(`
      INSERT INTO hardware_gates (
        gate_id, tenant_id, display_name, public_key_pem, algorithm, status,
        last_monotonic_counter, metadata_json, created_at, updated_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(gate_id) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        display_name = excluded.display_name,
        public_key_pem = excluded.public_key_pem,
        algorithm = excluded.algorithm,
        status = excluded.status,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at,
        last_seen_at = excluded.last_seen_at
    `).run(
      input.gateId,
      input.tenantId,
      displayName,
      input.publicKeyPem,
      algorithm,
      status,
      existing?.lastMonotonicCounter || 0,
      JSON.stringify(metadata),
      existing?.createdAt || now,
      now,
      now
    );

    return this.getGate(input.gateId) as HardwareGateRecord;
  }

  markGateOffline(gateId: string): void {
    this.assertPrepared();
    getDatabase().prepare(`
      UPDATE hardware_gates
      SET status = 'offline', updated_at = ?
      WHERE gate_id = ? AND status != 'revoked'
    `).run(new Date().toISOString(), gateId);
  }

  getGate(gateId: string): HardwareGateRecord | null {
    this.assertPrepared();
    const row = getDatabase().prepare(`
      SELECT *
      FROM hardware_gates
      WHERE gate_id = ?
      LIMIT 1
    `).get(gateId) as any;
    return row ? this.mapGate(row) : null;
  }

  listGates(tenantId: string): HardwareGateRecord[] {
    this.assertPrepared();
    const rows = getDatabase().prepare(`
      SELECT *
      FROM hardware_gates
      WHERE tenant_id = ?
      ORDER BY status = 'online' DESC, updated_at DESC
    `).all(tenantId) as any[];
    return rows.map((row) => this.mapGate(row));
  }

  private selectOnlineGate(tenantId: string): HardwareGateRecord | null {
    const rows = getDatabase().prepare(`
      SELECT *
      FROM hardware_gates
      WHERE tenant_id = ? AND status = 'online'
      ORDER BY last_seen_at DESC, updated_at DESC
      LIMIT 1
    `).all(tenantId) as any[];
    return rows[0] ? this.mapGate(rows[0]) : null;
  }

  private selectGate(tenantId: string, gateId?: string): HardwareGateRecord | null {
    if (gateId) {
      const gate = this.getGate(gateId);
      return gate && gate.tenantId === tenantId && gate.status === 'online' ? gate : null;
    }
    return this.selectOnlineGate(tenantId);
  }

  async requestPhysicalConfirmation(input: {
    tenantId: string;
    scope: CommandScope;
    targetId: string;
    commandType: string;
    payload?: Record<string, any>;
    gateId?: string;
    hardwareContext?: HardwareGrantContext;
    actorId: string;
    actorEmail?: string;
    actorIp?: string;
    actionId?: string;
    timeoutMs?: number;
  }): Promise<{
    success: boolean;
    intent: CommandIntentRecord;
    session?: HardwareConfirmationSessionRecord;
    message: string;
    reason?: string;
  }> {
    this.assertPrepared();
    const actionId = input.actionId || randomUUID();
    const now = new Date().toISOString();
    const payload = input.payload || {};
    const payloadHash = hashPayload(payload);
    const riskClass = classifyCommandRisk(input.commandType);
    const requestedBy = input.actorEmail || input.actorId;
    const gate = this.selectGate(input.tenantId, input.gateId);

    getDatabase().prepare(`
      INSERT INTO command_intents (
        action_id, tenant_id, scope, target_id, command_type, risk_class, payload_hash,
        payload_json, status, requested_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_hardware_confirmation', ?, ?, ?)
    `).run(
      actionId,
      input.tenantId,
      input.scope,
      input.targetId,
      input.commandType,
      riskClass,
      payloadHash,
      stableStringify(payload),
      requestedBy,
      now,
      now
    );

    if (!gate) {
      this.updateIntent(actionId, 'failed', { reason: 'hardware_gate_unavailable' });
      const intent = this.getIntent(actionId) as CommandIntentRecord;
      return {
        success: false,
        intent,
        message: 'No online hardware authorization gate is available.',
        reason: 'hardware_gate_unavailable'
      };
    }

    if (!this.gatewayEmitter) {
      this.updateIntent(actionId, 'failed', { reason: 'hardware_gateway_unavailable' });
      const intent = this.getIntent(actionId) as CommandIntentRecord;
      return {
        success: false,
        intent,
        message: 'Hardware authorization gateway is unavailable.',
        reason: 'hardware_gateway_unavailable'
      };
    }

    const sessionId = randomUUID();
    const expiresAt = isoPlusMs(input.timeoutMs || 120_000);
    const prompt = `Confirm ${input.commandType} on ${input.targetId}`;
    const summary = {
      actionId,
      scope: input.scope,
      targetId: input.targetId,
      commandType: input.commandType,
      riskClass,
      payloadHash,
      payloadShortHash: payloadHash.slice(0, 12),
      requestedBy,
      ...(input.hardwareContext || {})
    };

    getDatabase().prepare(`
      INSERT INTO hardware_confirmation_sessions (
        session_id, action_id, tenant_id, gate_id, status, prompt,
        summary_json, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      actionId,
      input.tenantId,
      gate.gateId,
      prompt,
      JSON.stringify(summary),
      expiresAt,
      now,
      now
    );

    getDatabase().prepare(`
      UPDATE command_intents
      SET confirmation_session_id = ?, updated_at = ?
      WHERE action_id = ?
    `).run(sessionId, now, actionId);

    const accepted = await Promise.resolve(this.gatewayEmitter(gate.gateId, 'physical_confirmation_required', {
      gateId: gate.gateId,
      sessionId,
      confirmationSessionId: sessionId,
      actionId,
      tenantId: input.tenantId,
      scope: input.scope,
      targetId: input.targetId,
      commandType: input.commandType,
      payloadHash,
      ...(input.hardwareContext || {}),
      prompt,
      summary,
      expiresAt
    }));

    if (!accepted) {
      this.updateSession(sessionId, 'failed', { reason: 'hardware_gate_rejected_dispatch' });
      this.updateIntent(actionId, 'failed', { reason: 'hardware_gate_rejected_dispatch' });
      return {
        success: false,
        intent: this.getIntent(actionId) as CommandIntentRecord,
        session: this.getConfirmationSession(sessionId) || undefined,
        message: 'Hardware gate rejected the confirmation request.',
        reason: 'hardware_gate_rejected_dispatch'
      };
    }

    try {
      const auditTargetType: 'agent' | 'device' | 'action' = input.scope === 'deployment' ? 'action' : input.scope;
      await auditLogger.log({
        tenantId: input.tenantId,
        eventType: 'hardware_confirmation_requested',
        category: 'command',
        severity: 'warning',
        actor: { type: 'user', id: input.actorId, email: input.actorEmail, ip: input.actorIp },
        target: { type: auditTargetType, id: input.targetId },
        action: input.commandType,
        details: { actionId, sessionId, gateId: gate.gateId, payloadHash },
        status: 'success'
      });
    } catch (error: any) {
      logger.warn('Hardware confirmation audit log unavailable', { error: error?.message });
    }

    return {
      success: true,
      intent: this.getIntent(actionId) as CommandIntentRecord,
      session: this.getConfirmationSession(sessionId) || undefined,
      message: `Command ${input.commandType} is waiting for hardware confirmation.`
    };
  }

  async handlePhysicalConfirmationAck(gateId: string, payload: Record<string, any>): Promise<{
    handled: boolean;
    confirmed: boolean;
    reason?: string;
    intent?: CommandIntentRecord;
    grant?: HardwareGrantRecord;
    session?: HardwareConfirmationSessionRecord;
  }> {
    this.assertPrepared();
    const sessionId = String(payload?.sessionId || payload?.confirmationSessionId || '').trim();
    if (!sessionId) {
      return { handled: false, confirmed: false, reason: 'missing_session_id' };
    }

    const session = this.getConfirmationSession(sessionId);
    if (!session?.intent) {
      return { handled: false, confirmed: false, reason: 'session_not_found' };
    }

    const gate = this.getGate(gateId);
    if (!gate || gate.gateId !== session.gateId) {
      this.rejectSession(sessionId, session.intent.actionId, 'gate_mismatch', payload);
      return { handled: true, confirmed: false, reason: 'gate_mismatch', session };
    }

    const issuedAt = String(payload?.issuedAt || '').trim();
    const expiresAt = String(payload?.expiresAt || '').trim();
    const monotonicCounter = Number(payload?.monotonicCounter);
    // SECURITY FIX: reject non-integer / unsafe-integer counters.
    // Number(1.5) === 1.5 would otherwise pass silently and let an
    // attacker replay a fractional counter that the INTEGER column
    // would round to 1. Also reject anything past MAX_SAFE_INTEGER
    // where integer addition loses precision.
    if (!Number.isFinite(monotonicCounter)
        || !Number.isInteger(monotonicCounter)
        || monotonicCounter > Number.MAX_SAFE_INTEGER
        || monotonicCounter < 0) {
      this.rejectSession(sessionId, session.intent.actionId, 'invalid_monotonic_counter', payload);
      return { handled: true, confirmed: false, reason: 'invalid_monotonic_counter', session };
    }
    const signature = String(payload?.signature || '').trim();
    const grant: HardwareGrantEnvelope = {
      gateId,
      sessionId,
      actionId: session.intent.actionId,
      tenantId: session.intent.tenantId,
      scope: session.intent.scope,
      targetId: session.intent.targetId,
      commandType: session.intent.commandType,
      payloadHash: session.intent.payloadHash,
      policyDigest: String(payload?.policyDigest || ''),
      challenge: String(payload?.challenge || ''),
      breakerTarget: String(payload?.breakerTarget || ''),
      interlockAction: String(payload?.interlockAction || ''),
      issuedAt,
      expiresAt,
      monotonicCounter,
      signature,
      algorithm: gate.algorithm
    };

    const rejection = this.validateGrantPayload({
      session,
      gate,
      grant,
      confirmed: Boolean(payload?.confirmed)
    });
    if (rejection) {
      this.rejectSession(sessionId, session.intent.actionId, rejection, payload);
      return { handled: true, confirmed: false, reason: rejection, session };
    }

    const verified = verifyHardwareGrantSignature(gate.publicKeyPem, grant);
    if (!verified) {
      this.rejectSession(sessionId, session.intent.actionId, 'invalid_signature', payload);
      return { handled: true, confirmed: false, reason: 'invalid_signature', session };
    }

    const now = new Date().toISOString();
    const grantId = randomUUID();
    const grantJson = JSON.stringify(grant);
    getDatabase().prepare(`
      INSERT INTO hardware_grants (
        grant_id, session_id, action_id, tenant_id, gate_id, payload_hash,
        issued_at, expires_at, monotonic_counter, signature, grant_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      grantId,
      sessionId,
      session.intent.actionId,
      session.intent.tenantId,
      gateId,
      session.intent.payloadHash,
      issuedAt,
      expiresAt,
      monotonicCounter,
      signature,
      grantJson,
      now
    );

    getDatabase().prepare(`
      UPDATE hardware_gates
      SET last_monotonic_counter = ?, status = 'online', updated_at = ?, last_seen_at = ?
      WHERE gate_id = ?
    `).run(monotonicCounter, now, now, gateId);

    this.updateSession(sessionId, 'confirmed', { ack: payload, grantId, verified: true });
    this.updateIntent(session.intent.actionId, 'hardware_confirmed', { grantId }, grantId);

    // Force a synchronous flush of the anti-replay high-water mark. Under the
    // sql.js backend the database lives in process memory and is persisted on
    // a 30s interval; without this flush a crash inside that window rolls
    // last_monotonic_counter back and re-opens the replay window for any
    // captured grant that is still inside its expiry.
    getDatabase().save();

    // Mirror the advanced high-water mark into the Postgres shadow store
    // immediately (instead of waiting for the periodic resync) so losing the
    // SQLite base store cannot roll the anti-replay counter back either.
    // Best-effort by design: upsert() no-ops when Postgres is not configured
    // and swallows write errors without affecting the grant decision.
    const gateRow = getDatabase().prepare(
      'SELECT * FROM hardware_gates WHERE gate_id = ?'
    ).get(gateId) as Record<string, unknown> | undefined;
    if (gateRow) {
      void postgresShadowStoreService.upsert('hardware_gates', gateRow);
    }

    const record = this.getGrant(grantId) as HardwareGrantRecord;
    return {
      handled: true,
      confirmed: true,
      intent: this.getIntent(session.intent.actionId) as CommandIntentRecord,
      grant: record,
      session: this.getConfirmationSession(sessionId) || undefined
    };
  }

  private validateGrantPayload(input: {
    session: HardwareConfirmationSessionRecord;
    gate: HardwareGateRecord;
    grant: HardwareGrantEnvelope;
    confirmed: boolean;
  }): string | null {
    if (!input.confirmed) {
      return 'operator_rejected';
    }
    if (!input.grant.signature) {
      return 'missing_signature';
    }
    if (!input.grant.issuedAt || !input.grant.expiresAt) {
      return 'missing_grant_time';
    }
    if (!Number.isFinite(input.grant.monotonicCounter)) {
      return 'invalid_monotonic_counter';
    }
    if (input.grant.monotonicCounter <= input.gate.lastMonotonicCounter) {
      return 'non_increasing_monotonic_counter';
    }
    if (input.grant.expiresAt !== input.session.expiresAt) {
      return 'expires_at_mismatch';
    }
    for (const field of ['policyDigest', 'challenge', 'breakerTarget', 'interlockAction'] as const) {
      const expected = String(input.session.summary?.[field] || '');
      const actual = String(input.grant[field] || '');
      if (expected && actual !== expected) {
        return `${field}_mismatch`;
      }
    }
    const sessionExpiresAtMs = new Date(input.session.expiresAt).getTime();
    // Fail closed on an unparseable expiry: Date.now() > NaN is false, which
    // would otherwise treat a malformed session.expiresAt as not-expired.
    if (!Number.isFinite(sessionExpiresAtMs) || Date.now() > sessionExpiresAtMs) {
      return 'session_expired';
    }
    return null;
  }

  getIntent(actionId: string): CommandIntentRecord | null {
    this.assertPrepared();
    const row = getDatabase().prepare(`
      SELECT *
      FROM command_intents
      WHERE action_id = ?
      LIMIT 1
    `).get(actionId) as any;
    return row ? this.mapIntent(row) : null;
  }

  getConfirmationSession(sessionId: string): HardwareConfirmationSessionRecord | null {
    this.assertPrepared();
    const row = getDatabase().prepare(`
      SELECT *
      FROM hardware_confirmation_sessions
      WHERE session_id = ?
      LIMIT 1
    `).get(sessionId) as any;
    if (!row) {
      return null;
    }
    const session = this.mapSession(row);
    session.intent = this.getIntent(session.actionId) || undefined;
    return session;
  }

  getGrant(grantId: string): HardwareGrantRecord | null {
    this.assertPrepared();
    const row = getDatabase().prepare(`
      SELECT *
      FROM hardware_grants
      WHERE grant_id = ?
      LIMIT 1
    `).get(grantId) as any;
    return row ? this.mapGrant(row) : null;
  }

  completeIntent(actionId: string, success: boolean, result: Record<string, any>): void {
    this.assertPrepared();
    this.updateIntent(actionId, success ? 'completed' : 'failed', result);
  }

  private rejectSession(sessionId: string, actionId: string, reason: string, payload: Record<string, any>): void {
    this.updateSession(sessionId, reason === 'session_expired' ? 'expired' : 'rejected', { reason, ack: payload });
    this.updateIntent(actionId, reason === 'session_expired' ? 'expired' : 'rejected', { reason, ack: payload });
    // PRD §7: every authorization decision (including rejections / fail-closed
    // triggers) must leave a tamper-evident audit event, not just a DB column.
    this.auditRejection(sessionId, actionId, reason, payload);
  }

  private auditRejection(sessionId: string, actionId: string, reason: string, payload: Record<string, any>): void {
    const intent = this.getIntent(actionId);
    const session = this.getConfirmationSession(sessionId);
    const severity: 'warning' | 'critical' =
      reason === 'invalid_signature' || reason === 'monotonic_counter_rollback' || reason === 'policy_digest_mismatch'
        ? 'critical'
        : 'warning';
    auditLogger.log({
      tenantId: intent?.tenantId || session?.tenantId || PLATFORM_TENANT_ID,
      eventType: 'hardware_confirmation_rejected',
      category: 'command',
      severity,
      actor: { type: 'user', id: intent?.requestedBy || 'unknown' },
      target: { type: 'action', id: actionId },
      action: intent?.commandType || 'hardware_grant',
      details: { actionId, sessionId, gateId: session?.gateId, reason, ackSummary: this.summarizeAck(payload) },
      status: 'failure'
    }).catch((error: any) => {
      logger.warn('Hardware confirmation rejection audit log unavailable', { actionId, reason, error: error?.message });
    });
  }

  private summarizeAck(payload: Record<string, any>): Record<string, any> {
    // Avoid logging full grant envelopes; surface only the fields useful for forensics.
    const { gateId, sessionId, actionId, commandType, monotonicCounter, expiresAt } = payload || {};
    return { gateId, sessionId, actionId, commandType, monotonicCounter, expiresAt };
  }

  private updateSession(sessionId: string, status: string, result?: Record<string, any>): void {
    getDatabase().prepare(`
      UPDATE hardware_confirmation_sessions
      SET status = ?, result_json = ?, updated_at = ?
      WHERE session_id = ?
    `).run(status, result ? JSON.stringify(result) : null, new Date().toISOString(), sessionId);
  }

  private updateIntent(
    actionId: string,
    status: CommandIntentStatus,
    result?: Record<string, any>,
    grantId?: string
  ): void {
    getDatabase().prepare(`
      UPDATE command_intents
      SET status = ?, result_json = ?, grant_id = COALESCE(?, grant_id), updated_at = ?
      WHERE action_id = ?
    `).run(status, result ? JSON.stringify(result) : null, grantId || null, new Date().toISOString(), actionId);
  }

  private mapGate(row: any): HardwareGateRecord {
    return {
      gateId: String(row.gate_id),
      tenantId: String(row.tenant_id),
      displayName: String(row.display_name || row.gate_id),
      publicKeyPem: String(row.public_key_pem || ''),
      algorithm: String(row.algorithm || 'ECDSA_P256_SHA256'),
      status: String(row.status || 'enrolled') as HardwareGateStatus,
      lastMonotonicCounter: Number(row.last_monotonic_counter || 0),
      metadata: parseJson(row.metadata_json, {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      lastSeenAt: row.last_seen_at || undefined
    };
  }

  private mapIntent(row: any): CommandIntentRecord {
    return {
      actionId: String(row.action_id),
      tenantId: String(row.tenant_id),
      scope: String(row.scope) as CommandScope,
      targetId: String(row.target_id),
      commandType: String(row.command_type),
      riskClass: String(row.risk_class) as RiskClass,
      payload: parseJson(row.payload_json, {}),
      payloadHash: String(row.payload_hash),
      status: String(row.status) as CommandIntentStatus,
      requestedBy: String(row.requested_by),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      confirmationSessionId: row.confirmation_session_id || undefined,
      grantId: row.grant_id || undefined,
      result: parseJson(row.result_json, undefined as any)
    };
  }

  private mapSession(row: any): HardwareConfirmationSessionRecord {
    return {
      sessionId: String(row.session_id),
      actionId: String(row.action_id),
      tenantId: String(row.tenant_id),
      gateId: String(row.gate_id),
      status: String(row.status),
      prompt: String(row.prompt),
      summary: parseJson(row.summary_json, {}),
      expiresAt: String(row.expires_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      result: parseJson(row.result_json, undefined as any)
    };
  }

  private mapGrant(row: any): HardwareGrantRecord {
    return {
      grantId: String(row.grant_id),
      sessionId: String(row.session_id),
      actionId: String(row.action_id),
      tenantId: String(row.tenant_id),
      gateId: String(row.gate_id),
      payloadHash: String(row.payload_hash),
      issuedAt: String(row.issued_at),
      expiresAt: String(row.expires_at),
      monotonicCounter: Number(row.monotonic_counter),
      signature: String(row.signature),
      grant: parseJson(row.grant_json, {}) as HardwareGrantEnvelope,
      createdAt: String(row.created_at)
    };
  }
}

export const hardwareAuthorizationService = new HardwareAuthorizationService();
