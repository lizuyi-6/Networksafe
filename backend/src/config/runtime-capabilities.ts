import { getDatabaseMode, getRuntimeProfile } from './platform-runtime';
import {
  allowDemoFeatures,
  allowPasswordLogin,
  getEnterpriseRuntimeMode,
  isEnterpriseStrictMode,
  oidcEnabled
} from './enterprise-runtime';

export function isDevLoginPresetEnabled(): boolean {
  return process.env.ENABLE_DEV_LOGIN_PRESETS === 'true'
    && getRuntimeProfile() !== 'prod'
    && allowDemoFeatures();
}

export function getRuntimeCapabilities() {
  return {
    devLoginEnabled: isDevLoginPresetEnabled(),
    passwordLoginEnabled: allowPasswordLogin(),
    oidcEnabled: oidcEnabled(),
    enterpriseRuntimeMode: getEnterpriseRuntimeMode(),
    demoModeAllowed: allowDemoFeatures(),
    enterpriseStrictMode: isEnterpriseStrictMode(),
    profile: getRuntimeProfile(),
    dbMode: getDatabaseMode()
  };
}
