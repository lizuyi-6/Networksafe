/**
 * Investigation Service
 *
 * Handles persistence and retrieval of investigation data.
 */

import { Database } from 'sqlite3';
import { promisify } from 'util';
import {
  BugReport,
  InvestigationContext,
  InvestigationResult
} from '../ai-agents/investigation/types';

export interface InvestigationRecord {
  investigationId: string;
  bugReportId: string;
  bugReport: BugReport;
  context: InvestigationContext;
  result: InvestigationResult;
  createdAt: Date;
  status: 'in_progress' | 'completed' | 'failed';
}

export class InvestigationService {
  private db: Database;

  constructor() {
    // TODO: Use proper database connection
    this.db = new Database('./data/investigations.db');
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    const createTable = `
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
    `;

    this.db.run(createTable, (err) => {
      if (err) {
        console.error('[InvestigationService] Failed to create table:', err);
      } else {
        console.log('[InvestigationService] Database initialized');
      }
    });
  }

  /**
   * Save investigation to database
   */
  public async saveInvestigation(data: InvestigationRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO investigations
        (investigation_id, bug_report_id, bug_report, context, result, created_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        data.investigationId,
        data.bugReportId,
        JSON.stringify(data.bugReport),
        JSON.stringify(data.context),
        JSON.stringify(data.result),
        data.createdAt.toISOString(),
        data.status,
        (err) => {
          if (err) {
            console.error('[InvestigationService] Failed to save investigation:', err);
            reject(err);
          } else {
            console.log(`[InvestigationService] Saved investigation ${data.investigationId}`);
            resolve();
          }
        }
      );

      stmt.finalize();
    });
  }

  /**
   * Get investigation by ID
   */
  public async getInvestigation(investigationId: string): Promise<InvestigationRecord | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM investigations WHERE investigation_id = ?',
        [investigationId],
        (err, row: any) => {
          if (err) {
            console.error('[InvestigationService] Failed to get investigation:', err);
            reject(err);
          } else if (row) {
            resolve(this.deserializeRow(row));
          } else {
            resolve(null);
          }
        }
      );
    });
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
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM investigations';
      const params: any[] = [];
      const conditions: string[] = [];

      if (options.severity || options.category) {
        const whereConditions: string[] = [];

        if (options.severity) {
          whereConditions.push('JSON_EXTRACT(bug_report, "$.severity") = ?');
          params.push(options.severity);
        }

        if (options.category) {
          whereConditions.push('JSON_EXTRACT(bug_report, "$.category") = ?');
          params.push(options.category);
        }

        query += ' WHERE ' + whereConditions.join(' AND ');
      }

      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(options.limit || 50);
      params.push(options.offset || 0);

      this.db.all(query, params, (err, rows: any[]) => {
        if (err) {
          console.error('[InvestigationService] Failed to get history:', err);
          reject(err);
        } else {
          const investigations = rows.map(row => this.deserializeRow(row));

          // Get total count
          let countQuery = 'SELECT COUNT(*) as count FROM investigations';
          if (conditions.length > 0) {
            countQuery += ' WHERE ' + conditions.join(' AND ');
          }

          this.db.get(countQuery, params.slice(0, -2), (countErr, countRow: any) => {
            if (countErr) {
              reject(countErr);
            } else {
              resolve({
                investigations,
                total: countRow.count
              });
            }
          });
        }
      });
    });
  }

  /**
   * Delete investigation
   */
  public async deleteInvestigation(investigationId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM investigations WHERE investigation_id = ?',
        [investigationId],
        (err) => {
          if (err) {
            console.error('[InvestigationService] Failed to delete investigation:', err);
            reject(err);
          } else {
            console.log(`[InvestigationService] Deleted investigation ${investigationId}`);
            resolve();
          }
        }
      );
    });
  }

  /**
   * Update investigation status
   */
  public async updateInvestigationStatus(
    investigationId: string,
    status: 'in_progress' | 'completed' | 'failed'
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE investigations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE investigation_id = ?',
        [status, investigationId],
        (err) => {
          if (err) {
            console.error('[InvestigationService] Failed to update status:', err);
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Deserialize database row to InvestigationRecord
   */
  private deserializeRow(row: any): InvestigationRecord {
    return {
      investigationId: row.investigation_id,
      bugReportId: row.bug_report_id,
      bugReport: JSON.parse(row.bug_report),
      context: JSON.parse(row.context),
      result: row.result ? JSON.parse(row.result) : undefined,
      createdAt: new Date(row.created_at),
      status: row.status
    };
  }

  /**
   * Close database connection
   */
  public close(): void {
    this.db.close((err) => {
      if (err) {
        console.error('[InvestigationService] Error closing database:', err);
      } else {
        console.log('[InvestigationService] Database connection closed');
      }
    });
  }
}
