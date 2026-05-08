/**
 * Investigation Service
 *
 * Handles persistence and retrieval of investigation data.
 */

import Database, { Database as SqlJsDatabase } from 'better-sqlite3';
import {
  BugReport,
  InvestigationContext,
  InvestigationResult
} from '../ai-agents/investigation/types';
import { getDatabase, initDatabase } from '../config/database';
import logger from '../utils/logger';

export interface InvestigationRecord {
  investigationId: string;
  bugReportId: string;
  bugReport: BugReport;
  context: InvestigationContext;
  result?: InvestigationResult;
  createdAt: Date;
  status: 'in_progress' | 'completed' | 'failed' | 'cancelled';
}

type RawRow = Record<string, unknown>;

export class InvestigationService {
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }

    await this.initPromise;
  }

  private async initialize(): Promise<void> {
    await initDatabase();
    const db = this.getDb();

    db.run(`
      CREATE TABLE IF NOT EXISTS investigations (
        investigation_id TEXT PRIMARY KEY,
        bug_report_id TEXT NOT NULL,
        bug_report TEXT NOT NULL,
        context TEXT NOT NULL,
        result TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_investigations_created_at
      ON investigations(created_at)
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_investigations_status
      ON investigations(status)
    `);

    this.persist();
    this.initialized = true;
    logger.info('InvestigationService storage initialized');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getDb(): any {
    return getDatabase().getDb();
  }

  private persist(): void {
    getDatabase().save();
  }

  /**
   * Save investigation to database
   */
  public async saveInvestigation(data: InvestigationRecord): Promise<void> {
    await this.ensureInitialized();
    const db = this.getDb();

    db.run(
      `
      INSERT OR REPLACE INTO investigations
      (investigation_id, bug_report_id, bug_report, context, result, created_at, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
      [
        data.investigationId,
        data.bugReportId,
        JSON.stringify(data.bugReport),
        JSON.stringify(data.context),
        data.result ? JSON.stringify(data.result) : null,
        data.createdAt.toISOString(),
        data.status
      ]
    );

    this.persist();
    logger.info(`[InvestigationService] Saved investigation ${data.investigationId}`);
  }

  /**
   * Get investigation by ID
   */
  public async getInvestigation(investigationId: string): Promise<InvestigationRecord | null> {
    await this.ensureInitialized();
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM investigations WHERE investigation_id = ? LIMIT 1');

    stmt.bind([investigationId]);
    const row = stmt.step() ? (stmt.getAsObject() as RawRow) : null;
    stmt.free();

    return row ? this.deserializeRow(row) : null;
  }

  /**
   * Get investigation history
   */
  public async getInvestigationHistory(options: {
    limit?: number;
    offset?: number;
    severity?: string;
    category?: string;
  }): Promise<{ investigations: InvestigationRecord[]; total: number }> {
    await this.ensureInitialized();
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM investigations ORDER BY created_at DESC');

    const rows: InvestigationRecord[] = [];
    while (stmt.step()) {
      rows.push(this.deserializeRow(stmt.getAsObject() as RawRow));
    }
    stmt.free();

    let filtered = rows;
    if (options.severity) {
      filtered = filtered.filter(r => r.bugReport.severity === options.severity);
    }
    if (options.category) {
      filtered = filtered.filter(r => r.bugReport.category === options.category);
    }

    const total = filtered.length;
    const offset = Math.max(0, options.offset || 0);
    const limit = Math.max(1, options.limit || 50);
    const investigations = filtered.slice(offset, offset + limit);

    return { investigations, total };
  }

  /**
   * Delete investigation
   */
  public async deleteInvestigation(investigationId: string): Promise<void> {
    await this.ensureInitialized();
    const db = this.getDb();

    db.run('DELETE FROM investigations WHERE investigation_id = ?', [investigationId]);
    this.persist();
    logger.info(`[InvestigationService] Deleted investigation ${investigationId}`);
  }

  /**
   * Update investigation status
   */
  public async updateInvestigationStatus(
    investigationId: string,
    status: 'in_progress' | 'completed' | 'failed' | 'cancelled'
  ): Promise<void> {
    await this.ensureInitialized();
    const db = this.getDb();

    db.run(
      `
      UPDATE investigations
      SET status = ?, updated_at = datetime('now')
      WHERE investigation_id = ?
      `,
      [status, investigationId]
    );

    this.persist();
  }

  /**
   * Deserialize database row to InvestigationRecord
   */
  private deserializeRow(row: RawRow): InvestigationRecord {
    const bugReport = this.parseJson<BugReport>(row.bug_report);
    const context = this.parseJson<InvestigationContext>(row.context);
    const result = this.parseJson<InvestigationResult | undefined>(row.result);

    return {
      investigationId: String(row.investigation_id || ''),
      bugReportId: String(row.bug_report_id || bugReport?.id || ''),
      bugReport,
      context,
      result,
      createdAt: new Date(String(row.created_at || new Date().toISOString())),
      status: this.parseStatus(row.status)
    };
  }

  private parseStatus(status: unknown): 'in_progress' | 'completed' | 'failed' | 'cancelled' {
    if (status === 'in_progress' || status === 'completed' || status === 'failed' || status === 'cancelled') {
      return status;
    }
    return 'in_progress';
  }

  private parseJson<T>(value: unknown): T {
    if (typeof value !== 'string' || value.length === 0) {
      return {} as T;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return {} as T;
    }
  }

  /**
   * Flush pending changes; database lifecycle is owned by global DatabaseManager.
   */
  public close(): void {
    if (!this.initialized) {
      return;
    }
    this.persist();
  }
}
