import { randomUUID } from 'crypto';
import { getDatabase } from '../config/database';
import {
  BridgeState,
  computeFinalDefensePolicyDigest,
  FinalDefenseAllowedAction,
  FinalDefensePolicyStatus,
  GatewayMgmtPath,
  GatewayProtectionMode,
  InterlockState,
  normalizeBridgeState,
  normalizeGatewayMgmtPath,
  normalizeInterlockState
} from '../security/final-defense-policy';
import { hardwareAuthorizationService } from './hardware-authorization.service';
import { GatewayDaemon, type GatewayDaemonOptions } from '../companion/gateway-daemon';

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
  gatewayProtectionMode: GatewayProtectionMode;
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

export interface RootResistantGatewayStatus {
  gatewayProtectionMode: 'external_network_gateway';
  gatewayId: string;
  tenantId: string;
  policyDigest?: string;
  reportedPolicyDigest?: string;
  firmwareDigest?: string;
  bridgeState: BridgeState;
  serverPortLink: boolean;
  lanPortLink: boolean;
  mgmtPath: GatewayMgmtPath;
  secureElementPresent: boolean;
  gatewayOnline: boolean;
  lastHeartbeatAt?: string;
  lastAttestationAt?: string;
  isolationReason?: string;
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

// PRD §4.4 fail-closed trigger #7 mandates isolation when a controller
// heartbeat is lost for > 45 seconds. Treat a gateway/companion as stale
// past that window so root-resistant-active reflects the PRD threshold
// (the previous 90s value was a 2x fail-open drift).
const HEARTBEAT_STALE_MS = 45_000;

function stale(lastHeartbeatAt?: string): boolean {
  if (!lastHeartbeatAt) {
    return true;
  }
  const lastMs = new Date(lastHeartbeatAt).getTime();
  // Fail closed on an unparseable timestamp: Date.now() - NaN is NaN and
  // NaN > STALE is false, which would report an unknown heartbeat as
  // fresh/online. An unparseable heartbeat is treated as stale, consistent
  // with a missing one.
  if (!Number.isFinite(lastMs)) {
    return true;
  }
  return Date.now() - lastMs > HEARTBEAT_STALE_MS;
}

const ROOT_RESISTANT_REQUIRED_COMMANDS = new Set([
  'host_remove',
  'host_uninstall',
  'uninstall',
  'remove_agent',
  'wipe_data',
  'wipe',
  'delete_data',
  'purge_data',
  'factory_reset',
  'recovery_flash',
  'firmware_flash',
  'ota_update',
  'deploy_bundle',
  'diagnostic_unlock',
  'critical_config_change'
]);

const ROOT_RESISTANT_GATEWAY_ACTIONS = new Set(['isolate', 'arm', 'release_temporary', 'attest']);

function normalizeGatewayAction(value: unknown): string {
  return String(value || '').trim().replace(/-/g, '_').toLowerCase();
}

function independentMgmtPath(value: GatewayMgmtPath): boolean {
  return value === 'dedicated_mgmt' || value === 'cellular';
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

      CREATE TABLE IF NOT EXISTS root_resistant_gateways (
        gateway_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        policy_digest TEXT,
        reported_policy_digest TEXT,
        firmware_digest TEXT,
        bridge_state TEXT NOT NULL,
        server_port_link INTEGER NOT NULL DEFAULT 0,
        lan_port_link INTEGER NOT NULL DEFAULT 0,
        mgmt_path TEXT NOT NULL,
        secure_element_present INTEGER NOT NULL DEFAULT 0,
        gateway_online INTEGER NOT NULL DEFAULT 0,
        last_heartbeat_at TEXT,
        last_attestation_at TEXT,
        isolation_reason TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_root_resistant_gateways_tenant
        ON root_resistant_gateways(tenant_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_root_resistant_gateways_state
        ON root_resistant_gateways(tenant_id, bridge_state, updated_at DESC);
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
    /**
     * SECURITY (V12.26): optimistic-concurrency guard. When supplied on
     * an UPDATE (i.e. policyId is set and a row already exists), the
     * caller asserts it knows the CURRENT stored digest. If the stored
     * digest no longer matches (another writer updated the policy in
     * the meantime), the upsert is refused with `policy_digest_conflict`
     * so the caller re-reads and retries instead of silently clobbering
     * the intervening change.
     */
    expectedPolicyDigest?: string;
  }): FinalDefensePolicyRecord {
    this.assertPrepared();
    const now = isoNow();
    const policyId = input.policyId || randomUUID();
    const createdAt = input.createdAt || now;
    const status = input.status || 'active';
    const requestedReleaseTtlMs = Number(input.releaseTtlMs);
    const releaseTtlMsInput = Number.isFinite(requestedReleaseTtlMs) ? requestedReleaseTtlMs : 120_000;
    const releaseTtlMs = Math.max(5_000, Math.min(releaseTtlMsInput, 15 * 60_000));

    // SECURITY (V12.26): if this is an update AND the caller supplied an
    // expected digest, verify the stored row still matches. A mismatch
    // means another writer won the race — refuse rather than overwrite.
    if (input.policyId && typeof input.expectedPolicyDigest === 'string') {
      const existing = this.getPolicy(input.policyId);
      if (existing && existing.policyDigest !== input.expectedPolicyDigest) {
        throw new Error(
          `policy_digest_conflict: expected ${input.expectedPolicyDigest}, `
          + `stored ${existing.policyDigest}`
        );
      }
    }

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

  reportRootResistantGatewayStatus(input: {
    tenantId: string;
    gatewayId: string;
    policyDigest?: string;
    reportedPolicyDigest?: string;
    firmwareDigest?: string;
    bridgeState?: string;
    serverPortLink?: boolean;
    lanPortLink?: boolean;
    mgmtPath?: string;
    secureElementPresent?: boolean;
    lastAttestationAt?: string;
    isolationReason?: string;
    lastError?: string;
  }): RootResistantGatewayStatus {
    this.assertPrepared();
    const now = isoNow();
    const existing = this.getRootResistantGatewayStatus(input.gatewayId);
    const policyDigest = input.policyDigest || existing?.policyDigest || null;
    const reportedPolicyDigest = input.reportedPolicyDigest || existing?.reportedPolicyDigest || null;
    const firmwareDigest = input.firmwareDigest || existing?.firmwareDigest || null;
    const lastAttestationAt = input.lastAttestationAt || existing?.lastAttestationAt || null;

    getDatabase().prepare(`
      INSERT INTO root_resistant_gateways (
        gateway_id, tenant_id, policy_digest, reported_policy_digest, firmware_digest,
        bridge_state, server_port_link, lan_port_link, mgmt_path, secure_element_present,
        gateway_online, last_heartbeat_at, last_attestation_at, isolation_reason, last_error,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(gateway_id) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        policy_digest = excluded.policy_digest,
        reported_policy_digest = excluded.reported_policy_digest,
        firmware_digest = excluded.firmware_digest,
        bridge_state = excluded.bridge_state,
        server_port_link = excluded.server_port_link,
        lan_port_link = excluded.lan_port_link,
        mgmt_path = excluded.mgmt_path,
        secure_element_present = excluded.secure_element_present,
        gateway_online = 1,
        last_heartbeat_at = excluded.last_heartbeat_at,
        last_attestation_at = excluded.last_attestation_at,
        isolation_reason = excluded.isolation_reason,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).run(
      input.gatewayId,
      input.tenantId,
      policyDigest,
      reportedPolicyDigest,
      firmwareDigest,
      normalizeBridgeState(input.bridgeState),
      input.serverPortLink ? 1 : 0,
      input.lanPortLink ? 1 : 0,
      normalizeGatewayMgmtPath(input.mgmtPath),
      input.secureElementPresent ? 1 : 0,
      now,
      lastAttestationAt,
      input.isolationReason || null,
      input.lastError || null,
      existing?.createdAt || now,
      now
    );

    return this.getRootResistantGatewayStatus(input.gatewayId) as RootResistantGatewayStatus;
  }

  getRootResistantGatewayStatus(gatewayId: string): RootResistantGatewayStatus | null {
    this.assertPrepared();
    const row = getDatabase().prepare(`
      SELECT *
      FROM root_resistant_gateways
      WHERE gateway_id = ?
      LIMIT 1
    `).get(gatewayId) as any;
    return row ? this.mapRootResistantGateway(row) : null;
  }

  listRootResistantGateways(tenantId: string): RootResistantGatewayStatus[] {
    this.assertPrepared();
    const rows = getDatabase().prepare(`
      SELECT *
      FROM root_resistant_gateways
      WHERE tenant_id = ?
      ORDER BY updated_at DESC
    `).all(tenantId) as any[];
    return rows.map((row) => this.mapRootResistantGateway(row));
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
    const normalizedCommand = normalizeGatewayAction(input.commandType);
    if (ROOT_RESISTANT_REQUIRED_COMMANDS.has(normalizedCommand) && !this.hasActiveRootResistantGateway(input.tenantId)) {
      return {
        success: false,
        message: 'A root-resistant external network gateway must be active before this high-risk action can be requested.',
        reason: 'root_resistant_gateway_unavailable'
      };
    }

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

  async requestGatewayAction(input: {
    tenantId: string;
    gatewayId: string;
    action: string;
    actorId: string;
    actorEmail?: string;
    actorIp?: string;
    payload?: Record<string, any>;
    challenge?: string;
  }) {
    this.assertPrepared();
    const action = normalizeGatewayAction(input.action);
    if (!ROOT_RESISTANT_GATEWAY_ACTIONS.has(action)) {
      return {
        success: false,
        message: `Gateway action ${input.action} is not allowed by the root-resistant gateway policy.`,
        reason: 'root_gateway_action_not_allowed'
      };
    }

    const status = this.getRootResistantGatewayStatus(input.gatewayId);
    if (!status || status.tenantId !== input.tenantId) {
      return {
        success: false,
        message: 'Root-resistant external network gateway is not configured for this tenant.',
        reason: 'root_gateway_not_configured'
      };
    }

    if (action === 'release_temporary' && !status.active) {
      return {
        success: false,
        message: 'Temporary bridge release requires a healthy root-resistant gateway state.',
        reason: 'root_gateway_degraded'
      };
    }

    const challenge = input.challenge || randomUUID();
    const interlockAction = action === 'isolate'
      ? 'bridge_isolate'
      : action === 'arm'
        ? 'bridge_arm'
        : action === 'attest'
          ? 'gateway_attest'
          : 'bridge_release_temporary';
    const breakerTarget = 'server-lan-transparent-bridge';
    const payload = {
      ...(input.payload || {}),
      gatewayId: input.gatewayId,
      gatewayMode: 'external_network_gateway',
      policyDigest: status.policyDigest || '',
      firmwareDigest: status.firmwareDigest || '',
      bridgeState: status.bridgeState,
      challenge,
      breakerTarget,
      interlockAction
    };

    return hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: input.tenantId,
      scope: 'device',
      targetId: input.gatewayId,
      commandType: action,
      gateId: input.gatewayId,
      payload,
      hardwareContext: {
        policyDigest: status.policyDigest || '',
        challenge,
        breakerTarget,
        interlockAction
      },
      actorId: input.actorId,
      actorEmail: input.actorEmail,
      actorIp: input.actorIp
    });
  }

  /**
   * Construct the appliance-side GatewayDaemon for a registered root-resistant
   * gateway, resolving its provisioned Secure Element public key from the
   * enrolled gate. Returns null when the gateway/gate is unknown or has no
   * provisioned key, so callers can degrade without throwing.
   *
   * This is the seam the appliance integration binds to: instantiate per
   * gateway, feed controller WebSocket frames into daemon.handleControllerFrame,
   * and route verified releases through daemon.requestRelease. The control-plane
   * confirmation loop (requestGatewayAction) is unchanged; the daemon is the
   * physical enforcement point that consumes its verified grants.
   */
  createGatewayDaemon(
    gatewayId: string,
    extra?: Partial<GatewayDaemonOptions>
  ): GatewayDaemon | null {
    this.assertPrepared();
    const status = this.getRootResistantGatewayStatus(gatewayId);
    if (!status) {
      return null;
    }
    const gate = hardwareAuthorizationService.getGate(gatewayId);
    if (!gate || !gate.publicKeyPem) {
      return null;
    }
    return new GatewayDaemon({
      gatewayId,
      secureElementPublicKeyPem: gate.publicKeyPem,
      breakerTarget: 'server-lan-transparent-bridge',
      policyDigest: status.policyDigest,
      ...extra
    });
  }

  private hasActiveRootResistantGateway(tenantId: string): boolean {
    return this.listRootResistantGateways(tenantId).some((gateway) => gateway.active);
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

  private rootResistantGatewayDegradedReasons(row: any): string[] {
    const reasons: string[] = [];
    if (stale(row.last_heartbeat_at)) {
      reasons.push('gateway_stale');
    }
    if (!asBoolean(row.gateway_online)) {
      reasons.push('gateway_offline');
    }
    if (!asBoolean(row.secure_element_present)) {
      reasons.push('secure_element_missing');
    }
    if (!row.policy_digest || row.reported_policy_digest !== row.policy_digest) {
      reasons.push('policy_digest_mismatch');
    }
    if (!row.firmware_digest) {
      reasons.push('firmware_digest_missing');
    }
    if (!row.last_attestation_at) {
      reasons.push('attestation_missing');
    }
    if (!asBoolean(row.server_port_link)) {
      reasons.push('server_port_link_down');
    }
    if (!asBoolean(row.lan_port_link)) {
      reasons.push('lan_port_link_down');
    }
    if (!independentMgmtPath(normalizeGatewayMgmtPath(row.mgmt_path))) {
      reasons.push('mgmt_path_not_independent');
    }
    const state = normalizeBridgeState(row.bridge_state);
    if (state !== 'armed' && state !== 'isolated') {
      reasons.push(`bridge_${state}`);
    }
    if (row.isolation_reason) {
      reasons.push('isolation_active');
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
      gatewayProtectionMode: 'host_companion_gate',
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

  private mapRootResistantGateway(row: any): RootResistantGatewayStatus {
    const degradedReasons = this.rootResistantGatewayDegradedReasons(row);
    return {
      gatewayProtectionMode: 'external_network_gateway',
      gatewayId: String(row.gateway_id),
      tenantId: String(row.tenant_id),
      policyDigest: row.policy_digest || undefined,
      reportedPolicyDigest: row.reported_policy_digest || undefined,
      firmwareDigest: row.firmware_digest || undefined,
      bridgeState: normalizeBridgeState(row.bridge_state),
      serverPortLink: asBoolean(row.server_port_link),
      lanPortLink: asBoolean(row.lan_port_link),
      mgmtPath: normalizeGatewayMgmtPath(row.mgmt_path),
      secureElementPresent: asBoolean(row.secure_element_present),
      gatewayOnline: asBoolean(row.gateway_online) && !stale(row.last_heartbeat_at),
      lastHeartbeatAt: row.last_heartbeat_at || undefined,
      lastAttestationAt: row.last_attestation_at || undefined,
      isolationReason: row.isolation_reason || undefined,
      lastError: row.last_error || undefined,
      active: degradedReasons.length === 0,
      degradedReasons,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }
}

export const finalDefenseService = new FinalDefenseService();
