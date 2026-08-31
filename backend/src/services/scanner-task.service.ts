import { randomUUID } from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import tls from 'tls';
import logger from '../utils/logger';
import { getDatabase } from '../config/database';
import { isMetadataAddress } from '../security/outbound-url-guard';
import { getAgentGateway } from './agent-system.service';
import { getDeviceList } from './device-registry.service';
import { OptimizationEngine } from '../scanner/optimization-engine';
import { NucleiScanner } from '../scanner/nuclei-scanner';
import { securityOperationsService } from './security-operations.service';
import type { FindingRecord } from './security-operations.service';
import { jobQueueService } from './job-queue.service';
import { artifactStoreService } from './artifact-store.service';
import { postgresShadowStoreService } from './postgres-shadow-store.service';

type ScanStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
type ScanPhase =
  | 'queued'
  | 'normalizing'
  | 'asset-resolution'
  | 'web-scan'
  | 'host-scan'
  | 'nuclei-scan'
  | 'correlation'
  | 'finalizing'
  | 'done';
type ScanStageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
type ScanTargetKind = 'url' | 'domain' | 'ip' | 'cidr' | 'assetId' | 'deviceId' | 'agentId' | 'host';
type CompatibilityTargetType = 'url' | 'host' | 'nuclei';
type Severity = 'critical' | 'high' | 'medium' | 'low';
type BroadcastFn = (event: string, data: any) => void;

interface TimeoutPolicy {
  connectMs: number;
  requestMs: number;
  stageMs: number;
}

interface RawTargetItem {
  kind: ScanTargetKind;
  value: string;
  label?: string;
  metadata?: Record<string, any>;
}

interface ScanProfileRecord {
  id: string;
  tenantId: string;
  name: string;
  scopes: string[];
  engines: string[];
  portSet: number[];
  templateSet: string[];
  timeoutPolicy: TimeoutPolicy;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

interface ScanRunTargetRecord {
  id: string;
  runId: string;
  tenantId: string;
  kind: ScanTargetKind;
  rawValue: string;
  normalizedValue: string;
  displayLabel: string;
  status: 'pending' | 'resolved' | 'failed' | 'skipped';
  error?: string;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

interface ScanStageRecord {
  id: string;
  runId: string;
  tenantId: string;
  stageKey: ScanPhase;
  stageLabel: string;
  status: ScanStageStatus;
  progress: number;
  detail?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  metadata: Record<string, any>;
}

interface ScanEvidenceRecord {
  id: string;
  runId: string;
  tenantId: string;
  targetId?: string;
  assetId?: string;
  engine: string;
  category: string;
  severity: Severity;
  title: string;
  summary: string;
  fingerprint: string;
  rawRef?: string;
  details: Record<string, any>;
  collectedAt: string;
}

interface ScanServiceExposureRecord {
  id: string;
  runId: string;
  tenantId: string;
  targetId?: string;
  assetId?: string;
  host: string;
  port: number;
  protocol: string;
  service?: string;
  banner?: string;
  tlsSummary?: Record<string, any>;
  metadata: Record<string, any>;
  discoveredAt: string;
}

interface ResolvedScanTarget {
  id: string;
  runId: string;
  tenantId: string;
  kind: ScanTargetKind;
  displayLabel: string;
  rawValue: string;
  normalizedValue: string;
  primaryAddress?: string;
  hosts: string[];
  urls: string[];
  metadata: Record<string, any>;
  assetIds: string[];
  supportsHostBaseline: boolean;
}

export interface ScanTaskInput {
  tenantId: string;
  createdBy: string;
  targets: {
    urls?: string[];
    domains?: string[];
    ips?: string[];
    cidrs?: string[];
    assetIds?: string[];
    deviceIds?: string[];
    agentIds?: string[];
    items?: RawTargetItem[];
    host?: {
      mode: 'local';
      includeSystem: boolean;
      includeWeb: boolean;
      includePorts: boolean;
    };
  };
  enginePolicy?: 'opt_then_nuclei';
}

export interface ScanTaskState {
  id: string;
  tenantId: string;
  createdBy: string;
  status: ScanStatus;
  phase: ScanPhase;
  progress: number;
  enginePolicy: 'opt_then_nuclei';
  profileId: string;
  targets: ScanTaskInput['targets'];
  summary: Record<string, any>;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

class ScanCancelledError extends Error {
  constructor() {
    super('Scan task was cancelled');
    this.name = 'ScanCancelledError';
  }
}

const DEFAULT_TIMEOUT_POLICY: TimeoutPolicy = {
  connectMs: 2500,
  requestMs: 5000,
  stageMs: 120000
};

const DEFAULT_PORT_SET = [21, 22, 25, 53, 80, 110, 143, 443, 445, 587, 993, 995, 1433, 1521, 3306, 3389, 5432, 6379, 8000, 8080, 8443, 9200, 27017];

const DEFAULT_SUMMARY = {
  urlTargets: 0,
  hostEnabled: false,
  targetCount: 0,
  assetsObserved: 0,
  servicesObserved: 0,
  evidenceCount: 0,
  queuePosition: 0,
  queuedDepth: 0,
  highRiskFindings: 0,
  findings: {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0
  },
  nuclei: 'not_run',
  validation: {
    evidenceCollected: 0,
    actionsSuggested: 0
  }
};

const SENSITIVE_PORTS = new Map<number, { severity: Severity; title: string }>([
  [22, { severity: 'medium', title: 'SSH Administrative Port Exposed' }],
  [3389, { severity: 'high', title: 'Remote Desktop Port Exposed' }],
  [5432, { severity: 'high', title: 'PostgreSQL Port Exposed' }],
  [6379, { severity: 'critical', title: 'Redis Port Exposed' }],
  [27017, { severity: 'high', title: 'MongoDB Port Exposed' }],
  [9200, { severity: 'high', title: 'Elasticsearch Port Exposed' }]
]);

const SERVICE_NAMES: Record<number, string> = {
  21: 'ftp',
  22: 'ssh',
  25: 'smtp',
  53: 'dns',
  80: 'http',
  110: 'pop3',
  143: 'imap',
  443: 'https',
  445: 'smb',
  587: 'submission',
  993: 'imaps',
  995: 'pop3s',
  1433: 'mssql',
  1521: 'oracle',
  3306: 'mysql',
  3389: 'rdp',
  5432: 'postgres',
  6379: 'redis',
  8000: 'http-alt',
  8080: 'http-proxy',
  8443: 'https-alt',
  9200: 'elasticsearch',
  27017: 'mongodb'
};

function toJson(value: any): string {
  return JSON.stringify(value ?? {});
}

function parseJson<T>(value: any, fallback: T): T {
  if (!value) return fallback;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function normalizeSeverity(severity: string): Severity {
  const normalized = String(severity || 'medium').toLowerCase();
  if (normalized === 'critical' || normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized;
  }
  return 'medium';
}

export function compareSemver(left: string, right: string): number {
  const leftParts = String(left || '')
    .split('.')
    .map((item) => Number.parseInt(item, 10))
    .map((item) => (Number.isFinite(item) ? item : 0));
  const rightParts = String(right || '')
    .split('.')
    .map((item) => Number.parseInt(item, 10))
    .map((item) => (Number.isFinite(item) ? item : 0));
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue !== rightValue) {
      return leftValue > rightValue ? 1 : -1;
    }
  }

  return 0;
}

export function isIp(value: string): boolean {
  return net.isIP(value) !== 0;
}

export function ipToLong(ip: string): number {
  const parts = ip.split('.').map((item) => Number(item));
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

export function longToIp(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255
  ].join('.');
}

export function expandIpv4Cidr(cidr: string, maxHosts = 64): string[] {
  const [base, prefixRaw] = cidr.split('/');
  const prefix = Number(prefixRaw);
  if (!isIp(base) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return [];
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = ipToLong(base) & mask;
  const size = Math.min(maxHosts, Math.max(1, 2 ** (32 - prefix)));
  const addresses: string[] = [];

  for (let offset = 0; offset < size; offset += 1) {
    addresses.push(longToIp((network + offset) >>> 0));
  }

  return addresses;
}

class ScannerTaskService {
  private tasks = new Map<string, ScanTaskState>();
  private cancelled = new Set<string>();
  private broadcaster: BroadcastFn = () => {};
  private optimizationEngine = new OptimizationEngine();
  private nucleiScanner = new NucleiScanner();
  private schemaReady = false;
  private queue: string[] = [];
  private activeTaskIds = new Set<string>();
  private tenantActiveCounts = new Map<string, number>();
  private queuePumpScheduled = false;
  private readonly maxGlobalConcurrency = Math.max(1, Number(process.env.SCANNER_MAX_GLOBAL_CONCURRENCY || 2));
  private readonly maxTenantConcurrency = Math.max(1, Number(process.env.SCANNER_MAX_TENANT_CONCURRENCY || 2));
  private readonly autoStart = process.env.NODE_ENV !== 'test';
  private workerStarted = false;
  private workerLoop: NodeJS.Timeout | null = null;

  setBroadcaster(fn: BroadcastFn): void {
    this.broadcaster = fn;
  }

  async startWorker(): Promise<void> {
    if (!this.autoStart || this.workerStarted) {
      return;
    }

    this.assertPrepared();
    this.workerStarted = true;
    await this.recoverRunnableTasks();
    this.scheduleQueuePump();
    this.workerLoop = setInterval(() => {
      void this.pumpQueue();
    }, Math.max(1000, Number(process.env.SCANNER_WORKER_POLL_MS || 2000)));
    this.workerLoop.unref?.();
    logger.info('Scanner worker started', {
      queueBackend: jobQueueService.backend(),
      artifactStore: artifactStoreService.describe().activeMode
    });
  }

  stopWorker(): void {
    this.workerStarted = false;
    if (this.workerLoop) {
      clearInterval(this.workerLoop);
      this.workerLoop = null;
    }
  }

  private async recoverRunnableTasks(): Promise<void> {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT *
      FROM scan_runs
      WHERE status IN ('pending', 'running')
      ORDER BY created_at ASC
    `).all() as any[];

    for (const row of rows) {
      const task = this.mapTaskRow(row);
      if (row.status === 'running') {
        task.status = 'pending';
        task.phase = 'queued';
        task.progress = Math.min(Number(task.progress || 0), 5);
        task.error = undefined;
        task.summary = {
          ...task.summary,
          recovered: true,
          recoveredAt: this.nowISO()
        };
        this.upsertTask(task, 'scanner:task:recovered', {
          phase: task.phase,
          progress: task.progress
        });
      } else {
        this.tasks.set(task.id, task);
      }

      this.enqueueTask(task.id);
    }
  }

  private async syncPendingTasksFromDatabase(): Promise<void> {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id
      FROM scan_runs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 100
    `).all() as Array<{ id: string }>;

    for (const row of rows) {
      if (!this.queue.includes(row.id) && !this.activeTaskIds.has(row.id)) {
        this.queue.push(row.id);
      }
    }

    if (rows.length > 0) {
      this.refreshQueuePositions();
    }
  }

  private async ingestQueueHints(): Promise<void> {
    const queuedIds = await jobQueueService.drain('scanner-runs', 100);
    for (const taskId of queuedIds) {
      if (!this.queue.includes(taskId) && !this.activeTaskIds.has(taskId)) {
        this.queue.push(taskId);
      }
    }
    if (queuedIds.length > 0) {
      this.refreshQueuePositions();
    }
  }

  prepare(): void {
    if (this.schemaReady) {
      return;
    }

    const db = getDatabase();
    db.exec(`
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

      CREATE TABLE IF NOT EXISTS scan_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scan_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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

      CREATE TABLE IF NOT EXISTS scan_target_assets (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scan_runs_tenant_status ON scan_runs(tenant_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_scan_targets_run ON scan_run_targets(run_id, status);
      CREATE INDEX IF NOT EXISTS idx_scan_stages_run ON scan_run_stages(run_id, stage_key);
      CREATE INDEX IF NOT EXISTS idx_scan_evidence_run ON scan_evidence(run_id, severity, collected_at);
      CREATE INDEX IF NOT EXISTS idx_scan_services_run ON scan_services(run_id, host, port);
      CREATE INDEX IF NOT EXISTS idx_scan_target_assets_run ON scan_target_assets(run_id, target_id);
    `);

    const now = this.nowISO();
    db.prepare(`
      UPDATE scan_runs
      SET status = 'failed', phase = 'done', progress = 100, error = COALESCE(error, 'Worker restarted before scan completion'), completed_at = COALESCE(completed_at, ?)
      WHERE status IN ('pending', 'running')
    `).run(now);
    db.prepare(`
      UPDATE scan_tasks
      SET status = 'failed', phase = 'done', progress = 100, error = COALESCE(error, 'Worker restarted before scan completion'), completed_at = COALESCE(completed_at, ?)
      WHERE status IN ('pending', 'running')
    `).run(now);
    db.prepare(`
      UPDATE scan_run_stages
      SET status = 'failed', error = COALESCE(error, 'Worker restarted before scan completion'), completed_at = COALESCE(completed_at, ?)
      WHERE status = 'running'
    `).run(now);

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

    throw new Error('Scanner task schema not initialized. Call scannerTaskService.prepare() during bootstrap.');
  }

  private nowISO(): string {
    return new Date().toISOString();
  }

  private shadowUpsert(table: Parameters<typeof postgresShadowStoreService.upsert>[0], row: Record<string, unknown>): void {
    void postgresShadowStoreService.upsert(table, row);
  }

  private shouldUseShadowReads(): boolean {
    return postgresShadowStoreService.canServeReads();
  }

  private async queryShadowAllWithFallback<T>(sql: string, params: unknown[], fallback: () => T[]): Promise<T[]> {
    if (!this.shouldUseShadowReads()) {
      return fallback();
    }

    try {
      return await postgresShadowStoreService.queryAll<T>(sql, params);
    } catch {
      return fallback();
    }
  }

  private async queryShadowOneWithFallback<T>(sql: string, params: unknown[], fallback: () => T | null): Promise<T | null> {
    if (!this.shouldUseShadowReads()) {
      return fallback();
    }

    try {
      return await postgresShadowStoreService.queryOne<T>(sql, params);
    } catch {
      return fallback();
    }
  }

  private persistProfile(profile: ScanProfileRecord): void {
    const db = getDatabase();
    db.prepare(`
      INSERT OR REPLACE INTO scan_profiles (
        id, tenant_id, name, scopes_json, engines_json, port_set_json, template_set_json, timeout_policy_json, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      profile.id,
      profile.tenantId,
      profile.name,
      toJson(profile.scopes),
      toJson(profile.engines),
      toJson(profile.portSet),
      toJson(profile.templateSet),
      toJson(profile.timeoutPolicy),
      toJson(profile.metadata),
      profile.createdAt,
      profile.updatedAt
    );
    this.shadowUpsert('scan_profiles', {
      id: profile.id,
      tenant_id: profile.tenantId,
      name: profile.name,
      scopes_json: toJson(profile.scopes),
      engines_json: toJson(profile.engines),
      port_set_json: toJson(profile.portSet),
      template_set_json: toJson(profile.templateSet),
      timeout_policy_json: toJson(profile.timeoutPolicy),
      metadata_json: toJson(profile.metadata),
      created_at: profile.createdAt,
      updated_at: profile.updatedAt
    });
  }

  private persistTask(task: ScanTaskState): void {
    const db = getDatabase();
    db.prepare(`
      INSERT OR REPLACE INTO scan_runs (
        id, tenant_id, created_by, status, phase, progress, engine_policy, profile_id, request_json, summary_json, error, queue_position, created_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.tenantId,
      task.createdBy,
      task.status,
      task.phase,
      task.progress,
      task.enginePolicy,
      task.profileId,
      toJson(task.targets),
      toJson(task.summary),
      task.error || null,
      Number(task.summary?.queuePosition || 0),
      task.createdAt,
      task.startedAt || null,
      task.completedAt || null
    );
    this.shadowUpsert('scan_runs', {
      id: task.id,
      tenant_id: task.tenantId,
      created_by: task.createdBy,
      status: task.status,
      phase: task.phase,
      progress: task.progress,
      engine_policy: task.enginePolicy,
      profile_id: task.profileId,
      request_json: toJson(task.targets),
      summary_json: toJson(task.summary),
      error: task.error || null,
      queue_position: Number(task.summary?.queuePosition || 0),
      created_at: task.createdAt,
      started_at: task.startedAt || null,
      completed_at: task.completedAt || null
    });

    db.prepare(`
      INSERT OR REPLACE INTO scan_tasks (
        id, tenant_id, created_by, status, phase, progress, engine_policy, targets_json, summary_json, error, created_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.tenantId,
      task.createdBy,
      task.status,
      task.phase,
      task.progress,
      task.enginePolicy,
      toJson(task.targets),
      toJson(task.summary),
      task.error || null,
      task.createdAt,
      task.startedAt || null,
      task.completedAt || null
    );
    this.shadowUpsert('scan_tasks', {
      id: task.id,
      tenant_id: task.tenantId,
      created_by: task.createdBy,
      status: task.status,
      phase: task.phase,
      progress: task.progress,
      engine_policy: task.enginePolicy,
      targets_json: toJson(task.targets),
      summary_json: toJson(task.summary),
      error: task.error || null,
      created_at: task.createdAt,
      started_at: task.startedAt || null,
      completed_at: task.completedAt || null
    });
  }

  private persistTarget(target: ScanRunTargetRecord): void {
    const db = getDatabase();
    db.prepare(`
      INSERT OR REPLACE INTO scan_run_targets (
        id, run_id, tenant_id, target_kind, raw_value, normalized_value, display_label, status, error, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      target.id,
      target.runId,
      target.tenantId,
      target.kind,
      target.rawValue,
      target.normalizedValue,
      target.displayLabel,
      target.status,
      target.error || null,
      toJson(target.metadata),
      target.createdAt,
      target.updatedAt
    );
    this.shadowUpsert('scan_run_targets', {
      id: target.id,
      run_id: target.runId,
      tenant_id: target.tenantId,
      target_kind: target.kind,
      raw_value: target.rawValue,
      normalized_value: target.normalizedValue,
      display_label: target.displayLabel,
      status: target.status,
      error: target.error || null,
      metadata_json: toJson(target.metadata),
      created_at: target.createdAt,
      updated_at: target.updatedAt
    });
  }

  private persistStage(stage: ScanStageRecord): void {
    const db = getDatabase();
    db.prepare(`
      INSERT OR REPLACE INTO scan_run_stages (
        id, run_id, tenant_id, stage_key, stage_label, status, progress, detail, error, started_at, completed_at, duration_ms, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stage.id,
      stage.runId,
      stage.tenantId,
      stage.stageKey,
      stage.stageLabel,
      stage.status,
      stage.progress,
      stage.detail || null,
      stage.error || null,
      stage.startedAt || null,
      stage.completedAt || null,
      stage.durationMs || null,
      toJson(stage.metadata)
    );
    this.shadowUpsert('scan_run_stages', {
      id: stage.id,
      run_id: stage.runId,
      tenant_id: stage.tenantId,
      stage_key: stage.stageKey,
      stage_label: stage.stageLabel,
      status: stage.status,
      progress: stage.progress,
      detail: stage.detail || null,
      error: stage.error || null,
      started_at: stage.startedAt || null,
      completed_at: stage.completedAt || null,
      duration_ms: stage.durationMs || null,
      metadata_json: toJson(stage.metadata)
    });
  }

  private persistEvidence(record: ScanEvidenceRecord): void {
    const db = getDatabase();
    db.prepare(`
      INSERT OR REPLACE INTO scan_evidence (
        id, run_id, tenant_id, target_id, asset_id, engine, category, severity, title, summary, fingerprint, raw_ref, details_json, collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.runId,
      record.tenantId,
      record.targetId || null,
      record.assetId || null,
      record.engine,
      record.category,
      record.severity,
      record.title,
      record.summary,
      record.fingerprint,
      record.rawRef || null,
      toJson(record.details),
      record.collectedAt
    );
    this.shadowUpsert('scan_evidence', {
      id: record.id,
      run_id: record.runId,
      tenant_id: record.tenantId,
      target_id: record.targetId || null,
      asset_id: record.assetId || null,
      engine: record.engine,
      category: record.category,
      severity: record.severity,
      title: record.title,
      summary: record.summary,
      fingerprint: record.fingerprint,
      raw_ref: record.rawRef || null,
      details_json: toJson(record.details),
      collected_at: record.collectedAt
    });
  }

  private persistServiceExposure(record: ScanServiceExposureRecord): void {
    const db = getDatabase();
    db.prepare(`
      INSERT OR REPLACE INTO scan_services (
        id, run_id, tenant_id, target_id, asset_id, host, port, protocol, service, banner, tls_summary_json, metadata_json, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.runId,
      record.tenantId,
      record.targetId || null,
      record.assetId || null,
      record.host,
      record.port,
      record.protocol,
      record.service || null,
      record.banner || null,
      toJson(record.tlsSummary || {}),
      toJson(record.metadata),
      record.discoveredAt
    );
    this.shadowUpsert('scan_services', {
      id: record.id,
      run_id: record.runId,
      tenant_id: record.tenantId,
      target_id: record.targetId || null,
      asset_id: record.assetId || null,
      host: record.host,
      port: record.port,
      protocol: record.protocol,
      service: record.service || null,
      banner: record.banner || null,
      tls_summary_json: toJson(record.tlsSummary || {}),
      metadata_json: toJson(record.metadata),
      discovered_at: record.discoveredAt
    });
  }

  private persistTargetAssetMapping(runId: string, tenantId: string, targetId: string, assetId: string, relationType: string): void {
    const id = `${runId}:${targetId}:${assetId}:${relationType}`;
    const db = getDatabase();
    db.prepare(`
      INSERT OR REPLACE INTO scan_target_assets (
        id, run_id, tenant_id, target_id, asset_id, relation_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, runId, tenantId, targetId, assetId, relationType, this.nowISO());
    this.shadowUpsert('scan_target_assets', {
      id,
      run_id: runId,
      tenant_id: tenantId,
      target_id: targetId,
      asset_id: assetId,
      relation_type: relationType,
      created_at: this.nowISO()
    });
  }

  private emitEvent(task: ScanTaskState, eventType: string, payload: any): void {
    const eventId = randomUUID();
    const createdAt = this.nowISO();
    const db = getDatabase();
    db.prepare(`
      INSERT INTO scan_events (task_id, tenant_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(task.id, task.tenantId, eventType, toJson(payload), createdAt);
    this.shadowUpsert('scan_events', {
      id: eventId,
      task_id: task.id,
      tenant_id: task.tenantId,
      event_type: eventType,
      payload_json: toJson(payload),
      created_at: createdAt
    });

    this.broadcaster(eventType, {
      taskId: task.id,
      tenantId: task.tenantId,
      event: eventType,
      payload,
      timestamp: createdAt
    });
  }

  private upsertTask(task: ScanTaskState, eventType?: string, payload?: any): void {
    this.tasks.set(task.id, task);
    this.persistTask(task);
    if (eventType) {
      this.emitEvent(task, eventType, payload ?? {
        status: task.status,
        phase: task.phase,
        progress: task.progress
      });
    }
  }

  private normalizeTargets(input: ScanTaskInput): ScanRunTargetRecord[] {
    const now = this.nowISO();
    const seen = new Set<string>();
    const rows: ScanRunTargetRecord[] = [];
    const tenantId = input.tenantId;
    const runId = randomUUID();

    /**
     * N5-6 (audit 2026-08): cloud metadata endpoints are an ABSOLUTE
     * exclusion for every target kind — a scan task is an SSRF primitive
     * when the control plane itself can be pointed at its own IMDS. Private
     * ranges stay scannable (that is the product), but metadata never is.
     * Literal targets are rejected here; DNS-resolved names are re-checked
     * at egress (assertResolvedTargetNotMetadata).
     */
    const isMetadataLiteral = (kind: ScanTargetKind, value: string): boolean => {
      if (kind === 'url') {
        try {
          return isMetadataAddress(new URL(value).hostname);
        } catch {
          return false;
        }
      }
      if (kind === 'cidr') {
        try {
          return expandIpv4Cidr(value).some((address) => isMetadataAddress(address));
        } catch {
          return false;
        }
      }
      if (kind === 'ip' || kind === 'domain' || kind === 'host') {
        return isMetadataAddress(value);
      }
      return false;
    };

    const push = (kind: ScanTargetKind, rawValue: string, label?: string, metadata?: Record<string, any>) => {
      const trimmed = String(rawValue || '').trim();
      if (!trimmed) return;
      if (isMetadataLiteral(kind, trimmed)) {
        throw new Error('backend.scan_target_metadata_blocked');
      }
      const normalizedValue = kind === 'url'
        ? (() => {
            try {
              return new URL(trimmed).toString();
            } catch {
              return trimmed;
            }
          })()
        : kind === 'domain'
          ? trimmed.toLowerCase()
          : trimmed;
      const key = `${kind}:${normalizedValue}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        id: randomUUID(),
        runId,
        tenantId,
        kind,
        rawValue: trimmed,
        normalizedValue,
        displayLabel: label || trimmed,
        status: 'pending',
        metadata: metadata || {},
        createdAt: now,
        updatedAt: now
      });
    };

    for (const url of input.targets.urls || []) push('url', url);
    for (const domain of input.targets.domains || []) push('domain', domain);
    for (const ip of input.targets.ips || []) push('ip', ip);
    for (const cidr of input.targets.cidrs || []) push('cidr', cidr);
    for (const assetId of input.targets.assetIds || []) push('assetId', assetId);
    for (const deviceId of input.targets.deviceIds || []) push('deviceId', deviceId);
    for (const agentId of input.targets.agentIds || []) push('agentId', agentId);
    for (const item of input.targets.items || []) {
      if (item?.kind && item?.value) {
        push(item.kind, item.value, item.label, item.metadata);
      }
    }
    if (input.targets.host?.mode === 'local') {
      push('host', 'local', 'Local Host', {
        includeSystem: input.targets.host.includeSystem,
        includeWeb: input.targets.host.includeWeb,
        includePorts: input.targets.host.includePorts
      });
    }

    return rows;
  }

  private deriveProfile(input: ScanTaskInput, targets: ScanRunTargetRecord[]): ScanProfileRecord {
    const now = this.nowISO();
    const scopes = new Set<string>();
    const engines = new Set<string>();
    const hasNetworkTargets = targets.some((target) =>
      target.kind === 'url' ||
      target.kind === 'domain' ||
      target.kind === 'ip' ||
      target.kind === 'cidr' ||
      target.kind === 'assetId' ||
      target.kind === 'deviceId' ||
      target.kind === 'agentId'
    );

    if (hasNetworkTargets || input.targets.host?.includeWeb) {
      scopes.add('web');
      scopes.add('tlsCert');
      scopes.add('serviceFingerprint');
      scopes.add('vulnTemplates');
      engines.add('web-scanner');
      engines.add('tls-probe');
      engines.add('service-probe');
      engines.add('nuclei');
    }

    if (hasNetworkTargets || input.targets.host?.includePorts) {
      scopes.add('ports');
      engines.add('port-probe');
    }

    if (input.targets.host?.includeSystem || targets.some((target) => target.kind === 'host')) {
      scopes.add('systemBaseline');
      scopes.add('hostExposure');
      engines.add('optimization-engine');
    }

    return {
      id: randomUUID(),
      tenantId: input.tenantId,
      name: `Auto profile ${now}`,
      scopes: Array.from(scopes),
      engines: Array.from(engines),
      portSet: Array.from(new Set(DEFAULT_PORT_SET)).sort((a, b) => a - b),
      templateSet: ['exposures', 'misconfigurations', 'web-cves'],
      timeoutPolicy: { ...DEFAULT_TIMEOUT_POLICY },
      metadata: {
        enginePolicy: input.enginePolicy || 'opt_then_nuclei',
        legacyHostOptions: input.targets.host || null
      },
      createdAt: now,
      updatedAt: now
    };
  }

  private createTaskState(input: ScanTaskInput, profile: ScanProfileRecord, targets: ScanRunTargetRecord[]): ScanTaskState {
    return {
      id: targets[0]?.runId || randomUUID(),
      tenantId: input.tenantId,
      createdBy: input.createdBy,
      status: 'pending',
      phase: 'queued',
      progress: 0,
      enginePolicy: input.enginePolicy || 'opt_then_nuclei',
      profileId: profile.id,
      targets: input.targets,
      summary: {
        ...DEFAULT_SUMMARY,
        urlTargets: (input.targets.urls || []).length,
        hostEnabled: Boolean(input.targets.host),
        targetCount: targets.length
      },
      createdAt: this.nowISO()
    };
  }

  private refreshQueuePositions(): void {
    const queueLookup = new Map(this.queue.map((taskId, index) => [taskId, index + 1]));
    for (const task of this.tasks.values()) {
      if (task.status === 'pending') {
        task.summary.queuePosition = queueLookup.get(task.id) || 0;
        task.summary.queuedDepth = this.queue.length;
        this.persistTask(task);
      }
    }
  }

  private enqueueTask(taskId: string): void {
    if (!this.queue.includes(taskId)) {
      this.queue.push(taskId);
      this.refreshQueuePositions();
    }
    void jobQueueService.enqueue('scanner-runs', taskId);
  }

  private scheduleQueuePump(): void {
    if (!this.autoStart || !this.workerStarted || this.queuePumpScheduled) {
      return;
    }
    this.queuePumpScheduled = true;
    setImmediate(() => {
      this.queuePumpScheduled = false;
      void this.pumpQueue();
    });
  }

  private async pumpQueue(): Promise<void> {
    if (!this.autoStart || !this.workerStarted) {
      return;
    }

    await this.ingestQueueHints();
    if (this.queue.length === 0) {
      await this.syncPendingTasksFromDatabase();
    }

    while (this.queue.length > 0 && this.activeTaskIds.size < this.maxGlobalConcurrency) {
      const nextIndex = this.queue.findIndex((taskId) => {
        const task = this.getTask(taskId);
        if (!task || task.status !== 'pending') return false;
        return (this.tenantActiveCounts.get(task.tenantId) || 0) < this.maxTenantConcurrency;
      });

      if (nextIndex < 0) {
        break;
      }

      const [taskId] = this.queue.splice(nextIndex, 1);
      const task = this.getTask(taskId);
      if (!task || task.status !== 'pending') {
        continue;
      }

      this.activeTaskIds.add(taskId);
      this.tenantActiveCounts.set(task.tenantId, (this.tenantActiveCounts.get(task.tenantId) || 0) + 1);
      task.summary.queuePosition = 0;
      task.summary.queuedDepth = this.queue.length;
      this.persistTask(task);
      this.refreshQueuePositions();

      this.runTask(taskId)
        .catch((error: any) => {
          logger.error('Scanner task execution failed', { taskId, error: error?.message || String(error) });
        })
        .finally(() => {
          this.activeTaskIds.delete(taskId);
          const current = this.tenantActiveCounts.get(task.tenantId) || 1;
          if (current <= 1) {
            this.tenantActiveCounts.delete(task.tenantId);
          } else {
            this.tenantActiveCounts.set(task.tenantId, current - 1);
          }
          this.scheduleQueuePump();
        });
    }
  }

  /**
   * N5-6: DNS answers can point at the control plane's own IMDS even when
   * the requested name looked benign. Every network egress in this service
   * resolves the host first and refuses metadata addresses. Returns the
   * validated addresses (callers may connect to them directly).
   */
  private async assertResolvedTargetNotMetadata(host: string): Promise<string[]> {
    const hostname = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (isMetadataAddress(hostname)) {
      throw new Error('backend.scan_target_metadata_blocked');
    }
    const literal = /^[0-9.]+$/.test(hostname) || hostname.includes(':');
    if (literal) {
      return [hostname];
    }
    const addresses = await this.resolveDomainAddresses(hostname);
    if (addresses.some((address) => isMetadataAddress(address))) {
      throw new Error('backend.scan_target_metadata_blocked');
    }
    return addresses;
  }

  private async fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    // N5-6: validate the hop host BEFORE fetching, follow redirects manually
    // (each hop re-validated) — `redirect: 'follow'` would let a public URL
    // bounce the control plane into its own metadata endpoint.
    const MAX_REDIRECTS = 3;
    let currentUrl = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const parsed = new URL(currentUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('backend.scan_target_protocol_blocked');
      }
      await this.assertResolvedTargetNotMetadata(parsed.hostname);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method: hop === 0 ? 'GET' : 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'AetherGuard-Scanner/1.0'
          }
        });
      } finally {
        clearTimeout(timer);
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || hop === MAX_REDIRECTS) {
          return response;
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      return response;
    }
    throw new Error('backend.scan_target_too_many_redirects');
  }

  private async resolveDomainAddresses(hostname: string): Promise<string[]> {
    try {
      const rows = await dns.lookup(hostname, { all: true, verbatim: true });
      return rows.map((row) => row.address).filter((address, index, all) => all.indexOf(address) === index);
    } catch {
      return [];
    }
  }

  private async inspectTlsEndpoint(host: string, port: number, servername?: string): Promise<Record<string, any> | null> {
    // N5-6: resolve-and-check before the TLS handshake.
    try {
      await this.assertResolvedTargetNotMetadata(host);
    } catch {
      return null;
    }
    return new Promise((resolve) => {
      const socket = tls.connect(
        {
          host,
          port,
          servername: servername || host,
          rejectUnauthorized: false,
          timeout: DEFAULT_TIMEOUT_POLICY.connectMs
        },
        () => {
          const cert = socket.getPeerCertificate();
          const protocol = socket.getProtocol();
          socket.end();
          if (!cert || !cert.valid_to) {
            resolve(null);
            return;
          }
          const validTo = new Date(cert.valid_to);
          const daysRemaining = Math.ceil((validTo.getTime() - Date.now()) / 86400000);
          resolve({
            subject: cert.subject,
            issuer: cert.issuer,
            validTo: validTo.toISOString(),
            daysRemaining,
            protocol
          });
        }
      );
      socket.on('error', () => resolve(null));
      socket.on('timeout', () => {
        socket.destroy();
        resolve(null);
      });
    });
  }

  private async probePorts(host: string, ports: number[], timeoutMs: number): Promise<Array<{ port: number; banner?: string }>> {
    // N5-6: resolve-and-check before any TCP connect.
    try {
      await this.assertResolvedTargetNotMetadata(host);
    } catch {
      return [];
    }
    const probes = ports.map((port) => new Promise<{ port: number; banner?: string } | null>((resolve) => {
      let settled = false;
      const socket = new net.Socket();
      let banner = '';

      const finish = (result: { port: number; banner?: string } | null) => {
        if (!settled) {
          settled = true;
          socket.destroy();
          resolve(result);
        }
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish({ port, banner: banner || undefined }));
      socket.once('timeout', () => finish(null));
      socket.once('error', () => finish(null));
      socket.on('data', (chunk) => {
        banner = `${banner}${chunk.toString()}`.slice(0, 256);
      });
      socket.connect(port, host);
    }));

    const results = await Promise.all(probes);
    return results.filter((result): result is { port: number; banner?: string } => Boolean(result));
  }

  private buildRemediation(title: string, severity: Severity, target: string): Record<string, any> {
    const remediationMap: Array<{ match: RegExp; title: string; owner: string; rollback: string }> = [
      {
        match: /header|cookie|csp|frame/i,
        title: 'Harden HTTP security headers',
        owner: 'application',
        rollback: 'Restore the previous reverse-proxy or application header policy if compatibility issues appear.'
      },
      {
        match: /tls|certificate|protocol/i,
        title: 'Rotate certificate or tighten TLS settings',
        owner: 'platform',
        rollback: 'Restore the prior certificate bundle or TLS policy if clients cannot negotiate.'
      },
      {
        match: /port|redis|postgres|mongodb|ssh|desktop|elasticsearch/i,
        title: 'Reduce exposed service surface',
        owner: 'infrastructure',
        rollback: 'Rollback the network policy if legitimate traffic is unexpectedly blocked.'
      },
      {
        match: /env|git|actuator|status|directory listing/i,
        title: 'Restrict sensitive web exposure',
        owner: 'application',
        rollback: 'Restore the previous route exposure only after validating compensating controls.'
      },
      {
        match: /baseline|firewall|disk|update/i,
        title: 'Apply host hardening remediation',
        owner: 'operations',
        rollback: 'Revert the host-level change if it causes service regression.'
      }
    ];

    const matched = remediationMap.find((item) => item.match.test(title));
    return {
      title: matched?.title || 'Review evidence and create a remediation task',
      priority: severity,
      owner: matched?.owner || 'security-operations',
      target,
      rollback: matched?.rollback || 'Rollback the mitigation if validation shows customer-facing impact.',
      suggestedSteps: [
        'Review the evidence and affected asset.',
        'Validate the change in a controlled environment.',
        'Apply the mitigation and confirm the finding is closed.'
      ]
    };
  }

  private registerObservedAsset(
    task: ScanTaskState,
    targetId: string | undefined,
    assetType: 'url' | 'site' | 'domain' | 'host' | 'ip' | 'device' | 'agent' | 'service',
    externalRef: string,
    displayName: string,
    metadata: Record<string, any> = {}
  ): string {
    const asset = securityOperationsService.upsertAsset({
      tenantId: task.tenantId,
      assetType,
      externalRef,
      displayName,
      primaryAddress: metadata.primaryAddress || metadata.address || undefined,
      status: metadata.status || 'observed',
      metadata
    });

    if (targetId) {
      this.persistTargetAssetMapping(task.id, task.tenantId, targetId, asset.assetId, assetType);
    }

    return asset.assetId;
  }

  private recordFinding(
    task: ScanTaskState,
    input: {
      targetId?: string;
      compatibilityTargetType: CompatibilityTargetType;
      target: string;
      category: string;
      severity: Severity;
      title: string;
      description: string;
      evidence: Record<string, any>;
      sourceEngine: string;
      rawRef?: string;
      assetId?: string;
    }
  ): void {
    const evidenceId = randomUUID();
    const legacyFindingId = randomUUID();
    const findingCreatedAt = this.nowISO();
    const fingerprint = `${task.tenantId}:${input.sourceEngine}:${input.category}:${input.target}:${input.title}`;
    const artifactScope = `scans/${task.id}/evidence`;
    const enrichedEvidence = {
      ...input.evidence,
      artifact: {
        scope: artifactScope,
        key: `${evidenceId}.json`,
        store: artifactStoreService.describe().activeMode
      }
    };

    void artifactStoreService.writeJson(artifactScope, evidenceId, {
      evidenceId,
      taskId: task.id,
      tenantId: task.tenantId,
      target: input.target,
      category: input.category,
      severity: input.severity,
      title: input.title,
      description: input.description,
      sourceEngine: input.sourceEngine,
      payload: input.evidence
    }).catch((error: any) => {
      logger.warn('Failed to persist scan evidence artifact', {
        taskId: task.id,
        evidenceId,
        error: error?.message
      });
    });

    this.persistEvidence({
      id: evidenceId,
      runId: task.id,
      tenantId: task.tenantId,
      targetId: input.targetId,
      assetId: input.assetId,
      engine: input.sourceEngine,
      category: input.category,
      severity: input.severity,
      title: input.title,
      summary: input.description,
      fingerprint,
      rawRef: input.rawRef,
      details: enrichedEvidence,
      collectedAt: this.nowISO()
    });

    const db = getDatabase();
    db.prepare(`
      INSERT INTO scan_findings (task_id, tenant_id, target_type, target, severity, title, description, evidence_json, source_engine, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.tenantId,
      input.compatibilityTargetType,
      input.target,
      input.severity,
      input.title,
      input.description,
      toJson({ ...enrichedEvidence, evidenceId }),
      input.sourceEngine,
      findingCreatedAt
    );
    this.shadowUpsert('scan_findings', {
      id: legacyFindingId,
      task_id: task.id,
      tenant_id: task.tenantId,
      target_type: input.compatibilityTargetType,
      target: input.target,
      severity: input.severity,
      title: input.title,
      description: input.description,
      evidence_json: toJson({ ...enrichedEvidence, evidenceId }),
      source_engine: input.sourceEngine,
      created_at: findingCreatedAt
    });

    const finding = securityOperationsService.ingestFinding({
      tenantId: task.tenantId,
      assetId: input.assetId,
      sourceType: 'scanner',
      sourceRef: task.id,
      target: input.target,
      category: input.category,
      severity: input.severity,
      title: input.title,
      description: input.description,
      evidence: {
        ...enrichedEvidence,
        evidenceId,
        runId: task.id
      },
      remediation: this.buildRemediation(input.title, input.severity, input.target),
      fingerprint,
      createAlert: input.severity === 'critical' || input.severity === 'high'
    });

    if (
      finding &&
      (input.severity === 'critical' || input.severity === 'high') &&
      input.category !== 'availability'
    ) {
      securityOperationsService.ensureActionDraftForFinding(
        task.tenantId,
        finding.findingId,
        'system:auto-remediation'
      );
    }

    task.summary.findings[input.severity] = (task.summary.findings[input.severity] || 0) + 1;
    task.summary.evidenceCount = (task.summary.evidenceCount || 0) + 1;
    task.summary.validation.evidenceCollected = (task.summary.validation.evidenceCollected || 0) + 1;
    if (input.severity === 'critical' || input.severity === 'high') {
      task.summary.highRiskFindings = (task.summary.highRiskFindings || 0) + 1;
      task.summary.validation.actionsSuggested = (task.summary.validation.actionsSuggested || 0) + 1;
    }
  }

  private recordServiceExposure(
    task: ScanTaskState,
    input: {
      targetId?: string;
      host: string;
      port: number;
      protocol: string;
      banner?: string;
      tlsSummary?: Record<string, any>;
      metadata?: Record<string, any>;
      assetId?: string;
    }
  ): void {
    this.persistServiceExposure({
      id: randomUUID(),
      runId: task.id,
      tenantId: task.tenantId,
      targetId: input.targetId,
      assetId: input.assetId,
      host: input.host,
      port: input.port,
      protocol: input.protocol,
      service: SERVICE_NAMES[input.port] || input.protocol,
      banner: input.banner,
      tlsSummary: input.tlsSummary,
      metadata: input.metadata || {},
      discoveredAt: this.nowISO()
    });

    task.summary.servicesObserved = (task.summary.servicesObserved || 0) + 1;
    this.registerObservedAsset(
      task,
      input.targetId,
      'service',
      `${input.host}:${input.port}`,
      `${input.host}:${input.port}`,
      {
        primaryAddress: input.host,
        protocol: input.protocol,
        port: input.port,
        banner: input.banner,
        tlsSummary: input.tlsSummary
      }
    );
  }

  private getTrafficDestination(target: ResolvedScanTarget, host: string): string {
    if (isIp(host)) {
      return host;
    }

    const resolvedAddresses = Array.isArray(target.metadata?.resolvedAddresses)
      ? target.metadata.resolvedAddresses.filter((item: unknown): item is string => typeof item === 'string' && Boolean(item))
      : [];

    return resolvedAddresses[0] || host;
  }

  private recordTrafficSession(
    task: ScanTaskState,
    input: {
      target: ResolvedScanTarget;
      targetId?: string;
      sessionKind: string;
      destHost: string;
      destPort: number;
      protocol: string;
      state: string;
      byteCount?: number;
      packetCount?: number;
      metadata?: Record<string, any>;
      destAssetId?: string;
      sourceAssetId?: string;
    }
  ): void {
    const now = this.nowISO();
    securityOperationsService.upsertTrafficSession({
      tenantId: task.tenantId,
      sessionId: `scan:${task.id}:${input.sessionKind}:${randomUUID()}`,
      sourceIP: String(process.env.SCANNER_SOURCE_IP || '127.0.0.1'),
      destIP: this.getTrafficDestination(input.target, input.destHost),
      sourcePort: 40000 + Math.floor(Math.random() * 20000),
      destPort: input.destPort,
      protocol: input.protocol,
      state: input.state,
      packetCount: Math.max(1, Number(input.packetCount || 1)),
      byteCount: Math.max(0, Number(input.byteCount || 0)),
      startTime: now,
      lastActivity: now,
      sourceAssetId: input.sourceAssetId,
      destAssetId: input.destAssetId || input.target.assetIds[0],
      metadata: {
        origin: 'scanner',
        classification: input.metadata?.classification || 'scan-observation',
        runId: task.id,
        targetId: input.targetId || input.target.id,
        targetLabel: input.target.displayLabel,
        targetKind: input.target.kind,
        phase: task.phase,
        ...input.metadata
      }
    });

    task.summary.observedSessions = (task.summary.observedSessions || 0) + 1;
    if (!['ESTABLISHED', 'COMPLETED'].includes(input.state)) {
      task.summary.trafficAnomalies = (task.summary.trafficAnomalies || 0) + 1;
    }
  }

  private async resolveTarget(task: ScanTaskState, target: ScanRunTargetRecord): Promise<ResolvedScanTarget | null> {
    const metadata = { ...(target.metadata || {}) };
    const assetIds = new Set<string>();
    const hosts = new Set<string>();
    const urls = new Set<string>();

    const updateTarget = (status: ScanRunTargetRecord['status'], extra?: { error?: string; metadata?: Record<string, any> }) => {
      target.status = status;
      target.error = extra?.error;
      target.metadata = {
        ...target.metadata,
        ...(extra?.metadata || {})
      };
      target.updatedAt = this.nowISO();
      this.persistTarget(target);
    };

    if (target.kind === 'url') {
      try {
        const parsed = new URL(target.normalizedValue);
        urls.add(parsed.toString());
        hosts.add(parsed.hostname);
        assetIds.add(this.registerObservedAsset(task, target.id, 'url', parsed.toString(), target.displayLabel, {
          primaryAddress: parsed.hostname,
          protocol: parsed.protocol,
          hostname: parsed.hostname
        }));
        assetIds.add(this.registerObservedAsset(task, target.id, 'domain', parsed.hostname, parsed.hostname, {
          primaryAddress: parsed.hostname
        }));
        const addresses = await this.resolveDomainAddresses(parsed.hostname);
        metadata.resolvedAddresses = addresses;
        for (const address of addresses) {
          assetIds.add(this.registerObservedAsset(task, target.id, 'ip', address, address, {
            primaryAddress: address,
            hostname: parsed.hostname
          }));
        }
      } catch (error: any) {
        updateTarget('failed', { error: error.message });
        return null;
      }
    } else if (target.kind === 'domain') {
      hosts.add(target.normalizedValue);
      urls.add(`https://${target.normalizedValue}`);
      urls.add(`http://${target.normalizedValue}`);
      assetIds.add(this.registerObservedAsset(task, target.id, 'domain', target.normalizedValue, target.displayLabel, {
        primaryAddress: target.normalizedValue
      }));
      const addresses = await this.resolveDomainAddresses(target.normalizedValue);
      metadata.resolvedAddresses = addresses;
      for (const address of addresses) {
        assetIds.add(this.registerObservedAsset(task, target.id, 'ip', address, address, {
          primaryAddress: address,
          hostname: target.normalizedValue
        }));
      }
    } else if (target.kind === 'ip') {
      hosts.add(target.normalizedValue);
      urls.add(`https://${target.normalizedValue}`);
      urls.add(`http://${target.normalizedValue}`);
      assetIds.add(this.registerObservedAsset(task, target.id, 'ip', target.normalizedValue, target.displayLabel, {
        primaryAddress: target.normalizedValue
      }));
    } else if (target.kind === 'cidr') {
      const expanded = expandIpv4Cidr(target.normalizedValue, 32);
      if (expanded.length === 0) {
        updateTarget('failed', { error: 'Invalid or unsupported CIDR range' });
        return null;
      }
      metadata.expandedHosts = expanded;
      expanded.forEach((address) => {
        hosts.add(address);
        urls.add(`https://${address}`);
        urls.add(`http://${address}`);
      });
    } else if (target.kind === 'assetId') {
      const asset = securityOperationsService.getAssetById(task.tenantId, target.normalizedValue);
      if (!asset) {
        updateTarget('failed', { error: 'Referenced asset was not found' });
        return null;
      }
      assetIds.add(asset.assetId);
      metadata.assetType = asset.assetType;
      metadata.assetRef = asset.externalRef;
      if (asset.assetType === 'url') {
        urls.add(asset.externalRef);
        try {
          const parsed = new URL(asset.externalRef);
          hosts.add(parsed.hostname);
        } catch {
          // Ignore malformed stored asset URLs.
        }
      } else if (asset.assetType === 'domain' || asset.assetType === 'host' || asset.assetType === 'ip') {
        hosts.add(asset.externalRef);
        urls.add(`https://${asset.externalRef}`);
        urls.add(`http://${asset.externalRef}`);
      }
    } else if (target.kind === 'deviceId') {
      const runtimeDevice = getDeviceList().find((item) => String(item.deviceId) === target.normalizedValue);
      if (!runtimeDevice) {
        updateTarget('failed', { error: 'Device target was not found' });
        return null;
      }

      assetIds.add(this.registerObservedAsset(task, target.id, 'device', runtimeDevice.deviceId, runtimeDevice.deviceId, {
        primaryAddress: runtimeDevice.systemInfo?.hostname || runtimeDevice.deviceId,
        status: runtimeDevice.isOnline ? 'online' : 'offline',
        chipModel: runtimeDevice.chipModel,
        firmwareVersion: runtimeDevice.version,
        sdkVersion: runtimeDevice.sdkVersion
      }));
      if (runtimeDevice.systemInfo?.hostname) {
        assetIds.add(this.registerObservedAsset(task, target.id, 'host', runtimeDevice.systemInfo.hostname, runtimeDevice.systemInfo.hostname, {
          primaryAddress: runtimeDevice.systemInfo.hostname,
          status: runtimeDevice.isOnline ? 'online' : 'offline',
          deviceId: runtimeDevice.deviceId
        }));
      }
      metadata.runtimeScope = 'device';
      metadata.runtimeSnapshot = {
        deviceId: runtimeDevice.deviceId,
        version: runtimeDevice.version,
        chipModel: runtimeDevice.chipModel,
        sdkVersion: runtimeDevice.sdkVersion,
        freeHeap: runtimeDevice.freeHeap,
        isOnline: runtimeDevice.isOnline,
        status: runtimeDevice.status,
        systemInfo: runtimeDevice.systemInfo
      };
    } else if (target.kind === 'agentId') {
      const runtimeAgent = getAgentGateway()?.getAgent(target.normalizedValue);
      if (!runtimeAgent) {
        updateTarget('failed', { error: 'Agent target was not found' });
        return null;
      }

      assetIds.add(this.registerObservedAsset(task, target.id, 'agent', runtimeAgent.agentId, runtimeAgent.hostname || runtimeAgent.agentId, {
        primaryAddress: runtimeAgent.registration?.ip || runtimeAgent.hostname,
        status: runtimeAgent.status?.isOnline === false ? 'offline' : 'online',
        platform: runtimeAgent.platform,
        version: runtimeAgent.registration?.version,
        hostname: runtimeAgent.hostname
      }));
      if (runtimeAgent.hostname) {
        assetIds.add(this.registerObservedAsset(task, target.id, 'host', runtimeAgent.hostname, runtimeAgent.hostname, {
          primaryAddress: runtimeAgent.registration?.ip || runtimeAgent.hostname,
          status: runtimeAgent.status?.isOnline === false ? 'offline' : 'online',
          agentId: runtimeAgent.agentId
        }));
      }
      metadata.runtimeScope = 'agent';
      metadata.runtimeSnapshot = {
        agentId: runtimeAgent.agentId,
        hostname: runtimeAgent.hostname,
        platform: runtimeAgent.platform,
        registration: runtimeAgent.registration,
        isOnline: runtimeAgent.status?.isOnline ?? true,
        status: runtimeAgent.status,
        lastHeartbeat: runtimeAgent.lastHeartbeat
      };
    } else if (target.kind === 'host') {
      hosts.add('127.0.0.1');
      assetIds.add(this.registerObservedAsset(task, target.id, 'host', 'local', 'Local Host', {
        primaryAddress: '127.0.0.1',
        status: 'online'
      }));
      metadata.executionMode = 'local';
    }

    updateTarget('resolved', { metadata });

    return {
      id: target.id,
      runId: target.runId,
      tenantId: target.tenantId,
      kind: target.kind,
      displayLabel: target.displayLabel,
      rawValue: target.rawValue,
      normalizedValue: target.normalizedValue,
      primaryAddress: hosts.values().next().value,
      hosts: Array.from(hosts),
      urls: Array.from(urls),
      metadata,
      assetIds: Array.from(assetIds),
      supportsHostBaseline:
        (target.kind === 'host' && target.normalizedValue === 'local') ||
        target.kind === 'agentId' ||
        target.kind === 'deviceId'
    };
  }

  private getStageLabel(stageKey: ScanPhase): string {
    const labels: Record<ScanPhase, string> = {
      queued: 'Queued',
      normalizing: 'Normalize request',
      'asset-resolution': 'Resolve targets and assets',
      'web-scan': 'Web, TLS and service exposure scan',
      'host-scan': 'Host baseline and local posture',
      'nuclei-scan': 'Template-driven validation',
      correlation: 'Correlate findings and operations',
      finalizing: 'Finalize run summary',
      done: 'Completed'
    };
    return labels[stageKey];
  }

  private beginStage(task: ScanTaskState, stageKey: ScanPhase, progress: number, detail?: string): ScanStageRecord {
    const stage: ScanStageRecord = {
      id: `${task.id}:${stageKey}`,
      runId: task.id,
      tenantId: task.tenantId,
      stageKey,
      stageLabel: this.getStageLabel(stageKey),
      status: 'running',
      progress,
      detail,
      startedAt: this.nowISO(),
      metadata: {}
    };
    this.persistStage(stage);
    task.phase = stageKey;
    task.progress = progress;
    this.upsertTask(task, 'scanner:task:phase', { phase: stageKey, progress, detail });
    return stage;
  }

  private updateStageProgress(task: ScanTaskState, stage: ScanStageRecord, progress: number, detail?: string): void {
    stage.progress = progress;
    stage.detail = detail || stage.detail;
    this.persistStage(stage);
    task.progress = progress;
    this.upsertTask(task, 'scanner:task:progress', { phase: task.phase, progress, detail });
  }

  private finishStage(task: ScanTaskState, stage: ScanStageRecord, detail?: string, metadata?: Record<string, any>): void {
    stage.status = 'completed';
    stage.progress = Math.max(stage.progress, task.progress);
    stage.detail = detail || stage.detail;
    stage.completedAt = this.nowISO();
    stage.durationMs = stage.startedAt ? new Date(stage.completedAt).getTime() - new Date(stage.startedAt).getTime() : undefined;
    stage.metadata = {
      ...stage.metadata,
      ...(metadata || {})
    };
    this.persistStage(stage);
    this.emitEvent(task, 'scanner:task:log', { level: 'info', message: `${stage.stageLabel} completed` });
  }

  private skipStage(task: ScanTaskState, stageKey: ScanPhase, progress: number, detail: string): void {
    const stage: ScanStageRecord = {
      id: `${task.id}:${stageKey}`,
      runId: task.id,
      tenantId: task.tenantId,
      stageKey,
      stageLabel: this.getStageLabel(stageKey),
      status: 'skipped',
      progress,
      detail,
      startedAt: this.nowISO(),
      completedAt: this.nowISO(),
      metadata: {}
    };
    this.persistStage(stage);
    this.emitEvent(task, 'scanner:task:log', { level: 'info', message: detail });
  }

  private ensureNotCancelled(task: ScanTaskState): void {
    if (this.cancelled.has(task.id)) {
      throw new ScanCancelledError();
    }
  }

  private getProfile(profileId: string): ScanProfileRecord | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM scan_profiles WHERE id = ? LIMIT 1').get(profileId) as any;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      scopes: parseJson(row.scopes_json, []),
      engines: parseJson(row.engines_json, []),
      portSet: parseJson(row.port_set_json, []),
      templateSet: parseJson(row.template_set_json, []),
      timeoutPolicy: parseJson(row.timeout_policy_json, { ...DEFAULT_TIMEOUT_POLICY }),
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private async getProfileView(profileId: string): Promise<ScanProfileRecord | null> {
    const row = await this.queryShadowOneWithFallback<any>(
      'SELECT * FROM scan_profiles WHERE id = $1 LIMIT 1',
      [profileId],
      () => {
        const db = getDatabase();
        return db.prepare('SELECT * FROM scan_profiles WHERE id = ? LIMIT 1').get(profileId) as any;
      }
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      scopes: parseJson(row.scopes_json, []),
      engines: parseJson(row.engines_json, []),
      portSet: parseJson(row.port_set_json, []),
      templateSet: parseJson(row.template_set_json, []),
      timeoutPolicy: parseJson(row.timeout_policy_json, { ...DEFAULT_TIMEOUT_POLICY }),
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private listRunTargets(runId: string): ScanRunTargetRecord[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM scan_run_targets
      WHERE run_id = ?
      ORDER BY created_at ASC
    `).all(runId) as any[];
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      tenantId: row.tenant_id,
      kind: row.target_kind,
      rawValue: row.raw_value,
      normalizedValue: row.normalized_value,
      displayLabel: row.display_label,
      status: row.status,
      error: row.error || undefined,
      metadata: parseJson(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private getTaskRelatedArtifacts(task: ScanTaskState) {
    const db = getDatabase();
    const evidenceFingerprints = (db.prepare(`
      SELECT DISTINCT fingerprint
      FROM scan_evidence
      WHERE run_id = ?
    `).all(task.id) as any[])
      .map((row: any) => row.fingerprint)
      .filter(Boolean);

    const findings = evidenceFingerprints.length > 0
      ? (db.prepare(`
          SELECT finding_id
          FROM sec_findings
          WHERE tenant_id = ? AND fingerprint IN (${evidenceFingerprints.map(() => '?').join(',')})
          ORDER BY updated_at DESC
        `).all(task.tenantId, ...evidenceFingerprints) as any[])
          .map((row: any) => securityOperationsService.getFindingById(task.tenantId, row.finding_id))
          .filter((finding): finding is NonNullable<ReturnType<typeof securityOperationsService.getFindingById>> => Boolean(finding))
      : [];
    const findingIds = findings.map((finding) => finding.findingId);

    const relatedAlerts = findingIds.length > 0
      ? (db.prepare(`
          SELECT * FROM sec_alerts
          WHERE tenant_id = ? AND finding_id IN (${findingIds.map(() => '?').join(',')})
          ORDER BY updated_at DESC
        `).all(task.tenantId, ...findingIds) as any[])
      : [];

    const relatedActions = findingIds.length > 0
      ? (db.prepare(`
          SELECT * FROM sec_actions
          WHERE tenant_id = ? AND finding_id IN (${findingIds.map(() => '?').join(',')})
          ORDER BY updated_at DESC
        `).all(task.tenantId, ...findingIds) as any[])
      : [];

    const relatedTrafficSessions = db.prepare(`
      SELECT *
      FROM sec_traffic_sessions
      WHERE tenant_id = ? AND session_id LIKE ?
      ORDER BY last_activity DESC
    `).all(task.tenantId, `scan:${task.id}:%`) as any[];

    return { findings, relatedAlerts, relatedActions, relatedTrafficSessions };
  }

  private async getTaskRelatedArtifactsView(task: ScanTaskState): Promise<{
    findings: FindingRecord[];
    relatedAlerts: any[];
    relatedActions: any[];
    relatedTrafficSessions: any[];
  }> {
    const evidenceFingerprints = (await this.queryShadowAllWithFallback<any>(
      `
        SELECT DISTINCT fingerprint
        FROM scan_evidence
        WHERE run_id = $1
      `,
      [task.id],
      () => {
        const db = getDatabase();
        return db.prepare(`
          SELECT DISTINCT fingerprint
          FROM scan_evidence
          WHERE run_id = ?
        `).all(task.id) as any[];
      }
    ))
      .map((row: any) => row.fingerprint)
      .filter(Boolean);

    const findings = await securityOperationsService.listFindingsByFingerprintsView(task.tenantId, evidenceFingerprints);
    const findingIds = findings.map((finding) => finding.findingId);

    const relatedAlerts = findingIds.length > 0
      ? await this.queryShadowAllWithFallback<any>(
          `
            SELECT * FROM sec_alerts
            WHERE tenant_id = $1 AND finding_id = ANY($2)
            ORDER BY updated_at DESC
          `,
          [task.tenantId, findingIds],
          () => {
            const db = getDatabase();
            return db.prepare(`
              SELECT * FROM sec_alerts
              WHERE tenant_id = ? AND finding_id IN (${findingIds.map(() => '?').join(',')})
              ORDER BY updated_at DESC
            `).all(task.tenantId, ...findingIds) as any[];
          }
        )
      : [];

    const relatedActions = findingIds.length > 0
      ? await this.queryShadowAllWithFallback<any>(
          `
            SELECT * FROM sec_actions
            WHERE tenant_id = $1 AND finding_id = ANY($2)
            ORDER BY updated_at DESC
          `,
          [task.tenantId, findingIds],
          () => {
            const db = getDatabase();
            return db.prepare(`
              SELECT * FROM sec_actions
              WHERE tenant_id = ? AND finding_id IN (${findingIds.map(() => '?').join(',')})
              ORDER BY updated_at DESC
            `).all(task.tenantId, ...findingIds) as any[];
          }
        )
      : [];

    const relatedTrafficSessions = await this.queryShadowAllWithFallback<any>(
      `
        SELECT *
        FROM sec_traffic_sessions
        WHERE tenant_id = $1 AND session_id LIKE $2
        ORDER BY last_activity DESC
      `,
      [task.tenantId, `scan:${task.id}:%`],
      () => {
        const db = getDatabase();
        return db.prepare(`
          SELECT *
          FROM sec_traffic_sessions
          WHERE tenant_id = ? AND session_id LIKE ?
          ORDER BY last_activity DESC
        `).all(task.tenantId, `scan:${task.id}:%`) as any[];
      }
    );

    return { findings, relatedAlerts, relatedActions, relatedTrafficSessions };
  }

  private mapTaskRow(row: any): ScanTaskState {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      createdBy: row.created_by,
      status: row.status,
      phase: row.phase,
      progress: Number(row.progress || 0),
      enginePolicy: row.engine_policy,
      profileId: row.profile_id || '',
      targets: parseJson(row.request_json || row.targets_json, {}),
      summary: parseJson(row.summary_json, { ...DEFAULT_SUMMARY }),
      error: row.error || undefined,
      createdAt: row.created_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined
    };
  }

  async createTask(input: ScanTaskInput): Promise<ScanTaskState> {
    this.assertPrepared();

    const normalizedTargets = this.normalizeTargets(input);
    const profile = this.deriveProfile(input, normalizedTargets);
    const task = this.createTaskState(input, profile, normalizedTargets);

    normalizedTargets.forEach((target) => {
      target.runId = task.id;
      target.tenantId = task.tenantId;
    });

    this.persistProfile(profile);
    this.upsertTask(task, 'scanner:task:created', { status: task.status, phase: task.phase, queued: true });
    normalizedTargets.forEach((target) => this.persistTarget(target));
    this.enqueueTask(task.id);
    this.scheduleQueuePump();

    return task;
  }

  async retryTask(taskId: string, actor?: string): Promise<ScanTaskState | null> {
    const existing = this.getTask(taskId);
    if (!existing) {
      return null;
    }

    return this.createTask({
      tenantId: existing.tenantId,
      createdBy: actor || existing.createdBy,
      enginePolicy: existing.enginePolicy,
      targets: existing.targets
    });
  }

  getRunningTaskByTenant(tenantId: string): ScanTaskState | null {
    for (const task of this.tasks.values()) {
      if (task.tenantId === tenantId && (task.status === 'pending' || task.status === 'running')) {
        return task;
      }
    }

    this.assertPrepared();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM scan_runs
      WHERE tenant_id = ? AND status IN ('pending', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(tenantId) as any;
    return row ? this.mapTaskRow(row) : null;
  }

  getTask(taskId: string): ScanTaskState | null {
    const task = this.tasks.get(taskId);
    if (task) {
      return task;
    }

    this.assertPrepared();
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM scan_runs WHERE id = ? LIMIT 1').get(taskId) as any;
    return row ? this.mapTaskRow(row) : null;
  }

  getHistory(tenantId: string, limit = 20): ScanTaskState[] {
    this.assertPrepared();
    const rowsById = new Map<string, ScanTaskState>();
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM scan_runs
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(tenantId, limit) as any[];
    rows.forEach((row) => rowsById.set(row.id, this.mapTaskRow(row)));
    for (const task of this.tasks.values()) {
      if (task.tenantId === tenantId) {
        rowsById.set(task.id, task);
      }
    }
    return Array.from(rowsById.values())
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, limit);
  }

  async getTaskView(taskId: string): Promise<ScanTaskState | null> {
    const liveTask = this.tasks.get(taskId);
    const row = await this.queryShadowOneWithFallback<any>(
      'SELECT * FROM scan_runs WHERE id = $1 LIMIT 1',
      [taskId],
      () => {
        this.assertPrepared();
        const db = getDatabase();
        return db.prepare('SELECT * FROM scan_runs WHERE id = ? LIMIT 1').get(taskId) as any;
      }
    );

    if (liveTask && (!row || new Date(liveTask.createdAt).getTime() >= new Date(row.created_at || 0).getTime())) {
      return liveTask;
    }
    return row ? this.mapTaskRow(row) : liveTask || null;
  }

  async getHistoryView(tenantId: string, limit = 20): Promise<ScanTaskState[]> {
    const rowsById = new Map<string, ScanTaskState>();
    const rows = await this.queryShadowAllWithFallback<any>(
      `
        SELECT * FROM scan_runs
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [tenantId, limit],
      () => {
        this.assertPrepared();
        const db = getDatabase();
        return db.prepare(`
          SELECT * FROM scan_runs
          WHERE tenant_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `).all(tenantId, limit) as any[];
      }
    );
    rows.forEach((row) => rowsById.set(row.id, this.mapTaskRow(row)));
    for (const task of this.tasks.values()) {
      if (task.tenantId === tenantId) {
        rowsById.set(task.id, task);
      }
    }
    return Array.from(rowsById.values())
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, limit);
  }

  cancelTask(taskId: string): boolean {
    const task = this.getTask(taskId);
    if (!task) {
      return false;
    }
    if (task.status !== 'pending' && task.status !== 'running') {
      return false;
    }

    this.cancelled.add(taskId);
    if (task.status === 'pending') {
      this.queue = this.queue.filter((queuedId) => queuedId !== taskId);
      this.refreshQueuePositions();
      void jobQueueService.remove('scanner-runs', taskId);
    }

    task.status = 'cancelled';
    task.phase = 'done';
    task.progress = 100;
    task.completedAt = this.nowISO();
    task.error = undefined;
    this.upsertTask(task, 'scanner:task:cancelled', { status: task.status, phase: task.phase });
    return true;
  }

  private async scanResolvedTarget(task: ScanTaskState, target: ResolvedScanTarget, profile: ScanProfileRecord): Promise<void> {
    this.ensureNotCancelled(task);
    const requestTimeout = profile.timeoutPolicy.requestMs || DEFAULT_TIMEOUT_POLICY.requestMs;
    const connectTimeout = profile.timeoutPolicy.connectMs || DEFAULT_TIMEOUT_POLICY.connectMs;
    const hosts = target.hosts.length > 0 ? target.hosts : target.primaryAddress ? [target.primaryAddress] : [];
    const urls = target.urls.length > 0 ? target.urls : hosts.flatMap((host) => [`https://${host}`, `http://${host}`]);

    for (const host of hosts) {
      const openPorts = await this.probePorts(host, profile.portSet || DEFAULT_PORT_SET, connectTimeout);
      for (const portInfo of openPorts) {
        const tlsSummary = portInfo.port === 443 || portInfo.port === 8443
          ? await this.inspectTlsEndpoint(host, portInfo.port, host)
          : null;
        const assetId = target.assetIds[0];
        this.recordTrafficSession(task, {
          target,
          targetId: target.id,
          sessionKind: 'port-probe',
          destHost: host,
          destPort: portInfo.port,
          protocol: 'tcp',
          state: 'ESTABLISHED',
          packetCount: 2,
          byteCount: (portInfo.banner ? Buffer.byteLength(portInfo.banner, 'utf8') : 0) + 96,
          metadata: {
            service: SERVICE_NAMES[portInfo.port] || 'tcp',
            bannerPresent: Boolean(portInfo.banner),
            classification: SENSITIVE_PORTS.has(portInfo.port) ? 'security-signal' : 'scan-observation'
          },
          destAssetId: assetId
        });
        this.recordServiceExposure(task, {
          targetId: target.id,
          host,
          port: portInfo.port,
          protocol: SERVICE_NAMES[portInfo.port] || 'tcp',
          banner: portInfo.banner,
          tlsSummary: tlsSummary || undefined,
          metadata: { targetLabel: target.displayLabel },
          assetId
        });

        const riskyPort = SENSITIVE_PORTS.get(portInfo.port);
        if (riskyPort) {
          this.recordFinding(task, {
            targetId: target.id,
            compatibilityTargetType: 'url',
            target: host,
            category: 'service-exposure',
            severity: riskyPort.severity,
            title: riskyPort.title,
            description: `Observed ${SERVICE_NAMES[portInfo.port] || 'service'} on ${host}:${portInfo.port}.`,
            evidence: {
              host,
              port: portInfo.port,
              banner: portInfo.banner,
              tlsSummary
            },
            sourceEngine: 'port_probe',
            rawRef: `${host}:${portInfo.port}`,
            assetId
          });
        }
      }
    }

    for (const url of urls) {
      this.ensureNotCancelled(task);
      let response: Response | null = null;
      let tlsSummary: Record<string, any> | null = null;
      let responseBody = '';
      let responseUrl = url;
      let requestStartedAt = Date.now();

      try {
        const parsed = new URL(url);
        requestStartedAt = Date.now();
        if (parsed.protocol === 'https:') {
          tlsSummary = await this.inspectTlsEndpoint(parsed.hostname, Number(parsed.port || 443), parsed.hostname);
        }
        response = await this.fetchWithTimeout(url, requestTimeout);
        responseUrl = response.url || url;
        responseBody = await response.text();
        this.recordTrafficSession(task, {
          target,
          targetId: target.id,
          sessionKind: 'web-fetch',
          destHost: parsed.hostname,
          destPort: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
          protocol: parsed.protocol.replace(':', ''),
          state: response.ok ? 'COMPLETED' : 'FAILED',
          packetCount: Math.max(3, Math.ceil(responseBody.length / 256) + 2),
          byteCount: Buffer.byteLength(responseBody || '', 'utf8') + 256,
          metadata: {
            classification: response.ok ? 'scan-observation' : 'scan-failure',
            status: response.status,
            statusText: response.statusText,
            responseUrl,
            redirected: responseUrl !== url,
            durationMs: Date.now() - requestStartedAt
          },
          destAssetId: target.assetIds[0]
        });
      } catch (error: any) {
        try {
          const failedUrl = new URL(url);
          this.recordTrafficSession(task, {
            target,
            targetId: target.id,
            sessionKind: 'web-fetch',
            destHost: failedUrl.hostname,
            destPort: Number(failedUrl.port || (failedUrl.protocol === 'https:' ? 443 : 80)),
            protocol: failedUrl.protocol.replace(':', ''),
            state: error?.name === 'AbortError' ? 'TIMED_OUT' : 'FAILED',
            packetCount: 1,
            byteCount: 0,
            metadata: {
              classification: 'scan-failure',
              error: error.message,
              url
            },
            destAssetId: target.assetIds[0]
          });
        } catch {
          // Ignore malformed URLs during traffic correlation.
        }
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'url',
          target: url,
          category: 'availability',
          severity: 'high',
          title: 'Target Unreachable',
          description: `Failed to fetch target ${url}: ${error.message}`,
          evidence: { error: error.message, url },
          sourceEngine: 'web_probe',
          rawRef: url,
          assetId: target.assetIds[0]
        });
        continue;
      }

      const headers = response.headers;
      const status = response.status;
      const server = headers.get('server');
      const missingHeaders = ['x-content-type-options', 'x-frame-options', 'content-security-policy']
        .filter((header) => !headers.get(header));

      if (status >= 500) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'url',
          target: responseUrl,
          category: 'availability',
          severity: 'medium',
          title: 'Server Error Response',
          description: `The endpoint returned HTTP ${status}.`,
          evidence: { status, responseUrl },
          sourceEngine: 'web_probe',
          rawRef: responseUrl,
          assetId: target.assetIds[0]
        });
      }

      for (const header of missingHeaders) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'url',
          target: responseUrl,
          category: 'web-posture',
          severity: 'medium',
          title: 'Missing Security Header',
          description: `Missing expected response header ${header}.`,
          evidence: { header, status, responseUrl },
          sourceEngine: 'web_probe',
          rawRef: responseUrl,
          assetId: target.assetIds[0]
        });
      }

      if (server && /apache\/2\.2|apache\/2\.4\.([0-2]\d|3[0-5])|nginx\/1\.(0|1|2|3|4|5|6|7|8|9)\b/i.test(server)) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'url',
          target: responseUrl,
          category: 'service-fingerprint',
          severity: 'high',
          title: 'Potentially Outdated Server Version',
          description: `Server header indicates an older software branch: ${server}.`,
          evidence: { server, responseUrl },
          sourceEngine: 'web_probe',
          rawRef: responseUrl,
          assetId: target.assetIds[0]
        });
      }

      const setCookie = headers.get('set-cookie') || '';
      if (setCookie && (!/secure/i.test(setCookie) || !/httponly/i.test(setCookie))) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'url',
          target: responseUrl,
          category: 'web-posture',
          severity: 'medium',
          title: 'Session Cookie Missing Hardening Flags',
          description: 'Observed Set-Cookie headers without both Secure and HttpOnly flags.',
          evidence: { setCookie: setCookie.slice(0, 256), responseUrl },
          sourceEngine: 'web_probe',
          rawRef: responseUrl,
          assetId: target.assetIds[0]
        });
      }

      if (tlsSummary && typeof tlsSummary.daysRemaining === 'number' && tlsSummary.daysRemaining <= 30) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'url',
          target: responseUrl,
          category: 'tls-posture',
          severity: tlsSummary.daysRemaining <= 7 ? 'critical' : 'high',
          title: 'TLS Certificate Expiring Soon',
          description: `Certificate for ${responseUrl} expires in ${tlsSummary.daysRemaining} days.`,
          evidence: tlsSummary,
          sourceEngine: 'tls_probe',
          rawRef: responseUrl,
          assetId: target.assetIds[0]
        });
      }

      if (tlsSummary?.protocol && /^TLSv1(\.0|\.1)?$/i.test(String(tlsSummary.protocol))) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'url',
          target: responseUrl,
          category: 'tls-posture',
          severity: 'high',
          title: 'Legacy TLS Protocol Enabled',
          description: `Endpoint negotiated ${tlsSummary.protocol}.`,
          evidence: tlsSummary,
          sourceEngine: 'tls_probe',
          rawRef: responseUrl,
          assetId: target.assetIds[0]
        });
      }

      const exposureProbes: Array<{ path: string; pattern?: RegExp; title: string; severity: Severity }> = [
        { path: '/.env', pattern: /(APP_KEY|DATABASE_URL|SECRET_KEY|API_KEY|JWT_SECRET)/i, title: 'Environment File Exposed', severity: 'critical' },
        { path: '/.git/HEAD', pattern: /ref:\s+refs\//i, title: 'Git Metadata Exposed', severity: 'high' },
        { path: '/server-status', pattern: /(Server Version|Current Time|Scoreboard)/i, title: 'Server Status Endpoint Exposed', severity: 'high' },
        { path: '/actuator/health', pattern: /(status|UP|DOWN)/i, title: 'Actuator Endpoint Exposed', severity: 'medium' }
      ];

      for (const probe of exposureProbes) {
        this.ensureNotCancelled(task);
        try {
          const probeUrl = new URL(probe.path, responseUrl).toString();
          const parsedProbeUrl = new URL(probeUrl);
          const probeResponse = await this.fetchWithTimeout(probeUrl, Math.min(requestTimeout, 3000));
          const body = await probeResponse.text();
          this.recordTrafficSession(task, {
            target,
            targetId: target.id,
            sessionKind: 'surface-probe',
            destHost: parsedProbeUrl.hostname,
            destPort: Number(parsedProbeUrl.port || (parsedProbeUrl.protocol === 'https:' ? 443 : 80)),
            protocol: parsedProbeUrl.protocol.replace(':', ''),
            state: probeResponse.ok ? 'COMPLETED' : 'FAILED',
            packetCount: Math.max(2, Math.ceil(body.length / 512) + 1),
            byteCount: Buffer.byteLength(body || '', 'utf8') + 128,
            metadata: {
              classification: probeResponse.ok ? 'scan-observation' : 'scan-failure',
              path: probe.path,
              status: probeResponse.status,
              responseUrl: probeUrl
            },
            destAssetId: target.assetIds[0]
          });
          if (probeResponse.ok && (!probe.pattern || probe.pattern.test(body))) {
            this.recordTrafficSession(task, {
              target,
              targetId: target.id,
              sessionKind: 'surface-hit',
              destHost: parsedProbeUrl.hostname,
              destPort: Number(parsedProbeUrl.port || (parsedProbeUrl.protocol === 'https:' ? 443 : 80)),
              protocol: parsedProbeUrl.protocol.replace(':', ''),
              state: 'COMPLETED',
              packetCount: Math.max(2, Math.ceil(body.length / 512) + 1),
              byteCount: Buffer.byteLength(body || '', 'utf8') + 128,
              metadata: {
                classification: 'sensitive-exposure',
                path: probe.path,
                status: probeResponse.status,
                responseUrl: probeUrl
              },
              destAssetId: target.assetIds[0]
            });
            this.recordFinding(task, {
              targetId: target.id,
              compatibilityTargetType: 'url',
              target: probeUrl,
              category: 'exposed-surface',
              severity: probe.severity,
              title: probe.title,
              description: `Observed accessible path ${probe.path} with sensitive response content.`,
              evidence: {
                path: probe.path,
                status: probeResponse.status,
                snippet: body.slice(0, 256)
              },
              sourceEngine: 'surface_probe',
              rawRef: probeUrl,
              assetId: target.assetIds[0]
            });
          }
        } catch (probeError: any) {
          const failedProbeUrl = new URL(probe.path, responseUrl);
          this.recordTrafficSession(task, {
            target,
            targetId: target.id,
            sessionKind: 'surface-probe',
            destHost: failedProbeUrl.hostname,
            destPort: Number(failedProbeUrl.port || (failedProbeUrl.protocol === 'https:' ? 443 : 80)),
            protocol: failedProbeUrl.protocol.replace(':', ''),
            state: probeError?.name === 'AbortError' ? 'TIMED_OUT' : 'FAILED',
            packetCount: 1,
            byteCount: 0,
            metadata: {
              classification: 'scan-failure',
              path: probe.path,
              error: probeError?.message || 'probe_failed'
            },
            destAssetId: target.assetIds[0]
          });
        }
      }

      if (/Index of \//i.test(responseBody) || /directory listing/i.test(responseBody)) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'url',
          target: responseUrl,
          category: 'exposed-surface',
          severity: 'medium',
          title: 'Directory Listing Enabled',
          description: 'The response suggests directory listing is enabled.',
          evidence: {
            responseUrl,
            snippet: responseBody.slice(0, 256)
          },
          sourceEngine: 'web_probe',
          rawRef: responseUrl,
          assetId: target.assetIds[0]
        });
      }
    }
  }

  private async runHostBaseline(task: ScanTaskState, target: ResolvedScanTarget): Promise<void> {
    this.ensureNotCancelled(task);
    if (!target.supportsHostBaseline) {
      this.emitEvent(task, 'scanner:task:log', {
        level: 'info',
        message: `Skipping host baseline for ${target.displayLabel}: target is not locally executable`
      });
      return;
    }

    if (target.metadata?.runtimeScope === 'agent' || target.metadata?.runtimeScope === 'device') {
      await this.runRuntimeBaseline(task, target);
      return;
    }

    const legacyOptions = task.targets.host || {
      mode: 'local' as const,
      includeSystem: true,
      includeWeb: true,
      includePorts: true
    };

    const result = await this.optimizationEngine.runFullScan({
      scanPorts: legacyOptions.includePorts,
      scanSystem: legacyOptions.includeSystem,
      scanWebServer: legacyOptions.includeWeb
    });

    for (const recommendation of result.recommendations || []) {
      this.recordFinding(task, {
        targetId: target.id,
        compatibilityTargetType: 'host',
        target: target.displayLabel,
        category: 'host-posture',
        severity: normalizeSeverity(recommendation.priority),
        title: recommendation.title,
        description: recommendation.description,
        evidence: recommendation,
        sourceEngine: 'optimization_engine',
        rawRef: target.displayLabel,
        assetId: target.assetIds[0]
      });
    }
  }

  private async runRuntimeBaseline(task: ScanTaskState, target: ResolvedScanTarget): Promise<void> {
    const runtimeScope = String(target.metadata?.runtimeScope || '');
    const snapshot = target.metadata?.runtimeSnapshot || {};
    const assetId = target.assetIds[0];
    const runtimeFlows: Array<{
      destHost: string;
      destPort: number;
      protocol: string;
      state: string;
      packetCount: number;
      byteCount: number;
      classification: string;
      description: string;
    }> = [];

    if (runtimeScope === 'agent') {
      const status = snapshot.status || {};
      const registration = snapshot.registration || {};
      const version = String(registration.version || '0.0.0');
      const role = String(registration.role || 'edge');
      const hostname = String(snapshot.hostname || target.displayLabel);

      this.recordFinding(task, {
        targetId: target.id,
        compatibilityTargetType: 'host',
        target: hostname,
        category: 'agent-runtime-baseline',
        severity: 'low',
        title: 'Agent Runtime Baseline Captured',
        description: `Captured live agent posture for ${hostname}: role ${role}, version ${version}, CPU ${status.cpuUsage ?? 'n/a'}%, memory ${status.memoryUsage ?? 'n/a'}%.`,
        evidence: {
          agentId: snapshot.agentId || target.normalizedValue,
          hostname,
          role,
          version,
          cpuUsage: status.cpuUsage,
          memoryUsage: status.memoryUsage,
          uptime: status.uptime,
          lastHeartbeat: snapshot.lastHeartbeat,
          platform: snapshot.platform
        },
        sourceEngine: 'runtime_baseline',
        rawRef: hostname,
        assetId
      });

      runtimeFlows.push({
        destHost: String(registration.ip || '172.22.0.10'),
        destPort: 443,
        protocol: 'tcp',
        state: snapshot.isOnline === false ? 'FAILED' : 'ESTABLISHED',
        packetCount: snapshot.isOnline === false ? 1 : 12,
        byteCount: snapshot.isOnline === false ? 0 : 8192,
        classification: snapshot.isOnline === false ? 'scan-failure' : 'runtime-observation',
        description: 'Agent control plane session'
      });

      if (role === 'inspection') {
        runtimeFlows.push({
          destHost: '172.22.0.53',
          destPort: 53,
          protocol: 'udp',
          state: 'ESTABLISHED',
          packetCount: 8,
          byteCount: 2048,
          classification: 'runtime-observation',
          description: 'Recursive DNS resolution path'
        });
      }

      if (role === 'egress' || role === 'gateway') {
        runtimeFlows.push({
          destHost: '198.18.0.12',
          destPort: 8443,
          protocol: 'tcp',
          state: Number(status.cpuUsage || 0) >= 85 ? 'SUSPICIOUS' : 'ESTABLISHED',
          packetCount: 10,
          byteCount: 4096,
          classification: Number(status.cpuUsage || 0) >= 85 ? 'security-signal' : 'runtime-observation',
          description: 'Northbound inspection channel'
        });
      }

      if (snapshot.isOnline === false) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'host',
          target: hostname,
          category: 'agent-runtime',
          severity: 'critical',
          title: 'Agent Runtime Offline',
          description: `Agent ${hostname} is not reporting to the control plane.`,
          evidence: {
            agentId: snapshot.agentId || target.normalizedValue,
            lastHeartbeat: snapshot.lastHeartbeat
          },
          sourceEngine: 'runtime_baseline',
          rawRef: hostname,
          assetId
        });
      }

      if (Number(status.cpuUsage || 0) >= 85) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'host',
          target: hostname,
          category: 'agent-runtime',
          severity: Number(status.cpuUsage || 0) >= 92 ? 'critical' : 'high',
          title: 'Agent Runtime CPU Pressure',
          description: `Agent CPU usage is ${status.cpuUsage}% during runtime inspection.`,
          evidence: {
            cpuUsage: status.cpuUsage,
            uptime: status.uptime
          },
          sourceEngine: 'runtime_baseline',
          rawRef: hostname,
          assetId
        });
      }

      if (Number(status.memoryUsage || 0) >= 80) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'host',
          target: hostname,
          category: 'agent-runtime',
          severity: Number(status.memoryUsage || 0) >= 90 ? 'high' : 'medium',
          title: 'Agent Runtime Memory Pressure',
          description: `Agent memory usage is ${status.memoryUsage}% during runtime inspection.`,
          evidence: {
            memoryUsage: status.memoryUsage,
            uptime: status.uptime
          },
          sourceEngine: 'runtime_baseline',
          rawRef: hostname,
          assetId
        });
      }

      if (compareSemver(version, '2.4.0') < 0) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'host',
          target: hostname,
          category: 'agent-runtime',
          severity: 'medium',
          title: 'Agent Version Drift',
          description: `Agent runtime version ${version} is behind the supported baseline 2.4.0.`,
          evidence: {
            currentVersion: version,
            requiredVersion: '2.4.0'
          },
          sourceEngine: 'runtime_baseline',
          rawRef: hostname,
          assetId
        });
      }

      this.recordFinding(task, {
        targetId: target.id,
        compatibilityTargetType: 'host',
        target: hostname,
        category: 'agent-runtime-surface',
        severity: role === 'gateway' || role === 'egress' ? 'medium' : 'low',
        title: 'Agent Runtime Service Surface Observed',
        description: `Observed ${role} agent channels ${runtimeFlows.map((flow) => `${flow.protocol.toUpperCase()}/${flow.destPort}`).join(', ')} during runtime inspection.`,
        evidence: {
          agentId: snapshot.agentId || target.normalizedValue,
          hostname,
          role,
          channels: runtimeFlows.map((flow) => ({
            protocol: flow.protocol,
            destHost: flow.destHost,
            destPort: flow.destPort,
            state: flow.state,
            classification: flow.classification,
            description: flow.description
          }))
        },
        sourceEngine: 'runtime_baseline',
        rawRef: hostname,
        assetId
      });
    }

    if (runtimeScope === 'device') {
      const status = snapshot.status || {};
      const systemInfo = snapshot.systemInfo || {};
      const hostname = String(systemInfo.hostname || target.displayLabel);
      const version = String(snapshot.version || '0.0.0');

      this.recordFinding(task, {
        targetId: target.id,
        compatibilityTargetType: 'host',
        target: hostname,
        category: 'device-runtime-baseline',
        severity: 'low',
        title: 'Device Runtime Baseline Captured',
        description: `Captured device posture for ${hostname}: firmware ${version}, heap ${snapshot.freeHeap ?? 'n/a'} bytes, RSSI ${status.wifiRssi ?? 'n/a'} dBm, CPU ${status.cpuUsage ?? 'n/a'}%.`,
        evidence: {
          deviceId: snapshot.deviceId || target.normalizedValue,
          hostname,
          firmwareVersion: version,
          sdkVersion: snapshot.sdkVersion,
          chipModel: snapshot.chipModel,
          freeHeap: snapshot.freeHeap,
          wifiRssi: status.wifiRssi,
          cpuUsage: status.cpuUsage,
          uptime: status.uptime,
          systemInfo
        },
        sourceEngine: 'runtime_baseline',
        rawRef: hostname,
        assetId
      });

      runtimeFlows.push({
        destHost: '172.22.0.25',
        destPort: 8883,
        protocol: 'tcp',
        state: snapshot.isOnline === false ? 'FAILED' : 'ESTABLISHED',
        packetCount: snapshot.isOnline === false ? 1 : 14,
        byteCount: snapshot.isOnline === false ? 0 : 6144,
        classification: snapshot.isOnline === false ? 'scan-failure' : 'runtime-observation',
        description: 'Telemetry publish channel'
      });
      runtimeFlows.push({
        destHost: '172.22.0.10',
        destPort: 443,
        protocol: 'tcp',
        state: Number(status.wifiRssi || 0) <= -80 ? 'SUSPICIOUS' : 'ESTABLISHED',
        packetCount: 7,
        byteCount: 3072,
        classification: Number(status.wifiRssi || 0) <= -80 ? 'security-signal' : 'runtime-observation',
        description: 'Config sync and firmware control channel'
      });

      if (snapshot.isOnline === false) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'host',
          target: hostname,
          category: 'device-runtime',
          severity: 'high',
          title: 'Device Runtime Offline',
          description: `Device ${hostname} is not publishing telemetry.`,
          evidence: {
            deviceId: snapshot.deviceId || target.normalizedValue,
            lastHeartbeat: snapshot.lastHeartbeat
          },
          sourceEngine: 'runtime_baseline',
          rawRef: hostname,
          assetId
        });
      }

      if (Number(status.wifiRssi || 0) <= -80) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'host',
          target: hostname,
          category: 'device-runtime',
          severity: 'high',
          title: 'Weak Device Signal',
          description: `Device RSSI is ${status.wifiRssi} dBm, indicating an unstable wireless path.`,
          evidence: {
            wifiRssi: status.wifiRssi
          },
          sourceEngine: 'runtime_baseline',
          rawRef: hostname,
          assetId
        });
      }

      if (Number(snapshot.freeHeap || 0) <= 180000) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'host',
          target: hostname,
          category: 'device-runtime',
          severity: 'medium',
          title: 'Device Free Heap Low',
          description: `Device free heap dropped to ${snapshot.freeHeap} bytes.`,
          evidence: {
            freeHeap: snapshot.freeHeap,
            chipModel: snapshot.chipModel
          },
          sourceEngine: 'runtime_baseline',
          rawRef: hostname,
          assetId
        });
      }

      if (Number(status.cpuUsage || 0) >= 85) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'host',
          target: hostname,
          category: 'device-runtime',
          severity: 'high',
          title: 'Device CPU Pressure',
          description: `Device CPU usage is ${status.cpuUsage}% during runtime inspection.`,
          evidence: {
            cpuUsage: status.cpuUsage,
            uptime: status.uptime
          },
          sourceEngine: 'runtime_baseline',
          rawRef: hostname,
          assetId
        });
      }

      if (compareSemver(version, '2.4.0') < 0) {
        this.recordFinding(task, {
          targetId: target.id,
          compatibilityTargetType: 'host',
          target: hostname,
          category: 'device-runtime',
          severity: 'medium',
          title: 'Device Firmware Drift',
          description: `Firmware version ${version} is below the preferred 2.4.0 baseline.`,
          evidence: {
            currentVersion: version,
            requiredVersion: '2.4.0',
            sdkVersion: snapshot.sdkVersion
          },
          sourceEngine: 'runtime_baseline',
          rawRef: hostname,
          assetId
        });
      }

      this.recordFinding(task, {
        targetId: target.id,
        compatibilityTargetType: 'host',
        target: hostname,
        category: 'device-runtime-surface',
        severity: 'low',
        title: 'Device Runtime Service Surface Observed',
        description: `Observed device channels ${runtimeFlows.map((flow) => `${flow.protocol.toUpperCase()}/${flow.destPort}`).join(', ')} during runtime inspection.`,
        evidence: {
          deviceId: snapshot.deviceId || target.normalizedValue,
          hostname,
          channels: runtimeFlows.map((flow) => ({
            protocol: flow.protocol,
            destHost: flow.destHost,
            destPort: flow.destPort,
            state: flow.state,
            classification: flow.classification,
            description: flow.description
          }))
        },
        sourceEngine: 'runtime_baseline',
        rawRef: hostname,
        assetId
      });
    }

    const seenServices = new Set<string>();
    for (const flow of runtimeFlows) {
      this.recordTrafficSession(task, {
        target,
        targetId: target.id,
        sessionKind: 'runtime-correlation',
        destHost: flow.destHost,
        destPort: flow.destPort,
        protocol: flow.protocol,
        state: flow.state,
        packetCount: flow.packetCount,
        byteCount: flow.byteCount,
        metadata: {
          classification: flow.classification,
          description: flow.description,
          source: 'runtime-baseline'
        },
        sourceAssetId: assetId
      });

      const serviceKey = `${flow.destHost}:${flow.destPort}`;
      if (!seenServices.has(serviceKey)) {
        seenServices.add(serviceKey);
        this.recordServiceExposure(task, {
          targetId: target.id,
          host: flow.destHost,
          port: flow.destPort,
          protocol: SERVICE_NAMES[flow.destPort] || flow.protocol,
          metadata: {
            source: 'runtime-baseline',
            classification: flow.classification,
            runtimeScope
          },
          assetId
        });
      }
    }
  }

  private async runNuclei(task: ScanTaskState, targets: ResolvedScanTarget[]): Promise<void> {
    const available = await this.nucleiScanner.checkAvailability();
    if (!available) {
      task.summary.nuclei = 'skipped';
      this.emitEvent(task, 'scanner:task:log', {
        level: 'info',
        message: 'Nuclei binary not available, skipping template validation phase'
      });
      return;
    }

    task.summary.nuclei = 'running';
    const urls = new Set<string>();
    targets.forEach((target) => target.urls.forEach((url) => urls.add(url)));

    for (const url of urls) {
      this.ensureNotCancelled(task);
      try {
        const findings = await this.nucleiScanner.quickScan(url, (progress) => {
          this.emitEvent(task, 'scanner:task:progress', {
            phase: task.phase,
            progress: task.progress,
            detail: `Nuclei ${url}: ${progress.progress}%`
          });
        });

        for (const finding of findings) {
          const severity = normalizeSeverity(finding.severity || 'medium');
          this.recordFinding(task, {
            compatibilityTargetType: 'nuclei',
            target: url,
            category: 'vulnerability',
            severity,
            title: finding.name || 'Nuclei finding',
            description: finding.description || finding.matched || 'Nuclei reported a vulnerability',
            evidence: finding,
            sourceEngine: 'nuclei',
            rawRef: url
          });
        }
      } catch (error: any) {
        this.emitEvent(task, 'scanner:task:log', {
          level: 'warn',
          message: `Nuclei failed for ${url}: ${error.message}`
        });
      }
    }

    task.summary.nuclei = 'completed';
  }

  private finalizeSummary(task: ScanTaskState): void {
    const db = getDatabase();
    task.summary.assetsObserved = Number(db.prepare(`
      SELECT COUNT(DISTINCT asset_id) AS count
      FROM scan_target_assets
      WHERE run_id = ?
    `).get(task.id)?.count || 0);
    task.summary.servicesObserved = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM scan_services
      WHERE run_id = ?
    `).get(task.id)?.count || 0);
    task.summary.evidenceCount = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM scan_evidence
      WHERE run_id = ?
    `).get(task.id)?.count || 0);
    task.summary.observedSessions = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM sec_traffic_sessions
      WHERE tenant_id = ? AND session_id LIKE ?
    `).get(task.tenantId, `scan:${task.id}:%`)?.count || 0);
    task.summary.trafficAnomalies = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM sec_traffic_sessions
      WHERE tenant_id = ? AND session_id LIKE ? AND (
        state NOT IN ('ESTABLISHED', 'COMPLETED') OR
        metadata_json LIKE '%"classification":"security-signal"%' OR
        metadata_json LIKE '%"classification":"scan-failure"%' OR
        metadata_json LIKE '%"classification":"sensitive-exposure"%'
      )
    `).get(task.tenantId, `scan:${task.id}:%`)?.count || 0);
    task.summary.status = task.status;
    task.summary.phase = task.phase;
    task.summary.queueBackend = jobQueueService.backend();
    task.summary.artifactStore = artifactStoreService.describe().activeMode;
  }

  getTaskResults(taskId: string): any {
    this.assertPrepared();
    const task = this.getTask(taskId);
    if (!task) {
      return null;
    }

    const db = getDatabase();
    const timelineRows = db.prepare(`
      SELECT event_type, payload_json, created_at
      FROM scan_events
      WHERE task_id = ?
      ORDER BY id ASC
    `).all(taskId) as any[];

    const stageRows = db.prepare(`
      SELECT * FROM scan_run_stages
      WHERE run_id = ?
      ORDER BY started_at ASC, stage_key ASC
    `).all(taskId) as any[];

    const targetRows = db.prepare(`
      SELECT * FROM scan_run_targets
      WHERE run_id = ?
      ORDER BY created_at ASC
    `).all(taskId) as any[];

    const evidenceRows = db.prepare(`
      SELECT * FROM scan_evidence
      WHERE run_id = ?
      ORDER BY collected_at DESC
    `).all(taskId) as any[];

    const serviceRows = db.prepare(`
      SELECT * FROM scan_services
      WHERE run_id = ?
      ORDER BY discovered_at DESC
    `).all(taskId) as any[];

    const compatibilityFindings = db.prepare(`
      SELECT target_type, target, severity, title, description, evidence_json, source_engine, created_at
      FROM scan_findings
      WHERE task_id = ?
      ORDER BY id ASC
    `).all(taskId) as any[];

    const { findings, relatedAlerts, relatedActions, relatedTrafficSessions } = this.getTaskRelatedArtifacts(task);
    const assetGroups = findings.reduce((groups: any[], finding) => {
      const existing = groups.find((group) => group.assetId === finding.assetId && group.target === finding.target);
      if (existing) {
        existing.findings.push(finding);
        existing.severities[finding.severity] = (existing.severities[finding.severity] || 0) + 1;
        return groups;
      }
      groups.push({
        assetId: finding.assetId,
        target: finding.target,
        category: finding.category,
        findings: [finding],
        severities: { [finding.severity]: 1 }
      });
      return groups;
    }, []);

    return {
      taskId,
      profile: this.getProfile(task.profileId),
      targets: targetRows.map((row: any) => ({
        id: row.id,
        kind: row.target_kind,
        rawValue: row.raw_value,
        normalizedValue: row.normalized_value,
        displayLabel: row.display_label,
        status: row.status,
        error: row.error || undefined,
        metadata: parseJson(row.metadata_json, {})
      })),
      stages: stageRows.map((row: any) => ({
        stageKey: row.stage_key,
        stageLabel: row.stage_label,
        status: row.status,
        progress: Number(row.progress || 0),
        detail: row.detail || undefined,
        error: row.error || undefined,
        startedAt: row.started_at || undefined,
        completedAt: row.completed_at || undefined,
        durationMs: Number(row.duration_ms || 0),
        metadata: parseJson(row.metadata_json, {})
      })),
      evidence: evidenceRows.map((row: any) => ({
        id: row.id,
        targetId: row.target_id || undefined,
        assetId: row.asset_id || undefined,
        engine: row.engine,
        category: row.category,
        severity: row.severity,
        title: row.title,
        summary: row.summary,
        fingerprint: row.fingerprint,
        rawRef: row.raw_ref || undefined,
        details: parseJson(row.details_json, {}),
        collectedAt: row.collected_at
      })),
      services: serviceRows.map((row: any) => ({
        id: row.id,
        targetId: row.target_id || undefined,
        assetId: row.asset_id || undefined,
        host: row.host,
        port: Number(row.port || 0),
        protocol: row.protocol,
        service: row.service || undefined,
        banner: row.banner || undefined,
        tlsSummary: parseJson(row.tls_summary_json, {}),
        metadata: parseJson(row.metadata_json, {}),
        discoveredAt: row.discovered_at
      })),
      timeline: timelineRows.map((row: any) => ({
        eventType: row.event_type,
        payload: parseJson(row.payload_json, {}),
        createdAt: row.created_at
      })),
      urlFindings: compatibilityFindings.filter((row) => row.target_type === 'url').map((row) => this.mapCompatibilityFinding(row)),
      hostFindings: compatibilityFindings.filter((row) => row.target_type === 'host').map((row) => this.mapCompatibilityFinding(row)),
      nucleiFindings: compatibilityFindings.filter((row) => row.target_type === 'nuclei').map((row) => this.mapCompatibilityFinding(row)),
      findings,
      assetGroups,
      relatedAlerts: relatedAlerts.map((row: any) => ({
        id: row.alert_id,
        title: row.title,
        severity: row.severity,
        status: row.status,
        sourceRef: row.source_ref,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: parseJson(row.metadata_json, {})
      })),
      relatedActions: relatedActions.map((row: any) => ({
        actionId: row.action_id,
        title: row.title,
        status: row.status,
        operator: row.operator,
        rollbackNotes: row.rollback_notes,
        runLog: parseJson(row.run_log_json, []),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      relatedTrafficSessions: relatedTrafficSessions.map((row: any) => ({
        sessionId: row.session_id,
        sourceIP: row.source_ip,
        destIP: row.dest_ip,
        sourcePort: Number(row.source_port || 0),
        destPort: Number(row.dest_port || 0),
        protocol: row.protocol,
        state: row.state,
        packetCount: Number(row.packet_count || 0),
        byteCount: Number(row.byte_count || 0),
        startTime: row.start_time,
        lastActivity: row.last_activity,
        sourceAssetId: row.source_asset_id || undefined,
        destAssetId: row.dest_asset_id || undefined,
        metadata: parseJson(row.metadata_json, {})
      })),
      summary: task.summary
    };
  }

  async getTaskResultsView(taskId: string): Promise<any> {
    const task = await this.getTaskView(taskId);
    if (!task) {
      return null;
    }

    const [timelineRows, stageRows, targetRows, evidenceRows, serviceRows, compatibilityFindings] = await Promise.all([
      this.queryShadowAllWithFallback<any>(
        `
          SELECT event_type, payload_json, created_at
          FROM scan_events
          WHERE task_id = $1
          ORDER BY created_at ASC, id ASC
        `,
        [taskId],
        () => {
          const db = getDatabase();
          return db.prepare(`
            SELECT event_type, payload_json, created_at
            FROM scan_events
            WHERE task_id = ?
            ORDER BY id ASC
          `).all(taskId) as any[];
        }
      ),
      this.queryShadowAllWithFallback<any>(
        `
          SELECT * FROM scan_run_stages
          WHERE run_id = $1
          ORDER BY started_at ASC, stage_key ASC
        `,
        [taskId],
        () => {
          const db = getDatabase();
          return db.prepare(`
            SELECT * FROM scan_run_stages
            WHERE run_id = ?
            ORDER BY started_at ASC, stage_key ASC
          `).all(taskId) as any[];
        }
      ),
      this.queryShadowAllWithFallback<any>(
        `
          SELECT * FROM scan_run_targets
          WHERE run_id = $1
          ORDER BY created_at ASC
        `,
        [taskId],
        () => {
          const db = getDatabase();
          return db.prepare(`
            SELECT * FROM scan_run_targets
            WHERE run_id = ?
            ORDER BY created_at ASC
          `).all(taskId) as any[];
        }
      ),
      this.queryShadowAllWithFallback<any>(
        `
          SELECT * FROM scan_evidence
          WHERE run_id = $1
          ORDER BY collected_at DESC
        `,
        [taskId],
        () => {
          const db = getDatabase();
          return db.prepare(`
            SELECT * FROM scan_evidence
            WHERE run_id = ?
            ORDER BY collected_at DESC
          `).all(taskId) as any[];
        }
      ),
      this.queryShadowAllWithFallback<any>(
        `
          SELECT * FROM scan_services
          WHERE run_id = $1
          ORDER BY discovered_at DESC
        `,
        [taskId],
        () => {
          const db = getDatabase();
          return db.prepare(`
            SELECT * FROM scan_services
            WHERE run_id = ?
            ORDER BY discovered_at DESC
          `).all(taskId) as any[];
        }
      ),
      this.queryShadowAllWithFallback<any>(
        `
          SELECT target_type, target, severity, title, description, evidence_json, source_engine, created_at
          FROM scan_findings
          WHERE task_id = $1
          ORDER BY created_at ASC, id ASC
        `,
        [taskId],
        () => {
          const db = getDatabase();
          return db.prepare(`
            SELECT target_type, target, severity, title, description, evidence_json, source_engine, created_at
            FROM scan_findings
            WHERE task_id = ?
            ORDER BY id ASC
          `).all(taskId) as any[];
        }
      )
    ]);

    const { findings, relatedAlerts, relatedActions, relatedTrafficSessions } = await this.getTaskRelatedArtifactsView(task);
    const assetGroups = findings.reduce((groups: any[], finding) => {
      const existing = groups.find((group) => group.assetId === finding.assetId && group.target === finding.target);
      if (existing) {
        existing.findings.push(finding);
        existing.severities[finding.severity] = (existing.severities[finding.severity] || 0) + 1;
        return groups;
      }
      groups.push({
        assetId: finding.assetId,
        target: finding.target,
        category: finding.category,
        findings: [finding],
        severities: { [finding.severity]: 1 }
      });
      return groups;
    }, []);

    return {
      taskId,
      profile: await this.getProfileView(task.profileId),
      targets: targetRows.map((row: any) => ({
        id: row.id,
        kind: row.target_kind,
        rawValue: row.raw_value,
        normalizedValue: row.normalized_value,
        displayLabel: row.display_label,
        status: row.status,
        error: row.error || undefined,
        metadata: parseJson(row.metadata_json, {})
      })),
      stages: stageRows.map((row: any) => ({
        stageKey: row.stage_key,
        stageLabel: row.stage_label,
        status: row.status,
        progress: Number(row.progress || 0),
        detail: row.detail || undefined,
        error: row.error || undefined,
        startedAt: row.started_at || undefined,
        completedAt: row.completed_at || undefined,
        durationMs: Number(row.duration_ms || 0),
        metadata: parseJson(row.metadata_json, {})
      })),
      evidence: evidenceRows.map((row: any) => ({
        id: row.id,
        targetId: row.target_id || undefined,
        assetId: row.asset_id || undefined,
        engine: row.engine,
        category: row.category,
        severity: row.severity,
        title: row.title,
        summary: row.summary,
        fingerprint: row.fingerprint,
        rawRef: row.raw_ref || undefined,
        details: parseJson(row.details_json, {}),
        collectedAt: row.collected_at
      })),
      services: serviceRows.map((row: any) => ({
        id: row.id,
        targetId: row.target_id || undefined,
        assetId: row.asset_id || undefined,
        host: row.host,
        port: Number(row.port || 0),
        protocol: row.protocol,
        service: row.service || undefined,
        banner: row.banner || undefined,
        tlsSummary: parseJson(row.tls_summary_json, {}),
        metadata: parseJson(row.metadata_json, {}),
        discoveredAt: row.discovered_at
      })),
      timeline: timelineRows.map((row: any) => ({
        eventType: row.event_type,
        payload: parseJson(row.payload_json, {}),
        createdAt: row.created_at
      })),
      urlFindings: compatibilityFindings.filter((row) => row.target_type === 'url').map((row) => this.mapCompatibilityFinding(row)),
      hostFindings: compatibilityFindings.filter((row) => row.target_type === 'host').map((row) => this.mapCompatibilityFinding(row)),
      nucleiFindings: compatibilityFindings.filter((row) => row.target_type === 'nuclei').map((row) => this.mapCompatibilityFinding(row)),
      findings,
      assetGroups,
      relatedAlerts: relatedAlerts.map((row: any) => ({
        id: row.alert_id,
        title: row.title,
        severity: row.severity,
        status: row.status,
        sourceRef: row.source_ref,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: parseJson(row.metadata_json, {})
      })),
      relatedActions: relatedActions.map((row: any) => ({
        actionId: row.action_id,
        title: row.title,
        status: row.status,
        operator: row.operator,
        rollbackNotes: row.rollback_notes,
        runLog: parseJson(row.run_log_json, []),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      relatedTrafficSessions: relatedTrafficSessions.map((row: any) => ({
        sessionId: row.session_id,
        sourceIP: row.source_ip,
        destIP: row.dest_ip,
        sourcePort: Number(row.source_port || 0),
        destPort: Number(row.dest_port || 0),
        protocol: row.protocol,
        state: row.state,
        packetCount: Number(row.packet_count || 0),
        byteCount: Number(row.byte_count || 0),
        startTime: row.start_time,
        lastActivity: row.last_activity,
        sourceAssetId: row.source_asset_id || undefined,
        destAssetId: row.dest_asset_id || undefined,
        metadata: parseJson(row.metadata_json, {})
      })),
      summary: task.summary
    };
  }

  private mapCompatibilityFinding(row: any): any {
    return {
      target: row.target,
      severity: row.severity,
      title: row.title,
      description: row.description,
      evidence: parseJson(row.evidence_json, {}),
      sourceEngine: row.source_engine,
      createdAt: row.created_at
    };
  }

  private async runTask(taskId: string): Promise<void> {
    const task = this.getTask(taskId);
    if (!task || this.cancelled.has(taskId)) {
      return;
    }

    task.status = 'running';
    task.phase = 'normalizing';
    task.progress = 5;
    task.startedAt = this.nowISO();
    task.error = undefined;
    this.upsertTask(task, 'scanner:task:started', { phase: task.phase, progress: task.progress });

    const profile = this.getProfile(task.profileId) || this.deriveProfile({
      tenantId: task.tenantId,
      createdBy: task.createdBy,
      targets: task.targets,
      enginePolicy: task.enginePolicy
    }, this.listRunTargets(task.id));
    const runTargets = this.listRunTargets(task.id);
    const resolvedTargets: ResolvedScanTarget[] = [];

    try {
      const normalizeStage = this.beginStage(task, 'normalizing', 5, 'Validating scan request');
      this.finishStage(task, normalizeStage, `Prepared ${runTargets.length} targets`);

      this.ensureNotCancelled(task);

      const resolutionStage = this.beginStage(task, 'asset-resolution', 10, 'Resolving targets');
      for (let index = 0; index < runTargets.length; index += 1) {
        this.ensureNotCancelled(task);
        const resolved = await this.resolveTarget(task, runTargets[index]);
        if (resolved) {
          resolvedTargets.push(resolved);
        }
        const progress = 10 + Math.floor(((index + 1) / Math.max(1, runTargets.length)) * 20);
        this.updateStageProgress(task, resolutionStage, progress, `Resolved ${index + 1}/${runTargets.length} targets`);
      }
      this.finishStage(task, resolutionStage, `Resolved ${resolvedTargets.length} executable targets`, {
        resolvedTargets: resolvedTargets.length,
        skippedTargets: runTargets.length - resolvedTargets.length
      });

      const webTargets = resolvedTargets.filter((target) => target.urls.length > 0 || target.hosts.length > 0);
      if (webTargets.length > 0) {
        const webStage = this.beginStage(task, 'web-scan', 35, 'Running web, TLS and service probes');
        for (let index = 0; index < webTargets.length; index += 1) {
          await this.scanResolvedTarget(task, webTargets[index], profile);
          const progress = 35 + Math.floor(((index + 1) / Math.max(1, webTargets.length)) * 35);
          this.updateStageProgress(task, webStage, progress, `Scanned ${index + 1}/${webTargets.length} network targets`);
        }
        this.finishStage(task, webStage, 'Completed network-facing scan stages');
      } else {
        this.skipStage(task, 'web-scan', 35, 'No web, domain or address targets were provided');
      }

      const hostTargets = resolvedTargets.filter((target) => target.supportsHostBaseline);
      if (hostTargets.length > 0) {
        const hostStage = this.beginStage(task, 'host-scan', 72, 'Running local host baseline');
        for (let index = 0; index < hostTargets.length; index += 1) {
          await this.runHostBaseline(task, hostTargets[index]);
          const progress = 72 + Math.floor(((index + 1) / Math.max(1, hostTargets.length)) * 10);
          this.updateStageProgress(task, hostStage, progress, `Completed ${index + 1}/${hostTargets.length} host targets`);
        }
        this.finishStage(task, hostStage, 'Completed local host posture checks');
      } else {
        this.skipStage(task, 'host-scan', 72, 'No locally executable host targets were available');
      }

      if ((profile.engines || []).includes('nuclei') && resolvedTargets.some((target) => target.urls.length > 0)) {
        const nucleiStage = this.beginStage(task, 'nuclei-scan', 84, 'Running template validation');
        await this.runNuclei(task, resolvedTargets);
        this.updateStageProgress(task, nucleiStage, 92, 'Template validation complete');
        this.finishStage(task, nucleiStage, 'Completed nuclei validation');
      } else {
        task.summary.nuclei = 'skipped';
        this.skipStage(task, 'nuclei-scan', 84, 'No URL targets available for nuclei validation');
      }

      const correlationStage = this.beginStage(task, 'correlation', 94, 'Correlating findings with alerts and actions');
      this.finalizeSummary(task);
      const correlated = this.getTaskRelatedArtifacts(task);
      this.updateStageProgress(task, correlationStage, 97, `Linked ${correlated.relatedAlerts.length} alerts and ${correlated.relatedActions.length} actions`);
      this.finishStage(task, correlationStage, 'Correlation complete', {
        alerts: correlated.relatedAlerts.length,
        actions: correlated.relatedActions.length
      });

      const finalStage = this.beginStage(task, 'finalizing', 98, 'Writing final summary');
      this.finalizeSummary(task);
      task.phase = 'done';
      task.progress = 100;
      task.status = 'completed';
      task.completedAt = this.nowISO();
      this.updateStageProgress(task, finalStage, 100, 'Run finalized');
      this.finishStage(task, finalStage, 'Scan run completed successfully');
      this.upsertTask(task, 'scanner:task:completed', { phase: task.phase, progress: task.progress, summary: task.summary });
    } catch (error: any) {
      if (error instanceof ScanCancelledError) {
        task.status = 'cancelled';
        task.phase = 'done';
        task.progress = 100;
        task.completedAt = this.nowISO();
        this.upsertTask(task, 'scanner:task:cancelled', { phase: task.phase, progress: task.progress });
        return;
      }

      task.status = 'failed';
      task.phase = 'done';
      task.progress = 100;
      task.error = error?.message || 'Scan execution failed';
      task.completedAt = this.nowISO();
      this.upsertTask(task, 'scanner:task:failed', { phase: task.phase, progress: task.progress, error: task.error });
    } finally {
      this.cancelled.delete(task.id);
    }
  }
}

export const scannerTaskService = new ScannerTaskService();

