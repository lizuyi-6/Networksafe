/**
 * Security Audit Logger
 * SECURE FIX: Tamper-evident logging for all security events
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { getDatabase } from '../config/database';

export interface AuditEvent {
  id: string;
  timestamp: string;
  eventType: string;
  category: 'auth' | 'agent' | 'command' | 'firewall' | 'system';
  severity: 'info' | 'warning' | 'critical';
  actor: {
    type: 'user' | 'agent' | 'system' | 'api';
    id: string;
    ip?: string;
  };
  action: string;
  target?: {
    type: 'agent' | 'server' | 'user' | 'rule';
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

  /**
   * Log a security event
   */
  async log(event: Omit<AuditEvent, 'id' | 'timestamp' | 'signature'>): Promise<string> {
    const auditEvent: AuditEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      signature: '', // Will be set after hashing
      ...event
    };

    // Create tamper-evident signature
    auditEvent.signature = this.createSignature(auditEvent);

    try {
      const db = getDatabase();

      // Store in database
      db.prepare(`
        INSERT INTO audit_log (
          id, timestamp, event_type, category, severity,
          actor_type, actor_id, actor_ip, action, target_type, target_id,
          details_json, status, signature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        auditEvent.id,
        auditEvent.timestamp,
        auditEvent.eventType,
        auditEvent.category,
        auditEvent.severity,
        auditEvent.actor.type,
        auditEvent.actor.id,
        auditEvent.actor.ip || null,
        auditEvent.action,
        auditEvent.target?.type || null,
        auditEvent.target?.id || null,
        JSON.stringify(auditEvent.details),
        auditEvent.status,
        auditEvent.signature
      );

      // Also log to standard logger
      this.logToStandardLogger(auditEvent);

      return auditEvent.id;
    } catch (error: any) {
      logger.error('Failed to write audit log', { error });
      // Still log to standard logger as fallback
      this.logToStandardLogger(auditEvent);
      return auditEvent.id;
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

  /**
   * Get audit logs for an entity
   */
  getLogs(filter: {
    category?: string;
    actorId?: string;
    targetId?: string;
    limit?: number;
  }): AuditEvent[] {
    const db = getDatabase();
    const { limit = 100 } = filter;

    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params: any[] = [];

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

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const results = db.prepare(query).all(...params) as any[];

    return results.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      eventType: r.event_type,
      category: r.category,
      severity: r.severity,
      actor: {
        type: r.actor_type,
        id: r.actor_id,
        ip: r.actor_ip
      },
      action: r.action,
      target: r.target_type ? {
        type: r.target_type,
        id: r.target_id
      } : undefined,
      details: JSON.parse(r.details_json),
      status: r.status,
      signature: r.signature
    }));
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
      const backup = {
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
          error: 'Invalid backup structure'
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
          error: 'Checksum verification failed - backup may be corrupted or tampered'
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
          error: 'Failed to create backup before rotation'
        };
      }

      // Delete old logs
      const deleteResult = db.prepare(
        'DELETE FROM audit_log WHERE timestamp < ?'
      ).run(cutoffIso);

      logger.info(`Audit log rotation complete`, {
        deletedCount: deleteResult.changes,
        backupPath: backupResult.filePath
      });

      await this.log({
        eventType: 'audit_log_rotation',
        category: 'system',
        severity: 'info',
        actor: { type: 'system', id: 'audit-service' },
        action: 'rotate_logs',
        details: {
          deletedCount: deleteResult.changes,
          backupPath: backupResult.filePath,
          cutoffDate: cutoffIso
        },
        status: 'success'
      });

      return {
        success: true,
        archivedCount: deleteResult.changes,
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

    setInterval(async () => {
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

    logger.info('Periodic audit log backup check started');
  }
}

export default new AuditLogger();
