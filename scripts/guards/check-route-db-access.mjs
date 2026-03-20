import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const routesRoot = path.join(workspaceRoot, 'backend', 'src', 'api', 'routes');
const transitionalAllowlist = new Set([]);
const violations = [];

const disallowedPatterns = [
  /\bgetDatabase\s*\(/,
  /\.prepare\s*\(/,
  /\bdb\.exec\s*\(/
];

for (const entry of fs.readdirSync(routesRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.ts')) {
    continue;
  }

  if (transitionalAllowlist.has(entry.name)) {
    continue;
  }

  const fullPath = path.join(routesRoot, entry.name);
  const content = fs.readFileSync(fullPath, 'utf8');
  if (disallowedPatterns.some((pattern) => pattern.test(content))) {
    violations.push(path.relative(workspaceRoot, fullPath));
  }
}

if (violations.length > 0) {
  console.error('Direct database access is not allowed in backend/src/api/routes outside the migration allowlist.');
  violations.forEach((file) => console.error(` - ${file}`));
  process.exit(1);
}

console.log('No direct route-level database access found outside the migration allowlist');
