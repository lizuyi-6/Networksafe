import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { APP_MODE, isDemoMode, isAttackSimulatorEnabled } from '../../config/app-mode';

const router = Router();

router.get('/mode', authenticate, (_req, res) => {
  res.json({
    appMode: APP_MODE,
    demoEnabled: isDemoMode(),
    attackSimEnabled: isAttackSimulatorEnabled()
  });
});

export default router;

