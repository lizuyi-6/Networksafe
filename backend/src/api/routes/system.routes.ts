import { Router } from 'express';
import { authenticate, AuthenticatedRequest, requireRole } from '../../middleware/auth.middleware';
import { getAppMode, setAppMode, isDemoMode, isAttackSimulatorEnabled, AppMode } from '../../config/app-mode';
import logger from '../../utils/logger';

const router = Router();

router.get('/mode', authenticate, (req: AuthenticatedRequest, res) => {
  res.json({
    appMode: getAppMode(),
    demoEnabled: isDemoMode(),
    attackSimEnabled: isAttackSimulatorEnabled(),
    canToggleMode: req.user?.role === 'admin'
  });
});

router.post('/mode', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  const { appMode, seedDemoData = false, clearExisting = false } = req.body || {};
  const targetMode = appMode as AppMode;

  if (targetMode !== 'production' && targetMode !== 'demo') {
    return res.status(400).json({
      success: false,
      error: 'backend.invalid_app_mode',
      message: 'appMode must be either "production" or "demo".'
    });
  }

  const previousMode = getAppMode();
  if (previousMode === targetMode) {
    return res.json({
      success: true,
      data: {
        appMode: getAppMode(),
        demoEnabled: isDemoMode(),
        attackSimEnabled: isAttackSimulatorEnabled(),
        seeded: false
      }
    });
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

    return res.json({
      success: true,
      data: {
        appMode: getAppMode(),
        demoEnabled: isDemoMode(),
        attackSimEnabled: isAttackSimulatorEnabled(),
        seeded: false
      }
    });
  } catch (error: any) {
    setAppMode(previousMode);
    logger.error('Failed to switch app mode', {
      from: previousMode,
      to: targetMode,
      userId: req.user?.userId,
      error: error.message
    });
    return res.status(500).json({
      success: false,
      error: 'backend.switch_app_mode_failed',
      message: error.message
    });
  }
});

export default router;
