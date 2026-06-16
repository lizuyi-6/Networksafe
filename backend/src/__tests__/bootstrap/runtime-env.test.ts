/**
 * Runtime Environment Validation Tests
 *
 * Sprint 5 R5: covers the V2.1 fix that promotes
 * `SERIAL_HELPER_SHARED_SECRET` to a trust anchor and requires it to be at
 * least 32 characters and distinct from `DEVICE_COMMAND_SECRET` in
 * production. A leaked helper secret lets the holder fabricate Final
 * Defense "active" state for any tenant and defeat the root-resistant claim,
 * so the validator must reject short values and value collisions at boot.
 */

import { validateRuntimeEnvironment } from '../../bootstrap/runtime-env';

describe('validateRuntimeEnvironment (Sprint 5 R5 / V2.1)', () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    APP_ROLE: process.env.APP_ROLE,
    JWT_SECRET: process.env.JWT_SECRET,
    AUDIT_LOG_SECRET: process.env.AUDIT_LOG_SECRET,
    DEVICE_COMMAND_SECRET: process.env.DEVICE_COMMAND_SECRET,
    SERIAL_HELPER_SHARED_SECRET: process.env.SERIAL_HELPER_SHARED_SECRET,
    PLATFORM_API_KEY: process.env.PLATFORM_API_KEY,
    DB_MODE: process.env.DB_MODE,
    APP_MODE: process.env.APP_MODE,
    DISABLE_REDIS: process.env.DISABLE_REDIS,
    ENTERPRISE_RUNTIME_MODE: process.env.ENTERPRISE_RUNTIME_MODE
  };

  function restoreEnv() {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  function baseProductionEnv(): void {
    process.env.NODE_ENV = 'production';
    process.env.APP_ROLE = 'all';
    process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long';
    process.env.AUDIT_LOG_SECRET = 'test-audit-log-secret-minimum-32-characters';
    process.env.DEVICE_COMMAND_SECRET = 'a-strong-device-command-secret-32-chars-or-more';
    process.env.SERIAL_HELPER_SHARED_SECRET = 'a-distinct-helper-secret-32-characters-minimum';
    process.env.DB_MODE = 'postgres';
    process.env.DISABLE_REDIS = 'false';
    process.env.APP_MODE = 'production';
    // Bypass OIDC / MFA requirements for prod-enterprise mode: this test
    // exercises the SERIAL_HELPER_SHARED_SECRET trust-anchor check, not
    // OIDC wiring. The `lab` mode keeps the rest of the production
    // validator active while disabling OIDC.
    process.env.ENTERPRISE_RUNTIME_MODE = 'lab';
  }

  afterEach(() => {
    restoreEnv();
  });

  it('accepts a 32+ character SERIAL_HELPER_SHARED_SECRET distinct from DEVICE_COMMAND_SECRET', () => {
    baseProductionEnv();
    expect(() => validateRuntimeEnvironment()).not.toThrow();
  });

  it('rejects a SERIAL_HELPER_SHARED_SECRET shorter than 32 characters', () => {
    baseProductionEnv();
    process.env.SERIAL_HELPER_SHARED_SECRET = 'too-short';
    expect(() => validateRuntimeEnvironment()).toThrow(/SERIAL_HELPER_SHARED_SECRET/);
  });

  it('rejects a SERIAL_HELPER_SHARED_SECRET that equals DEVICE_COMMAND_SECRET', () => {
    baseProductionEnv();
    const shared = 'shared-trust-anchor-32-characters-min';
    process.env.DEVICE_COMMAND_SECRET = shared;
    process.env.SERIAL_HELPER_SHARED_SECRET = shared;
    expect(() => validateRuntimeEnvironment()).toThrow(/distinct secret/);
  });
});
