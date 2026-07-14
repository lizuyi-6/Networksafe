// PostToolUse hook (Write|Edit): when an edit touches a safety-path file,
// run the mapped verification and feed exit code + output tail back as
// additionalContext. Non-safety files: exit 0 silently (no noise).
//
// Non-blocking by design: it surfaces real results so the model can't claim
// "needs manual verification", but does not hard-block WIP edits where a
// targeted test is temporarily red. Flip to decision:"block" to harden.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// file-path substring -> { cmd, cwd } run from repo root.
const BACKEND_MAP = [
  { re: /services\/final-defense\.service\.ts$/, cmd: ['npx', 'jest', 'src/__tests__/services/final-defense.service.test.ts'] },
  { re: /services\/hardware-authorization\.service\.ts$/, cmd: ['npx', 'jest', 'src/__tests__/services/hardware-authorization.service.test.ts'] },
  { re: /services\/device-control\.service\.ts$/, cmd: ['npx', 'jest', 'src/__tests__/services/device-control.service.test.ts'] },
  { re: /companion\//, cmd: ['npx', 'jest', 'src/__tests__/companion/serial-device-companion.test.ts'] },
  { re: /security\/final-defense-policy\.ts$/, cmd: ['npx', 'jest', 'src/__tests__/services/final-defense.service.test.ts'] },
  { re: /security\/hardware-grant\.ts$/, cmd: ['npx', 'jest', 'src/__tests__/services/hardware-authorization.service.test.ts'] },
];

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const filePath = input.tool_input?.file_path || input.tool_response?.filePath || '';
if (!filePath) process.exit(0);

let cmd, args, cwd;
const isWin = process.platform === 'win32';
if (/rust-fastpath\//.test(filePath)) {
  cmd = 'cargo';
  args = ['test'];
  cwd = 'rust-fastpath';
} else {
  const m = BACKEND_MAP.find((x) => x.re.test(filePath));
  if (!m) process.exit(0); // non-safety: silent pass-through
  cwd = 'backend';
  // On Windows npx is npx.cmd (not a real exe); spawn cmd.exe with /c to run it
  // without shell:true (avoids EINVAL on .cmd and the DEP0190 args-with-shell warning).
  if (isWin) {
    cmd = 'cmd';
    args = ['/c', ...m.cmd];
  } else {
    cmd = m.cmd[0];
    args = m.cmd.slice(1);
  }
}

const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
const exit = res.status;
const err = res.error ? `${res.error.name}: ${res.error.message}` : '';
const out = `${res.stdout || ''}${res.stderr || ''}`;
const tail = out.split('\n').slice(-30).join('\n').trim();

const msg =
  `⚠️ PostToolUse 安全路径验证\n` +
  `触发文件: ${filePath}\n` +
  `命令: ${cmd} ${args.join(' ')} (cwd ${cwd})\n` +
  `退出码: ${exit}\n` +
  (err ? `spawn 错误: ${err}\n` : '') +
  `输出尾:\n${tail || '(无输出)'}`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: msg,
    },
  })
);
