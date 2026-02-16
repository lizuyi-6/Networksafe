export type AppMode = 'production' | 'demo';

let runtimeDemoMode = false;

export const envAppMode = (): AppMode => {
  return import.meta.env.VITE_APP_MODE === 'demo' ? 'demo' : 'production';
};

export const canUseDemoMode = (): boolean => envAppMode() === 'demo';

export const getStoredDemoMode = (): boolean => {
  if (!canUseDemoMode()) return false;
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('demo_mode') === 'true';
};

export const setStoredDemoMode = (enabled: boolean): void => {
  if (!canUseDemoMode()) return;
  if (typeof window === 'undefined') return;
  localStorage.setItem('demo_mode', String(enabled));
};

export const setRuntimeDemoMode = (enabled: boolean): void => {
  runtimeDemoMode = canUseDemoMode() ? enabled : false;
};

export const isDemoModeActive = (): boolean => runtimeDemoMode;
