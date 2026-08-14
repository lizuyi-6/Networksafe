import { getSessionUserKey } from '../services/session-cache';

export type AppMode = 'production' | 'demo';

let runtimeDemoMode = false;
const LEGACY_DEMO_MODE_KEY = 'demo_mode';
const DEMO_MODE_KEY_PREFIX = 'demo-mode:';

const normalizeUserKey = (value?: string | null): string | null => {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
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

/**
 * SECURITY (audit 2026-08, FE-001): demo mode must be a build-time opt-in.
 * Previously this was hardcoded `true`, which meant every production build
 * shipped with a toggle that reroutes device commands (and demo-mode data
 * feeds) to simulated success — an operator-deception surface. Demo stays
 * available only when the build explicitly enables it:
 *   - VITE_APP_MODE=demo (whole-app demo build), or
 *   - VITE_ENABLE_DEMO_MODE=true (per-build toggle enablement)
 */
export const canUseDemoMode = (): boolean =>
    envAppMode() === 'demo' || import.meta.env.VITE_ENABLE_DEMO_MODE === 'true';

export const getCurrentDemoUserKey = (): string | null => {
  return normalizeUserKey(getSessionUserKey());
};

export const getStoredDemoMode = (userKey?: string | null): boolean => {
  if (typeof window === 'undefined') return false;
  // FE-001: a stale localStorage flag must not resurrect demo mode in a
  // build where demo is disabled.
  if (!canUseDemoMode()) return false;

  const resolvedUserKey = normalizeUserKey(userKey ?? getCurrentDemoUserKey());
  if (!resolvedUserKey) return false;

  migrateLegacyDemoMode(resolvedUserKey);
  return localStorage.getItem(getScopedDemoKey(resolvedUserKey)) === 'true';
};

export const setStoredDemoMode = (enabled: boolean, userKey?: string | null): void => {
  if (typeof window === 'undefined') return;
  if (!canUseDemoMode()) return;

  const resolvedUserKey = normalizeUserKey(userKey ?? getCurrentDemoUserKey());
  if (!resolvedUserKey) return;

  migrateLegacyDemoMode(resolvedUserKey);
  localStorage.setItem(getScopedDemoKey(resolvedUserKey), String(enabled));
};

export const setRuntimeDemoMode = (enabled: boolean): void => {
  runtimeDemoMode = enabled && canUseDemoMode();
};

export const isDemoModeActive = (): boolean => runtimeDemoMode;
