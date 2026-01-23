import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
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

router.post('/', (req, res) => {
    // Mock save
    res.json({ success: true, message: 'Configuration saved' });
});

export default router;
