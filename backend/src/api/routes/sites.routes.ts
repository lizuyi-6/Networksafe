import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware';

const router = Router();

/**
 * GET /api/sites/
 * 获取站点列表
 *
 * 🔒 SECURITY: 需要认证（修复 CVE-2024-XXXX）
 * 之前: 无认证，任何人都可以访问
 * 修复后: 需要有效的 JWT Token 或 API Key
 */
router.get('/', authenticate, (req: AuthenticatedRequest, res: Response) => {
    // 实际应用中应该从数据库查询，并根据用户租户 ID 过滤
    // 这里返回模拟数据用于演示
    res.json([
        { id: 1, domain: 'api.example.com', status: 'secure' },
        { id: 2, domain: 'admin.example.com', status: 'warning' },
    ]);
});

export default router;
