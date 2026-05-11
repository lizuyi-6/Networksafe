import EnvValidator from '../security/env-validator.service';
import logger from '../utils/logger';
import {
  getAppRole,
  getArtifactStoreMode,
  getDatabaseMode,
  getRuntimeProfile,
  hasGatewayRole
} from '../config/platform-runtime';

const WEAK_VALUE_PATTERNS: RegExp[] = [
  /^change_me/i,
  /^dev-device-key-2026$/i,
  /^AetherGuardDeviceCommandSecret2026$/i,
  /^AetherGuardArtifactSecret2026$/i,
  /^AetherGuardPgShadow2026$/i
];

function hasWeakValue(value: string): boolean {
  return WEAK_VALUE_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

function assertWeakSecretWarning(
  key: string,
  warnings: string[]
): void {
  const value = String(process.env[key] || '').trim();
  if (!value) return;
  if (hasWeakValue(value)) {
    warnings.push(
      `[SECURITY WARNING] ${key} is using a known default or placeholder value. ` +
        'Replace it with a strong secret before exposing this service to production traffic.'
    );
  }
}

function assertStrongSecret(
  key: string,
  minimumLength: number,
  errors: string[],
  options: { requiredInProduction?: boolean } = {}
): void {
  const value = String(process.env[key] || '').trim();
  if (!value) {
    if (options.requiredInProduction !== false) {
      errors.push(`${key} must be set in production.`);
    }
    return;
  }

  if (value.length < minimumLength) {
    errors.push(`${key} must be at least ${minimumLength} characters long.`);
    return;
  }

  if (hasWeakValue(value)) {
    errors.push(`${key} cannot use a bundled default or placeholder value.`);
  }
}

export interface RuntimeEnvironmentReport {
  nodeEnv: string;
  profile: string;
  appRole: string;
  dbMode: string;
  artifactStoreMode: string;
  warnings: string[];
}

export function validateRuntimeEnvironment(): RuntimeEnvironmentReport {
  const warnings: string[] = [];
  const errors: string[] = [];
  const nodeEnv = EnvValidator.optional('NODE_ENV', 'development', {
    allowedValues: ['development', 'production', 'test']
  });
  const profile = getRuntimeProfile();
  const appRole = getAppRole();
  const dbMode = getDatabaseMode();
  const artifactStoreMode = getArtifactStoreMode();
  const isProduction = nodeEnv === 'production' || profile === 'prod';

  EnvValidator.require('JWT_SECRET', {
    minLength: 32,
    description: 'JWT signing secret'
  });
  EnvValidator.require('AUDIT_LOG_SECRET', {
    minLength: 32,
    description: 'Audit log signing secret'
  });

  if (isProduction) {
    assertStrongSecret('ADMIN_PASSWORD', 12, errors);
    assertStrongSecret('ENCRYPTION_KEY', 32, errors);
    assertStrongSecret('ENCRYPTION_SALT', 16, errors);

    if (hasGatewayRole() || appRole === 'all') {
      assertStrongSecret('DEVICE_COMMAND_SECRET', 24, errors);
    }

    // WARNING-level checks: these fields use known default values but are not
    // hard-blocked so that operators can still start the service and rotate
    // secrets without a full outage.
    assertWeakSecretWarning('POSTGRES_PASSWORD', warnings);
    assertWeakSecretWarning('S3_SECRET_KEY', warnings);
    assertWeakSecretWarning('DEVICE_API_KEYS', warnings);

    if (String(process.env.APP_MODE || '').trim().toLowerCase() === 'demo') {
      errors.push('APP_MODE=demo is not allowed in production.');
    }

    if (String(process.env.ENABLE_DEV_LOGIN_PRESETS || '').trim().toLowerCase() === 'true') {
      errors.push('ENABLE_DEV_LOGIN_PRESETS must be disabled in production.');
    }

    if (dbMode !== 'postgres') {
      errors.push('DB_MODE must be set to postgres in production.');
    }

    if (String(process.env.DISABLE_REDIS || '').trim().toLowerCase() === 'true') {
      errors.push('DISABLE_REDIS cannot be enabled in production.');
    }

    if (artifactStoreMode === 's3') {
      const bucket = String(process.env.S3_BUCKET || '').trim();
      const endpoint = String(process.env.S3_ENDPOINT || '').trim();
      if (!bucket || !endpoint) {
        errors.push('S3_BUCKET and S3_ENDPOINT are required when ARTIFACT_STORE=s3 in production.');
      }
    }

    const platformApiKey = String(process.env.PLATFORM_API_KEY || '').trim();
    if (!platformApiKey) {
      warnings.push('PLATFORM_API_KEY is not set; cloud AI routes will start in a degraded state.');
    }
  }

  const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '').trim();
  if (!allowedOrigins) {
    warnings.push('ALLOWED_ORIGINS is empty; browser access will rely on localhost defaults.');
  }

  if (errors.length > 0) {
    const message = `Runtime environment validation failed: ${errors.join(' ')}`;
    logger.error(message, {
      nodeEnv,
      profile,
      appRole,
      dbMode,
      artifactStoreMode
    });
    throw new Error(message);
  }

  const report: RuntimeEnvironmentReport = {
    nodeEnv,
    profile,
    appRole,
    dbMode,
    artifactStoreMode,
    warnings
  };

  if (warnings.length > 0) {
    logger.warn('Runtime environment validated with warnings', { ...report });
  } else {
    logger.info('Runtime environment validated', { ...report });
  }

  return report;
}
