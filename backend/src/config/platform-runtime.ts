export type AppRole = 'all' | 'api' | 'gateway' | 'worker' | 'scheduler';
export type ArtifactStoreMode = 'local' | 's3';
export type DatabaseMode = 'sqlite' | 'postgres';
export type RuntimeProfile = 'prod' | 'dev' | 'demo';

const VALID_APP_ROLES = new Set<AppRole>(['all', 'api', 'gateway', 'worker', 'scheduler']);
const VALID_ARTIFACT_STORES = new Set<ArtifactStoreMode>(['local', 's3']);
const VALID_DATABASE_MODES = new Set<DatabaseMode>(['sqlite', 'postgres']);
const VALID_RUNTIME_PROFILES = new Set<RuntimeProfile>(['prod', 'dev', 'demo']);

function normalizeRole(value?: string): AppRole {
  const normalized = String(value || 'all').trim().toLowerCase() as AppRole;
  return VALID_APP_ROLES.has(normalized) ? normalized : 'all';
}

function normalizeArtifactStore(value?: string): ArtifactStoreMode {
  const normalized = String(value || 'local').trim().toLowerCase() as ArtifactStoreMode;
  return VALID_ARTIFACT_STORES.has(normalized) ? normalized : 'local';
}

function normalizeDatabaseMode(value?: string): DatabaseMode {
  const normalized = String(value || '').trim().toLowerCase() as DatabaseMode;
  if (VALID_DATABASE_MODES.has(normalized)) {
    return normalized;
  }

  return getRuntimeProfile() === 'prod' ? 'postgres' : 'sqlite';
}

function normalizeRuntimeProfile(value?: string): RuntimeProfile {
  const normalized = String(value || '').trim().toLowerCase() as RuntimeProfile;
  if (VALID_RUNTIME_PROFILES.has(normalized)) {
    return normalized;
  }
  if (String(process.env.APP_MODE || '').toLowerCase() === 'demo') {
    return 'demo';
  }
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production' ? 'prod' : 'dev';
}

function normalizeBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export function getAppRole(): AppRole {
  return normalizeRole(process.env.APP_ROLE);
}

export function getArtifactStoreMode(): ArtifactStoreMode {
  return normalizeArtifactStore(process.env.ARTIFACT_STORE);
}

export function getDatabaseMode(): DatabaseMode {
  return normalizeDatabaseMode(process.env.DB_MODE);
}

export function getRuntimeProfile(): RuntimeProfile {
  return normalizeRuntimeProfile(process.env.PROFILE || process.env.APP_PROFILE);
}

export function isSqliteFallbackEnabled(): boolean {
  return normalizeBoolean(process.env.SQLITE_FALLBACK_ENABLED, getRuntimeProfile() !== 'prod');
}

export function isRuntimeEmulatorEnabled(): boolean {
  const requested = normalizeBoolean(process.env.ENABLE_RUNTIME_EMULATOR, false);
  return requested && getRuntimeProfile() !== 'prod';
}

export function hasApiRole(role = getAppRole()): boolean {
  return role === 'all' || role === 'api';
}

export function hasGatewayRole(role = getAppRole()): boolean {
  return role === 'all' || role === 'gateway';
}

export function hasWorkerRole(role = getAppRole()): boolean {
  return role === 'all' || role === 'worker';
}

export function hasSchedulerRole(role = getAppRole()): boolean {
  return role === 'all' || role === 'scheduler';
}

export function hasControlPlaneRole(role = getAppRole()): boolean {
  return hasApiRole(role) || hasGatewayRole(role) || hasWorkerRole(role) || hasSchedulerRole(role);
}

export function getRuntimeDescriptor() {
  const role = getAppRole();
  return {
    role,
    profile: getRuntimeProfile(),
    dbMode: getDatabaseMode(),
    artifactStore: getArtifactStoreMode(),
    sqliteFallbackEnabled: isSqliteFallbackEnabled(),
    emulatorEnabled: isRuntimeEmulatorEnabled(),
    apiEnabled: hasApiRole(role),
    gatewayEnabled: hasGatewayRole(role),
    workerEnabled: hasWorkerRole(role),
    schedulerEnabled: hasSchedulerRole(role)
  };
}
