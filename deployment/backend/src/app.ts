import express from 'express';
import cors from 'cors';
import { defaultConfig as config } from './config';
import logger from './utils/logger';

// Import Routes
import statsRoutes from './api/routes/stats.routes';
import configRoutes from './api/routes/config.routes';
import logsRoutes from './api/routes/logs.routes';
import sitesRoutes from './api/routes/sites.routes';
import adminRoutes from './api/routes/admin.routes';

const app = express();

// ============================================
// 安全中间件配置 (符合 OWASP 规范)
// ============================================

// 1. CORS 配置 - 限制允许的源
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://localhost:5173',
];

app.use(cors({
    origin: (origin, callback) => {
        // 允许无 origin 的请求（如服务器间请求）
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            logger.warn(`Blocked CORS request from: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400, // 预检请求缓存 24 小时
}));

// 2. 请求体大小限制 (防止大请求攻击)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 3. 安全 HTTP 头 (手动实现，或安装 helmet)
app.use((req, res, next) => {
    // 防止点击劫持
    res.setHeader('X-Frame-Options', 'DENY');
    // 防止 MIME 类型嗅探
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // XSS 过滤
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // 隐藏服务器信息
    res.removeHeader('X-Powered-By');
    // HSTS (仅 HTTPS)
    if (req.secure) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// 4. 请求日志
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.headers['user-agent']?.substring(0, 50),
    });
    next();
});

// Routes
app.use('/api/stats', statsRoutes);
app.use('/api/config', configRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    // 不暴露错误详情给客户端
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal Server Error' });
});

export default app;
