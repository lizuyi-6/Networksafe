import { Request, Response } from 'express';

export class AdminController {
    // 模拟用户错误数据
    static getErrors(req: Request, res: Response) {
        const errors = [
            { userId: 'user_001', errorCode: '10001', message: 'EACCES: permission denied', timestamp: new Date().toISOString() },
            { userId: 'user_002', errorCode: '11003', message: 'ENOENT: no such file or directory', timestamp: new Date().toISOString() },
            { userId: 'user_003', errorCode: '10001', message: 'EACCES: permission denied', timestamp: new Date().toISOString() },
        ];
        res.json(errors);
    }

    // 模拟系统性能数据
    static getPerformance(req: Request, res: Response) {
        const performance = {
            server: {
                cpu: Math.random() * 30 + 10,
                memory: Math.random() * 40 + 30,
            },
            clients: {
                total_agents: Math.floor(Math.random() * 50) + 10,
                avg_cpu_overhead: (Math.random() * 2 + 0.5).toFixed(2),
                avg_latency_added: `${(Math.random() * 5 + 1).toFixed(1)}ms`,
            },
        };
        res.json(performance);
    }

    // 接收日志的端点
    static submitLogs(req: Request, res: Response) {
        try {
            const { data } = req.body;

            if (!data) {
                return res.status(400).json({ error: '缺少数据' });
            }

            console.log('[ADMIN] 收到日志:', data);

            res.json({ success: true, message: '日志已接收' });
        } catch (error) {
            console.error('[ADMIN] 处理失败:', error);
            res.status(400).json({ error: '处理失败' });
        }
    }
}
