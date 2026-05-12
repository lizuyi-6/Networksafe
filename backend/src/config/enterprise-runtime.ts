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
  return mode === 'lab';
}

export function allowGatewayDestructiveCommands(mode = getEnterpriseRuntimeMode()): boolean {
  return mode === 'lab';
}

export function allowPasswordLogin(mode = getEnterpriseRuntimeMode()): boolean {
  return mode === 'lab' || process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN === 'true';
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
