import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

const router = Router();

// SECURITY FIX: All admin routes now require authentication and admin role
// 模拟用户错误数据
router.get('/errors', authenticate, requireRole('admin'), AdminController.getErrors);

// 模拟系统性能数据
router.get('/performance', authenticate, requireRole('admin'), AdminController.getPerformance);

// 接收日志的端点
router.post('/logs', authenticate, requireRole('admin'), AdminController.submitLogs);

export default router;

