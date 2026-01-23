import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
    // Mock logs
    res.json([
        {
            id: 1,
            time: new Date().toISOString(),
            type: 'ANTIBOT',
            level: 'WARN',
            message: 'Suspicious User-Agent detected: curl/7.68.0',
            ip: '192.168.1.100',
        },
        {
            id: 2,
            time: new Date(Date.now() - 15000).toISOString(),
            type: 'RATELIMIT',
            level: 'ERROR',
            message: 'Rate limit exceeded for user',
            ip: '10.0.0.55',
        }
    ]);
});

export default router;
