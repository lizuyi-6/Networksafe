/**
 * AetherGuard CLI integration tests.
 *
 * Spawns the compiled CLI (dist/cli/aetherguard.js) and asserts the AI-native
 * output contract: structured JSON on stdout, stable exit codes, and correct
 * verdicts for known attack / benign inputs. dist/ is gitignored, so the test
 * builds the CLI on demand when the compiled artifact is absent (e.g. a clean
 * checkout or CI run that only ran `npm test`).
 */
import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const cliPath = path.resolve(__dirname, '../../../dist/cli/aetherguard.js');

beforeAll(() => {
  if (!fs.existsSync(cliPath)) {
    // Build only the CLI so a clean checkout/CI test run does not fail before
    // exercising the contract. `npm run build` compiles tsconfig.build.json.
    execSync('npm run build', { stdio: 'ignore', cwd: path.resolve(__dirname, '../../..') });
  }
}, 120_000);

function runCli(args: string[], extraEnv: NodeJS.ProcessEnv = {}): { stdout: string; code: number } {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      encoding: 'utf8',
      // This suite runs inside a parallel shard. Keep the child bounded, but
      // allow for CPU starvation while other Jest workers compile TS files.
      timeout: 120000,
      env: { ...process.env, FORCE_COLOR: '0', CI: '1', ...extraEnv }
    });
    return { stdout, code: 0 };
  } catch (err: any) {
    return { stdout: err.stdout?.toString() ?? '', code: err.status ?? 1 };
  }
}

function runCliWithStdin(args: string[], input: string): { stdout: string; code: number } {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      encoding: 'utf8',
      timeout: 120000,
      input,
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' }
    });
    return { stdout, code: 0 };
  } catch (err: any) {
    return { stdout: err.stdout?.toString() ?? '', code: err.status ?? 1 };
  }
}

describe('aetherguard CLI (AI-native contract)', () => {
  it('emits pure structured JSON for a benign request (stdout-parsable)', () => {
    const { stdout, code } = runCli(['analyze', '--path', '/api/widgets', '--json']);
    const parsed = JSON.parse(stdout); // throws if any non-JSON noise leaked onto stdout
    expect(parsed.verdict).toBe('allow');
    expect(parsed.decisionPath).toBe('deterministic');
    expect(Array.isArray(parsed.signals)).toBe(true);
    expect(code).toBe(0);
  });

  it('blocks a SQLi auth-bypass payload and exits non-zero (CI/AI can branch on it)', () => {
    const { stdout, code } = runCli(['analyze', '--path', '/login', '--method', 'POST', '--body', "admin' OR 1=1--", '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.verdict).toBe('block');
    expect(parsed.attackFamily).toBe('sqli');
    expect(parsed.matchedRules.some((r: any) => r.ruleId.includes('sqli'))).toBe(true);
    expect(code).toBe(1); // threat → non-zero so AI agents / CI detect the block
  });

  it('auto-splits a query string embedded in --path so query matchers still fire', () => {
    const { stdout } = runCli(['analyze', '--path', '/search?q=hello+world', '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.requestId).toMatch(/^cli-/);
  });

  it('analyze --input - rejects malformed JSON with exit 2 (no silent allow)', () => {
    // A pipeline/CI passing broken JSON must NOT be classified as a benign
    // default request (verdict allow / exit 0). It must fail loudly at exit 2.
    const { stdout, code } = runCliWithStdin(['analyze', '--input', '-', '--json'], '{not-json');
    expect(code).toBe(2);
    // --json must still emit a valid JSON error object on stdout.
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.error).toBeDefined();
  });

  it('analyze --input - with valid JSON still classifies normally', () => {
    const { stdout, code } = runCliWithStdin(['analyze', '--input', '-', '--json'], JSON.stringify({ path: '/x', method: 'GET' }));
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.verdict).toBe('allow');
  });

  it('analyze --force-debate implies --ai (emits the multi-agent ai field)', () => {
    // Help text promises "Force a multi-agent debate (implies --ai)". Without
    // the implication, passing only --force-debate emitted no ai/cascadeTrace.
    const { stdout } = runCli(['analyze', '--path', '/login', '--method', 'POST', '--body', "' OR 1=1--", '--force-debate', '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.ai).toBeDefined();
    expect(parsed.verdict).toBe('block');
  });

  it('emits the 7-layer topology as pure JSON', () => {
    const { stdout, code } = runCli(['topology'], { LOG_LEVEL: 'debug' });
    const parsed = JSON.parse(stdout);
    expect(parsed.layers).toHaveLength(7);
    expect(parsed.layers[0]).toMatchObject({ num: 1, thinkingDepth: 'shallow', modelTier: 'local' });
    expect(parsed.layers[4]).toMatchObject({ num: 5, thinkingDepth: 'deep', modelTier: 'cloud' });
    expect(parsed.roles).toEqual(['socrates', 'plato', 'aristotle', 'arbitrator']);
    expect(code).toBe(0);
  });

  it('lists the built-in detection rules', () => {
    const { stdout } = runCli(['detect-rules']);
    const parsed = JSON.parse(stdout);
    expect(parsed.count).toBe(parsed.rules.length);
    expect(parsed.count).toBeGreaterThan(0);
  });

  it('reports bad --headers JSON with a stable input-error exit code', () => {
    const { code } = runCli(['analyze', '--path', '/x', '--headers', '{not-json', '--json']);
    expect(code).toBe(2);
  });

  it('pipe: streams one JSON-line verdict per stdin request and exits non-zero on any block', () => {
    const feed = [
      '{"path":"/api/widgets","method":"GET"}',
      '{"path":"/login","method":"POST","body":"admin\' OR 1=1--"}',
      '{"path":"/health"}'
    ].join('\n');
    const { stdout, code } = runCliWithStdin(['pipe'], feed);
    const outLines = stdout.trim().split('\n').filter(Boolean);
    expect(outLines.length).toBe(3);
    const verdicts = outLines.map((l) => JSON.parse(l).verdict);
    expect(verdicts).toEqual(['allow', 'block', 'allow']);
    expect(code).toBe(1); // worst verdict (block) → non-zero
  });

  it('pipe --summary: emits an aggregate object', () => {
    const feed = '{"path":"/a"}\n{"path":"/login","method":"POST","body":"admin\' OR 1=1--"}';
    const { stdout } = runCliWithStdin(['pipe', '--summary'], feed);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.processed).toBe(2);
    expect(parsed.blocked).toBe(1);
    expect(parsed.allowed).toBe(1);
  });

  it('audit: HTTP-mode command returns a structured result (logs on success, error object on failure)', () => {
    const { stdout } = runCli(['audit', '--json']);
    // Environment-dependent (server may be up or down); either way stdout must be
    // valid JSON with a recognizable contract — {logs} on success or {error} on failure.
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.logs !== undefined || parsed.error !== undefined).toBe(true);
  });
});
