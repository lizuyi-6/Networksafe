import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const frontendRoot = path.join(workspaceRoot, 'frontend', 'src');
const violations = [];

const pattern = /fetch\s*\(\s*([`'"])\s*\/api\b/g;

function scanDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
      continue;
    }

    if (!/\.(ts|tsx)$/.test(entry.name)) {
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    if (pattern.test(content)) {
      violations.push(path.relative(workspaceRoot, fullPath));
    }
  }
}

scanDir(frontendRoot);

if (violations.length > 0) {
  console.error('Direct /api fetch usage is not allowed outside frontend/src/services/api.ts');
  violations.forEach((file) => console.error(` - ${file}`));
  process.exit(1);
}

console.log('No direct /api fetch usage found in frontend/src');
