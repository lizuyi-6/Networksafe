import { execFileSync } from 'node:child_process';

const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .map((file) => file.replaceAll('\\', '/'));

const allowedTracked = new Set([
  'artifacts/README.md'
]);

const forbiddenPatterns = [
  {
    pattern: /^backend\/test-data\/.*\.(db|sqlite|sqlite3)$/i,
    reason: 'runtime database'
  },
  {
    pattern: /^docs\/legal\/softcopyright\/.*_(source_print|user_manual)\.(html|txt|docx)$/i,
    reason: 'generated legal printout'
  },
  {
    pattern: /^docs\/video\/.*\.(wav|mp4|png)$/i,
    reason: 'generated video or audio media'
  },
  {
    pattern: /^qa-blackbox-screenshots\//i,
    reason: 'local QA screenshot output'
  },
  {
    pattern: /^security-tests\/reports\//i,
    reason: 'generated security-test report'
  },
  {
    pattern: /^\.playwright-mcp\//i,
    reason: 'local Playwright MCP state'
  },
  {
    pattern: /^hardware\/kicad\/.*\/release\/.*\/(?:gerbers|drill|.*upload.*)\//i,
    reason: 'generated PCB manufacturing package'
  },
  {
    pattern: /^hardware\/kicad\/.*\/release\/.*\.(gbr|gbrjob|gbl|gbs|gm1|gtl|gts|drl)$/i,
    reason: 'generated PCB manufacturing file'
  },
  {
    pattern: /^\d+-.*\.png$/i,
    reason: 'root-level QA screenshot'
  },
  {
    pattern: /\.pptx$/i,
    reason: 'generated presentation deck'
  }
];

const violations = [];

for (const file of trackedFiles) {
  if (allowedTracked.has(file)) {
    continue;
  }

  for (const rule of forbiddenPatterns) {
    if (rule.pattern.test(file)) {
      violations.push({ file, reason: rule.reason });
      break;
    }
  }
}

if (violations.length > 0) {
  console.error('Tracked generated artifacts should be archived or removed from the Git index:');
  for (const violation of violations) {
    console.error(` - ${violation.file} (${violation.reason})`);
  }
  console.error('');
  console.error('After preserving needed files in the external archive, run git rm --cached <path> for each tracked artifact.');
  process.exit(1);
}

console.log('No tracked generated artifacts found');
