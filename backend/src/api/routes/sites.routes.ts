import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
    res.json([
        { id: 1, domain: 'api.example.com', status: 'secure' },
        { id: 2, domain: 'admin.example.com', status: 'warning' },
    ]);
});

export default router;
