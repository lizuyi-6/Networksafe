import { getDatabase } from '../../config/database';

let schemaReady = false;

export function ensureAgentOnboardingSchema(): void {
  if (schemaReady) {
    return;
  }

  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_onboarding_codes (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      tenant_id TEXT,
      created_by TEXT NOT NULL,
      max_uses INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'used', 'expired', 'revoked')),
      expected_hostname TEXT,
      expected_tags_json TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT,
      used_by_agent_id TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_credentials_audit (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      action TEXT NOT NULL CHECK(action IN ('issued', 'rotated', 'revoked', 'onboarding_code_issued', 'onboarding_code_used')),
      operator_id TEXT,
      reason TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    )
  `);
  schemaReady = true;
}
