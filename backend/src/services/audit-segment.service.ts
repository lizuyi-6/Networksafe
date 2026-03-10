import { createHash, randomUUID } from 'crypto';
import { getDatabase } from '../config/database';
import { getArtifactStoreMode } from '../config/platform-runtime';
import { artifactStoreService } from './artifact-store.service';
import { auditArchiveService } from './audit-archive.service';
import { postgresShadowStoreService } from './postgres-shadow-store.service';
import logger from '../utils/logger';

interface AuditLogRow {
  id: string;
  timestamp: string;
  tenant_id?: string | null;
  event_type: string;
  category: string;
  severity: string;
  actor_type: string;
  actor_id: string;
  actor_email?: string | null;
  actor_ip?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  details_json: string;
  status: string;
  signature: string;
}

interface PersistedSegmentRow {
  id: string;
  tenant_id: string;
  segment_key: string;
  chain_hash: string;
  object_key?: string | null;
  version_id?: string | null;
  retention_until?: string | null;
  object_lock_enabled?: boolean | number | null;
  verify_status?: string | null;
  lock_mode: string;
  status: string;
  metadata_json?: string | null;
  created_at: string;
  verified_at?: string | null;
}

export interface AuditSegmentMetadata {
  previousSegmentId: string | null;
  previousChainHash: string | null;
  contentHash: string;
  recordCount: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  firstLogId: string | null;
  lastLogId: string | null;
  artifactRef: string;
  artifactLocation: string;
  bucket: string | null;
  objectKey: string | null;
  versionId: string | null;
  retentionUntil: string | null;
  storeMode: string;
  objectLockRequested: boolean;
  objectLockEnabled: boolean;
  verifyStatus: 'pending' | 'verified' | 'corrupt';
}

export interface AuditSegmentRecord {
  id: string;
  tenantId: string;
  segmentKey: string;
  chainHash: string;
  objectKey: string | null;
  versionId: string | null;
  retentionUntil: string | null;
  objectLockEnabled: boolean;
  verifyStatus: string;
  lockMode: string;
  status: string;
  metadata: AuditSegmentMetadata;
  createdAt: string;
  verifiedAt: string | null;
}

export interface ArchivedAuditSegmentPayload {
  version: '1.0';
  segmentId: string;
  tenantId: string;
  segmentKey: string;
  chainHash: string;
  previousChainHash: string | null;
  createdAt: string;
  recordCount: number;
  records: Array<{
    id: string;
    timestamp: string;
    tenantId?: string;
    eventType: string;
    category: string;
    severity: string;
    actor: {
      type: string;
      id: string;
      email?: string;
      ip?: string;
    };
    action: string;
    target?: {
      type: string;
      id: string;
    };
    details: Record<string, any>;
    status: string;
    signature: string;
  }>;
}

interface ArchiveOptions {
  tenantId?: string;
  before?: string;
  maxLogsPerSegment?: number;
  maxSegments?: number;
}

interface VerifyResult {
  valid: boolean;
  chainValid: boolean;
  contentValid: boolean;
  linkageValid: boolean;
  objectLockValid: boolean;
  segment: AuditSegmentRecord | null;
}

function normalizeTenantId(value?: string | null): string {
  return String(value || '').trim() || 'global';
}

function normalizeLimit(value: any, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function parseMetadata(raw: any): AuditSegmentMetadata {
  const fallback: AuditSegmentMetadata = {
    previousSegmentId: null,
    previousChainHash: null,
    contentHash: '',
    recordCount: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    firstLogId: null,
    lastLogId: null,
    artifactRef: '',
    artifactLocation: '',
    bucket: null,
    objectKey: null,
    versionId: null,
    retentionUntil: null,
    storeMode: getArtifactStoreMode(),
    objectLockRequested: false,
    objectLockEnabled: false,
    verifyStatus: 'pending'
  };

  if (!raw || typeof raw !== 'string') {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AuditSegmentMetadata>;
    return {
      ...fallback,
      ...parsed
    };
  } catch {
    return fallback;
  }
}

function canonicalizeRecords(rows: AuditLogRow[]) {
  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    tenantId: row.tenant_id || undefined,
    eventType: row.event_type,
    category: row.category,
    severity: row.severity,
    actor: {
      type: row.actor_type,
      id: row.actor_id,
      email: row.actor_email || undefined,
      ip: row.actor_ip || undefined
    },
    action: row.action,
    target: row.target_type ? {
      type: row.target_type,
      id: row.target_id || ''
    } : undefined,
    details: (() => {
      try {
        return JSON.parse(row.details_json || '{}');
      } catch {
        return {};
      }
    })(),
    status: row.status,
    signature: row.signature
  }));
}

function computeContentHash(records: ArchivedAuditSegmentPayload['records']): string {
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

function computeChainHash(tenantId: string, segmentKey: string, previousChainHash: string | null, contentHash: string): string {
  return createHash('sha256')
    .update(`${tenantId}|${segmentKey}|${previousChainHash || 'ROOT'}|${contentHash}`)
    .digest('hex');
}

class AuditSegmentService {
  private schemaReady = false;

  private ensureSchema(): void {
    if (this.schemaReady) {
      return;
    }

    const db = getDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_segments (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        segment_key TEXT NOT NULL,
        chain_hash TEXT NOT NULL,
        object_key TEXT,
        version_id TEXT,
        retention_until TEXT,
        object_lock_enabled INTEGER NOT NULL DEFAULT 0,
        verify_status TEXT NOT NULL DEFAULT 'pending',
        lock_mode TEXT NOT NULL DEFAULT 'hash_chain',
        status TEXT NOT NULL DEFAULT 'pending',
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        verified_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_segments_tenant ON audit_segments(tenant_id, created_at DESC);
    `);

    const migrations = [
      `ALTER TABLE audit_segments ADD COLUMN version_id TEXT`,
      `ALTER TABLE audit_segments ADD COLUMN retention_until TEXT`,
      `ALTER TABLE audit_segments ADD COLUMN object_lock_enabled INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE audit_segments ADD COLUMN verify_status TEXT NOT NULL DEFAULT 'pending'`
    ];
    for (const migration of migrations) {
      try {
        db.exec(migration);
      } catch {
        // ignore existing-column migration errors
      }
    }

    this.schemaReady = true;
  }

  private mapRow(row: PersistedSegmentRow): AuditSegmentRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      segmentKey: row.segment_key,
      chainHash: row.chain_hash,
      objectKey: row.object_key || null,
      versionId: row.version_id || null,
      retentionUntil: row.retention_until || null,
      objectLockEnabled: row.object_lock_enabled == null
        ? parseMetadata(row.metadata_json).objectLockEnabled
        : Boolean(row.object_lock_enabled),
      verifyStatus: row.verify_status || parseMetadata(row.metadata_json).verifyStatus,
      lockMode: row.lock_mode,
      status: row.status,
      metadata: parseMetadata(row.metadata_json),
      createdAt: row.created_at,
      verifiedAt: row.verified_at || null
    };
  }

  private async querySegments(tenantId?: string, limit = 50): Promise<AuditSegmentRecord[]> {
    this.ensureSchema();
    const safeLimit = normalizeLimit(limit, 50, 1, 500);

    if (postgresShadowStoreService.canServeReads()) {
      const rows = tenantId
        ? await postgresShadowStoreService.queryAll<PersistedSegmentRow>(`
            SELECT *
            FROM audit_segments
            WHERE tenant_id = $1
            ORDER BY created_at DESC
            LIMIT $2
          `, [tenantId, safeLimit])
        : await postgresShadowStoreService.queryAll<PersistedSegmentRow>(`
            SELECT *
            FROM audit_segments
            ORDER BY created_at DESC
            LIMIT $1
          `, [safeLimit]);
      return rows.map((row) => this.mapRow(row));
    }

    const db = getDatabase();
    const rows = tenantId
      ? db.prepare(`
          SELECT *
          FROM audit_segments
          WHERE tenant_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `).all(tenantId, safeLimit) as PersistedSegmentRow[]
      : db.prepare(`
          SELECT *
          FROM audit_segments
          ORDER BY created_at DESC
          LIMIT ?
        `).all(safeLimit) as PersistedSegmentRow[];

    return rows.map((row) => this.mapRow(row));
  }

  async listSegments(options: { tenantId?: string; limit?: number } = {}): Promise<AuditSegmentRecord[]> {
    return this.querySegments(options.tenantId, options.limit || 50);
  }

  private async getLatestSegment(tenantId: string): Promise<AuditSegmentRecord | null> {
    const records = await this.querySegments(tenantId, 1);
    return records[0] || null;
  }

  private async listCandidateTenants(before: string): Promise<string[]> {
    if (postgresShadowStoreService.canServeReads()) {
      const rows = await postgresShadowStoreService.queryAll<{ tenant_id: string }>(`
        SELECT DISTINCT COALESCE(tenant_id, 'global') AS tenant_id
        FROM audit_log
        WHERE timestamp <= $1
        ORDER BY tenant_id ASC
      `, [before]);
      return rows.map((row) => normalizeTenantId(row.tenant_id));
    }

    const rows = getDatabase().prepare(`
      SELECT DISTINCT COALESCE(tenant_id, 'global') AS tenant_id
      FROM audit_log
      WHERE timestamp <= ?
      ORDER BY tenant_id ASC
    `).all(before) as Array<{ tenant_id: string }>;

    return rows.map((row) => normalizeTenantId(row.tenant_id));
  }

  private async loadLogsForSegment(
    tenantId: string,
    before: string,
    maxLogsPerSegment: number,
    after?: { timestamp: string | null; id: string | null }
  ): Promise<AuditLogRow[]> {
    const safeLimit = normalizeLimit(maxLogsPerSegment, 250, 1, 2000);

    if (postgresShadowStoreService.canServeReads()) {
      if (after?.timestamp && after.id) {
        return postgresShadowStoreService.queryAll<AuditLogRow>(`
          SELECT *
          FROM audit_log
          WHERE COALESCE(tenant_id, 'global') = $1
            AND timestamp <= $2
            AND (timestamp > $3 OR (timestamp = $3 AND id > $4))
          ORDER BY timestamp ASC, id ASC
          LIMIT $5
        `, [tenantId, before, after.timestamp, after.id, safeLimit]);
      }

      return postgresShadowStoreService.queryAll<AuditLogRow>(`
        SELECT *
        FROM audit_log
        WHERE COALESCE(tenant_id, 'global') = $1
          AND timestamp <= $2
        ORDER BY timestamp ASC, id ASC
        LIMIT $3
      `, [tenantId, before, safeLimit]);
    }

    const db = getDatabase();
    if (after?.timestamp && after.id) {
      return db.prepare(`
        SELECT *
        FROM audit_log
        WHERE COALESCE(tenant_id, 'global') = ?
          AND timestamp <= ?
          AND (timestamp > ? OR (timestamp = ? AND id > ?))
        ORDER BY timestamp ASC, id ASC
        LIMIT ?
      `).all(tenantId, before, after.timestamp, after.timestamp, after.id, safeLimit) as AuditLogRow[];
    }

    return db.prepare(`
      SELECT *
      FROM audit_log
      WHERE COALESCE(tenant_id, 'global') = ?
        AND timestamp <= ?
      ORDER BY timestamp ASC, id ASC
      LIMIT ?
    `).all(tenantId, before, safeLimit) as AuditLogRow[];
  }

  private async persistSegment(row: PersistedSegmentRow): Promise<void> {
    if (postgresShadowStoreService.canServeReads()) {
      await postgresShadowStoreService.execute(`
        INSERT INTO audit_segments
        (id, tenant_id, segment_key, chain_hash, object_key, version_id, retention_until, object_lock_enabled, verify_status, lock_mode, status, metadata_json, created_at, verified_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (id)
        DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          segment_key = EXCLUDED.segment_key,
          chain_hash = EXCLUDED.chain_hash,
          object_key = EXCLUDED.object_key,
          version_id = EXCLUDED.version_id,
          retention_until = EXCLUDED.retention_until,
          object_lock_enabled = EXCLUDED.object_lock_enabled,
          verify_status = EXCLUDED.verify_status,
          lock_mode = EXCLUDED.lock_mode,
          status = EXCLUDED.status,
          metadata_json = EXCLUDED.metadata_json,
          created_at = EXCLUDED.created_at,
          verified_at = EXCLUDED.verified_at
      `, [
        row.id,
        row.tenant_id,
        row.segment_key,
        row.chain_hash,
        row.object_key || null,
        row.version_id || null,
        row.retention_until || null,
        row.object_lock_enabled ? 1 : 0,
        row.verify_status || 'pending',
        row.lock_mode,
        row.status,
        row.metadata_json || null,
        row.created_at,
        row.verified_at || null
      ]);
    }

    getDatabase().prepare(`
      INSERT OR REPLACE INTO audit_segments
      (id, tenant_id, segment_key, chain_hash, object_key, version_id, retention_until, object_lock_enabled, verify_status, lock_mode, status, metadata_json, created_at, verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.tenant_id,
      row.segment_key,
      row.chain_hash,
      row.object_key || null,
      row.version_id || null,
      row.retention_until || null,
      row.object_lock_enabled ? 1 : 0,
      row.verify_status || 'pending',
      row.lock_mode,
      row.status,
      row.metadata_json || null,
      row.created_at,
      row.verified_at || null
    );

    if (!postgresShadowStoreService.canServeReads()) {
      void postgresShadowStoreService.upsert('audit_segments', row as unknown as Record<string, unknown>);
    }
  }

  private async getSegmentById(segmentId: string): Promise<AuditSegmentRecord | null> {
    this.ensureSchema();
    if (postgresShadowStoreService.canServeReads()) {
      const row = await postgresShadowStoreService.queryOne<PersistedSegmentRow>(`
        SELECT *
        FROM audit_segments
        WHERE id = $1
        LIMIT 1
      `, [segmentId]);
      return row ? this.mapRow(row) : null;
    }

    const row = getDatabase().prepare(`
      SELECT *
      FROM audit_segments
      WHERE id = ?
      LIMIT 1
    `).get(segmentId) as PersistedSegmentRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  async archivePending(options: ArchiveOptions = {}) {
    this.ensureSchema();
    const before = options.before || new Date().toISOString();
    const maxLogsPerSegment = normalizeLimit(options.maxLogsPerSegment, 250, 1, 2000);
    const maxSegments = normalizeLimit(options.maxSegments, 5, 1, 50);
    const tenantIds = options.tenantId ? [normalizeTenantId(options.tenantId)] : await this.listCandidateTenants(before);
    const results: Array<AuditSegmentRecord & { recordCount: number }> = [];

    for (const tenantId of tenantIds) {
      if (results.length >= maxSegments) {
        break;
      }

      let previousSegment = await this.getLatestSegment(tenantId);
      while (results.length < maxSegments) {
        const after = previousSegment?.metadata.lastTimestamp && previousSegment.metadata.lastLogId
          ? {
              timestamp: previousSegment.metadata.lastTimestamp,
              id: previousSegment.metadata.lastLogId
            }
          : undefined;

        const rows = await this.loadLogsForSegment(tenantId, before, maxLogsPerSegment, after);
        if (!rows.length) {
          break;
        }

        const records = canonicalizeRecords(rows);
        const contentHash = computeContentHash(records);
        const createdAt = new Date().toISOString();
        const segmentId = randomUUID();
        const firstTimestamp = rows[0]?.timestamp || null;
        const lastTimestamp = rows[rows.length - 1]?.timestamp || null;
        const firstLogId = rows[0]?.id || null;
        const lastLogId = rows[rows.length - 1]?.id || null;
        const segmentKey = `${tenantId}/${(firstTimestamp || createdAt).replace(/[:.]/g, '-')}-${segmentId.slice(0, 8)}`;
        const previousChainHash = previousSegment?.chainHash || null;
        const chainHash = computeChainHash(tenantId, segmentKey, previousChainHash, contentHash);

        const payload: ArchivedAuditSegmentPayload = {
          version: '1.0',
          segmentId,
          tenantId,
          segmentKey,
          chainHash,
          previousChainHash,
          createdAt,
          recordCount: rows.length,
          records
        };
        const auditArchive = await auditArchiveService.writeLockedJson(tenantId, 'audit/segments', segmentKey, payload);
        const lockMode = auditArchive.objectLockEnabled ? 'object_lock' : 'hash_chain';

        const metadata: AuditSegmentMetadata = {
          previousSegmentId: previousSegment?.id || null,
          previousChainHash,
          contentHash,
          recordCount: rows.length,
          firstTimestamp,
          lastTimestamp,
          firstLogId,
          lastLogId,
          artifactRef: auditArchive.artifactRef,
          artifactLocation: auditArchive.location,
          bucket: auditArchive.bucket,
          objectKey: auditArchive.objectKey,
          versionId: auditArchive.versionId || null,
          retentionUntil: auditArchive.retentionUntil || null,
          storeMode: auditArchive.objectLockEnabled ? 's3' : artifactStoreService.describe().activeMode,
          objectLockRequested: lockMode === 'object_lock',
          objectLockEnabled: auditArchive.objectLockEnabled,
          verifyStatus: 'pending'
        };

        const row: PersistedSegmentRow = {
          id: segmentId,
          tenant_id: tenantId,
          segment_key: segmentKey,
          chain_hash: chainHash,
          object_key: auditArchive.objectKey,
          version_id: auditArchive.versionId || null,
          retention_until: auditArchive.retentionUntil || null,
          object_lock_enabled: auditArchive.objectLockEnabled,
          verify_status: 'pending',
          lock_mode: lockMode,
          status: 'archived',
          metadata_json: JSON.stringify(metadata),
          created_at: createdAt,
          verified_at: null
        };

        await this.persistSegment(row);
        const verification = await this.verifySegment(segmentId);
        previousSegment = verification.segment || this.mapRow(row);
        results.push({
          ...previousSegment,
          recordCount: rows.length
        });

        logger.info('Archived audit segment', {
          tenantId,
          segmentId,
          segmentKey,
          recordCount: rows.length,
          lockMode,
          artifactRef: auditArchive.artifactRef
        });
      }
    }

    return {
      success: true,
      archivedCount: results.length,
      segments: results
    };
  }

  async verifySegment(segmentId: string): Promise<VerifyResult> {
    const segment = await this.getSegmentById(segmentId);
    if (!segment) {
      return {
        valid: false,
        chainValid: false,
        contentValid: false,
        linkageValid: false,
        objectLockValid: false,
        segment: null
      };
    }

    let payload: ArchivedAuditSegmentPayload | null = null;
    let objectLockValid = !segment.objectLockEnabled;
    try {
      if (segment.metadata.bucket && segment.metadata.objectKey && segment.metadata.bucket !== 'local-fallback') {
        payload = await auditArchiveService.readJson<ArchivedAuditSegmentPayload>(
          segment.metadata.bucket,
          segment.metadata.objectKey,
          segment.metadata.versionId || undefined
        );
        const inspection = await auditArchiveService.inspectObject(
          segment.metadata.bucket,
          segment.metadata.objectKey,
          segment.metadata.versionId || undefined
        );
        objectLockValid = segment.metadata.objectLockEnabled
          ? Boolean(inspection.objectLockEnabled && inspection.retentionUntil)
          : true;
      } else {
        payload = await artifactStoreService.readJson<ArchivedAuditSegmentPayload>(
          segment.metadata.artifactRef || segment.objectKey || '',
          segment.metadata.artifactLocation || undefined
        );
      }
    } catch (error: any) {
      logger.warn('Failed to read archived audit segment payload', {
        segmentId,
        error: error?.message
      });
    }

    const payloadRecords = payload?.records || [];
    const contentHash = payload ? computeContentHash(payloadRecords) : '';
    const contentValid = Boolean(payload) && contentHash === segment.metadata.contentHash;
    const recomputedChainHash = computeChainHash(
      segment.tenantId,
      segment.segmentKey,
      segment.metadata.previousChainHash,
      contentHash
    );
    const archivedChainHash = payload?.chainHash || null;
    const chainValid = Boolean(payload) && segment.chainHash === archivedChainHash && segment.chainHash === recomputedChainHash;

    let linkageValid = !segment.metadata.previousSegmentId && !segment.metadata.previousChainHash;
    if (segment.metadata.previousSegmentId) {
      const previous = await this.getSegmentById(segment.metadata.previousSegmentId);
      linkageValid = Boolean(previous) && previous!.chainHash === segment.metadata.previousChainHash;
    }

    const valid = contentValid && chainValid && linkageValid && objectLockValid;
    const now = new Date().toISOString();
    const nextMetadata: AuditSegmentMetadata = {
      ...segment.metadata,
      verifyStatus: valid ? 'verified' : 'corrupt'
    };
    await this.persistSegment({
      id: segment.id,
      tenant_id: segment.tenantId,
      segment_key: segment.segmentKey,
      chain_hash: segment.chainHash,
      object_key: segment.objectKey,
      version_id: segment.versionId,
      retention_until: segment.retentionUntil,
      object_lock_enabled: segment.objectLockEnabled,
      verify_status: valid ? 'verified' : 'corrupt',
      lock_mode: segment.lockMode,
      status: valid ? 'verified' : 'corrupt',
      metadata_json: JSON.stringify(nextMetadata),
      created_at: segment.createdAt,
      verified_at: now
    });

    return {
      valid,
      chainValid,
      contentValid,
      linkageValid,
      objectLockValid,
      segment: {
        ...segment,
        verifyStatus: valid ? 'verified' : 'corrupt',
        status: valid ? 'verified' : 'corrupt',
        metadata: nextMetadata,
        verifiedAt: now
      }
    };
  }
}

export const auditSegmentService = new AuditSegmentService();
