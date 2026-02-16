import { Router } from 'express';
import { APP_MODE, isDemoMode, isAttackSimulatorEnabled } from '../../config/app-mode';

const router = Router();

router.get('/mode', (_req, res) => {
  res.json({
    appMode: APP_MODE,
    demoEnabled: isDemoMode(),
    attackSimEnabled: isAttackSimulatorEnabled()
  });
});

export default router;

