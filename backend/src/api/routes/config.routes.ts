import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

const router = Router();

router.get('/', authenticate, (req, res) => {
    // Mock config
    res.json({
        antiBot: {
            enabled: true,
            requestThreshold: 100,
            fastRequestThreshold: 10,
            blockDuration: 3600,
        },
        rateLimit: {
            requestsPerMinute: 60,
            windowSeconds: 60,
        },
    });
});

router.post('/', authenticate, requireRole('admin'), (req, res) => {
    // Mock save
    res.json({ success: true, message: 'backend.configuration_saved' });
});

export default router;
