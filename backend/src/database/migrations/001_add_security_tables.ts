/**
 * Database Migration: Add Security Tables
 * Adds tables for agent registration and audit logging
 */

import { getDatabase } from '../../config/database';

export function up(): void {
  const db = getDatabase();

  // Agent registrations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT UNIQUE NOT NULL,
      hostname TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      secret_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT,
      tenant_id TEXT NOT NULL DEFAULT 'default'
    )
  `);

  // Create index on agent_id for fast lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_registrations_agent_id
    ON agent_registrations(agent_id)
  `);

  // Create index on status for filtering
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_registrations_status
    ON agent_registrations(status)
  `);

  // Audit log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_ip TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      details_json TEXT NOT NULL,
      status TEXT NOT NULL,
      signature TEXT NOT NULL
    )
  `);

  // Create index on timestamp for queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp
    ON audit_log(timestamp DESC)
  `);

  // Create index on category for filtering
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_category
    ON audit_log(category)
  `);

  // Create index on actor_id for user activity queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id
    ON audit_log(actor_id)
  `);

  // Create index on target_id for target activity queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_target_id
    ON audit_log(target_id)
  `);

  // Nonce tracking for replay attack prevention
  db.exec(`
    CREATE TABLE IF NOT EXISTS used_nonces (
      nonce TEXT PRIMARY KEY,
      used_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `);

  // Create index on expires_at for cleanup
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_used_nonces_expires_at
    ON used_nonces(expires_at)
  `);
}

export function down(): void {
  const db = getDatabase();

  db.exec(`DROP INDEX IF EXISTS idx_used_nonces_expires_at`);
  db.exec(`DROP INDEX IF EXISTS idx_audit_log_target_id`);
  db.exec(`DROP INDEX IF EXISTS idx_audit_log_actor_id`);
  db.exec(`DROP INDEX IF EXISTS idx_audit_log_category`);
  db.exec(`DROP INDEX IF EXISTS idx_audit_log_timestamp`);
  db.exec(`DROP INDEX IF EXISTS idx_agent_registrations_status`);
  db.exec(`DROP INDEX IF EXISTS idx_agent_registrations_agent_id`);

  db.exec(`DROP TABLE IF EXISTS used_nonces`);
  db.exec(`DROP TABLE IF EXISTS audit_log`);
  db.exec(`DROP TABLE IF EXISTS agent_registrations`);
}
