import { Pool } from 'pg';
import { getDatabase } from '../config/database';
import { getDatabaseMode } from '../config/platform-runtime';
import logger from '../utils/logger';

type ShadowTable =
  | 'audit_log'
  | 'users'
  | 'sites'
  | 'devices'
  | 'agents'
  | 'api_keys'
  | 'agent_registrations'
  | 'agent_onboarding_codes'
  | 'agent_credentials_audit'
  | 'deployment_profiles'
  | 'platform_config'
  | 'ai_endpoints'
  | 'notification_deliveries'
  | 'audit_segments'
  | 'benchmark_runs'
  | 'admin_dispute_exports'
  | 'scan_tasks'
  | 'scan_events'
  | 'scan_findings'
  | 'scan_profiles'
  | 'scan_runs'
  | 'scan_run_targets'
  | 'scan_run_stages'
  | 'scan_evidence'
  | 'scan_services'
  | 'scan_target_assets'
  | 'sec_assets'
  | 'sec_findings'
  | 'sec_alerts'
  | 'sec_actions'
  | 'sec_validations'
  | 'sec_traffic_sessions'
  | 'hardware_gates'
  | 'command_intents'
  | 'hardware_confirmation_sessions'
  | 'hardware_grants';

interface TableConfig {
  conflict: string[];
  ddl: string;
  backfill?: 'upsert' | 'replace';
}

const TABLES: Record<ShadowTable, TableConfig> = {
  audit_log: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        tenant_id TEXT,
        event_type TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_email TEXT,
        actor_ip TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        details_json TEXT NOT NULL,
        status TEXT NOT NULL,
        signature TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_audit_log_tenant_time ON audit_log(tenant_id, timestamp DESC);
    `,
    backfill: 'upsert'
  },
  users: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT,
        plan TEXT,
        tenant_id TEXT,
        status TEXT,
        last_login TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_users_tenant ON users(tenant_id, created_at DESC);
    `,
    backfill: 'replace'
  },
  sites: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS sites (
        id BIGINT PRIMARY KEY,
        domain TEXT UNIQUE NOT NULL,
        target TEXT NOT NULL,
        "sslEnabled" INTEGER,
        "antiBotEnabled" INTEGER,
        "rateLimitEnabled" INTEGER,
        "rateLimitRequests" INTEGER,
        "concurrencyEnabled" INTEGER,
        "concurrencyMax" INTEGER,
        tenant_id TEXT,
        "createdAt" TEXT,
        "updatedAt" TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_sites_tenant ON sites(tenant_id, "updatedAt" DESC);
    `,
    backfill: 'replace'
  },
  devices: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        device_type TEXT,
        mac_address TEXT,
        firmware_version TEXT,
        status TEXT,
        last_seen TEXT,
        config TEXT,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_devices_status ON devices(status, last_seen DESC);
    `,
    backfill: 'replace'
  },
  agents: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        hostname TEXT NOT NULL,
        platform TEXT,
        arch TEXT,
        version TEXT,
        "lastHeartbeat" TEXT,
        status TEXT,
        "createdAt" TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_agents_status ON agents(status, "lastHeartbeat" DESC);
    `,
    backfill: 'replace'
  },
  api_keys: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key_hash TEXT,
        user_id TEXT,
        tenant_id TEXT,
        permissions TEXT,
        last_used TEXT,
        expires_at TEXT,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_api_keys_tenant ON api_keys(tenant_id, created_at DESC);
    `,
    backfill: 'replace'
  },
  agent_registrations: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS agent_registrations (
        id BIGINT PRIMARY KEY,
        agent_id TEXT UNIQUE NOT NULL,
        hostname TEXT NOT NULL,
        api_key_hash TEXT NOT NULL,
        secret_key TEXT NOT NULL,
        fingerprint TEXT,
        platform TEXT,
        status TEXT,
        created_at TEXT,
        last_seen_at TEXT,
        tenant_id TEXT
      );
      ALTER TABLE agent_registrations ADD COLUMN IF NOT EXISTS tenant_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_shadow_agent_regs_status ON agent_registrations(status, last_seen_at DESC);
      CREATE INDEX IF NOT EXISTS idx_shadow_agent_regs_tenant ON agent_registrations(tenant_id, created_at DESC);
    `,
    backfill: 'replace'
  },
  agent_onboarding_codes: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS agent_onboarding_codes (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        tenant_id TEXT,
        created_by TEXT NOT NULL,
        max_uses INTEGER NOT NULL DEFAULT 1,
        used_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        expected_hostname TEXT,
        expected_tags_json TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        used_at TEXT,
        used_by_agent_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_onboarding_codes_tenant ON agent_onboarding_codes(tenant_id, created_at DESC);
    `,
    backfill: 'replace'
  },
  agent_credentials_audit: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS agent_credentials_audit (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        action TEXT NOT NULL,
        operator_id TEXT,
        reason TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_agent_creds_audit_agent ON agent_credentials_audit(agent_id, created_at DESC);
    `,
    backfill: 'replace'
  },
  deployment_profiles: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS deployment_profiles (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        site_id TEXT,
        server_type TEXT NOT NULL,
        name TEXT,
        profile_json TEXT NOT NULL,
        config_text TEXT NOT NULL,
        env_snippet TEXT NOT NULL,
        checksum TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_deployment_profiles_tenant ON deployment_profiles(tenant_id, created_at DESC);
    `,
    backfill: 'replace'
  },
  platform_config: {
    conflict: ['tenant_id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS platform_config (
        tenant_id TEXT PRIMARY KEY,
        anti_bot_enabled INTEGER NOT NULL,
        anti_bot_request_threshold INTEGER NOT NULL,
        anti_bot_fast_request_threshold INTEGER NOT NULL,
        anti_bot_block_duration INTEGER NOT NULL,
        rate_limit_requests_per_minute INTEGER NOT NULL,
        rate_limit_window_seconds INTEGER NOT NULL,
        notifications_json TEXT NOT NULL DEFAULT '{}',
        ai_routing_json TEXT NOT NULL DEFAULT '{}',
        privacy_mode TEXT NOT NULL DEFAULT 'off',
        audit_archive_json TEXT NOT NULL DEFAULT '{}',
        fastpath_json TEXT NOT NULL DEFAULT '{}',
        detection_pipeline_json TEXT NOT NULL DEFAULT '{}',
        deployment_defaults_json TEXT NOT NULL DEFAULT '{}',
        device_gateway_json TEXT NOT NULL DEFAULT '{}',
        updated_by TEXT,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS notifications_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS ai_routing_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS privacy_mode TEXT NOT NULL DEFAULT 'off';
      ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS audit_archive_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS fastpath_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS detection_pipeline_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS deployment_defaults_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS device_gateway_json TEXT NOT NULL DEFAULT '{}';
    `,
    backfill: 'replace'
  },
  ai_endpoints: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS ai_endpoints (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        model_name TEXT NOT NULL,
        api_key TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 10,
        timeout INTEGER NOT NULL DEFAULT 15000,
        type TEXT NOT NULL DEFAULT 'custom',
        purpose TEXT NOT NULL DEFAULT 'deep_analysis',
        last_test_json TEXT,
        created_by TEXT,
        updated_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      ALTER TABLE ai_endpoints ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'deep_analysis';
      CREATE INDEX IF NOT EXISTS idx_shadow_ai_endpoints_tenant_priority ON ai_endpoints(tenant_id, priority ASC, updated_at DESC);
    `,
    backfill: 'replace'
  },
  notification_deliveries: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        alert_id TEXT,
        channel_id TEXT NOT NULL,
        channel_type TEXT NOT NULL,
        channel_label TEXT NOT NULL,
        status TEXT NOT NULL,
        severity TEXT NOT NULL,
        target TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        response_json TEXT,
        error TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 1,
        dedupe_key TEXT,
        next_attempt_at TEXT,
        terminal_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
      ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS next_attempt_at TEXT;
      ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS terminal_at TEXT;
      CREATE INDEX IF NOT EXISTS idx_shadow_notification_deliveries_tenant ON notification_deliveries(tenant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_shadow_notification_deliveries_due ON notification_deliveries(status, next_attempt_at, created_at);
    `,
    backfill: 'replace'
  },
  audit_segments: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS audit_segments (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        segment_key TEXT NOT NULL,
        chain_hash TEXT NOT NULL,
        object_key TEXT,
        lock_mode TEXT NOT NULL DEFAULT 'hash_chain',
        status TEXT NOT NULL DEFAULT 'pending',
        version_id TEXT,
        retention_until TEXT,
        object_lock_enabled INTEGER NOT NULL DEFAULT 0,
        verify_status TEXT NOT NULL DEFAULT 'pending',
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        verified_at TEXT
      );
      ALTER TABLE audit_segments ADD COLUMN IF NOT EXISTS version_id TEXT;
      ALTER TABLE audit_segments ADD COLUMN IF NOT EXISTS retention_until TEXT;
      ALTER TABLE audit_segments ADD COLUMN IF NOT EXISTS object_lock_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE audit_segments ADD COLUMN IF NOT EXISTS verify_status TEXT NOT NULL DEFAULT 'pending';
      CREATE INDEX IF NOT EXISTS idx_shadow_audit_segments_tenant ON audit_segments(tenant_id, created_at DESC);
    `,
    backfill: 'replace'
  },
  benchmark_runs: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS benchmark_runs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        scenario TEXT NOT NULL,
        qps DOUBLE PRECISION,
        p95_latency_ms DOUBLE PRECISION,
        agent_cpu_pct DOUBLE PRECISION,
        agent_memory_mb DOUBLE PRECISION,
        local_ai_latency_ms DOUBLE PRECISION,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_benchmark_runs_tenant ON benchmark_runs(tenant_id, created_at DESC);
    `,
    backfill: 'replace'
  },
  admin_dispute_exports: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS admin_dispute_exports (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        filters_json TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        json_payload TEXT NOT NULL,
        csv_payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_admin_exports_tenant ON admin_dispute_exports(tenant_id, requested_at DESC);
    `,
    backfill: 'replace'
  },
  scan_tasks: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS scan_tasks (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        progress INTEGER NOT NULL,
        engine_policy TEXT NOT NULL,
        targets_json TEXT NOT NULL,
        summary_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_scan_tasks_tenant_status ON scan_tasks(tenant_id, status, created_at DESC);
    `,
    backfill: 'upsert'
  },
  scan_events: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS scan_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_scan_events_task ON scan_events(task_id, created_at DESC);
    `,
    backfill: 'upsert'
  },
  scan_findings: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS scan_findings (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        evidence_json TEXT,
        source_engine TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_scan_findings_task ON scan_findings(task_id, severity, created_at DESC);
    `,
    backfill: 'upsert'
  },
  scan_profiles: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS scan_profiles (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        engines_json TEXT NOT NULL,
        port_set_json TEXT NOT NULL,
        template_set_json TEXT NOT NULL,
        timeout_policy_json TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
    backfill: 'upsert'
  },
  scan_runs: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS scan_runs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        progress INTEGER NOT NULL,
        engine_policy TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        request_json TEXT NOT NULL,
        summary_json TEXT,
        error TEXT,
        queue_position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_scan_runs_tenant_status ON scan_runs(tenant_id, status, created_at DESC);
    `,
    backfill: 'upsert'
  },
  scan_run_targets: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS scan_run_targets (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        raw_value TEXT NOT NULL,
        normalized_value TEXT NOT NULL,
        display_label TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_scan_run_targets_run ON scan_run_targets(run_id, status, updated_at DESC);
    `,
    backfill: 'upsert'
  },
  scan_run_stages: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS scan_run_stages (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        stage_key TEXT NOT NULL,
        stage_label TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL,
        detail TEXT,
        error TEXT,
        started_at TEXT,
        completed_at TEXT,
        duration_ms INTEGER,
        metadata_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_scan_run_stages_run ON scan_run_stages(run_id, stage_key);
    `,
    backfill: 'upsert'
  },
  scan_evidence: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS scan_evidence (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        target_id TEXT,
        asset_id TEXT,
        engine TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        raw_ref TEXT,
        details_json TEXT,
        collected_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_scan_evidence_run ON scan_evidence(run_id, severity, collected_at DESC);
    `,
    backfill: 'upsert'
  },
  scan_services: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS scan_services (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        target_id TEXT,
        asset_id TEXT,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        protocol TEXT NOT NULL,
        service TEXT,
        banner TEXT,
        tls_summary_json TEXT,
        metadata_json TEXT,
        discovered_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_scan_services_run ON scan_services(run_id, host, port);
    `,
    backfill: 'upsert'
  },
  scan_target_assets: {
    conflict: ['id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS scan_target_assets (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_scan_target_assets_run ON scan_target_assets(run_id, target_id);
    `,
    backfill: 'upsert'
  },
  sec_assets: {
    conflict: ['asset_key'],
    ddl: `
      CREATE TABLE IF NOT EXISTS sec_assets (
        asset_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        asset_key TEXT NOT NULL UNIQUE,
        asset_type TEXT NOT NULL,
        external_ref TEXT NOT NULL,
        display_name TEXT NOT NULL,
        primary_address TEXT,
        status TEXT NOT NULL,
        risk_score INTEGER NOT NULL DEFAULT 0,
        findings_open INTEGER NOT NULL DEFAULT 0,
        alerts_open INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_sec_assets_tenant_type ON sec_assets(tenant_id, asset_type, updated_at DESC);
    `,
    backfill: 'upsert'
  },
  sec_findings: {
    conflict: ['fingerprint'],
    ddl: `
      CREATE TABLE IF NOT EXISTS sec_findings (
        finding_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        asset_id TEXT,
        source_type TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        target TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        evidence_json TEXT,
        remediation_json TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_sec_findings_tenant ON sec_findings(tenant_id, status, severity, updated_at DESC);
    `,
    backfill: 'upsert'
  },
  sec_alerts: {
    conflict: ['alert_id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS sec_alerts (
        alert_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        finding_id TEXT,
        asset_id TEXT,
        source_type TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        status TEXT NOT NULL,
        investigation_id TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_sec_alerts_tenant ON sec_alerts(tenant_id, status, severity, updated_at DESC);
    `,
    backfill: 'upsert'
  },
  sec_actions: {
    conflict: ['action_id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS sec_actions (
        action_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        asset_id TEXT,
        finding_id TEXT,
        alert_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        operator TEXT NOT NULL,
        rollback_notes TEXT,
        run_log_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_sec_actions_tenant ON sec_actions(tenant_id, status, updated_at DESC);
    `,
    backfill: 'upsert'
  },
  sec_validations: {
    conflict: ['validation_run_id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS sec_validations (
        validation_run_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        attack_id TEXT NOT NULL,
        attack_name TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        verdict TEXT NOT NULL,
        detected INTEGER NOT NULL,
        blocked INTEGER NOT NULL,
        response_time INTEGER NOT NULL,
        result_json TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_sec_validations_tenant ON sec_validations(tenant_id, completed_at DESC);
    `
  },
  sec_traffic_sessions: {
    conflict: ['session_id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS sec_traffic_sessions (
        session_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        source_ip TEXT NOT NULL,
        dest_ip TEXT NOT NULL,
        source_port INTEGER NOT NULL,
        dest_port INTEGER NOT NULL,
        protocol TEXT NOT NULL,
        state TEXT NOT NULL,
        packet_count INTEGER NOT NULL,
        byte_count INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        last_activity TEXT NOT NULL,
        source_asset_id TEXT,
        dest_asset_id TEXT,
        metadata_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_sec_traffic_sessions_tenant ON sec_traffic_sessions(tenant_id, last_activity DESC);
    `,
    backfill: 'upsert'
  },
  // Hardware authorization chain (Final Defense). hardware_gates carries the
  // anti-replay high-water mark (last_monotonic_counter); in DB_MODE=postgres
  // production these tables must survive loss of the SQLite base store, so
  // they are part of the shadow snapshot like the audit log.
  hardware_gates: {
    conflict: ['gate_id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS hardware_gates (
        gate_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        public_key_pem TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        status TEXT NOT NULL,
        last_monotonic_counter BIGINT NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_hardware_gates_tenant ON hardware_gates(tenant_id, status, updated_at DESC);
    `,
    backfill: 'upsert'
  },
  command_intents: {
    conflict: ['action_id'],
    ddl: `
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
      CREATE INDEX IF NOT EXISTS idx_shadow_command_intents_target ON command_intents(tenant_id, scope, target_id, created_at DESC);
    `,
    backfill: 'upsert'
  },
  hardware_confirmation_sessions: {
    conflict: ['session_id'],
    ddl: `
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
      CREATE INDEX IF NOT EXISTS idx_shadow_hardware_sessions_gate ON hardware_confirmation_sessions(gate_id, created_at DESC);
    `,
    backfill: 'upsert'
  },
  hardware_grants: {
    conflict: ['grant_id'],
    ddl: `
      CREATE TABLE IF NOT EXISTS hardware_grants (
        grant_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        gate_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        monotonic_counter BIGINT NOT NULL,
        signature TEXT NOT NULL,
        grant_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_hardware_grants_gate_counter ON hardware_grants(gate_id, monotonic_counter);
    `,
    backfill: 'upsert'
  }
};

export function maskConnectionString(connectionString: string): string {
  try {
    const parsed = new URL(connectionString);
    const auth = parsed.username ? `${parsed.username}:***@` : '';
    return `${parsed.protocol}//${auth}${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}`;
  } catch {
    return 'postgres://***';
  }
}

export function toSqlValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

export function toQueryValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

class PostgresShadowStoreService {
  private readonly connectionString = process.env.SHADOW_DATABASE_URL || '';
  private readonly poolSize = Math.max(1, Number(process.env.SHADOW_DB_POOL_MAX || 4));
  private readonly resyncIntervalMs = Math.max(10000, Number(process.env.SHADOW_DB_RESYNC_INTERVAL_MS || 60000));
  private pool: Pool | null = null;
  private initPromise: Promise<void> | null = null;
  private schemaReady = false;
  private connected = false;
  private lastError?: string;
  private lastBackfillAt?: string;
  private lastBackfillError?: string;
  private syncedTables: Record<string, number> = {};
  private resyncTimer: NodeJS.Timeout | null = null;

  isEnabled(): boolean {
    return Boolean(this.connectionString);
  }

  canServeReads(): boolean {
    return getDatabaseMode() === 'postgres' && this.isEnabled() && this.connected && Boolean(this.pool);
  }

  async init(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    if (this.pool && this.connected && this.schemaReady) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.initialize().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  async close(): Promise<void> {
    if (this.resyncTimer) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = null;
    }
    const pool = this.pool;
    this.pool = null;
    this.connected = false;
    this.schemaReady = false;
    if (pool) {
      await pool.end().catch(() => undefined);
    }
  }

  describe(): Record<string, any> {
    return {
      enabled: this.isEnabled(),
      connected: this.connected,
      readModeActive: this.canServeReads(),
      endpoint: this.isEnabled() ? maskConnectionString(this.connectionString) : null,
      lastError: this.lastError || null,
      lastBackfillAt: this.lastBackfillAt || null,
      lastBackfillError: this.lastBackfillError || null,
      syncedTables: this.syncedTables
    };
  }

  async backfillSnapshot(): Promise<void> {
    if (!(await this.ensureReady())) {
      return;
    }

    const db = getDatabase();
    const supportedTables = Object.entries(TABLES).filter(([, config]) => config.backfill) as Array<[ShadowTable, TableConfig]>;

    try {
      for (const [table, config] of supportedTables) {
        if (!this.sqliteTableExists(db, table)) {
          continue;
        }

        const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
        if (config.backfill === 'replace') {
          await this.pool!.query(`DELETE FROM "${table}"`);
        }
        for (const row of rows) {
          await this.upsert(table, row);
        }
        this.syncedTables[table] = rows.length;
      }

      this.lastBackfillAt = new Date().toISOString();
      this.lastBackfillError = undefined;
      this.connected = true;
    } catch (error: any) {
      this.lastBackfillError = error?.message || 'backfill failed';
      this.connected = false;
      logger.warn('Postgres shadow backfill failed', { error: this.lastBackfillError });
    }
  }

  startResyncLoop(): void {
    if (!this.isEnabled() || this.resyncTimer) {
      return;
    }

    this.resyncTimer = setInterval(() => {
      void this.backfillSnapshot();
    }, this.resyncIntervalMs);
    this.resyncTimer.unref?.();
  }

  async upsert(table: ShadowTable, row: Record<string, unknown>): Promise<void> {
    if (!(await this.ensureReady())) {
      return;
    }

    const config = TABLES[table];
    const columns = Object.keys(row);
    if (columns.length === 0) {
      return;
    }

    const values = columns.map((column) => toSqlValue(row[column]));
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    const updateColumns = columns.filter((column) => !config.conflict.includes(column));
    const assignment =
      updateColumns.length > 0
        ? updateColumns.map((column) => `"${column}" = EXCLUDED."${column}"`).join(', ')
        : `"${config.conflict[0]}" = EXCLUDED."${config.conflict[0]}"`;

    const sql = `
      INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')})
      VALUES (${placeholders})
      ON CONFLICT (${config.conflict.map((column) => `"${column}"`).join(', ')})
      DO UPDATE SET ${assignment}
    `;

    try {
      await this.pool!.query(sql, values);
      this.connected = true;
      this.lastError = undefined;
    } catch (error: any) {
      this.connected = false;
      this.lastError = error?.message || 'shadow write failed';
      logger.warn('Postgres shadow write failed', { table, error: this.lastError });
    }
  }

  async queryAll<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!(await this.ensureReady())) {
      return [];
    }

    try {
      const result = await this.pool!.query(sql, params.map((value) => toQueryValue(value)));
      this.connected = true;
      this.lastError = undefined;
      return result.rows as T[];
    } catch (error: any) {
      this.connected = false;
      this.lastError = error?.message || 'shadow read failed';
      logger.warn('Postgres shadow read failed', { error: this.lastError, sql });
      throw error;
    }
  }

  async queryOne<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.queryAll<T>(sql, params);
    return rows[0] || null;
  }

  async execute(sql: string, params: unknown[] = []): Promise<number> {
    if (!(await this.ensureReady())) {
      return 0;
    }

    try {
      const result = await this.pool!.query(sql, params.map((value) => toQueryValue(value)));
      this.connected = true;
      this.lastError = undefined;
      return Number(result.rowCount || 0);
    } catch (error: any) {
      this.connected = false;
      this.lastError = error?.message || 'shadow execute failed';
      logger.warn('Postgres shadow execute failed', { error: this.lastError, sql });
      throw error;
    }
  }

  private async ensureReady(): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }
    await this.init();
    return Boolean(this.pool);
  }

  private async initialize(): Promise<void> {
    try {
      if (!this.pool) {
        this.pool = new Pool({
          connectionString: this.connectionString,
          max: this.poolSize
        });
      }

      await this.pool.query('SELECT 1');
      await this.ensureSchema();
      this.connected = true;
      this.lastError = undefined;
      logger.info('Postgres shadow store ready', {
        endpoint: maskConnectionString(this.connectionString)
      });
    } catch (error: any) {
      this.connected = false;
      this.lastError = error?.message || 'initialization failed';
      logger.warn('Postgres shadow store unavailable', {
        endpoint: maskConnectionString(this.connectionString),
        error: this.lastError
      });
      if (this.pool) {
        await this.pool.end().catch(() => undefined);
        this.pool = null;
      }
    }
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady || !this.pool) {
      return;
    }

    for (const config of Object.values(TABLES)) {
      await this.pool.query(config.ddl);
    }

    this.schemaReady = true;
  }

  private sqliteTableExists(db: ReturnType<typeof getDatabase>, table: string): boolean {
    const row = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
      LIMIT 1
    `).get(table) as { name?: string } | undefined;
    return Boolean(row?.name);
  }
}

export const postgresShadowStoreService = new PostgresShadowStoreService();
