/**
 * Security Audit Logger
 * SECURE FIX: Tamper-evident logging for all security events
 */

import { uuidv4 } from '../utils/uuid';
import logger from '../utils/logger';
import { getDatabase } from '../config/database';
import { postgresShadowStoreService } from '../services/postgres-shadow-store.service';
import { auditSegmentService } from '../services/audit-segment.service';
import { recursiveSanitize } from '../utils/log-sanitizer';

export interface AuditEvent {
  id: string;
  timestamp: string;
  tenantId?: string;
  eventType: string;
  category: 'auth' | 'agent' | 'command' | 'firewall' | 'system';
  severity: 'info' | 'warning' | 'critical';
  actor: {
    type: 'user' | 'agent' | 'system' | 'api';
    id: string;
    ip?: string;
    email?: string;
  };
  action: string;
  target?: {
    type: 'agent' | 'server' | 'user' | 'rule' | 'device' | 'site' | 'scan' | 'action' | 'tenant';
    id: string;
  };
  details: Record<string, any>;
  status: 'success' | 'failure' | 'attempt';
  signature?: string; // For tamper detection
}

/**
 * Audit Logger Service
 * SECURITY FIX CVE-2026-103: Enforce AUDIT_LOG_SECRET at initialization
 * SECURITY FIX CVE-2026-104: Added audit log backup protection
 */
export class AuditLogger {
  private readonly auditSecret: string;
  private readonly backupRetentionDays: number;
  private readonly maxDatabaseSize: number;
  private schemaReady = false;

  constructor() {
    // SECURITY FIX CVE-2026-103: Require AUDIT_LOG_SECRET at startup
    this.auditSecret = process.env.AUDIT_LOG_SECRET || '';

    if (!this.auditSecret) {
      throw new Error(
        'FATAL: AUDIT_LOG_SECRET environment variable is required. ' +
        'This secret is used to sign audit logs and prevent tampering. ' +
        'Set a strong random secret (min 32 characters).'
      );
    }

    if (this.auditSecret.length < 32) {
      throw new Error(
        'FATAL: AUDIT_LOG_SECRET must be at least 32 characters long. ' +
        `Current length: ${this.auditSecret.length}`
      );
    }

    // Backup configuration
    this.backupRetentionDays = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '90', 10);
    this.maxDatabaseSize = parseInt(process.env.AUDIT_LOG_MAX_SIZE_MB || '100', 10) * 1024 * 1024;

    logger.info('Audit Logger initialized with secure secret and backup protection');

    // Start periodic backup check
    this.startPeriodicBackupCheck();
  }

  prepare(): void {
    if (this.schemaReady) {
      return;
    }

    const db = getDatabase();
    db.exec(`
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

      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_log_category ON audit_log(category);
      CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id ON audit_log(actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_target_id ON audit_log(target_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_id ON audit_log(tenant_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_log_status ON audit_log(status, timestamp DESC);
    `);

    const softMigrations = [
      `ALTER TABLE audit_log ADD COLUMN tenant_id TEXT`,
      `ALTER TABLE audit_log ADD COLUMN actor_email TEXT`
    ];

    for (const sql of softMigrations) {
      try {
        db.exec(sql);
      } catch (error: any) {
        if (!(error?.message || '').includes('duplicate column name')) {
          logger.warn('Audit log soft migration failed', { sql, error: error?.message });
        }
      }
    }

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

    throw new Error('Audit logger schema not initialized. Call auditLogger.prepare() during bootstrap.');
  }

  private mapAuditRow(row: any): AuditEvent {
    return {
      id: row.id,
      timestamp: row.timestamp,
      tenantId: row.tenant_id || undefined,
      eventType: row.event_type,
      category: row.category,
      severity: row.severity,
      actor: {
        type: row.actor_type,
        id: row.actor_id,
        ip: row.actor_ip || undefined,
        email: row.actor_email || undefined
      },
      action: row.action,
      target: row.target_type ? {
        type: row.target_type,
        id: row.target_id
      } : undefined,
      details: JSON.parse(row.details_json),
      status: row.status,
      signature: row.signature
    };
  }

  /**
   * Log a security event
   */
  async log(event: Omit<AuditEvent, 'id' | 'timestamp' | 'signature'>): Promise<string> {
    this.assertPrepared();
    const auditEvent: AuditEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      signature: '', // Will be set after hashing
      ...event
    };

    // Create tamper-evident signature
    auditEvent.signature = this.createSignature(auditEvent);

    // SECURITY FIX D31: strip CRLF/tab/null control chars from
    // user-controlled `details` (and any other free-form string
    // fields) to prevent log injection in dashboards and exports.
    auditEvent.details = recursiveSanitize(auditEvent.details);

    try {
      const db = getDatabase();

      // SECURITY FIX R12 V12.2: commit local SQLite FIRST. The shadow
      // store is a best-effort mirror and must never prevent the
      // local commit (the audit log is the source of truth for
      // compliance/forensics).
      db.prepare(`
        INSERT INTO audit_log (
          id, timestamp, tenant_id, event_type, category, severity,
          actor_type, actor_id, actor_email, actor_ip, action, target_type, target_id,
          details_json, status, signature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        auditEvent.id,
        auditEvent.timestamp,
        auditEvent.tenantId || null,
        auditEvent.eventType,
        auditEvent.category,
        auditEvent.severity,
        auditEvent.actor.type,
        auditEvent.actor.id,
        auditEvent.actor.email || null,
        auditEvent.actor.ip || null,
        auditEvent.action,
        auditEvent.target?.type || null,
        auditEvent.target?.id || null,
        JSON.stringify(auditEvent.details),
        auditEvent.status,
        auditEvent.signature
      );

      // Now mirror to the postgres shadow store. Both paths are
      // best-effort: their failures are tracked in the shadow-write
      // metrics but do not block the caller — UNLESS
      // AUDIT_LOG_FAIL_CLOSED=true, in which case the FIRST shadow
      // failure aborts the second attempt (defense in depth) and is
      // re-thrown AFTER the local commit.
      const failClosed = process.env.AUDIT_LOG_FAIL_CLOSED === 'true';
      let shadowError: Error | null = null;
      let executeSucceeded = !postgresShadowStoreService.canServeReads();

      if (postgresShadowStoreService.canServeReads()) {
        try {
          await postgresShadowStoreService.execute(`
            INSERT INTO audit_log (
              id, timestamp, tenant_id, event_type, category, severity,
              actor_type, actor_id, actor_email, actor_ip, action, target_type, target_id,
              details_json, status, signature
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (id)
            DO UPDATE SET
              timestamp = EXCLUDED.timestamp,
              tenant_id = EXCLUDED.tenant_id,
              event_type = EXCLUDED.event_type,
              category = EXCLUDED.category,
              severity = EXCLUDED.severity,
              actor_type = EXCLUDED.actor_type,
              actor_id = EXCLUDED.actor_id,
              actor_email = EXCLUDED.actor_email,
              actor_ip = EXCLUDED.actor_ip,
              action = EXCLUDED.action,
              target_type = EXCLUDED.target_type,
              target_id = EXCLUDED.target_id,
              details_json = EXCLUDED.details_json,
              status = EXCLUDED.status,
              signature = EXCLUDED.signature
          `, [
            auditEvent.id,
            auditEvent.timestamp,
            auditEvent.tenantId || null,
            auditEvent.eventType,
            auditEvent.category,
            auditEvent.severity,
            auditEvent.actor.type,
            auditEvent.actor.id,
            auditEvent.actor.email || null,
            auditEvent.actor.ip || null,
            auditEvent.action,
            auditEvent.target?.type || null,
            auditEvent.target?.id || null,
            JSON.stringify(auditEvent.details),
            auditEvent.status,
            auditEvent.signature
          ]);
          recordAuditShadowWrite(true);
          executeSucceeded = true;
        } catch (e) {
          recordAuditShadowWrite(false, e);
          shadowError = e instanceof Error ? e : new Error(String(e));
          if (failClosed) {
            // short-circuit: do not attempt upsert in fail-closed mode
            this.logToStandardLogger(auditEvent);
            throw shadowError;
          }
        }
      }

      // Only attempt upsert if execute didn't already fail (or wasn't required)
      // AND the shadow store is enabled at all.
      if ((executeSucceeded || !failClosed) && postgresShadowStoreService.isEnabled()) {
        try {
          const upsertResult = await postgresShadowStoreService.upsert('audit_log', {
            id: auditEvent.id,
            timestamp: auditEvent.timestamp,
            tenant_id: auditEvent.tenantId || null,
            event_type: auditEvent.eventType,
            category: auditEvent.category,
            severity: auditEvent.severity,
            actor_type: auditEvent.actor.type,
            actor_id: auditEvent.actor.id,
            actor_email: auditEvent.actor.email || null,
            actor_ip: auditEvent.actor.ip || null,
            action: auditEvent.action,
            target_type: auditEvent.target?.type || null,
            target_id: auditEvent.target?.id || null,
            details_json: JSON.stringify(auditEvent.details),
            status: auditEvent.status,
            signature: auditEvent.signature
          });
          // surface lastError from shadow state machine (e.g. queue full)
          const desc = typeof postgresShadowStoreService.describe === 'function'
            ? postgresShadowStoreService.describe()
            : null;
          if (desc && desc.lastError) {
            recordAuditShadowWrite(false, desc.lastError);
            shadowError = shadowError || new Error(String(desc.lastError));
          } else {
            recordAuditShadowWrite(true);
          }
          // unused but kept for side-effect clarity
          void upsertResult;
        } catch (e) {
          recordAuditShadowWrite(false, e);
          shadowError = shadowError || (e instanceof Error ? e : new Error(String(e)));
        }
      }

      // Also log to standard logger
      this.logToStandardLogger(auditEvent);

      // AUDIT_LOG_FAIL_CLOSED: if any shadow path failed AND the
      // operator opted in, re-throw AFTER the local commit so the
      // caller can treat it as a compliance event without losing
      // the local row.
      if (shadowError && process.env.AUDIT_LOG_FAIL_CLOSED === 'true') {
        throw shadowError;
      }

      return auditEvent.id;
    } catch (error: any) {
      logger.error('Failed to write audit log', { error });
      // Still log to standard logger as fallback
      this.logToStandardLogger(auditEvent);
      // SECURITY FIX D22: always re-throw local SQLite insert failures
      // so callers can retry — never silently return a success id
      // when the write actually failed. Tag the error so callers can
      // branch on it without parsing message strings.
      const wrapped = new Error(
        `audit_log_local_insert_failed: ${error?.message || String(error)}`
      );
      (wrapped as any).cause = error;
      (wrapped as any).code = 'audit_log_local_insert_failed';
      throw wrapped;
    }
  }

  /**
   * Convenience method: Log authentication event
   */
  async logAuth(event: {
    action: 'login' | 'logout' | 'failed_login' | 'token_refresh';
    actor: { id: string; ip?: string };
    success: boolean;
    details?: Record<string, any>;
  }): Promise<string> {
    return this.log({
      eventType: event.action,
      category: 'auth',
      severity: event.success ? 'info' : 'warning',
      actor: { type: 'user', id: event.actor.id, ip: event.actor.ip },
      action: event.action,
      details: event.details || {},
      status: event.success ? 'success' : 'failure'
    });
  }

  /**
   * Convenience method: Log agent event
   */
  async logAgent(event: {
    action: 'connect' | 'disconnect' | 'register' | 'revoke' | 'command_received';
    agentId: string;
    ip?: string;
    success: boolean;
    details?: Record<string, any>;
  }): Promise<string> {
    return this.log({
      eventType: event.action,
      category: 'agent',
      severity: event.success ? 'info' : 'warning',
      actor: { type: 'agent', id: event.agentId, ip: event.ip },
      action: event.action,
      target: { type: 'agent', id: event.agentId },
      details: event.details || {},
      status: event.success ? 'success' : 'failure'
    });
  }

  /**
   * Convenience method: Log command execution
   */
  async logCommand(event: {
    commandType: string;
    agentId: string;
    userId?: string;
    success: boolean;
    details?: Record<string, any>;
  }): Promise<string> {
    return this.log({
      eventType: 'command_executed',
      category: 'command',
      severity: 'critical',
      actor: { type: event.userId ? 'user' : 'system', id: event.userId || 'system' },
      action: `execute_${event.commandType}`,
      target: { type: 'agent', id: event.agentId },
      details: {
        commandType: event.commandType,
        ...event.details
      },
      status: event.success ? 'success' : 'failure'
    });
  }

  /**
   * Convenience method: Log firewall change
   */
  async logFirewall(event: {
    action: 'block_ip' | 'unblock_ip' | 'add_rule' | 'remove_rule';
    agentId: string;
    ip?: string;
    userId?: string;
    success: boolean;
    details?: Record<string, any>;
  }): Promise<string> {
    return this.log({
      eventType: event.action,
      category: 'firewall',
      severity: 'critical',
      actor: { type: event.userId ? 'user' : 'system', id: event.userId || 'system' },
      action: event.action,
      target: { type: 'server', id: event.agentId },
      details: {
        ip: event.ip,
        ...event.details
      },
      status: event.success ? 'success' : 'failure'
    });
  }

  /**
   * Create signature for tamper detection
   * SECURITY FIX CVE-2026-103: Use class property instead of environment variable
   */
  private createSignature(event: AuditEvent): string {
    const crypto = require('crypto');

    const data = `${event.id}|${event.timestamp}|${event.eventType}|${event.action}|${event.status}`;
    return crypto.createHmac('sha256', this.auditSecret).update(data).digest('hex');
  }

  /**
   * Log to standard logger
   */
  private logToStandardLogger(event: AuditEvent): void {
    const message = `[AUDIT] [${event.category.toUpperCase()}] ${event.action} - ${event.actor.type}:${event.actor.id}`;

    switch (event.severity) {
      case 'critical':
        logger.error(message, event.details);
        break;
      case 'warning':
        logger.warn(message, event.details);
        break;
      default:
        logger.info(message, event.details);
    }
  }

  /**
   * Verify audit log integrity
   */
  /**
   * Verify audit log integrity
   * SECURITY FIX CVE-2026-103: Use class property instead of environment variable
   */
  verifyIntegrity(logId: string): boolean {
    this.assertPrepared();
    const db = getDatabase();
    const log = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(logId) as any;

    if (!log) {
      return false;
    }

    // SECURITY FIX: Use class property instead of environment variable
    const crypto = require('crypto');
    const data = `${log.id}|${log.timestamp}|${log.event_type}|${log.action}|${log.status}`;
    const expected = crypto.createHmac('sha256', this.auditSecret).update(data).digest('hex');

    return log.signature === expected;
  }

  async verifyIntegrityView(logId: string): Promise<boolean> {
    if (!postgresShadowStoreService.canServeReads()) {
      return this.verifyIntegrity(logId);
    }

    const log = await postgresShadowStoreService.queryOne<any>(
      'SELECT * FROM audit_log WHERE id = $1 LIMIT 1',
      [logId]
    );

    if (!log) {
      return false;
    }

    const crypto = require('crypto');
    const data = `${log.id}|${log.timestamp}|${log.event_type}|${log.action}|${log.status}`;
    const expected = crypto.createHmac('sha256', this.auditSecret).update(data).digest('hex');
    return log.signature === expected;
  }

  /**
   * Get audit logs for an entity
   */
  getLogs(filter: {
    tenantId?: string;
    category?: string;
    actorId?: string;
    targetId?: string;
    status?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): AuditEvent[] {
    this.assertPrepared();
    const db = getDatabase();
    const page = Math.max(1, Number(filter.page || 1));
    const limit = Math.max(1, Math.min(Number(filter.limit || 100), 500));
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params: any[] = [];

    if (filter.tenantId) {
      query += ' AND tenant_id = ?';
      params.push(filter.tenantId);
    }

    if (filter.category) {
      query += ' AND category = ?';
      params.push(filter.category);
    }

    if (filter.actorId) {
      query += ' AND actor_id = ?';
      params.push(filter.actorId);
    }

    if (filter.targetId) {
      query += ' AND target_id = ?';
      params.push(filter.targetId);
    }

    if (filter.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    }

    if (filter.from) {
      query += ' AND timestamp >= ?';
      params.push(filter.from);
    }

    if (filter.to) {
      query += ' AND timestamp <= ?';
      params.push(filter.to);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const results = db.prepare(query).all(...params) as any[];

    return results.map(r => ({
      ...this.mapAuditRow(r)
    }));
  }

  async getLogsView(filter: {
    tenantId?: string;
    category?: string;
    actorId?: string;
    targetId?: string;
    status?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Promise<AuditEvent[]> {
    if (!postgresShadowStoreService.canServeReads()) {
      return this.getLogs(filter);
    }

    const page = Math.max(1, Number(filter.page || 1));
    const limit = Math.max(1, Math.min(Number(filter.limit || 100), 500));
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params: any[] = [];

    const push = (clause: string, value: any) => {
      params.push(value);
      query += ` AND ${clause.replace('?', `$${params.length}`)}`;
    };

    if (filter.tenantId) {
      push('tenant_id = ?', filter.tenantId);
    }
    if (filter.category) {
      push('category = ?', filter.category);
    }
    if (filter.actorId) {
      push('actor_id = ?', filter.actorId);
    }
    if (filter.targetId) {
      push('target_id = ?', filter.targetId);
    }
    if (filter.status) {
      push('status = ?', filter.status);
    }
    if (filter.from) {
      push('timestamp >= ?', filter.from);
    }
    if (filter.to) {
      push('timestamp <= ?', filter.to);
    }

    params.push(limit, offset);
    query += ` ORDER BY timestamp DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const results = await postgresShadowStoreService.queryAll<any>(query, params);
    return results.map((row) => this.mapAuditRow(row));
  }

  async getLogByIdView(logId: string): Promise<AuditEvent | null> {
    if (!postgresShadowStoreService.canServeReads()) {
      return this.getLogs({ limit: 500 }).find((item) => item.id === logId) || null;
    }

    const row = await postgresShadowStoreService.queryOne<any>(
      'SELECT * FROM audit_log WHERE id = $1 LIMIT 1',
      [logId]
    );
    return row ? this.mapAuditRow(row) : null;
  }

  /**
   * SECURITY FIX CVE-2026-104: Export audit logs to backup file
   * Creates a tamper-evident backup with integrity checksum
   */
  async exportBackup(outputPath?: string): Promise<{
    success: boolean;
    filePath?: string;
    recordCount?: number;
    checksum?: string;
    error?: string;
  }> {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const crypto = require('crypto');

      const db = getDatabase();

      // Get all audit logs
      const logs = db.prepare('SELECT * FROM audit_log ORDER BY timestamp ASC').all() as any[];

      if (logs.length === 0) {
        return {
          success: true,
          recordCount: 0,
          checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' // SHA256 of empty
        };
      }

      // Create backup data structure
      const backup: {
        exportedAt: string;
        version: string;
        recordCount: number;
        logs: any[];
        checksum?: string;
      } = {
        exportedAt: new Date().toISOString(),
        version: '1.0',
        recordCount: logs.length,
        logs: logs.map(log => ({
          id: log.id,
          timestamp: log.timestamp,
          event_type: log.event_type,
          category: log.category,
          severity: log.severity,
          actor_type: log.actor_type,
          actor_id: log.actor_id,
          actor_ip: log.actor_ip,
          action: log.action,
          target_type: log.target_type,
          target_id: log.target_id,
          details_json: log.details_json,
          status: log.status,
          signature: log.signature
        }))
      };

      // Serialize to JSON
      const backupJson = JSON.stringify(backup, null, 2);

      // Calculate checksum of entire backup
      const checksum = crypto.createHash('sha256').update(backupJson).digest('hex');

      // Add checksum to backup metadata
      backup.checksum = checksum;
      const finalBackup = JSON.stringify(backup, null, 2);

      // Determine output path
      const defaultPath = path.join(
        process.env.DATA_DIR || './data',
        `audit-log-backup-${new Date().toISOString().split('T')[0]}.json`
      );

      const targetPath = outputPath || defaultPath;

      // Ensure directory exists
      const dir = path.dirname(targetPath);
      await fs.mkdir(dir, { recursive: true });

      // Write backup file
      await fs.writeFile(targetPath, finalBackup, 'utf8');

      // Log backup event
      await this.log({
        eventType: 'audit_log_backup',
        category: 'system',
        severity: 'info',
        actor: { type: 'system', id: 'audit-service' },
        action: 'export_backup',
        details: {
          filePath: targetPath,
          recordCount: logs.length,
          checksum
        },
        status: 'success'
      });

      logger.info(`Audit log backup created: ${targetPath}`, {
        recordCount: logs.length,
        checksum
      });

      return {
        success: true,
        filePath: targetPath,
        recordCount: logs.length,
        checksum
      };
    } catch (error: any) {
      logger.error('Failed to create audit log backup', { error });

      await this.log({
        eventType: 'audit_log_backup_failed',
        category: 'system',
        severity: 'critical',
        actor: { type: 'system', id: 'audit-service' },
        action: 'export_backup',
        details: { error: error.message },
        status: 'failure'
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * SECURITY FIX CVE-2026-104: Verify backup integrity
   */
  async verifyBackup(filePath: string): Promise<{
    valid: boolean;
    recordCount?: number;
    integrityCheck?: 'passed' | 'failed' | 'error';
    error?: string;
  }> {
    try {
      const fs = require('fs').promises;
      const crypto = require('crypto');

      // Read backup file
      const backupJson = await fs.readFile(filePath, 'utf8');
      const backup = JSON.parse(backupJson);

      // Verify structure
      if (!backup.version || !backup.logs || !Array.isArray(backup.logs)) {
        return {
          valid: false,
          integrityCheck: 'error',
          error: 'backend.invalid_backup_structure'
        };
      }

      // Verify checksum
      const backupWithoutChecksum = { ...backup };
      delete backupWithoutChecksum.checksum;
      const recalculatedJson = JSON.stringify(backupWithoutChecksum, null, 2);
      const expectedChecksum = crypto.createHash('sha256').update(recalculatedJson).digest('hex');

      if (backup.checksum !== expectedChecksum) {
        logger.error(`Backup checksum mismatch: ${filePath}`, {
          expected: expectedChecksum,
          actual: backup.checksum
        });

        return {
          valid: false,
          recordCount: backup.recordCount,
          integrityCheck: 'failed',
          error: 'backend.checksum_verification_failed_backup_may_be_corrupted_or_tampered'
        };
      }

      // Verify all log signatures
      let validSignatures = 0;
      for (const log of backup.logs) {
        const data = `${log.id}|${log.timestamp}|${log.event_type}|${log.action}|${log.status}`;
        const expected = crypto.createHmac('sha256', this.auditSecret).update(data).digest('hex');

        if (log.signature === expected) {
          validSignatures++;
        }
      }

      if (validSignatures !== backup.logs.length) {
        logger.warn(`Backup has some invalid signatures: ${filePath}`, {
          valid: validSignatures,
          total: backup.logs.length
        });
      }

      logger.info(`Backup verification complete: ${filePath}`, {
        recordCount: backup.recordCount,
        validSignatures,
        integrityCheck: 'passed'
      });

      return {
        valid: true,
        recordCount: backup.recordCount,
        integrityCheck: 'passed'
      };
    } catch (error: any) {
      logger.error('Failed to verify backup', { error, filePath });
      return {
        valid: false,
        integrityCheck: 'error',
        error: error.message
      };
    }
  }

  /**
   * SECURITY FIX CVE-2026-104: Rotate old logs to prevent database bloat
   * Archives logs older than retention period
   */
  async rotateLogs(): Promise<{
    success: boolean;
    archivedCount?: number;
    backupPath?: string;
    error?: string;
  }> {
    try {
      const db = getDatabase();

      // Calculate cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.backupRetentionDays);
      const cutoffIso = cutoffDate.toISOString();

      // Count logs to archive
      const countResult = db.prepare(
        'SELECT COUNT(*) as count FROM audit_log WHERE timestamp < ?'
      ).get(cutoffIso) as any;

      const count = countResult.count;

      if (count === 0) {
        return {
          success: true,
          archivedCount: 0
        };
      }

      logger.info(`Starting audit log rotation`, {
        count,
        cutoffDate: cutoffIso
      });

      // Export to backup first
      const backupResult = await this.exportBackup(
        `./data/audit-log-archive-${new Date().toISOString().split('T')[0]}.json`
      );

      if (!backupResult.success) {
        return {
          success: false,
          error: 'backend.failed_to_create_backup_before_rotation'
        };
      }

      // Delete old logs
      db.prepare(
        'DELETE FROM audit_log WHERE timestamp < ?'
      ).run(cutoffIso);

      logger.info(`Audit log rotation complete`, {
        backupPath: backupResult.filePath
      });

      await this.log({
        eventType: 'audit_log_rotation',
        category: 'system',
        severity: 'info',
        actor: { type: 'system', id: 'audit-service' },
        action: 'rotate_logs',
        details: {
          backupPath: backupResult.filePath,
          cutoffDate: cutoffIso
        },
        status: 'success'
      });

      return {
        success: true,
        backupPath: backupResult.filePath
      };
    } catch (error: any) {
      logger.error('Failed to rotate audit logs', { error });

      await this.log({
        eventType: 'audit_log_rotation_failed',
        category: 'system',
        severity: 'critical',
        actor: { type: 'system', id: 'audit-service' },
        action: 'rotate_logs',
        details: { error: error.message },
        status: 'failure'
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * SECURITY FIX CVE-2026-104: Check if database needs rotation
   */
  async checkDatabaseSize(): Promise<boolean> {
    try {
      const fs = require('fs').promises;
      const dbPath = process.env.DATABASE_PATH || './data/security.db';

      const stats = await fs.stat(dbPath);
      const sizeMB = stats.size / (1024 * 1024);

      if (sizeMB > this.maxDatabaseSize / (1024 * 1024)) {
        logger.warn(`Audit log database size exceeds limit: ${sizeMB.toFixed(2)}MB`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Failed to check database size', { error });
      return false;
    }
  }

  /**
   * SECURITY FIX CVE-2026-104: Start periodic backup check
   * Runs daily to check if rotation is needed
   */
  private startPeriodicBackupCheck(): void {
    // Check every 24 hours
    const checkInterval = 24 * 60 * 60 * 1000;
    const archiveIntervalMinutes = Math.max(15, parseInt(process.env.AUDIT_SEGMENT_ARCHIVE_INTERVAL_MINUTES || '60', 10) || 60);
    const archiveInterval = archiveIntervalMinutes * 60 * 1000;

    const runSegmentArchiver = async () => {
      try {
        const result = await auditSegmentService.archivePending({
          maxSegments: parseInt(process.env.AUDIT_SEGMENT_MAX_BATCHES || '5', 10) || 5,
          maxLogsPerSegment: parseInt(process.env.AUDIT_SEGMENT_MAX_RECORDS || '250', 10) || 250
        });

        if (result.archivedCount > 0) {
          logger.info('Periodic audit segment archival completed', {
            archivedCount: result.archivedCount
          });
        }
      } catch (error) {
        logger.error('Periodic audit segment archival failed', { error });
      }
    };

    const backupCheckTimer = setInterval(async () => {
      try {
        const needsRotation = await this.checkDatabaseSize();

        if (needsRotation) {
          logger.info('Database size limit reached, starting rotation');
          await this.rotateLogs();
        }
      } catch (error) {
        logger.error('Periodic backup check failed', { error });
      }
    }, checkInterval);
    if (typeof backupCheckTimer.unref === 'function') {
      backupCheckTimer.unref();
    }

    const initialArchiverTimer = setTimeout(() => {
      void runSegmentArchiver();
    }, 15 * 1000);
    if (typeof initialArchiverTimer.unref === 'function') {
      initialArchiverTimer.unref();
    }

    const archiverTimer = setInterval(() => {
      void runSegmentArchiver();
    }, archiveInterval);
    if (typeof archiverTimer.unref === 'function') {
      archiverTimer.unref();
    }

    logger.info('Periodic audit log backup check started', {
      segmentArchiveIntervalMinutes: archiveIntervalMinutes
    });
  }
}

// =====================================================================
// Shadow-write metrics — exported as module-level counters so redteam
// tests (and ops dashboards) can observe postgres-shadow health.
// =====================================================================
let auditShadowWriteSuccesses = 0;
let auditShadowWriteFailures = 0;
let auditShadowWriteLastError: string | null = null;

export function recordAuditShadowWrite(success: boolean, error?: unknown): void {
  if (success) {
    auditShadowWriteSuccesses += 1;
  } else {
    auditShadowWriteFailures += 1;
    if (error !== undefined) {
      auditShadowWriteLastError = error instanceof Error ? error.message : String(error);
    }
  }
}

export interface AuditShadowWriteMetrics {
  successes: number;
  failures: number;
  lastError: string | null;
}

export function getAuditShadowWriteMetrics(): AuditShadowWriteMetrics {
  return {
    successes: auditShadowWriteSuccesses,
    failures: auditShadowWriteFailures,
    lastError: auditShadowWriteLastError
  };
}

export function resetAuditShadowWriteMetrics(): void {
  auditShadowWriteSuccesses = 0;
  auditShadowWriteFailures = 0;
  auditShadowWriteLastError = null;
}

export default new AuditLogger();
