export type AppMode = 'production' | 'demo';

const normalizeMode = (value?: string): AppMode => {
  if (value?.toLowerCase() === 'demo') {
    return 'demo';
  }
  return 'production';
};

export const APP_MODE: AppMode = normalizeMode(process.env.APP_MODE);

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
