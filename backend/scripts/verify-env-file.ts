/**
 * Validate an AetherGuard env file against the backend's real startup gates
 * (backend/src/bootstrap/runtime-env.ts) WITHOUT booting the server.
 *
 * Usage (from backend/):
 *   npx ts-node --transpile-only scripts/verify-env-file.ts <path-to-env-file> [--dev]
 *
 *   default : simulates the docker-compose backend container environment
 *             (NODE_ENV=production, APP_ROLE=all, DB_MODE=postgres, ARTIFACT_STORE=s3, ...)
 *             so the file is checked against ALL production hard gates.
 *   --dev   : simulates local development (NODE_ENV=development) — checks the
 *             unconditional gates only (JWT_SECRET, AUDIT_LOG_SECRET, ...).
 *
 * Exit codes: 0 = file passes, 1 = file rejected by startup validation, 2 = usage/IO error.
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const devMode = args.includes('--dev');

if (!file) {
  console.error('usage: npx ts-node --transpile-only scripts/verify-env-file.ts <path-to-env-file> [--dev]');
  process.exit(2);
}

const resolved = path.resolve(file);
const loaded = dotenv.config({ path: resolved, override: true });
if (loaded.error) {
  console.error(`[verify-env-file] cannot read ${resolved}: ${String(loaded.error)}`);
  process.exit(2);
}

if (devMode) {
  process.env.NODE_ENV = 'development';
} else {
  // Mirror the fixed environment docker-compose.yml injects into the backend
  // container (keep in sync with the backend service's `environment:` block).
  process.env.NODE_ENV = 'production';
  process.env.PROFILE = 'prod';
  process.env.APP_ROLE = 'all';
  process.env.APP_MODE = 'production';
  process.env.DB_MODE = 'postgres';
  process.env.ARTIFACT_STORE = 's3';
  process.env.S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://minio:9000';
  process.env.S3_BUCKET = process.env.S3_BUCKET || 'aetherguard-artifacts';
}

// Import AFTER process.env is finalized — the module reads env at call time,
// but keep ordering conservative in case of future module-level reads.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validateRuntimeEnvironment } = require('../src/bootstrap/runtime-env');

try {
  const report = validateRuntimeEnvironment();
  // Mirror the DB-layer boot guard (src/config/database.ts: "SQLite fallback is
  // disabled. Postgres connection is required.") — runtime-env does not cover it,
  // but with DB_MODE=postgres the server refuses to start unless the SQLite
  // primary store is explicitly acknowledged.
  const sqliteFallback = String(process.env.SQLITE_FALLBACK_ENABLED || 'false').trim().toLowerCase() === 'true';
  if (!devMode && !sqliteFallback) {
    console.error(`[verify-env-file] FAIL mode=docker-production file=${resolved}`);
    console.error('  DB_MODE=postgres with SQLITE_FALLBACK_ENABLED!=true: backend/src/config/database.ts refuses to start');
    console.error('  ("SQLite fallback is disabled. Postgres connection is required."). Set SQLITE_FALLBACK_ENABLED=true');
    console.error('  (current implementation: SQLite primary store + Postgres shadow tables).');
    process.exit(1);
  }
  console.log(`[verify-env-file] PASS mode=${devMode ? 'dev' : 'docker-production'} file=${resolved}`);
  if (report.warnings.length > 0) {
    for (const w of report.warnings) console.log(`  [warning] ${w}`);
  }
  process.exit(0);
} catch (err) {
  console.error(`[verify-env-file] FAIL mode=${devMode ? 'dev' : 'docker-production'} file=${resolved}`);
  console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
