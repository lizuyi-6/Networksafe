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
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    JWT_SECRET: process.env.JWT_SECRET,
    AUDIT_LOG_SECRET: process.env.AUDIT_LOG_SECRET,
    AUDIT_LOG_FAIL_CLOSED: process.env.AUDIT_LOG_FAIL_CLOSED,
    AUDIT_SHADOW_REQUIRED: process.env.AUDIT_SHADOW_REQUIRED,
    SHADOW_DATABASE_URL: process.env.SHADOW_DATABASE_URL,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
    S3_SECRET_KEY: process.env.S3_SECRET_KEY,
    ARTIFACT_STORE: process.env.ARTIFACT_STORE,
    DEVICE_API_KEYS: process.env.DEVICE_API_KEYS,
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
    process.env.ADMIN_PASSWORD = 'StrongAdmin!9-Production-Test-Password';
    process.env.AUDIT_LOG_SECRET = 'test-audit-log-secret-minimum-32-characters';
    process.env.AUDIT_LOG_FAIL_CLOSED = 'true';
    process.env.AUDIT_SHADOW_REQUIRED = 'true';
    process.env.SHADOW_DATABASE_URL = 'postgres://aetherguard:test@postgres:5432/aetherguard';
    process.env.REDIS_PASSWORD = 'strong-redis-password-32-characters';
    process.env.POSTGRES_PASSWORD = 'strong-postgres-password-32-characters';
    process.env.S3_SECRET_KEY = 'strong-s3-secret-key-32-characters';
    process.env.ARTIFACT_STORE = 'local';
    process.env.DEVICE_API_KEYS = 'device_key_0123456789abcdef01234567';
    process.env.DEVICE_COMMAND_SECRET = 'a-strong-device-command-secret-32-chars-or-more';
    process.env.SERIAL_HELPER_SHARED_SECRET = 'a-distinct-helper-secret-32-characters-minimum';
    process.env.DB_MODE = 'postgres';
    process.env.DISABLE_REDIS = 'false';
    process.env.APP_MODE = 'production';
    process.env.ENTERPRISE_RUNTIME_MODE = 'prod-enterprise';
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

  it.each([
    'AUDIT_LOG_FAIL_CLOSED',
    'AUDIT_SHADOW_REQUIRED'
  ])('rejects production when %s is missing', (key) => {
    baseProductionEnv();
    delete process.env[key];
    expect(() => validateRuntimeEnvironment()).toThrow(new RegExp(`${key} must be set to true`));
  });

  it.each([
    'AUDIT_LOG_FAIL_CLOSED',
    'AUDIT_SHADOW_REQUIRED'
  ])('rejects production when %s is false', (key) => {
    baseProductionEnv();
    process.env[key] = 'false';
    expect(() => validateRuntimeEnvironment()).toThrow(new RegExp(`${key} must be set to true`));
  });

  it('rejects production when the required audit shadow has no connection string', () => {
    baseProductionEnv();
    delete process.env.SHADOW_DATABASE_URL;
    expect(() => validateRuntimeEnvironment()).toThrow(/SHADOW_DATABASE_URL must be set/);
  });

  it('rejects the lab enterprise mode under a production runtime profile', () => {
    baseProductionEnv();
    process.env.ENTERPRISE_RUNTIME_MODE = 'lab';
    expect(() => validateRuntimeEnvironment()).toThrow(/ENTERPRISE_RUNTIME_MODE must be set to prod-enterprise/);
  });

  it.each([
    ['ADMIN_PASSWORD', 'AdminLocal!2026'],
    ['REDIS_PASSWORD', 'LocalRedisPassword_2026'],
    ['POSTGRES_PASSWORD', 'LocalPostgresPassword_2026'],
    ['S3_SECRET_KEY', 'LocalS3SecretKey_2026_123456'],
    ['DEVICE_API_KEYS', 'local-device-key-2026']
  ])('rejects the known local production credential in %s', (key, value) => {
    baseProductionEnv();
    process.env[key] = value;
    expect(() => validateRuntimeEnvironment()).toThrow(new RegExp(`${key} (?:cannot use|must be at least)`));
  });
});
