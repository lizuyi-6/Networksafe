import { allowDemoFeatures } from './enterprise-runtime';

export type AppMode = 'production' | 'demo';

const normalizeMode = (value?: string): AppMode => {
  if (value?.toLowerCase() === 'demo' && allowDemoFeatures()) {
    return 'demo';
  }
  return 'production';
};

const INITIAL_APP_MODE: AppMode = normalizeMode(process.env.APP_MODE);
export let APP_MODE: AppMode = INITIAL_APP_MODE;

export const getAppMode = (): AppMode => APP_MODE;

export const setAppMode = (mode: AppMode): AppMode => {
  APP_MODE = mode === 'demo' && !allowDemoFeatures() ? 'production' : mode;
  return APP_MODE;
};

export const isDemoMode = (): boolean => APP_MODE === 'demo';

export const isAttackSimulatorEnabled = (): boolean => {
  // Strict separation: attack simulator is only allowed in demo mode.
  if (!isDemoMode()) return false;
  return process.env.ENABLE_ATTACK_SIM === 'true';
};

export const isDemoAutoSeedEnabled = (): boolean => {
  if (!isDemoMode()) return false;
  return process.env.DEMO_AUTO_SEED === 'true';
};
