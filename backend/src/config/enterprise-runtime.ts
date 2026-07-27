export type EnterpriseRuntimeMode = 'prod-enterprise' | 'trial' | 'lab';

const VALID_ENTERPRISE_MODES = new Set<EnterpriseRuntimeMode>([
  'prod-enterprise',
  'trial',
  'lab'
]);

function normalizeMode(value?: string): EnterpriseRuntimeMode {
  const normalized = String(value || '').trim().toLowerCase() as EnterpriseRuntimeMode;
  if (VALID_ENTERPRISE_MODES.has(normalized)) {
    return normalized;
  }

  const profile = String(process.env.PROFILE || process.env.APP_PROFILE || process.env.NODE_ENV || '').trim().toLowerCase();
  if (profile === 'prod' || profile === 'production') {
    return 'prod-enterprise';
  }
  if (profile === 'demo') {
    return 'lab';
  }
  return 'trial';
}

export function getEnterpriseRuntimeMode(): EnterpriseRuntimeMode {
  return normalizeMode(process.env.ENTERPRISE_RUNTIME_MODE);
}

export function isEnterpriseStrictMode(mode = getEnterpriseRuntimeMode()): boolean {
  return mode === 'prod-enterprise';
}

export function isEnterpriseRuntime(mode = getEnterpriseRuntimeMode()): boolean {
  return mode === 'prod-enterprise' || mode === 'trial';
}

export function isLabRuntime(mode = getEnterpriseRuntimeMode()): boolean {
  return mode === 'lab';
}

export function allowDemoFeatures(mode = getEnterpriseRuntimeMode()): boolean {
  // Lab runtime always allows demo. prod-enterprise and trial allow demo only
  // when an operator explicitly sets ALLOW_DEMO_FEATURES=true (e.g. a release
  // verification stack that must exercise the demo-mode UI paths).
  return mode === 'lab' || process.env.ALLOW_DEMO_FEATURES === 'true';
}

export function allowGatewayDestructiveCommands(mode = getEnterpriseRuntimeMode()): boolean {
  return mode === 'lab';
}

export function allowPasswordLogin(mode = getEnterpriseRuntimeMode()): boolean {
  return mode === 'lab'
    || process.env.ALLOW_LOCAL_PASSWORD_LOGIN === 'true'
    || process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN === 'true';
}

/**
 * Process-local sessions are useful for an explicitly configured lab server,
 * but they cannot provide durable revocation or survive a process restart.
 * Keep this policy shared by login, request authentication, and readiness so
 * the server never issues a session that its own middleware will reject.
 */
export function allowLabInMemoryAuthSessions(
  mode = getEnterpriseRuntimeMode(),
  nodeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase()
): boolean {
  if (nodeEnv === 'test') {
    return true;
  }

  if (nodeEnv === 'production' || mode !== 'lab') {
    return false;
  }

  return process.env.ALLOW_LAB_IN_MEMORY_AUTH_SESSIONS === 'true'
    || process.env.ALLOW_INSECURE_AUTH_WHEN_REDIS_DOWN === 'true';
}

export function oidcEnabled(): boolean {
  return Boolean(
    String(process.env.OIDC_CLIENT_ID || '').trim()
    && String(process.env.OIDC_CLIENT_SECRET || '').trim()
    && String(process.env.OIDC_AUTHORIZATION_ENDPOINT || '').trim()
    && String(process.env.OIDC_TOKEN_ENDPOINT || '').trim()
    && String(process.env.OIDC_USERINFO_ENDPOINT || '').trim()
  );
}

export function oidcRequireMfa(): boolean {
  return String(process.env.OIDC_REQUIRE_MFA || '').trim().toLowerCase() === 'true';
}
