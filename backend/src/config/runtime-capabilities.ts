import { getDatabaseMode, getRuntimeProfile } from './platform-runtime';

export function isDevLoginPresetEnabled(): boolean {
  return process.env.ENABLE_DEV_LOGIN_PRESETS === 'true' && getRuntimeProfile() !== 'prod';
}

export function getRuntimeCapabilities() {
  return {
    devLoginEnabled: isDevLoginPresetEnabled(),
    profile: getRuntimeProfile(),
    dbMode: getDatabaseMode()
  };
}
