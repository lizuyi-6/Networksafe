/**
 * FluxGuard Control Platform - Main Entry Point
 * 
 * 中央管控平台服务器
 * - 接收 Agent 连接和心跳
 * - 提供管理 API
 * - 推送告警到 Dashboard
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';
import { initDatabase, closeDatabase } from './config/database';
import logger from './utils/logger';
import { AgentGateway } from './websocket/agent-gateway';
import { DeviceGateway } from './websocket/device-gateway';

// API Routes
import statsRoutes from './api/routes/stats.routes';
import configRoutes from './api/routes/config.routes';
import logsRoutes from './api/routes/logs.routes';
import sitesRoutes from './api/routes/sites.routes';
import adminRoutes from './api/routes/admin.routes';
import scannerRouter from './api/routes/scanner';
import agentsRouter, { setAgentGateway } from './api/routes/agents.routes';
import devicesRouter from './api/routes/devices.routes';
import aiEndpointsRouter from './api/routes/ai-endpoints.routes';

// Initialize Express
const app = express();
const httpServer = createServer(app);

// Agent Gateway (WebSocket)
let agentGateway: AgentGateway;
let deviceGateway: DeviceGateway;

// ============================================
// 安全中间件配置 (符合 OWASP 规范)
// ============================================

// CORS 配置
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://localhost:5173',
];

app.use(cors({
  origin: (origin, callback) => {
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
  maxAge: 86400,
}));

// 安全头
app.use(helmet({
  contentSecurityPolicy: false, // 允许 Dashboard 加载
}));

// 压缩
app.use(compression());

// 请求体解析
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 请求日志
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.headers['user-agent']?.substring(0, 50),
  });
  next();
});

// ============================================
// API 路由
// ============================================

const apiRouter = express.Router();

// Health check
apiRouter.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    mode: 'control-platform',
    agents: agentGateway?.getOnlineCount() || 0
  });
});

// 挂载路由
apiRouter.use('/stats', statsRoutes);
apiRouter.use('/config', configRoutes);
apiRouter.use('/logs', logsRoutes);
apiRouter.use('/sites', sitesRoutes);
apiRouter.use('/admin', adminRoutes);
apiRouter.use('/scanner', scannerRouter);
apiRouter.use('/agents', agentsRouter);
apiRouter.use('/devices', devicesRouter);
apiRouter.use('/ai-endpoints', aiEndpointsRouter);

app.use('/api', apiRouter);

// 错误处理
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal Server Error' });
});

// ============================================
// 服务器启动
// ============================================

async function start() {
  const PORT = process.env.PORT || 8080;

  try {
    // 初始化数据库
    await initDatabase();
    logger.info('Database initialized');

    // 初始化 Agent Gateway (WebSocket)
    agentGateway = new AgentGateway(httpServer);

    // 注入到路由
    setAgentGateway(agentGateway);

    // 启动 HTTP 服务器
    httpServer.listen(PORT, () => {
      logger.info(`FluxGuard Control Platform started`);
      logger.info(`API: http://localhost:${PORT}/api`);
      logger.info(`WebSocket: ws://localhost:${PORT}`);
      logger.info(`Dashboard: http://localhost:5173`);
    });

  } catch (error: any) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// ============================================
// 优雅关闭
// ============================================

async function shutdown() {
  logger.info('Shutting down...');

  try {
    if (agentGateway) {
      agentGateway.close();
    }

    httpServer.close();
    closeDatabase();

    logger.info('Shutdown complete');
  } catch (error: any) {
    logger.error('Error during shutdown', { error });
  }

  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// 启动应用
start().catch((error) => {
  logger.error('Fatal error', { error });
  process.exit(1);
});

// 导出用于测试
export default app;
export { agentGateway };
