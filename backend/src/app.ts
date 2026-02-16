import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { defaultConfig as config } from './config';
import { InputValidator } from './security/input-validator';
import logger from './utils/logger';
import { apiRateLimit } from './middleware/rate-limit.middleware';
import { requestTimingMiddleware } from './middleware/auth.middleware';

// Import Routes
import statsRoutes from './api/routes/stats.routes';
import configRoutes from './api/routes/config.routes';
import logsRoutes from './api/routes/logs.routes';
import sitesRoutes from './api/routes/sites.routes';
import adminRoutes from './api/routes/admin.routes';
import authRoutes from './api/routes/auth.routes';
import aiSystemRoutes, { initializeAgentSystem } from './routes/ai-system';
import investigationRoutes from './api/routes/investigation.routes';
import agentOnboardingRoutes from './api/routes/agent-onboarding.routes';

const app = express();
const inputValidator = new InputValidator();

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
        // SECURITY FIX: Production environment requires origin header
        if (!origin && process.env.NODE_ENV === 'production') {
            logger.warn('Blocked request without Origin header in production');
            return callback(new Error('Origin header required'));
        }
        // Allow no-origin requests in development (Postman, curl, etc.)
        if (!origin && process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }

        if (allowedOrigins.includes(origin!)) {
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

// Request timing middleware - track request processing time
app.use(requestTimingMiddleware);

// 2. 请求体大小限制 (防止大请求攻击)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// SECURITY FIX: Parse cookies for httpOnly token authentication
app.use(cookieParser());

// 3. 安全 HTTP 头 (手动实现，或安装 helmet)
app.use((req, res, next) => {
    // 防止点击劫持
    res.setHeader('X-Frame-Options', 'DENY');
    // 防止 MIME 类型嗅探
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // SECURITY FIX: Replace deprecated X-XSS-Protection with CSP
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';");
    // 隐藏服务器信息
    res.removeHeader('X-Powered-By');
    // HSTS (仅 HTTPS)
    if (req.secure) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// SECURITY FIX: Global input validation middleware
app.use((req, res, next) => {
    // Skip validation for certain paths (health check, static assets, auth routes)
    if (req.path === '/health' ||
        req.path.startsWith('/static') ||
        req.path.startsWith('/api/auth')) {
        return next();
    }

    const checkContent = [
        req.url,
        JSON.stringify(req.query),
        JSON.stringify(req.body)
    ].join(' ');

    const result = inputValidator.validateAll(checkContent);
    if (!result.isValid) {
        logger.warn('Input validation failed', {
            reason: result.reason,
            ip: req.ip,
            path: req.path,
            threatLevel: result.threatLevel
        });
        return res.status(400).json({
            error: 'Invalid input detected',
            code: 'INPUT_VALIDATION_FAILED'
        });
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

// 5. Apply rate limiting to all API routes
// SECURITY FIX RISK-001: Comprehensive rate limiting for all endpoints
app.use('/api/', apiRateLimit);

// Routes
app.use('/api/stats', statsRoutes);
app.use('/api/config', configRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', aiSystemRoutes);
app.use('/api/investigation', investigationRoutes);
app.use('/api/agent-onboarding', agentOnboardingRoutes);

export { initializeAgentSystem };

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
