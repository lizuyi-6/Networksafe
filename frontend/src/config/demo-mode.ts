export type AppMode = 'production' | 'demo';

let runtimeDemoMode = false;
const LEGACY_DEMO_MODE_KEY = 'demo_mode';
const DEMO_MODE_KEY_PREFIX = 'demo-mode:';

type StoredUser = {
  email?: string;
  userId?: string;
  id?: string;
  username?: string;
};

const normalizeUserKey = (value?: string | null): string | null => {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
};

const getStoredUser = (): StoredUser | null => {
  if (typeof window === 'undefined') return null;

  const rawUser = localStorage.getItem('user');
  if (!rawUser) return null;

  try {
    return JSON.parse(rawUser) as StoredUser;
  } catch {
    return null;
  }
};

const getScopedDemoKey = (userKey: string): string => `${DEMO_MODE_KEY_PREFIX}${userKey}`;

const migrateLegacyDemoMode = (userKey: string): void => {
  if (typeof window === 'undefined') return;

  const legacyValue = localStorage.getItem(LEGACY_DEMO_MODE_KEY);
  if (legacyValue === null) return;

  const scopedKey = getScopedDemoKey(userKey);
  if (localStorage.getItem(scopedKey) === null) {
    localStorage.setItem(scopedKey, legacyValue);
  }

  localStorage.removeItem(LEGACY_DEMO_MODE_KEY);
};

export const envAppMode = (): AppMode => {
  return import.meta.env.VITE_APP_MODE === 'demo' ? 'demo' : 'production';
};

export const canUseDemoMode = (): boolean => true;

export const getCurrentDemoUserKey = (): string | null => {
  const user = getStoredUser();
  return normalizeUserKey(user?.email || user?.userId || user?.id || user?.username || null);
};

export const getStoredDemoMode = (userKey?: string | null): boolean => {
  if (typeof window === 'undefined') return false;

  const resolvedUserKey = normalizeUserKey(userKey ?? getCurrentDemoUserKey());
  if (!resolvedUserKey) return false;

  migrateLegacyDemoMode(resolvedUserKey);
  return localStorage.getItem(getScopedDemoKey(resolvedUserKey)) === 'true';
};

export const setStoredDemoMode = (enabled: boolean, userKey?: string | null): void => {
  if (typeof window === 'undefined') return;

  const resolvedUserKey = normalizeUserKey(userKey ?? getCurrentDemoUserKey());
  if (!resolvedUserKey) return;

  migrateLegacyDemoMode(resolvedUserKey);
  localStorage.setItem(getScopedDemoKey(resolvedUserKey), String(enabled));
};

export const setRuntimeDemoMode = (enabled: boolean): void => {
  runtimeDemoMode = enabled;
};

export const isDemoModeActive = (): boolean => runtimeDemoMode;
