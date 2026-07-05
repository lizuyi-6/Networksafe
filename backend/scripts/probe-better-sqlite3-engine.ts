process.env.DB_ENGINE = 'better-sqlite3';
process.env.DATA_DIR = require('os').tmpdir() + '/ag-bsql-probe-' + process.pid;

(async () => {
  const { initDatabase, getDatabase, closeDatabase } = require('../src/config/database');
  await initDatabase();
  const db = getDatabase();
  db.exec('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, v TEXT)');
  db.prepare('INSERT INTO probe (id, v) VALUES (?, ?)').run(1, 'x');
  db.prepare('INSERT INTO probe (id, v) VALUES (?, ?)').run(2, 'y');
  const stmt = db.prepare('SELECT id, v FROM probe ORDER BY id');
  stmt.bind([]);
  const rows: any[] = [];
  let guard = 0;
  while (stmt.step() && ++guard <= 10) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  console.log('ENGINE-PROBE rows:', JSON.stringify(rows));
  const single = db.prepare('SELECT v FROM probe WHERE id = ?').get(2);
  console.log('ENGINE-PROBE get:', JSON.stringify(single));
  closeDatabase();
})().catch((e: any) => {
  console.error('ENGINE-PROBE FAILED', (e && e.stack) || e);
  process.exit(1);
});
