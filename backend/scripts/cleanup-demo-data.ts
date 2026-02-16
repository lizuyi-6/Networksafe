import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

type Counts = Record<string, number>;

const resolveDbPath = (): string => {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  return path.join(dataDir, 'newsecurity.db');
};

const getCount = (db: any, sql: string, params: any[] = []): number => {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : { c: 0 };
  stmt.free();
  return Number((row as any).c || 0);
};

const buildCounts = (db: any): Counts => ({
  users: getCount(db, "SELECT COUNT(*) AS c FROM users WHERE email LIKE 'demo@%' OR username LIKE 'Demo %'"),
  sites: getCount(
    db,
    "SELECT COUNT(*) AS c FROM sites WHERE domain IN ('example.com','api.example.com','admin.example.com')"
  ),
  agents: getCount(
    db,
    "SELECT COUNT(*) AS c FROM agents WHERE hostname LIKE 'web-server-%' OR hostname LIKE 'api-server-%' OR hostname LIKE 'db-server-%' OR id LIKE 'agent-demo-%'"
  ),
  devices: getCount(
    db,
    "SELECT COUNT(*) AS c FROM devices WHERE mac_address LIKE 'AA:BB:CC:DD:EE:%'"
  ),
  alerts: getCount(
    db,
    "SELECT COUNT(*) AS c FROM alerts WHERE message LIKE '%SQL injection attempt detected%' OR message LIKE '%Demo%' OR source LIKE 'web-server-%' OR source LIKE 'api-server-%' OR source LIKE 'db-server-%'"
  ),
  api_keys: getCount(
    db,
    "SELECT COUNT(*) AS c FROM api_keys WHERE name LIKE 'Demo API Key%'"
  ),
  agent_registrations: getCount(
    db,
    "SELECT COUNT(*) AS c FROM agent_registrations WHERE api_key_hash = ?",
    [crypto.createHash('sha256').update('probe_agent_demo_key_32_characters').digest('hex')]
  )
});

const deleteDemoData = (db: any): void => {
  db.run("DELETE FROM users WHERE email LIKE 'demo@%' OR username LIKE 'Demo %'");
  db.run("DELETE FROM sites WHERE domain IN ('example.com','api.example.com','admin.example.com')");
  db.run("DELETE FROM agents WHERE hostname LIKE 'web-server-%' OR hostname LIKE 'api-server-%' OR hostname LIKE 'db-server-%' OR id LIKE 'agent-demo-%'");
  db.run("DELETE FROM devices WHERE mac_address LIKE 'AA:BB:CC:DD:EE:%'");
  db.run("DELETE FROM alerts WHERE message LIKE '%SQL injection attempt detected%' OR message LIKE '%Demo%' OR source LIKE 'web-server-%' OR source LIKE 'api-server-%' OR source LIKE 'db-server-%'");
  db.run("DELETE FROM api_keys WHERE name LIKE 'Demo API Key%'");
};

const main = async () => {
  const execute = process.argv.includes('--execute');
  const dryRun = !execute;

  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(fileBuffer);

  const before = buildCounts(db);
  console.log('Demo data candidates:', before);

  if (dryRun) {
    console.log('Dry run complete. Re-run with --execute to delete.');
    process.exit(0);
  }

  const backupPath = `${dbPath}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
  fs.copyFileSync(dbPath, backupPath);
  console.log(`Backup created: ${backupPath}`);

  db.run('BEGIN TRANSACTION');
  try {
    deleteDemoData(db);
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }

  const after = buildCounts(db);
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  console.log('Cleanup complete.');
  console.log('Before:', before);
  console.log('After:', after);
};

main().catch((error) => {
  console.error('Cleanup failed:', error);
  process.exit(1);
});
