import { Router } from 'express';
import { authenticate, AuthenticatedRequest, optionalAuth, requireRole } from '../../middleware/auth.middleware';
import { requireStepUpScope } from '../../middleware/step-up.middleware';
import { getAppMode, setAppMode, isDemoMode, isAttackSimulatorEnabled, AppMode } from '../../config/app-mode';
import { sendError, sendSuccess } from '../../core/http/api-response';
import logger from '../../utils/logger';
import { getRuntimeCapabilities } from '../../config/runtime-capabilities';
import { allowDemoFeatures } from '../../config/enterprise-runtime';

const router = Router();

router.get('/mode', optionalAuth, (req: AuthenticatedRequest, res) => {
  const capabilities = getRuntimeCapabilities();
  if (!req.user) {
    const publicPayload = {
      passwordLoginEnabled: capabilities.passwordLoginEnabled,
      oidcEnabled: capabilities.oidcEnabled
    };
    return sendSuccess(res, publicPayload, { legacy: publicPayload });
  }

  const payload = {
    appMode: getAppMode(),
    demoEnabled: isDemoMode(),
    attackSimEnabled: isAttackSimulatorEnabled(),
    canToggleMode: allowDemoFeatures() && req.user?.role === 'platform_admin',
    devLoginEnabled: capabilities.devLoginEnabled,
    passwordLoginEnabled: capabilities.passwordLoginEnabled,
    oidcEnabled: capabilities.oidcEnabled,
    enterpriseRuntimeMode: capabilities.enterpriseRuntimeMode,
    demoModeAllowed: capabilities.demoModeAllowed,
    enterpriseStrictMode: capabilities.enterpriseStrictMode,
    profile: capabilities.profile,
    dbMode: capabilities.dbMode
  };
  return sendSuccess(res, payload, { legacy: payload });
});

router.post('/mode', authenticate, requireRole('admin'), requireStepUpScope({ action: 'system.mode_change' }), async (req: AuthenticatedRequest, res) => {
  const { appMode, seedDemoData = false, clearExisting = false } = req.body || {};
  const targetMode = appMode as AppMode;

  if (targetMode !== 'production' && targetMode !== 'demo') {
    return sendError(res, 400, {
      code: 'backend.invalid_app_mode',
      message: 'appMode must be either "production" or "demo".'
    });
  }

  const previousMode = getAppMode();
  const capabilities = getRuntimeCapabilities();
  if (targetMode === 'demo' && !allowDemoFeatures()) {
    return sendError(res, 403, {
      code: 'backend.demo_mode_disabled_in_enterprise_runtime',
      message: 'Demo mode is disabled in the current enterprise runtime mode.'
    });
  }
  if (previousMode === targetMode) {
    const payload = {
      appMode: getAppMode(),
      demoEnabled: isDemoMode(),
      attackSimEnabled: isAttackSimulatorEnabled(),
      seeded: false,
      devLoginEnabled: capabilities.devLoginEnabled,
      profile: capabilities.profile,
      dbMode: capabilities.dbMode
    };
    return sendSuccess(res, payload, { legacy: payload });
  }

  try {
    setAppMode(targetMode);

    logger.info('App mode switched', {
      from: previousMode,
      to: targetMode,
      userId: req.user?.userId,
      seedDemoData,
      clearExisting,
      isolatedDemoReadPath: true
    });

    const payload = {
      appMode: getAppMode(),
      demoEnabled: isDemoMode(),
      attackSimEnabled: isAttackSimulatorEnabled(),
      seeded: false,
      devLoginEnabled: capabilities.devLoginEnabled,
      profile: capabilities.profile,
      dbMode: capabilities.dbMode
    };
    return sendSuccess(res, payload, { legacy: payload });
  } catch (error: any) {
    setAppMode(previousMode);
    logger.error('Failed to switch app mode', {
      from: previousMode,
      to: targetMode,
      userId: req.user?.userId,
      error: error.message
    });
    return sendError(res, 500, {
      code: 'backend.switch_app_mode_failed',
      message: error.message
    });
  }
});

export default router;
