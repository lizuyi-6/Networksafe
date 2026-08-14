import EnvValidator from '../security/env-validator.service';
import logger from '../utils/logger';
import {
  getAppRole,
  getArtifactStoreMode,
  getDatabaseMode,
  getRuntimeProfile,
  hasGatewayRole
} from '../config/platform-runtime';
import {
  allowDemoFeatures,
  allowPasswordLogin,
  getEnterpriseRuntimeMode,
  isEnterpriseStrictMode,
  oidcEnabled
} from '../config/enterprise-runtime';

const WEAK_VALUE_PATTERNS: RegExp[] = [
  /^change_me/i,
  /^dev-device-key-2026$/i,
  /^AetherGuardDeviceCommandSecret2026$/i,
  /^AetherGuardArtifactSecret2026$/i,
  /^AetherGuardPgShadow2026$/i,
  /^local/i,
  /^adminlocal/i
];

function hasWeakValue(value: string): boolean {
  return WEAK_VALUE_PATTERNS.some((pattern) => pattern.test(value.trim()));
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

function assertProductionTrue(key: string, errors: string[]): void {
  if (process.env[key] !== 'true') {
    errors.push(`${key} must be set to true in production.`);
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
  const enterpriseRuntimeMode = getEnterpriseRuntimeMode();

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
    assertStrongSecret('REDIS_PASSWORD', 16, errors);
    assertStrongSecret('POSTGRES_PASSWORD', 24, errors);
    assertStrongSecret('S3_SECRET_KEY', 24, errors);
    assertStrongSecret('DEVICE_API_KEYS', 24, errors);

    // Audit writes guard irreversible command dispatch and other security
    // actions. Production must never silently downgrade either the caller
    // failure signal or the required Postgres shadow copy.
    assertProductionTrue('AUDIT_LOG_FAIL_CLOSED', errors);
    assertProductionTrue('AUDIT_SHADOW_REQUIRED', errors);
    if (!String(process.env.SHADOW_DATABASE_URL || '').trim()) {
      errors.push('SHADOW_DATABASE_URL must be set when audit shadow writes are required in production.');
    }
    if (enterpriseRuntimeMode !== 'prod-enterprise') {
      errors.push('ENTERPRISE_RUNTIME_MODE must be set to prod-enterprise in production.');
    }

    if (hasGatewayRole() || appRole === 'all') {
      assertStrongSecret('DEVICE_COMMAND_SECRET', 24, errors);
    }

    // V2.1: SERIAL_HELPER_SHARED_SECRET is a trust anchor for the
    // hardware companion — a leaked helper secret lets the holder
    // fabricate Final Defense "active" state for any tenant. Require
    // ≥32 chars AND distinct from DEVICE_COMMAND_SECRET.
    if (hasGatewayRole() || appRole === 'all') {
      assertStrongSecret('SERIAL_HELPER_SHARED_SECRET', 32, errors);
      const helperSecret = String(process.env.SERIAL_HELPER_SHARED_SECRET || '').trim();
      const deviceSecret = String(process.env.DEVICE_COMMAND_SECRET || '').trim();
      if (helperSecret && deviceSecret && helperSecret === deviceSecret) {
        errors.push('SERIAL_HELPER_SHARED_SECRET must be a distinct secret from DEVICE_COMMAND_SECRET.');
      }

      // AG-B04 (audit 2026-08): optional per-helper named keys
      // (`keyId:secret,keyId:secret`) for individually revocable appliance
      // credentials. When present, every entry must meet the same strength
      // bar and stay distinct from DEVICE_COMMAND_SECRET and the shared key.
      const extraRaw = String(process.env.SERIAL_HELPER_EXTRA_SECRETS || '').trim();
      if (extraRaw) {
        const seenKeyIds = new Set<string>();
        for (const rawEntry of extraRaw.split(',')) {
          const entry = rawEntry.trim();
          if (!entry) {
            continue;
          }
          const separator = entry.indexOf(':');
          if (separator <= 0 || separator >= entry.length - 1) {
            errors.push('SERIAL_HELPER_EXTRA_SECRETS entries must use the keyId:secret format.');
            continue;
          }
          const keyId = entry.slice(0, separator).trim();
          const secret = entry.slice(separator + 1).trim();
          if (seenKeyIds.has(keyId)) {
            errors.push(`SERIAL_HELPER_EXTRA_SECRETS keyId "${keyId}" is duplicated.`);
          }
          seenKeyIds.add(keyId);
          if (secret.length < 32) {
            errors.push(`SERIAL_HELPER_EXTRA_SECRETS entry "${keyId}" must be at least 32 characters.`);
          }
          if (secret === deviceSecret || secret === helperSecret) {
            errors.push(`SERIAL_HELPER_EXTRA_SECRETS entry "${keyId}" must be distinct from DEVICE_COMMAND_SECRET and SERIAL_HELPER_SHARED_SECRET.`);
          }
        }
      }
    }

    if (String(process.env.APP_MODE || '').trim().toLowerCase() === 'demo') {
      errors.push('APP_MODE=demo is not allowed in production.');
    }

    if (enterpriseRuntimeMode === 'prod-enterprise' && !oidcEnabled()) {
      if (allowPasswordLogin()) {
        warnings.push('OIDC is not configured; local password login is the only interactive login path.');
      } else {
        errors.push('No interactive login path is configured. Enable local password login or configure all required OIDC endpoints.');
      }
    }

    if (
      process.env.ALLOW_LAB_IN_MEMORY_AUTH_SESSIONS === 'true'
      || process.env.ALLOW_INSECURE_AUTH_WHEN_REDIS_DOWN === 'true'
    ) {
      errors.push('Process-local authentication sessions cannot be enabled in production.');
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

  if (!allowDemoFeatures() && String(process.env.APP_MODE || '').trim().toLowerCase() === 'demo') {
    warnings.push(`APP_MODE=demo requested but ENTERPRISE_RUNTIME_MODE=${enterpriseRuntimeMode} disables demo features; runtime will behave as production.`);
  }

  if (isEnterpriseStrictMode() && !allowPasswordLogin()) {
    warnings.push('prod-enterprise mode is active; local password login is disabled for every role.');
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
