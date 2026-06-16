/**
 * Sprint 5 R4 / V4.3 — multi-factor isTestRuntime() gate tests.
 *
 * The legacy gate checked only `NODE_ENV === 'test'`, which was a CVE-grade
 * misconfiguration trap (any `NODE_ENV=test` in production silently bypassed
 * WebSocket signature verification and granted admin cross-tenant access).
 *
 * These tests pin the new contract:
 *   - NODE_ENV=test AND ALLOW_TEST_RUNTIME=true AND NOT prod-enterprise  → true
 *   - any of the three conditions missing                                  → false
 */

const ORIGINAL_ENV = { ...process.env };

// Hoist-friendly require: each test resets the env then re-requires the module
// so the top-level isTestRuntime() closure picks up the new env values via
// the lazy `require('../config/enterprise-runtime')` lookup.
function loadIsTestRuntime() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../testing/test-runtime-adapter').isTestRuntime as () => boolean;
}

function loadEnterpriseRuntimeMode(): string | undefined {
  jest.resetModules();
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const runtime = require('../../config/enterprise-runtime');
    return runtime?.getEnterpriseRuntimeMode?.();
  } catch {
    return undefined;
  }
}

function setEnv(overrides: Record<string, string | undefined>) {
  const keys = ['NODE_ENV', 'ALLOW_TEST_RUNTIME', 'APP_MODE', 'PROFILE', 'APP_PROFILE'];
  for (const k of keys) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

afterEach(() => {
  // Restore the baseline that jest.setup.js (and the rest of the suite) expects.
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) {
      delete process.env[k];
    }
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe('isTestRuntime() — multi-factor gate (V4.3 fix)', () => {
  it('returns true only when NODE_ENV=test AND ALLOW_TEST_RUNTIME=true AND NOT prod-enterprise', () => {
    setEnv({ NODE_ENV: 'test', ALLOW_TEST_RUNTIME: 'true' });
    // APP_MODE not set, so enterprise runtime mode is not 'prod-enterprise'
    const isTestRuntime = loadIsTestRuntime();
    expect(isTestRuntime()).toBe(true);
  });

  it('returns false when ALLOW_TEST_RUNTIME is missing, even if NODE_ENV=test', () => {
    setEnv({ NODE_ENV: 'test' });
    const isTestRuntime = loadIsTestRuntime();
    expect(isTestRuntime()).toBe(false);
  });

  it('returns false when ALLOW_TEST_RUNTIME is set to something other than "true"', () => {
    setEnv({ NODE_ENV: 'test', ALLOW_TEST_RUNTIME: 'yes' });
    const isTestRuntime = loadIsTestRuntime();
    expect(isTestRuntime()).toBe(false);
  });

  it('returns false when NODE_ENV is production, even with ALLOW_TEST_RUNTIME=true', () => {
    setEnv({ NODE_ENV: 'production', ALLOW_TEST_RUNTIME: 'true' });
    const isTestRuntime = loadIsTestRuntime();
    expect(isTestRuntime()).toBe(false);
  });

  it('returns false when NODE_ENV is development, even with ALLOW_TEST_RUNTIME=true', () => {
    setEnv({ NODE_ENV: 'development', ALLOW_TEST_RUNTIME: 'true' });
    const isTestRuntime = loadIsTestRuntime();
    expect(isTestRuntime()).toBe(false);
  });

  it('returns false when NODE_ENV is undefined', () => {
    setEnv({});
    const isTestRuntime = loadIsTestRuntime();
    expect(isTestRuntime()).toBe(false);
  });

  it('returns false in prod-enterprise mode even with NODE_ENV=test AND ALLOW_TEST_RUNTIME=true', () => {
    // APP_MODE=production + NODE_ENV=test is the misconfiguration trap the
    // original V4.3 PoC describes. The enterprise-runtime guard must
    // fail-closed on top of the env flags.
    setEnv({
      NODE_ENV: 'test',
      ALLOW_TEST_RUNTIME: 'true',
      APP_MODE: 'production',
      PROFILE: 'prod'
    });
    const mode = loadEnterpriseRuntimeMode();
    // Sanity-check the assumption the test relies on.
    expect(mode).toBe('prod-enterprise');

    const isTestRuntime = loadIsTestRuntime();
    expect(isTestRuntime()).toBe(false);
  });

  it('returns true in lab mode with NODE_ENV=test AND ALLOW_TEST_RUNTIME=true (sanity check)', () => {
    setEnv({
      NODE_ENV: 'test',
      ALLOW_TEST_RUNTIME: 'true',
      APP_MODE: 'demo',
      PROFILE: 'demo'
    });
    const mode = loadEnterpriseRuntimeMode();
    expect(mode).not.toBe('prod-enterprise');

    const isTestRuntime = loadIsTestRuntime();
    expect(isTestRuntime()).toBe(true);
  });
});
