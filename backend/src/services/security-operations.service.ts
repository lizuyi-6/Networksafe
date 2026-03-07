import { randomUUID } from 'crypto';
import { getDatabase } from '../config/database';
import { postgresShadowStoreService } from './postgres-shadow-store.service';

type Severity = 'critical' | 'high' | 'medium' | 'low';
type FindingStatus = 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'suppressed' | 'ignored';
type AlertStatus = 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'suppressed';
type ActionStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'rolled_back';
type AssetType = 'url' | 'site' | 'domain' | 'host' | 'ip' | 'device' | 'agent' | 'service';
type ValidationVerdict = 'blocked' | 'alerted' | 'missed' | 'false_positive' | 'timeout';

export interface AssetSummary {
  assetId: string;
  tenantId: string;
  assetType: AssetType;
  externalRef: string;
  displayName: string;
  primaryAddress?: string;
  status: string;
  riskScore: number;
  findingsOpen: number;
  alertsOpen: number;
  metadata: Record<string, any>;
  lastSeenAt?: string;
}

export interface FindingRecord {
  findingId: string;
  tenantId: string;
  assetId?: string;
  sourceType: string;
  sourceRef: string;
  target: string;
  category: string;
  severity: Severity;
  status: FindingStatus;
  title: string;
  description: string;
  evidence: Record<string, any>;
  remediation: Record<string, any>;
  fingerprint: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface AlertRecord {
  id: string;
  title: string;
  message: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  type: 'security' | 'performance' | 'system';
  source: string;
  time: string;
  status: AlertStatus;
  timestamp: string;
  assetId?: string;
  findingId?: string;
  investigationId?: string;
  metadata?: Record<string, any>;
}

export interface ActionRunRecord {
  actionId: string;
  tenantId: string;
  assetId?: string;
  findingId?: string;
  alertId?: string;
  title: string;
  status: ActionStatus;
  operator: string;
  rollbackNotes: string;
  runLog: Record<string, any>[];
  createdAt: string;
  updatedAt: string;
}

export interface ValidationRunRecord {
  validationRunId: string;
  tenantId: string;
  attackId: string;
  attackName: string;
  category: string;
  severity: Severity;
  verdict: ValidationVerdict;
  detected: boolean;
  blocked: boolean;
  responseTime: number;
  startedAt: string;
  completedAt: string;
  result: Record<string, any>;
}

const severityWeight: Record<Severity, number> = {
  critical: 100,
  high: 75,
  medium: 45,
  low: 20
};

class SecurityOperationsService {
  private schemaReady = false;

  private ensureSchema(): void {
    if (this.schemaReady) {
      return;
    }

    const db = getDatabase();
    db.exec(`
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

      CREATE INDEX IF NOT EXISTS idx_sec_assets_tenant ON sec_assets(tenant_id, asset_type);
      CREATE INDEX IF NOT EXISTS idx_sec_findings_tenant ON sec_findings(tenant_id, status, severity);
      CREATE INDEX IF NOT EXISTS idx_sec_findings_source ON sec_findings(source_type, source_ref);
      CREATE INDEX IF NOT EXISTS idx_sec_alerts_tenant ON sec_alerts(tenant_id, status, severity);
      CREATE INDEX IF NOT EXISTS idx_sec_actions_tenant ON sec_actions(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_sec_validations_tenant ON sec_validations(tenant_id, completed_at);
      CREATE INDEX IF NOT EXISTS idx_sec_sessions_tenant ON sec_traffic_sessions(tenant_id, last_activity);
    `);

    this.schemaReady = true;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private shadowUpsert(table: Parameters<typeof postgresShadowStoreService.upsert>[0], row: Record<string, any> | null | undefined): void {
    if (!row) {
      return;
    }
    void postgresShadowStoreService.upsert(table, row);
  }

  private shadowGet(table: Parameters<typeof postgresShadowStoreService.upsert>[0], sql: string, ...params: any[]): void {
    const db = getDatabase();
    const row = db.prepare(sql).get(...params) as Record<string, any> | undefined;
    this.shadowUpsert(table, row);
  }

  private parseJson<T>(value: any, fallback: T): T {
    if (!value || typeof value !== 'string') {
      return fallback;
    }
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private normalizeSeverity(severity?: string): Severity {
    const normalized = String(severity || 'medium').toLowerCase();
    if (normalized === 'critical' || normalized === 'high' || normalized === 'medium' || normalized === 'low') {
      return normalized;
    }
    return 'medium';
  }

  private mapSeverityLabel(severity: Severity): 'Critical' | 'High' | 'Medium' | 'Low' {
    return severity.charAt(0).toUpperCase() + severity.slice(1) as 'Critical' | 'High' | 'Medium' | 'Low';
  }

  private assetKey(tenantId: string, assetType: AssetType, externalRef: string): string {
    return `${tenantId}:${assetType}:${externalRef}`;
  }

  private relativeTime(timestamp?: string): string {
    if (!timestamp) return 'Just now';
    const diffMs = Date.now() - new Date(timestamp).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} mins ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    return `${diffDays} days ago`;
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

  upsertAsset(input: {
    tenantId: string;
    assetType: AssetType;
    externalRef: string;
    displayName: string;
    primaryAddress?: string;
    status?: string;
    metadata?: Record<string, any>;
  }): AssetSummary {
    this.ensureSchema();
    const db = getDatabase();
    const now = this.now();
    const key = this.assetKey(input.tenantId, input.assetType, input.externalRef);
    const existing = db.prepare('SELECT * FROM sec_assets WHERE asset_key = ?').get(key) as any;

    if (existing) {
      const nextMetadata = {
        ...this.parseJson(existing.metadata_json, {}),
        ...(input.metadata || {})
      };
      db.prepare(`
        UPDATE sec_assets
        SET display_name = ?, primary_address = ?, status = ?, metadata_json = ?, updated_at = ?, last_seen_at = ?
        WHERE asset_key = ?
      `).run(
        input.displayName || existing.display_name,
        input.primaryAddress || existing.primary_address || null,
        input.status || existing.status,
        JSON.stringify(nextMetadata),
        now,
        now,
        key
      );
      this.shadowGet('sec_assets', 'SELECT * FROM sec_assets WHERE asset_key = ? LIMIT 1', key);
      return this.getAssetById(input.tenantId, existing.asset_id)!;
    }

    const assetId = randomUUID();
    db.prepare(`
      INSERT INTO sec_assets (
        asset_id, tenant_id, asset_key, asset_type, external_ref, display_name, primary_address,
        status, risk_score, findings_open, alerts_open, metadata_json, created_at, updated_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?)
    `).run(
      assetId,
      input.tenantId,
      key,
      input.assetType,
      input.externalRef,
      input.displayName,
      input.primaryAddress || null,
      input.status || 'observed',
      JSON.stringify(input.metadata || {}),
      now,
      now,
      now
    );
    this.shadowGet('sec_assets', 'SELECT * FROM sec_assets WHERE asset_id = ? LIMIT 1', assetId);

    return this.getAssetById(input.tenantId, assetId)!;
  }

  listAssets(tenantId: string, limit = 100): AssetSummary[] {
    this.ensureSchema();
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM sec_assets
      WHERE tenant_id = ?
      ORDER BY risk_score DESC, updated_at DESC
      LIMIT ?
    `).all(tenantId, limit) as any[];
    return rows.map((row) => this.mapAsset(row));
  }

  getAssetById(tenantId: string, assetId: string): AssetSummary | null {
    this.ensureSchema();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM sec_assets
      WHERE tenant_id = ? AND asset_id = ?
      LIMIT 1
    `).get(tenantId, assetId) as any;
    return row ? this.mapAsset(row) : null;
  }

  async getAssetByIdView(tenantId: string, assetId: string): Promise<AssetSummary | null> {
    const row = await this.queryShadowOneWithFallback<any>(
      `
        SELECT * FROM sec_assets
        WHERE tenant_id = $1 AND asset_id = $2
        LIMIT 1
      `,
      [tenantId, assetId],
      () => {
        this.ensureSchema();
        const db = getDatabase();
        return db.prepare(`
          SELECT * FROM sec_assets
          WHERE tenant_id = ? AND asset_id = ?
          LIMIT 1
        `).get(tenantId, assetId) as any;
      }
    );
    return row ? this.mapAsset(row) : null;
  }

  getAssetByExternalRef(tenantId: string, assetType: AssetType, externalRef: string): AssetSummary | null {
    this.ensureSchema();
    const db = getDatabase();
    const key = this.assetKey(tenantId, assetType, externalRef);
    const row = db.prepare('SELECT * FROM sec_assets WHERE asset_key = ? LIMIT 1').get(key) as any;
    return row ? this.mapAsset(row) : null;
  }

  ingestFinding(input: {
    tenantId: string;
    assetId?: string;
    sourceType: string;
    sourceRef: string;
    target: string;
    category?: string;
    severity: string;
    title: string;
    description: string;
    evidence?: Record<string, any>;
    remediation?: Record<string, any>;
    fingerprint?: string;
    createAlert?: boolean;
    alertType?: 'security' | 'performance' | 'system';
  }): FindingRecord {
    this.ensureSchema();
    const db = getDatabase();
    const now = this.now();
    const severity = this.normalizeSeverity(input.severity);
    const fingerprint = input.fingerprint || `${input.sourceType}:${input.sourceRef}:${input.target}:${input.title}`;
    const existing = db.prepare(`
      SELECT * FROM sec_findings
      WHERE tenant_id = ? AND fingerprint = ?
      LIMIT 1
    `).get(input.tenantId, fingerprint) as any;

    if (existing) {
      const mergedEvidence = {
        ...this.parseJson(existing.evidence_json, {}),
        ...(input.evidence || {})
      };
      const mergedRemediation = {
        ...this.parseJson(existing.remediation_json, {}),
        ...(input.remediation || {})
      };
      const nextStatus: FindingStatus = existing.status === 'resolved' ? 'open' : existing.status;
      db.prepare(`
        UPDATE sec_findings
        SET asset_id = ?, severity = ?, description = ?, evidence_json = ?, remediation_json = ?, status = ?,
            last_seen_at = ?, updated_at = ?, occurrence_count = occurrence_count + 1
        WHERE finding_id = ?
      `).run(
        input.assetId || existing.asset_id || null,
        severity,
        input.description,
        JSON.stringify(mergedEvidence),
        JSON.stringify(mergedRemediation),
        nextStatus,
        now,
        now,
        existing.finding_id
      );
      this.recalculateAssetRisk(input.tenantId, input.assetId || existing.asset_id);
      this.shadowGet('sec_findings', 'SELECT * FROM sec_findings WHERE finding_id = ? LIMIT 1', existing.finding_id);
      const record = this.getFindingById(input.tenantId, existing.finding_id)!;
      if ((input.createAlert || severity === 'critical' || severity === 'high') && nextStatus === 'open') {
        this.createAlert({
          tenantId: input.tenantId,
          findingId: existing.finding_id,
          assetId: input.assetId || existing.asset_id || undefined,
          sourceType: input.sourceType,
          sourceRef: input.sourceRef,
          title: input.title,
          message: input.description,
          severity,
          alertType: input.alertType || 'security',
          metadata: {
            target: input.target,
            category: input.category || 'security-posture'
          }
        });
      }
      return record;
    }

    const findingId = randomUUID();
    db.prepare(`
      INSERT INTO sec_findings (
        finding_id, tenant_id, fingerprint, asset_id, source_type, source_ref, target, category, severity, status,
        title, description, evidence_json, remediation_json, first_seen_at, last_seen_at, occurrence_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      findingId,
      input.tenantId,
      fingerprint,
      input.assetId || null,
      input.sourceType,
      input.sourceRef,
      input.target,
      input.category || 'security-posture',
      severity,
      input.title,
      input.description,
      JSON.stringify(input.evidence || {}),
      JSON.stringify(input.remediation || {}),
      now,
      now,
      now,
      now
    );

    this.recalculateAssetRisk(input.tenantId, input.assetId);
    this.shadowGet('sec_findings', 'SELECT * FROM sec_findings WHERE finding_id = ? LIMIT 1', findingId);
    const record = this.getFindingById(input.tenantId, findingId)!;

    if (input.createAlert || severity === 'critical' || severity === 'high') {
      this.createAlert({
        tenantId: input.tenantId,
        findingId,
        assetId: input.assetId,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        title: input.title,
        message: input.description,
        severity,
        alertType: input.alertType || 'security',
        metadata: {
          target: input.target,
          category: input.category || 'security-posture'
        }
      });
    }

    return record;
  }

  resolveFindingByFingerprint(tenantId: string, fingerprint: string, actor = 'system'): FindingRecord | null {
    this.ensureSchema();
    const db = getDatabase();
    const existing = db.prepare(`
      SELECT *
      FROM sec_findings
      WHERE tenant_id = ? AND fingerprint = ?
      LIMIT 1
    `).get(tenantId, fingerprint) as any;

    if (!existing) {
      return null;
    }

    const now = this.now();
    if (existing.status !== 'resolved') {
      db.prepare(`
        UPDATE sec_findings
        SET status = 'resolved', updated_at = ?, last_seen_at = ?
        WHERE finding_id = ?
      `).run(now, now, existing.finding_id);
      this.shadowGet('sec_findings', 'SELECT * FROM sec_findings WHERE finding_id = ? LIMIT 1', existing.finding_id);
    }

    const alertRows = db.prepare(`
      SELECT * FROM sec_alerts
      WHERE tenant_id = ? AND finding_id = ? AND status IN ('open', 'acknowledged', 'investigating')
    `).all(tenantId, existing.finding_id) as any[];

    for (const alert of alertRows) {
      const metadata = {
        ...this.parseJson(alert.metadata_json, {}),
        lastActor: actor,
        autoResolved: true
      };
      db.prepare(`
        UPDATE sec_alerts
        SET status = 'resolved', metadata_json = ?, updated_at = ?
        WHERE alert_id = ?
      `).run(JSON.stringify(metadata), now, alert.alert_id);
      this.shadowGet('sec_alerts', 'SELECT * FROM sec_alerts WHERE alert_id = ? LIMIT 1', alert.alert_id);
    }

    this.recalculateAssetRisk(tenantId, existing.asset_id);
    return this.getFindingById(tenantId, existing.finding_id);
  }

  syncSignalFinding(input: {
    tenantId: string;
    active: boolean;
    assetId?: string;
    sourceType: string;
    sourceRef: string;
    target: string;
    category: string;
    severity: Severity;
    title: string;
    description: string;
    evidence?: Record<string, any>;
    remediation?: Record<string, any>;
    fingerprint: string;
    createAlert?: boolean;
    alertType?: 'security' | 'performance' | 'system';
  }): FindingRecord | null {
    if (input.active) {
      return this.ingestFinding({
        tenantId: input.tenantId,
        assetId: input.assetId,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        target: input.target,
        category: input.category,
        severity: input.severity,
        title: input.title,
        description: input.description,
        evidence: input.evidence,
        remediation: input.remediation,
        fingerprint: input.fingerprint,
        createAlert: input.createAlert,
        alertType: input.alertType
      });
    }

    return this.resolveFindingByFingerprint(input.tenantId, input.fingerprint);
  }

  listFindingsBySource(tenantId: string, sourceType: string, sourceRef: string): FindingRecord[] {
    this.ensureSchema();
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM sec_findings
      WHERE tenant_id = ? AND source_type = ? AND source_ref = ?
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 4
          WHEN 'high' THEN 3
          WHEN 'medium' THEN 2
          ELSE 1
        END DESC,
        updated_at DESC
    `).all(tenantId, sourceType, sourceRef) as any[];
    return rows.map((row) => this.mapFinding(row));
  }

  async listFindingsBySourceView(tenantId: string, sourceType: string, sourceRef: string): Promise<FindingRecord[]> {
    const rows = await this.queryShadowAllWithFallback<any>(
      `
        SELECT * FROM sec_findings
        WHERE tenant_id = $1 AND source_type = $2 AND source_ref = $3
        ORDER BY
          CASE severity
            WHEN 'critical' THEN 4
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 2
            ELSE 1
          END DESC,
          updated_at DESC
      `,
      [tenantId, sourceType, sourceRef],
      () => {
        this.ensureSchema();
        const db = getDatabase();
        return db.prepare(`
          SELECT * FROM sec_findings
          WHERE tenant_id = ? AND source_type = ? AND source_ref = ?
          ORDER BY
            CASE severity
              WHEN 'critical' THEN 4
              WHEN 'high' THEN 3
              WHEN 'medium' THEN 2
              ELSE 1
            END DESC,
            updated_at DESC
        `).all(tenantId, sourceType, sourceRef) as any[];
      }
    );
    return rows.map((row) => this.mapFinding(row));
  }

  getFindingById(tenantId: string, findingId: string): FindingRecord | null {
    this.ensureSchema();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM sec_findings
      WHERE tenant_id = ? AND finding_id = ?
      LIMIT 1
    `).get(tenantId, findingId) as any;
    return row ? this.mapFinding(row) : null;
  }

  async getFindingByIdView(tenantId: string, findingId: string): Promise<FindingRecord | null> {
    const row = await this.queryShadowOneWithFallback<any>(
      `
        SELECT * FROM sec_findings
        WHERE tenant_id = $1 AND finding_id = $2
        LIMIT 1
      `,
      [tenantId, findingId],
      () => {
        this.ensureSchema();
        const db = getDatabase();
        return db.prepare(`
          SELECT * FROM sec_findings
          WHERE tenant_id = ? AND finding_id = ?
          LIMIT 1
        `).get(tenantId, findingId) as any;
      }
    );
    return row ? this.mapFinding(row) : null;
  }

  async listFindingsByFingerprintsView(tenantId: string, fingerprints: string[]): Promise<FindingRecord[]> {
    const uniqueFingerprints = Array.from(new Set(fingerprints.map((item) => String(item || '').trim()).filter(Boolean)));
    if (uniqueFingerprints.length === 0) {
      return [];
    }

    const rows = await this.queryShadowAllWithFallback<any>(
      `
        SELECT * FROM sec_findings
        WHERE tenant_id = $1 AND fingerprint = ANY($2)
        ORDER BY updated_at DESC
      `,
      [tenantId, uniqueFingerprints],
      () => {
        this.ensureSchema();
        const db = getDatabase();
        return db.prepare(`
          SELECT * FROM sec_findings
          WHERE tenant_id = ? AND fingerprint IN (${uniqueFingerprints.map(() => '?').join(',')})
          ORDER BY updated_at DESC
        `).all(tenantId, ...uniqueFingerprints) as any[];
      }
    );

    return rows.map((row) => this.mapFinding(row));
  }

  createAlert(input: {
    tenantId: string;
    findingId?: string;
    assetId?: string;
    sourceType: string;
    sourceRef: string;
    title: string;
    message: string;
    severity: Severity;
    alertType: 'security' | 'performance' | 'system';
    metadata?: Record<string, any>;
  }): AlertRecord {
    this.ensureSchema();
    const db = getDatabase();
    const now = this.now();

    const existing = input.findingId
      ? db.prepare(`
          SELECT * FROM sec_alerts
          WHERE tenant_id = ? AND finding_id = ? AND status IN ('open', 'acknowledged', 'investigating')
          LIMIT 1
        `).get(input.tenantId, input.findingId)
      : null;

    if (existing) {
      this.shadowUpsert('sec_alerts', existing as Record<string, any>);
      return this.mapAlert(existing);
    }

    const alertId = randomUUID();
    db.prepare(`
      INSERT INTO sec_alerts (
        alert_id, tenant_id, finding_id, asset_id, source_type, source_ref, title, message, severity, alert_type,
        status, investigation_id, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?, ?)
    `).run(
      alertId,
      input.tenantId,
      input.findingId || null,
      input.assetId || null,
      input.sourceType,
      input.sourceRef,
      input.title,
      input.message,
      input.severity,
      input.alertType,
      JSON.stringify(input.metadata || {}),
      now,
      now
    );

    this.recalculateAssetRisk(input.tenantId, input.assetId);
    this.shadowGet('sec_alerts', 'SELECT * FROM sec_alerts WHERE alert_id = ? LIMIT 1', alertId);
    return this.getAlertById(input.tenantId, alertId)!;
  }

  listAlerts(tenantId: string, filters?: { severity?: string; status?: string; limit?: number }): AlertRecord[] {
    this.ensureSchema();
    const db = getDatabase();
    const clauses = ['tenant_id = ?'];
    const params: any[] = [tenantId];

    if (filters?.severity && filters.severity !== 'all') {
      clauses.push('severity = ?');
      params.push(this.normalizeSeverity(filters.severity));
    }

    if (filters?.status && filters.status !== 'all') {
      clauses.push('status = ?');
      params.push(filters.status);
    }

    params.push(filters?.limit || 100);

    const rows = db.prepare(`
      SELECT * FROM sec_alerts
      WHERE ${clauses.join(' AND ')}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...params) as any[];

    return rows.map((row) => this.mapAlert(row));
  }

  async listAlertsView(tenantId: string, filters?: { severity?: string; status?: string; limit?: number }): Promise<AlertRecord[]> {
    const clauses = ['tenant_id = $1'];
    const params: any[] = [tenantId];

    if (filters?.severity && filters.severity !== 'all') {
      clauses.push(`severity = $${params.length + 1}`);
      params.push(this.normalizeSeverity(filters.severity));
    }

    if (filters?.status && filters.status !== 'all') {
      clauses.push(`status = $${params.length + 1}`);
      params.push(filters.status);
    }

    params.push(filters?.limit || 100);

    const rows = await this.queryShadowAllWithFallback<any>(
      `
        SELECT * FROM sec_alerts
        WHERE ${clauses.join(' AND ')}
        ORDER BY updated_at DESC
        LIMIT $${params.length}
      `,
      params,
      () => this.listAlerts(tenantId, filters).map((alert) => ({
        alert_id: alert.id,
        title: alert.title,
        message: alert.message,
        severity: String(alert.severity).toLowerCase(),
        alert_type: alert.type,
        source_ref: alert.source,
        status: alert.status,
        created_at: alert.timestamp,
        updated_at: alert.timestamp,
        asset_id: alert.assetId || null,
        finding_id: alert.findingId || null,
        investigation_id: alert.investigationId || null,
        metadata_json: JSON.stringify(alert.metadata || {})
      }))
    );

    return rows.map((row) => this.mapAlert(row));
  }

  getAlertById(tenantId: string, alertId: string): AlertRecord | null {
    this.ensureSchema();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM sec_alerts
      WHERE tenant_id = ? AND alert_id = ?
      LIMIT 1
    `).get(tenantId, alertId) as any;
    return row ? this.mapAlert(row) : null;
  }

  async getAlertByIdView(tenantId: string, alertId: string): Promise<AlertRecord | null> {
    const row = await this.queryShadowOneWithFallback<any>(
      `
        SELECT * FROM sec_alerts
        WHERE tenant_id = $1 AND alert_id = $2
        LIMIT 1
      `,
      [tenantId, alertId],
      () => {
        this.ensureSchema();
        const db = getDatabase();
        return db.prepare(`
          SELECT * FROM sec_alerts
          WHERE tenant_id = ? AND alert_id = ?
          LIMIT 1
        `).get(tenantId, alertId) as any;
      }
    );
    return row ? this.mapAlert(row) : null;
  }

  transitionAlert(tenantId: string, alertId: string, status: AlertStatus, actor: string): AlertRecord | null {
    this.ensureSchema();
    const db = getDatabase();
    const existing = db.prepare(`
      SELECT * FROM sec_alerts
      WHERE tenant_id = ? AND alert_id = ?
      LIMIT 1
    `).get(tenantId, alertId) as any;

    if (!existing) {
      return null;
    }

    const now = this.now();
    const investigationId =
      status === 'investigating'
        ? existing.investigation_id || `inv-${randomUUID().slice(0, 8)}`
        : existing.investigation_id || null;

    const metadata = {
      ...this.parseJson(existing.metadata_json, {}),
      lastActor: actor
    };

    db.prepare(`
      UPDATE sec_alerts
      SET status = ?, investigation_id = ?, metadata_json = ?, updated_at = ?
      WHERE alert_id = ?
    `).run(status, investigationId, JSON.stringify(metadata), now, alertId);
    this.shadowGet('sec_alerts', 'SELECT * FROM sec_alerts WHERE alert_id = ? LIMIT 1', alertId);

    if (existing.finding_id) {
      const findingStatus: FindingStatus =
        status === 'suppressed'
          ? 'suppressed'
          : status === 'resolved'
            ? 'resolved'
            : status === 'investigating'
              ? 'investigating'
              : status === 'acknowledged'
                ? 'acknowledged'
                : 'open';
      db.prepare(`
        UPDATE sec_findings
        SET status = ?, updated_at = ?
        WHERE finding_id = ?
      `).run(findingStatus, now, existing.finding_id);
      this.shadowGet('sec_findings', 'SELECT * FROM sec_findings WHERE finding_id = ? LIMIT 1', existing.finding_id);
    }

    this.recalculateAssetRisk(tenantId, existing.asset_id);
    return this.getAlertById(tenantId, alertId);
  }

  async transitionAlertView(tenantId: string, alertId: string, status: AlertStatus, actor: string): Promise<AlertRecord | null> {
    if (!this.shouldUseShadowReads()) {
      return this.transitionAlert(tenantId, alertId, status, actor);
    }

    const existing = await postgresShadowStoreService.queryOne<any>(
      `
        SELECT * FROM sec_alerts
        WHERE tenant_id = $1 AND alert_id = $2
        LIMIT 1
      `,
      [tenantId, alertId]
    );

    if (!existing) {
      return null;
    }

    const now = this.now();
    const investigationId =
      status === 'investigating'
        ? existing.investigation_id || `inv-${randomUUID().slice(0, 8)}`
        : existing.investigation_id || null;

    const metadata = {
      ...this.parseJson(existing.metadata_json, {}),
      lastActor: actor
    };

    await postgresShadowStoreService.execute(`
      UPDATE sec_alerts
      SET status = $1, investigation_id = $2, metadata_json = $3, updated_at = $4
      WHERE tenant_id = $5 AND alert_id = $6
    `, [status, investigationId, JSON.stringify(metadata), now, tenantId, alertId]);

    if (existing.finding_id) {
      const findingStatus: FindingStatus =
        status === 'suppressed'
          ? 'suppressed'
          : status === 'resolved'
            ? 'resolved'
            : status === 'investigating'
              ? 'investigating'
              : status === 'acknowledged'
                ? 'acknowledged'
                : 'open';

      await postgresShadowStoreService.execute(`
        UPDATE sec_findings
        SET status = $1, updated_at = $2
        WHERE finding_id = $3
      `, [findingStatus, now, existing.finding_id]);
    }

    if (existing.asset_id) {
      await this.recalculateAssetRiskView(tenantId, existing.asset_id);
    }

    // Mirror back to the legacy SQLite state so the worker/runtime layer stays coherent.
    this.transitionAlert(tenantId, alertId, status, actor);
    return this.getAlertByIdView(tenantId, alertId);
  }

  createActionFromFinding(tenantId: string, findingId: string, operator: string): ActionRunRecord | null {
    this.ensureSchema();
    const finding = this.getFindingById(tenantId, findingId);
    if (!finding) {
      return null;
    }

    const db = getDatabase();
    const existing = db.prepare(`
      SELECT *
      FROM sec_actions
      WHERE tenant_id = ? AND finding_id = ? AND status IN ('pending', 'running')
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(tenantId, findingId) as any;
    if (existing) {
      return this.mapAction(existing);
    }

    const now = this.now();
    const actionId = randomUUID();
    const relatedAlert = db.prepare(`
      SELECT alert_id
      FROM sec_alerts
      WHERE tenant_id = ? AND finding_id = ? AND status IN ('open', 'acknowledged', 'investigating')
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(tenantId, findingId) as any;
    const rollbackNotes = 'Revert the configuration change or rollback the deployment if validation fails.';
    const runLog = [
      { at: now, message: 'Remediation action created from finding evidence.', actor: operator },
      { at: now, message: 'Awaiting operator approval before execution.', actor: 'system' }
    ];

    db.prepare(`
      INSERT INTO sec_actions (
        action_id, tenant_id, asset_id, finding_id, alert_id, title, status, operator, rollback_notes, run_log_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(
      actionId,
      tenantId,
      finding.assetId || null,
      findingId,
      relatedAlert?.alert_id || null,
      `Remediate: ${finding.title}`,
      operator,
      rollbackNotes,
      JSON.stringify(runLog),
      now,
      now
    );
    this.shadowGet('sec_actions', 'SELECT * FROM sec_actions WHERE action_id = ? LIMIT 1', actionId);

    return this.getActionById(tenantId, actionId);
  }

  async createActionFromFindingView(tenantId: string, findingId: string, operator: string): Promise<ActionRunRecord | null> {
    if (!this.shouldUseShadowReads()) {
      return this.createActionFromFinding(tenantId, findingId, operator);
    }

    const finding = await this.getFindingByIdView(tenantId, findingId);
    if (!finding) {
      return null;
    }

    const existing = await postgresShadowStoreService.queryOne<any>(`
      SELECT *
      FROM sec_actions
      WHERE tenant_id = $1 AND finding_id = $2 AND status IN ('pending', 'running')
      ORDER BY updated_at DESC
      LIMIT 1
    `, [tenantId, findingId]);

    if (existing) {
      return this.mapAction(existing);
    }

    const now = this.now();
    const actionId = randomUUID();
    const relatedAlert = await postgresShadowStoreService.queryOne<any>(`
      SELECT alert_id
      FROM sec_alerts
      WHERE tenant_id = $1 AND finding_id = $2 AND status IN ('open', 'acknowledged', 'investigating')
      ORDER BY updated_at DESC
      LIMIT 1
    `, [tenantId, findingId]);
    const rollbackNotes = 'Revert the configuration change or rollback the deployment if validation fails.';
    const runLog = [
      { at: now, message: 'Remediation action created from finding evidence.', actor: operator },
      { at: now, message: 'Awaiting operator approval before execution.', actor: 'system' }
    ];

    await postgresShadowStoreService.execute(`
      INSERT INTO sec_actions (
        action_id, tenant_id, asset_id, finding_id, alert_id, title, status, operator, rollback_notes, run_log_json, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11)
    `, [
      actionId,
      tenantId,
      finding.assetId || null,
      findingId,
      relatedAlert?.alert_id || null,
      `Remediate: ${finding.title}`,
      operator,
      rollbackNotes,
      JSON.stringify(runLog),
      now,
      now
    ]);

    // Mirror back to SQLite so existing runtime consumers continue to work.
    this.recordActionRun({
      actionId,
      tenantId,
      assetId: finding.assetId,
      findingId,
      alertId: relatedAlert?.alert_id || undefined,
      title: `Remediate: ${finding.title}`,
      status: 'pending',
      operator,
      rollbackNotes,
      runLog
    });

    return this.getActionById(tenantId, actionId);
  }

  ensureActionDraftForFinding(tenantId: string, findingId: string, operator = 'system:auto-remediation'): ActionRunRecord | null {
    return this.createActionFromFinding(tenantId, findingId, operator);
  }

  recordActionRun(input: {
    actionId?: string;
    tenantId: string;
    title: string;
    status: ActionStatus;
    operator: string;
    rollbackNotes?: string;
    assetId?: string;
    findingId?: string;
    alertId?: string;
    runLog?: Record<string, any>[];
  }): ActionRunRecord {
    this.ensureSchema();
    const db = getDatabase();
    const now = this.now();
    const actionId = input.actionId || randomUUID();

    db.prepare(`
      INSERT INTO sec_actions (
        action_id, tenant_id, asset_id, finding_id, alert_id, title, status, operator, rollback_notes, run_log_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actionId,
      input.tenantId,
      input.assetId || null,
      input.findingId || null,
      input.alertId || null,
      input.title,
      input.status,
      input.operator,
      input.rollbackNotes || '',
      JSON.stringify(input.runLog || []),
      now,
      now
    );

    this.recalculateAssetRisk(input.tenantId, input.assetId);
    this.shadowGet('sec_actions', 'SELECT * FROM sec_actions WHERE action_id = ? LIMIT 1', actionId);
    return this.getActionById(input.tenantId, actionId)!;
  }

  updateActionRun(input: {
    tenantId: string;
    actionId: string;
    status?: ActionStatus;
    operator?: string;
    title?: string;
    rollbackNotes?: string;
    appendLog?: Record<string, any>[];
  }): ActionRunRecord | null {
    this.ensureSchema();
    const db = getDatabase();
    const existing = db.prepare(`
      SELECT *
      FROM sec_actions
      WHERE tenant_id = ? AND action_id = ?
      LIMIT 1
    `).get(input.tenantId, input.actionId) as any;

    if (!existing) {
      return null;
    }

    const nextLog = [
      ...this.parseJson(existing.run_log_json, []),
      ...(input.appendLog || [])
    ];

    db.prepare(`
      UPDATE sec_actions
      SET title = ?, status = ?, operator = ?, rollback_notes = ?, run_log_json = ?, updated_at = ?
      WHERE tenant_id = ? AND action_id = ?
    `).run(
      input.title || existing.title,
      input.status || existing.status,
      input.operator || existing.operator,
      input.rollbackNotes ?? existing.rollback_notes ?? '',
      JSON.stringify(nextLog),
      this.now(),
      input.tenantId,
      input.actionId
    );
    this.shadowGet('sec_actions', 'SELECT * FROM sec_actions WHERE action_id = ? LIMIT 1', input.actionId);

    return this.getActionById(input.tenantId, input.actionId);
  }

  listActions(tenantId: string, limit = 20): ActionRunRecord[] {
    this.ensureSchema();
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM sec_actions
      WHERE tenant_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(tenantId, limit) as any[];
    return rows.map((row) => this.mapAction(row));
  }

  async listActionsView(tenantId: string, limit = 20): Promise<ActionRunRecord[]> {
    const rows = await this.queryShadowAllWithFallback<any>(
      `
        SELECT * FROM sec_actions
        WHERE tenant_id = $1
        ORDER BY updated_at DESC
        LIMIT $2
      `,
      [tenantId, limit],
      () => {
        this.ensureSchema();
        const db = getDatabase();
        return db.prepare(`
          SELECT * FROM sec_actions
          WHERE tenant_id = ?
          ORDER BY updated_at DESC
          LIMIT ?
        `).all(tenantId, limit) as any[];
      }
    );
    return rows.map((row) => this.mapAction(row));
  }

  getActionById(tenantId: string, actionId: string): ActionRunRecord | null {
    this.ensureSchema();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM sec_actions
      WHERE tenant_id = ? AND action_id = ?
      LIMIT 1
    `).get(tenantId, actionId) as any;
    return row ? this.mapAction(row) : null;
  }

  recordValidationRun(input: {
    tenantId: string;
    attackId: string;
    attackName: string;
    category: string;
    severity: Severity;
    verdict: ValidationVerdict;
    detected: boolean;
    blocked: boolean;
    responseTime: number;
    startedAt: string;
    completedAt: string;
    result: Record<string, any>;
  }): ValidationRunRecord {
    this.ensureSchema();
    const db = getDatabase();
    const validationRunId = randomUUID();

    db.prepare(`
      INSERT INTO sec_validations (
        validation_run_id, tenant_id, attack_id, attack_name, category, severity, verdict, detected, blocked, response_time,
        result_json, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      validationRunId,
      input.tenantId,
      input.attackId,
      input.attackName,
      input.category,
      input.severity,
      input.verdict,
      input.detected ? 1 : 0,
      input.blocked ? 1 : 0,
      input.responseTime,
      JSON.stringify(input.result || {}),
      input.startedAt,
      input.completedAt
    );
    this.shadowGet('sec_validations', 'SELECT * FROM sec_validations WHERE validation_run_id = ? LIMIT 1', validationRunId);

    return this.listValidationRuns(input.tenantId, 1)[0];
  }

  listValidationRuns(tenantId: string, limit = 20): ValidationRunRecord[] {
    this.ensureSchema();
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM sec_validations
      WHERE tenant_id = ?
      ORDER BY completed_at DESC
      LIMIT ?
    `).all(tenantId, limit) as any[];
    return rows.map((row) => this.mapValidation(row));
  }

  async listValidationRunsView(tenantId: string, limit = 20): Promise<ValidationRunRecord[]> {
    const rows = await this.queryShadowAllWithFallback<any>(
      `
        SELECT * FROM sec_validations
        WHERE tenant_id = $1
        ORDER BY completed_at DESC
        LIMIT $2
      `,
      [tenantId, limit],
      () => {
        this.ensureSchema();
        const db = getDatabase();
        return db.prepare(`
          SELECT * FROM sec_validations
          WHERE tenant_id = ?
          ORDER BY completed_at DESC
          LIMIT ?
        `).all(tenantId, limit) as any[];
      }
    );
    return rows.map((row) => this.mapValidation(row));
  }

  upsertTrafficSession(input: {
    tenantId: string;
    sessionId: string;
    sourceIP: string;
    destIP: string;
    sourcePort: number;
    destPort: number;
    protocol: string;
    state: string;
    packetCount: number;
    byteCount: number;
    startTime: string;
    lastActivity: string;
    metadata?: Record<string, any>;
    sourceAssetId?: string;
    destAssetId?: string;
  }): void {
    this.ensureSchema();
    const db = getDatabase();
    const existing = db.prepare('SELECT session_id FROM sec_traffic_sessions WHERE session_id = ?').get(input.sessionId) as any;

    if (existing) {
      db.prepare(`
        UPDATE sec_traffic_sessions
        SET state = ?, packet_count = ?, byte_count = ?, last_activity = ?, metadata_json = ?
        WHERE session_id = ?
      `).run(
        input.state,
        input.packetCount,
        input.byteCount,
        input.lastActivity,
        JSON.stringify(input.metadata || {}),
        input.sessionId
      );
      this.shadowGet('sec_traffic_sessions', 'SELECT * FROM sec_traffic_sessions WHERE session_id = ? LIMIT 1', input.sessionId);
      return;
    }

    db.prepare(`
      INSERT INTO sec_traffic_sessions (
        session_id, tenant_id, source_ip, dest_ip, source_port, dest_port, protocol, state, packet_count,
        byte_count, start_time, last_activity, source_asset_id, dest_asset_id, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.sessionId,
      input.tenantId,
      input.sourceIP,
      input.destIP,
      input.sourcePort,
      input.destPort,
      input.protocol,
      input.state,
      input.packetCount,
      input.byteCount,
      input.startTime,
      input.lastActivity,
      input.sourceAssetId || null,
      input.destAssetId || null,
      JSON.stringify(input.metadata || {})
    );
    this.shadowGet('sec_traffic_sessions', 'SELECT * FROM sec_traffic_sessions WHERE session_id = ? LIMIT 1', input.sessionId);
  }

  listTrafficSessions(tenantId: string, limit = 50): any[] {
    this.ensureSchema();
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM sec_traffic_sessions
      WHERE tenant_id = ?
      ORDER BY last_activity DESC
      LIMIT ?
    `).all(tenantId, limit) as any[];
  }

  async listTrafficSessionsView(tenantId: string, limit = 50): Promise<any[]> {
    return this.queryShadowAllWithFallback<any>(
      `
        SELECT * FROM sec_traffic_sessions
        WHERE tenant_id = $1
        ORDER BY last_activity DESC
        LIMIT $2
      `,
      [tenantId, limit],
      () => {
        this.ensureSchema();
        const db = getDatabase();
        return db.prepare(`
          SELECT * FROM sec_traffic_sessions
          WHERE tenant_id = ?
          ORDER BY last_activity DESC
          LIMIT ?
        `).all(tenantId, limit) as any[];
      }
    );
  }

  summarizeThreats(tenantId: string): Array<{ type: string; count: number; severity: Severity }> {
    this.ensureSchema();
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT category AS type, severity, COUNT(*) AS count
      FROM sec_findings
      WHERE tenant_id = ? AND status IN ('open', 'acknowledged', 'investigating')
      GROUP BY category, severity
      ORDER BY count DESC
    `).all(tenantId) as any[];

    return rows.map((row) => ({
      type: row.type,
      count: Number(row.count || 0),
      severity: this.normalizeSeverity(row.severity)
    }));
  }

  async summarizeThreatsView(tenantId: string): Promise<Array<{ type: string; count: number; severity: Severity }>> {
    const rows = await this.queryShadowAllWithFallback<any>(
      `
        SELECT category AS type, severity, COUNT(*) AS count
        FROM sec_findings
        WHERE tenant_id = $1 AND status IN ('open', 'acknowledged', 'investigating')
        GROUP BY category, severity
        ORDER BY count DESC
      `,
      [tenantId],
      () => {
        this.ensureSchema();
        const db = getDatabase();
        return db.prepare(`
          SELECT category AS type, severity, COUNT(*) AS count
          FROM sec_findings
          WHERE tenant_id = ? AND status IN ('open', 'acknowledged', 'investigating')
          GROUP BY category, severity
          ORDER BY count DESC
        `).all(tenantId) as any[];
      }
    );

    return rows.map((row) => ({
      type: row.type,
      count: Number(row.count || 0),
      severity: this.normalizeSeverity(row.severity)
    }));
  }

  getDashboardSummary(tenantId: string): {
    openCriticalFindings: number;
    highRiskFindings: number;
    activeAlerts: number;
    runningScans: number;
    queuedScans: number;
    pendingActions: number;
    failedValidations: number;
    assetsAtRisk: number;
    observedSessions: number;
    trafficAnomalies: number;
    recentActions: ActionRunRecord[];
    recentValidations: ValidationRunRecord[];
  } {
    this.ensureSchema();
    const db = getDatabase();
    const recentWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const openCriticalFindings = Number(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM sec_findings
        WHERE tenant_id = ? AND severity = 'critical' AND status IN ('open', 'acknowledged', 'investigating')
      `).get(tenantId)?.count || 0
    );

    const highRiskFindings = Number(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM sec_findings
        WHERE tenant_id = ? AND severity IN ('critical', 'high') AND status IN ('open', 'acknowledged', 'investigating')
      `).get(tenantId)?.count || 0
    );

    const activeAlerts = Number(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM sec_alerts
        WHERE tenant_id = ? AND status IN ('open', 'acknowledged', 'investigating')
      `).get(tenantId)?.count || 0
    );

    const runningScans = Number(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM scan_runs
        WHERE tenant_id = ? AND status IN ('pending', 'running')
      `).get(tenantId)?.count || 0
    );

    const queuedScans = Number(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM scan_runs
        WHERE tenant_id = ? AND status = 'pending'
      `).get(tenantId)?.count || 0
    );

    const pendingActions = Number(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM sec_actions
        WHERE tenant_id = ? AND status IN ('pending', 'queued', 'running')
      `).get(tenantId)?.count || 0
    );

    const failedValidations = Number(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM sec_validations
        WHERE tenant_id = ? AND verdict IN ('missed', 'false_positive', 'timeout')
      `).get(tenantId)?.count || 0
    );

    const assetsAtRisk = Number(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM sec_assets
        WHERE tenant_id = ? AND risk_score >= 45
      `).get(tenantId)?.count || 0
    );

    const observedSessions = Number(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM sec_traffic_sessions
        WHERE tenant_id = ? AND last_activity >= ?
      `).get(tenantId, recentWindowStart)?.count || 0
    );

    const trafficAnomalies = Number(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM sec_traffic_sessions
        WHERE tenant_id = ? AND last_activity >= ? AND (
          state NOT IN ('ESTABLISHED', 'COMPLETED') OR
          metadata_json LIKE '%"classification":"security-signal"%' OR
          metadata_json LIKE '%"classification":"scan-failure"%' OR
          metadata_json LIKE '%"classification":"sensitive-exposure"%'
        )
      `).get(tenantId, recentWindowStart)?.count || 0
    );

    return {
      openCriticalFindings,
      highRiskFindings,
      activeAlerts,
      runningScans,
      queuedScans,
      pendingActions,
      failedValidations,
      assetsAtRisk,
      observedSessions,
      trafficAnomalies,
      recentActions: this.listActions(tenantId, 5),
      recentValidations: this.listValidationRuns(tenantId, 5)
    };
  }

  async getDashboardSummaryView(tenantId: string): Promise<{
    openCriticalFindings: number;
    highRiskFindings: number;
    activeAlerts: number;
    runningScans: number;
    queuedScans: number;
    pendingActions: number;
    failedValidations: number;
    assetsAtRisk: number;
    observedSessions: number;
    trafficAnomalies: number;
    recentActions: ActionRunRecord[];
    recentValidations: ValidationRunRecord[];
  }> {
    const recentWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      openCriticalFindingsRow,
      highRiskFindingsRow,
      activeAlertsRow,
      runningScansRow,
      queuedScansRow,
      pendingActionsRow,
      failedValidationsRow,
      assetsAtRiskRow,
      observedSessionsRow,
      trafficAnomaliesRow,
      recentActions,
      recentValidations
    ] = await Promise.all([
      this.queryShadowOneWithFallback<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM sec_findings WHERE tenant_id = $1 AND severity = 'critical' AND status IN ('open', 'acknowledged', 'investigating')`,
        [tenantId],
        () => ({ count: this.getDashboardSummary(tenantId).openCriticalFindings })
      ),
      this.queryShadowOneWithFallback<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM sec_findings WHERE tenant_id = $1 AND severity IN ('critical', 'high') AND status IN ('open', 'acknowledged', 'investigating')`,
        [tenantId],
        () => ({ count: this.getDashboardSummary(tenantId).highRiskFindings })
      ),
      this.queryShadowOneWithFallback<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM sec_alerts WHERE tenant_id = $1 AND status IN ('open', 'acknowledged', 'investigating')`,
        [tenantId],
        () => ({ count: this.getDashboardSummary(tenantId).activeAlerts })
      ),
      this.queryShadowOneWithFallback<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM scan_runs WHERE tenant_id = $1 AND status IN ('pending', 'running')`,
        [tenantId],
        () => ({ count: this.getDashboardSummary(tenantId).runningScans })
      ),
      this.queryShadowOneWithFallback<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM scan_runs WHERE tenant_id = $1 AND status = 'pending'`,
        [tenantId],
        () => ({ count: this.getDashboardSummary(tenantId).queuedScans })
      ),
      this.queryShadowOneWithFallback<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM sec_actions WHERE tenant_id = $1 AND status IN ('pending', 'queued', 'running')`,
        [tenantId],
        () => ({ count: this.getDashboardSummary(tenantId).pendingActions })
      ),
      this.queryShadowOneWithFallback<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM sec_validations WHERE tenant_id = $1 AND verdict IN ('missed', 'false_positive', 'timeout')`,
        [tenantId],
        () => ({ count: this.getDashboardSummary(tenantId).failedValidations })
      ),
      this.queryShadowOneWithFallback<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM sec_assets WHERE tenant_id = $1 AND risk_score >= 45`,
        [tenantId],
        () => ({ count: this.getDashboardSummary(tenantId).assetsAtRisk })
      ),
      this.queryShadowOneWithFallback<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM sec_traffic_sessions WHERE tenant_id = $1 AND last_activity >= $2`,
        [tenantId, recentWindowStart],
        () => ({ count: this.getDashboardSummary(tenantId).observedSessions })
      ),
      this.queryShadowOneWithFallback<{ count: number }>(
        `
          SELECT COUNT(*)::int AS count
          FROM sec_traffic_sessions
          WHERE tenant_id = $1 AND last_activity >= $2 AND (
            state NOT IN ('ESTABLISHED', 'COMPLETED') OR
            metadata_json LIKE '%"classification":"security-signal"%' OR
            metadata_json LIKE '%"classification":"scan-failure"%' OR
            metadata_json LIKE '%"classification":"sensitive-exposure"%'
          )
        `,
        [tenantId, recentWindowStart],
        () => ({ count: this.getDashboardSummary(tenantId).trafficAnomalies })
      ),
      this.listActionsView(tenantId, 5),
      this.listValidationRunsView(tenantId, 5)
    ]);

    return {
      openCriticalFindings: Number(openCriticalFindingsRow?.count || 0),
      highRiskFindings: Number(highRiskFindingsRow?.count || 0),
      activeAlerts: Number(activeAlertsRow?.count || 0),
      runningScans: Number(runningScansRow?.count || 0),
      queuedScans: Number(queuedScansRow?.count || 0),
      pendingActions: Number(pendingActionsRow?.count || 0),
      failedValidations: Number(failedValidationsRow?.count || 0),
      assetsAtRisk: Number(assetsAtRiskRow?.count || 0),
      observedSessions: Number(observedSessionsRow?.count || 0),
      trafficAnomalies: Number(trafficAnomaliesRow?.count || 0),
      recentActions,
      recentValidations
    };
  }

  getAssetOverviewByExternalRef(tenantId: string, assetType: AssetType, externalRef: string): {
    asset: AssetSummary | null;
    findings: FindingRecord[];
    alerts: AlertRecord[];
    actions: ActionRunRecord[];
  } {
    const asset = this.getAssetByExternalRef(tenantId, assetType, externalRef);
    if (!asset) {
      return { asset: null, findings: [], alerts: [], actions: [] };
    }

    const db = getDatabase();
    const findings = db.prepare(`
      SELECT * FROM sec_findings
      WHERE tenant_id = ? AND asset_id = ?
      ORDER BY updated_at DESC
      LIMIT 20
    `).all(tenantId, asset.assetId) as any[];

    const alerts = db.prepare(`
      SELECT * FROM sec_alerts
      WHERE tenant_id = ? AND asset_id = ?
      ORDER BY updated_at DESC
      LIMIT 20
    `).all(tenantId, asset.assetId) as any[];

    const actions = db.prepare(`
      SELECT * FROM sec_actions
      WHERE tenant_id = ? AND asset_id = ?
      ORDER BY updated_at DESC
      LIMIT 20
    `).all(tenantId, asset.assetId) as any[];

    return {
      asset,
      findings: findings.map((row) => this.mapFinding(row)),
      alerts: alerts.map((row) => this.mapAlert(row)),
      actions: actions.map((row) => this.mapAction(row))
    };
  }

  listAssetsByExternalRefs(tenantId: string, externalRefs: string[], assetTypes?: AssetType[]): AssetSummary[] {
    this.ensureSchema();
    const refs = Array.from(new Set(externalRefs.map((item) => String(item || '').trim()).filter(Boolean)));
    if (refs.length === 0) {
      return [];
    }

    const db = getDatabase();
    const clauses = ['tenant_id = ?', `external_ref IN (${refs.map(() => '?').join(',')})`];
    const params: any[] = [tenantId, ...refs];

    if (assetTypes && assetTypes.length > 0) {
      clauses.push(`asset_type IN (${assetTypes.map(() => '?').join(',')})`);
      params.push(...assetTypes);
    }

    const rows = db.prepare(`
      SELECT * FROM sec_assets
      WHERE ${clauses.join(' AND ')}
      ORDER BY risk_score DESC, updated_at DESC
    `).all(...params) as any[];

    return rows.map((row) => this.mapAsset(row));
  }

  getOperationalContextForExternalRefs(
    tenantId: string,
    externalRefs: string[],
    assetTypes?: AssetType[],
    limit = 20
  ): {
    assets: AssetSummary[];
    findings: FindingRecord[];
    alerts: AlertRecord[];
    actions: ActionRunRecord[];
    trafficSessions: any[];
    serviceExposure: any[];
    scanRuns: any[];
  } {
    const assets = this.listAssetsByExternalRefs(tenantId, externalRefs, assetTypes);
    const context = this.getOperationalContextForAssetIds(tenantId, assets.map((asset) => asset.assetId), limit);
    return {
      assets,
      findings: context.findings,
      alerts: context.alerts,
      actions: context.actions,
      trafficSessions: context.trafficSessions,
      serviceExposure: context.serviceExposure,
      scanRuns: context.scanRuns
    };
  }

  getOperationalContextForAssetIds(
    tenantId: string,
    assetIds: string[],
    limit = 20
  ): {
    assets: AssetSummary[];
    findings: FindingRecord[];
    alerts: AlertRecord[];
    actions: ActionRunRecord[];
    trafficSessions: any[];
    serviceExposure: any[];
    scanRuns: any[];
  } {
    this.ensureSchema();
    const uniqueAssetIds = Array.from(new Set(assetIds.map((item) => String(item || '').trim()).filter(Boolean)));
    if (uniqueAssetIds.length === 0) {
      return {
        assets: [],
        findings: [],
        alerts: [],
        actions: [],
        trafficSessions: [],
        serviceExposure: [],
        scanRuns: []
      };
    }

    const db = getDatabase();
    const assetPlaceholders = uniqueAssetIds.map(() => '?').join(',');

    const assetRows = db.prepare(`
      SELECT * FROM sec_assets
      WHERE tenant_id = ? AND asset_id IN (${assetPlaceholders})
      ORDER BY risk_score DESC, updated_at DESC
    `).all(tenantId, ...uniqueAssetIds) as any[];

    const findingsRows = db.prepare(`
      SELECT * FROM sec_findings
      WHERE tenant_id = ? AND asset_id IN (${assetPlaceholders})
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 4
          WHEN 'high' THEN 3
          WHEN 'medium' THEN 2
          ELSE 1
        END DESC,
        updated_at DESC
      LIMIT ?
    `).all(tenantId, ...uniqueAssetIds, limit) as any[];

    const alertRows = db.prepare(`
      SELECT * FROM sec_alerts
      WHERE tenant_id = ? AND asset_id IN (${assetPlaceholders})
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(tenantId, ...uniqueAssetIds, limit) as any[];

    const actionRows = db.prepare(`
      SELECT * FROM sec_actions
      WHERE tenant_id = ? AND asset_id IN (${assetPlaceholders})
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(tenantId, ...uniqueAssetIds, limit) as any[];

    const trafficRows = db.prepare(`
      SELECT * FROM sec_traffic_sessions
      WHERE tenant_id = ? AND (
        source_asset_id IN (${assetPlaceholders}) OR
        dest_asset_id IN (${assetPlaceholders})
      )
      ORDER BY last_activity DESC
      LIMIT ?
    `).all(tenantId, ...uniqueAssetIds, ...uniqueAssetIds, limit) as any[];

    const serviceRows = db.prepare(`
      SELECT * FROM scan_services
      WHERE tenant_id = ? AND asset_id IN (${assetPlaceholders})
      ORDER BY discovered_at DESC
      LIMIT ?
    `).all(tenantId, ...uniqueAssetIds, limit) as any[];

    const scanRows = db.prepare(`
      SELECT r.*
      FROM scan_runs r
      INNER JOIN scan_target_assets ta ON ta.run_id = r.id
      WHERE r.tenant_id = ? AND ta.asset_id IN (${assetPlaceholders})
      GROUP BY r.id
      ORDER BY COALESCE(r.completed_at, r.started_at, r.created_at) DESC
      LIMIT ?
    `).all(tenantId, ...uniqueAssetIds, limit) as any[];

    return {
      assets: assetRows.map((row) => this.mapAsset(row)),
      findings: findingsRows.map((row) => this.mapFinding(row)),
      alerts: alertRows.map((row) => this.mapAlert(row)),
      actions: actionRows.map((row) => this.mapAction(row)),
      trafficSessions: trafficRows.map((row) => ({
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
        metadata: this.parseJson(row.metadata_json, {})
      })),
      serviceExposure: serviceRows.map((row) => ({
        id: row.id,
        runId: row.run_id,
        targetId: row.target_id || undefined,
        assetId: row.asset_id || undefined,
        host: row.host,
        port: Number(row.port || 0),
        protocol: row.protocol,
        service: row.service || undefined,
        banner: row.banner || undefined,
        tlsSummary: this.parseJson(row.tls_summary_json, {}),
        metadata: this.parseJson(row.metadata_json, {}),
        discoveredAt: row.discovered_at
      })),
      scanRuns: scanRows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        status: row.status,
        phase: row.phase,
        progress: Number(row.progress || 0),
        profileId: row.profile_id,
        error: row.error || undefined,
        summary: this.parseJson(row.summary_json, {}),
        createdAt: row.created_at,
        startedAt: row.started_at || undefined,
        completedAt: row.completed_at || undefined
      }))
    };
  }

  async getOperationalContextForAssetIdsView(
    tenantId: string,
    assetIds: string[],
    limit = 20
  ): Promise<{
    assets: AssetSummary[];
    findings: FindingRecord[];
    alerts: AlertRecord[];
    actions: ActionRunRecord[];
    trafficSessions: any[];
    serviceExposure: any[];
    scanRuns: any[];
  }> {
    const uniqueAssetIds = Array.from(new Set(assetIds.map((item) => String(item || '').trim()).filter(Boolean)));
    if (uniqueAssetIds.length === 0) {
      return {
        assets: [],
        findings: [],
        alerts: [],
        actions: [],
        trafficSessions: [],
        serviceExposure: [],
        scanRuns: []
      };
    }

    if (!this.shouldUseShadowReads()) {
      return this.getOperationalContextForAssetIds(tenantId, uniqueAssetIds, limit);
    }

    try {
      const [assetRows, findingsRows, alertRows, actionRows, trafficRows, serviceRows, scanRows] = await Promise.all([
        postgresShadowStoreService.queryAll<any>(
          `
            SELECT * FROM sec_assets
            WHERE tenant_id = $1 AND asset_id = ANY($2)
            ORDER BY risk_score DESC, updated_at DESC
          `,
          [tenantId, uniqueAssetIds]
        ),
        postgresShadowStoreService.queryAll<any>(
          `
            SELECT * FROM sec_findings
            WHERE tenant_id = $1 AND asset_id = ANY($2)
            ORDER BY
              CASE severity
                WHEN 'critical' THEN 4
                WHEN 'high' THEN 3
                WHEN 'medium' THEN 2
                ELSE 1
              END DESC,
              updated_at DESC
            LIMIT $3
          `,
          [tenantId, uniqueAssetIds, limit]
        ),
        postgresShadowStoreService.queryAll<any>(
          `
            SELECT * FROM sec_alerts
            WHERE tenant_id = $1 AND asset_id = ANY($2)
            ORDER BY updated_at DESC
            LIMIT $3
          `,
          [tenantId, uniqueAssetIds, limit]
        ),
        postgresShadowStoreService.queryAll<any>(
          `
            SELECT * FROM sec_actions
            WHERE tenant_id = $1 AND asset_id = ANY($2)
            ORDER BY updated_at DESC
            LIMIT $3
          `,
          [tenantId, uniqueAssetIds, limit]
        ),
        postgresShadowStoreService.queryAll<any>(
          `
            SELECT * FROM sec_traffic_sessions
            WHERE tenant_id = $1 AND (
              source_asset_id = ANY($2) OR
              dest_asset_id = ANY($2)
            )
            ORDER BY last_activity DESC
            LIMIT $3
          `,
          [tenantId, uniqueAssetIds, limit]
        ),
        postgresShadowStoreService.queryAll<any>(
          `
            SELECT * FROM scan_services
            WHERE tenant_id = $1 AND asset_id = ANY($2)
            ORDER BY discovered_at DESC
            LIMIT $3
          `,
          [tenantId, uniqueAssetIds, limit]
        ),
        postgresShadowStoreService.queryAll<any>(
          `
            SELECT r.*
            FROM scan_runs r
            INNER JOIN scan_target_assets ta ON ta.run_id = r.id
            WHERE r.tenant_id = $1 AND ta.asset_id = ANY($2)
            GROUP BY r.id
            ORDER BY COALESCE(r.completed_at, r.started_at, r.created_at) DESC
            LIMIT $3
          `,
          [tenantId, uniqueAssetIds, limit]
        )
      ]);

      return {
        assets: assetRows.map((row) => this.mapAsset(row)),
        findings: findingsRows.map((row) => this.mapFinding(row)),
        alerts: alertRows.map((row) => this.mapAlert(row)),
        actions: actionRows.map((row) => this.mapAction(row)),
        trafficSessions: trafficRows.map((row) => this.mapTrafficSessionRow(row)),
        serviceExposure: serviceRows.map((row) => this.mapServiceExposureRow(row)),
        scanRuns: scanRows.map((row) => this.mapScanRunRow(row))
      };
    } catch {
      return this.getOperationalContextForAssetIds(tenantId, uniqueAssetIds, limit);
    }
  }

  getTrafficSessionById(tenantId: string, sessionId: string): any | null {
    this.ensureSchema();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM sec_traffic_sessions
      WHERE tenant_id = ? AND session_id = ?
      LIMIT 1
    `).get(tenantId, sessionId) as any;

    if (!row) {
      return null;
    }

    return {
      ...this.mapTrafficSessionRow(row)
    };
  }

  async getTrafficSessionByIdView(tenantId: string, sessionId: string): Promise<any | null> {
    const row = await this.queryShadowOneWithFallback<any>(
      `
        SELECT * FROM sec_traffic_sessions
        WHERE tenant_id = $1 AND session_id = $2
        LIMIT 1
      `,
      [tenantId, sessionId],
      () => {
        this.ensureSchema();
        const db = getDatabase();
        return db.prepare(`
          SELECT * FROM sec_traffic_sessions
          WHERE tenant_id = ? AND session_id = ?
          LIMIT 1
        `).get(tenantId, sessionId) as any;
      }
    );

    return row ? this.mapTrafficSessionRow(row) : null;
  }

  getValidationRunById(tenantId: string, validationRunId: string): ValidationRunRecord | null {
    this.ensureSchema();
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM sec_validations
      WHERE tenant_id = ? AND validation_run_id = ?
      LIMIT 1
    `).get(tenantId, validationRunId) as any;

    return row ? this.mapValidation(row) : null;
  }

  async getValidationRunByIdView(tenantId: string, validationRunId: string): Promise<ValidationRunRecord | null> {
    const row = await this.queryShadowOneWithFallback<any>(
      `
        SELECT * FROM sec_validations
        WHERE tenant_id = $1 AND validation_run_id = $2
        LIMIT 1
      `,
      [tenantId, validationRunId],
      () => {
        this.ensureSchema();
        const db = getDatabase();
        return db.prepare(`
          SELECT * FROM sec_validations
          WHERE tenant_id = ? AND validation_run_id = ?
          LIMIT 1
        `).get(tenantId, validationRunId) as any;
      }
    );

    return row ? this.mapValidation(row) : null;
  }

  listValidationRunsByAttackId(tenantId: string, attackId: string, limit = 20): ValidationRunRecord[] {
    this.ensureSchema();
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM sec_validations
      WHERE tenant_id = ? AND attack_id = ?
      ORDER BY completed_at DESC
      LIMIT ?
    `).all(tenantId, attackId, limit) as any[];

    return rows.map((row) => this.mapValidation(row));
  }

  async listValidationRunsByAttackIdView(tenantId: string, attackId: string, limit = 20): Promise<ValidationRunRecord[]> {
    const rows = await this.queryShadowAllWithFallback<any>(
      `
        SELECT * FROM sec_validations
        WHERE tenant_id = $1 AND attack_id = $2
        ORDER BY completed_at DESC
        LIMIT $3
      `,
      [tenantId, attackId, limit],
      () => {
        this.ensureSchema();
        const db = getDatabase();
        return db.prepare(`
          SELECT * FROM sec_validations
          WHERE tenant_id = ? AND attack_id = ?
          ORDER BY completed_at DESC
          LIMIT ?
        `).all(tenantId, attackId, limit) as any[];
      }
    );
    return rows.map((row) => this.mapValidation(row));
  }

  private recalculateAssetRisk(tenantId: string, assetId?: string | null): void {
    if (!assetId) {
      return;
    }

    const db = getDatabase();
    const findingRows = db.prepare(`
      SELECT severity
      FROM sec_findings
      WHERE tenant_id = ? AND asset_id = ? AND status IN ('open', 'acknowledged', 'investigating')
    `).all(tenantId, assetId) as any[];
    const alertRows = db.prepare(`
      SELECT severity
      FROM sec_alerts
      WHERE tenant_id = ? AND asset_id = ? AND status IN ('open', 'acknowledged', 'investigating')
    `).all(tenantId, assetId) as any[];

    const riskScore = findingRows.reduce((sum, row) => sum + severityWeight[this.normalizeSeverity(row.severity)], 0);
    const alertsOpen = alertRows.length;
    const findingsOpen = findingRows.length;

    db.prepare(`
      UPDATE sec_assets
      SET risk_score = ?, alerts_open = ?, findings_open = ?, updated_at = ?, last_seen_at = ?
      WHERE tenant_id = ? AND asset_id = ?
    `).run(riskScore, alertsOpen, findingsOpen, this.now(), this.now(), tenantId, assetId);
    this.shadowGet('sec_assets', 'SELECT * FROM sec_assets WHERE tenant_id = ? AND asset_id = ? LIMIT 1', tenantId, assetId);
  }

  private async recalculateAssetRiskView(tenantId: string, assetId?: string | null): Promise<void> {
    if (!assetId || !this.shouldUseShadowReads()) {
      this.recalculateAssetRisk(tenantId, assetId);
      return;
    }

    const [findingRows, alertRows] = await Promise.all([
      postgresShadowStoreService.queryAll<{ severity: string }>(`
        SELECT severity
        FROM sec_findings
        WHERE tenant_id = $1 AND asset_id = $2 AND status IN ('open', 'acknowledged', 'investigating')
      `, [tenantId, assetId]),
      postgresShadowStoreService.queryAll<{ severity: string }>(`
        SELECT severity
        FROM sec_alerts
        WHERE tenant_id = $1 AND asset_id = $2 AND status IN ('open', 'acknowledged', 'investigating')
      `, [tenantId, assetId])
    ]);

    const riskScore = findingRows.reduce((sum, row) => sum + severityWeight[this.normalizeSeverity(row.severity)], 0);
    const alertsOpen = alertRows.length;
    const findingsOpen = findingRows.length;

    await postgresShadowStoreService.execute(`
      UPDATE sec_assets
      SET risk_score = $1, alerts_open = $2, findings_open = $3, updated_at = $4, last_seen_at = $5
      WHERE tenant_id = $6 AND asset_id = $7
    `, [riskScore, alertsOpen, findingsOpen, this.now(), this.now(), tenantId, assetId]);

    this.recalculateAssetRisk(tenantId, assetId);
  }

  private mapTrafficSessionRow(row: any): any {
    return {
      sessionId: row.session_id,
      tenantId: row.tenant_id,
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
      metadata: this.parseJson(row.metadata_json, {})
    };
  }

  private mapServiceExposureRow(row: any): any {
    return {
      id: row.id,
      runId: row.run_id,
      targetId: row.target_id || undefined,
      assetId: row.asset_id || undefined,
      host: row.host,
      port: Number(row.port || 0),
      protocol: row.protocol,
      service: row.service || undefined,
      banner: row.banner || undefined,
      tlsSummary: this.parseJson(row.tls_summary_json, {}),
      metadata: this.parseJson(row.metadata_json, {}),
      discoveredAt: row.discovered_at
    };
  }

  private mapScanRunRow(row: any): any {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      status: row.status,
      phase: row.phase,
      progress: Number(row.progress || 0),
      profileId: row.profile_id,
      error: row.error || undefined,
      summary: this.parseJson(row.summary_json, {}),
      createdAt: row.created_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined
    };
  }

  private mapAsset(row: any): AssetSummary {
    return {
      assetId: row.asset_id,
      tenantId: row.tenant_id,
      assetType: row.asset_type,
      externalRef: row.external_ref,
      displayName: row.display_name,
      primaryAddress: row.primary_address || undefined,
      status: row.status,
      riskScore: Number(row.risk_score || 0),
      findingsOpen: Number(row.findings_open || 0),
      alertsOpen: Number(row.alerts_open || 0),
      metadata: this.parseJson(row.metadata_json, {}),
      lastSeenAt: row.last_seen_at || undefined
    };
  }

  private mapFinding(row: any): FindingRecord {
    return {
      findingId: row.finding_id,
      tenantId: row.tenant_id,
      assetId: row.asset_id || undefined,
      sourceType: row.source_type,
      sourceRef: row.source_ref,
      target: row.target,
      category: row.category,
      severity: this.normalizeSeverity(row.severity),
      status: row.status as FindingStatus,
      title: row.title,
      description: row.description,
      evidence: this.parseJson(row.evidence_json, {}),
      remediation: this.parseJson(row.remediation_json, {}),
      fingerprint: row.fingerprint,
      occurrenceCount: Number(row.occurrence_count || 0),
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at
    };
  }

  private mapAlert(row: any): AlertRecord {
    const severity = this.normalizeSeverity(row.severity);
    return {
      id: row.alert_id,
      title: row.title,
      message: row.message,
      severity: this.mapSeverityLabel(severity),
      type: row.alert_type,
      source: row.source_ref,
      time: this.relativeTime(row.updated_at || row.created_at),
      status: row.status,
      timestamp: row.created_at,
      assetId: row.asset_id || undefined,
      findingId: row.finding_id || undefined,
      investigationId: row.investigation_id || undefined,
      metadata: this.parseJson(row.metadata_json, {})
    };
  }

  private mapAction(row: any): ActionRunRecord {
    return {
      actionId: row.action_id,
      tenantId: row.tenant_id,
      assetId: row.asset_id || undefined,
      findingId: row.finding_id || undefined,
      alertId: row.alert_id || undefined,
      title: row.title,
      status: row.status,
      operator: row.operator,
      rollbackNotes: row.rollback_notes || '',
      runLog: this.parseJson(row.run_log_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapValidation(row: any): ValidationRunRecord {
    return {
      validationRunId: row.validation_run_id,
      tenantId: row.tenant_id,
      attackId: row.attack_id,
      attackName: row.attack_name,
      category: row.category,
      severity: this.normalizeSeverity(row.severity),
      verdict: row.verdict,
      detected: Boolean(row.detected),
      blocked: Boolean(row.blocked),
      responseTime: Number(row.response_time || 0),
      startedAt: row.started_at,
      completedAt: row.completed_at,
      result: this.parseJson(row.result_json, {})
    };
  }
}

export const securityOperationsService = new SecurityOperationsService();
