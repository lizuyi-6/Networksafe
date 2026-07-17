import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const composeArgs = [
  'compose',
  '-f',
  'docker-compose.yml',
  '-f',
  'deployment/development/docker-compose.jetbrains.yml',
];
const host = '127.0.0.1';
const port = Number(process.env.JETBRAINS_POSTGRES_PORT || 15432);

await new Promise((resolve, reject) => {
  const socket = createConnection({ host, port });
  socket.setTimeout(5000);
  socket.once('connect', () => {
    socket.destroy();
    resolve();
  });
  socket.once('timeout', () => {
    socket.destroy();
    reject(new Error(`PostgreSQL endpoint timed out: ${host}:${port}`));
  });
  socket.once('error', reject);
});

function run(args, options = {}) {
  const result = spawnSync('docker', [...composeArgs, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture) process.stderr.write(result.stderr || result.stdout || '');
    process.exit(result.status ?? 1);
  }
  return options.capture ? result.stdout.trim() : '';
}

run(['exec', '-T', 'postgres', 'pg_isready', '-U', 'aetherguard', '-d', 'aetherguard']);

const fields = run(
  [
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'aetherguard',
    '-d',
    'aetherguard',
    '-At',
    '-F',
    '|',
    '-c',
    "SELECT current_database(), current_user, current_setting('server_version_num')::int >= 160000;",
  ],
  { capture: true },
).split('|');

if (fields.length !== 3 || fields[0] !== 'aetherguard' || fields[1] !== 'aetherguard' || fields[2] !== 't') {
  console.error(`postgres_contract=failed fields=${JSON.stringify(fields)}`);
  process.exit(1);
}

const tableCount = Number(
  run(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'aetherguard',
      '-d',
      'aetherguard',
      '-At',
      '-c',
      "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';",
    ],
    { capture: true },
  ),
);

const requiredTables = run(
  [
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'aetherguard',
    '-d',
    'aetherguard',
    '-At',
    '-c',
    "SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('audit_log', 'hardware_gates', 'sites', 'users');",
  ],
  { capture: true },
).split(',').filter(Boolean);

if (tableCount < 1 || requiredTables.join(',') !== 'audit_log,hardware_gates,sites,users') {
  console.error(
    `postgres_schema_contract=failed public_tables=${tableCount} required_tables=${JSON.stringify(requiredTables)}`,
  );
  process.exit(1);
}

const userCount = Number(
  run(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'aetherguard',
      '-d',
      'aetherguard',
      '-At',
      '-c',
      'SELECT count(*) FROM users;',
    ],
    { capture: true },
  ),
);

if (userCount < 1) {
  console.error(`postgres_seed_contract=failed users=${userCount}`);
  process.exit(1);
}

console.log('postgres_contract=passed');
console.log(`jetbrains_endpoint=${host}:${port}`);
console.log('database=aetherguard');
console.log('user=aetherguard');
console.log('server_version_major>=16');
console.log(`public_tables=${tableCount}`);
console.log(`required_tables=${requiredTables.join(',')}`);
console.log(`users=${userCount}`);
