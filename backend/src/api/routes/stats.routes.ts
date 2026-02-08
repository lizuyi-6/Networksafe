/**
 * Stats Routes
 * SECURITY FIX CVE-2026-039: Added authentication middleware
 */
import { Router } from 'express';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.middleware';
import simulationService from '../../services/simulation.service';

const router = Router();

// SECURITY FIX CVE-2026-039: Apply authentication
router.use(authenticate);

router.get('/', (req: AuthenticatedRequest, res) => {
    res.json(simulationService.getStats());
});

export default router;
