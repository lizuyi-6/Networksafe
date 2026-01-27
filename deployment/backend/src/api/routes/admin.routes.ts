import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';

const router = Router();

// 模拟用户错误数据
router.get('/errors', AdminController.getErrors);

// 模拟系统性能数据
router.get('/performance', AdminController.getPerformance);

// 接收日志的端点
router.post('/logs', AdminController.submitLogs);

export default router;

