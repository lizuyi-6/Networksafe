/**
 * FluxGuard Control Platform - Main Entry Point
 * 
 * 中央管控平台服务器
 * - 接收 Agent 连接和心跳
 * - 提供管理 API
 * - 推送告警到 Dashboard
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
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
import scannerRouter from './api/routes/scanner.routes';
import smartFixRouter from './api/routes/smart-fix.routes';
import deploymentsRouter from './api/routes/deployments.routes';
import agentsRouter, { setAgentGateway } from './api/routes/agents.routes';
import devicesRouter from './api/routes/devices.routes';
import aiEndpointsRouter from './api/routes/ai-endpoints.routes';
import authRouter from './api/routes/auth.routes';
import attackRoutes from './api/routes/attack.routes';
import aiSystemRouter, { initializeAgentSystem, setAgentGateway as setAISystemAgentGateway } from './api/routes/ai-system.routes';
import trafficRouter from './api/routes/traffic.routes';
import alertsRouter from './api/routes/alerts.routes';
import systemRouter from './api/routes/system.routes';
import agentOnboardingRouter from './api/routes/agent-onboarding.routes';
import dashboardRouter from './api/routes/dashboard.routes';
import fixHistoryRouter from './api/routes/fix-history.routes';
import { isDemoAutoSeedEnabled } from './config/app-mode';
import { getRuntimeDescriptor } from './config/platform-runtime';
import { scannerTaskService } from './services/scanner-task.service';
import { runtimeEmulatorService } from './services/runtime-emulator.service';
import { commandDispatcherService } from './services/command-dispatcher.service';
import { artifactStoreService } from './services/artifact-store.service';
import { jobQueueService } from './services/job-queue.service';
import { postgresShadowStoreService } from './services/postgres-shadow-store.service';
import { getDeviceById, executeDeviceCommandInternal } from './api/routes/devices.routes';

// Initialize Express
const app = express();
const httpServer = createServer(app);
const runtime = getRuntimeDescriptor();

// Agent Gateway (WebSocket)
let agentGateway: AgentGateway | null = null;
let deviceGateway: DeviceGateway | null = null;

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
      // Return proper error instead of throwing to avoid 500
      return callback(null, false);
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

// Cookie 解析
app.use(cookieParser());

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
  const shadow = postgresShadowStoreService.describe();
  const readSource = shadow.readModeActive ? 'postgres' : 'sqlite';
  const writeSource = runtime.dbMode === 'postgres' && shadow.connected ? 'postgres+sqlite-mirror' : 'sqlite';
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    mode: 'control-platform',
    agents: agentGateway?.getOnlineCount() || 0,
    runtime,
    dbPrimaryMode: runtime.dbMode,
    sqliteFallbackEnabled: runtime.sqliteFallbackEnabled,
    emulatorEnabled: runtime.emulatorEnabled,
    readSource,
    writeSource,
    queueBackend: jobQueueService.backend(),
    artifactStore: artifactStoreService.describe(),
    shadowStore: shadow,
    emulator: runtimeEmulatorService.describe()
  });
});

// 挂载路由
if (runtime.apiEnabled) {
  apiRouter.use('/stats', statsRoutes);
  apiRouter.use('/config', configRoutes);
  apiRouter.use('/logs', logsRoutes);
  apiRouter.use('/sites', sitesRoutes);
  apiRouter.use('/admin', adminRoutes);
  apiRouter.use('/scanner', scannerRouter);
  apiRouter.use('/smart-fix', smartFixRouter);
  apiRouter.use('/deployments', deploymentsRouter);
  apiRouter.use('/agents', agentsRouter);
  apiRouter.use('/devices', devicesRouter);
  apiRouter.use('/ai-endpoints', aiEndpointsRouter);
  apiRouter.use('/auth', authRouter);
  apiRouter.use('/ai-system', aiSystemRouter);
  apiRouter.use('/traffic', trafficRouter);
  apiRouter.use('/attack', attackRoutes);
  apiRouter.use('/alerts', alertsRouter);
  apiRouter.use('/system', systemRouter);
  apiRouter.use('/agent-onboarding', agentOnboardingRouter);
  apiRouter.use('/dashboard', dashboardRouter);
  apiRouter.use('/fix-history', fixHistoryRouter);
}

app.use('/api', apiRouter);

// 错误处理
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'backend.internal_server_error' });
});

// ============================================
// 服务器启动
// ============================================

async function start() {
  const PORT = process.env.PORT || 8080;

  try {
    // 初始化数据库
    await initDatabase();
    await postgresShadowStoreService.init();
    // Always bootstrap base data, seed demo data only in demo mode.
    const { bootstrapDatabase } = require('./database/init');
    await bootstrapDatabase();
    if (isDemoAutoSeedEnabled()) {
      const { seedDatabase } = require('./database/seeds/demo_data');
      await seedDatabase({ clearExisting: false, verbose: true });
    }
    await postgresShadowStoreService.backfillSnapshot();

    logger.info('Database initialized and seeded');

    if (runtime.gatewayEnabled) {
      // 初始化 Agent Gateway (WebSocket)
      agentGateway = new AgentGateway(httpServer);
      deviceGateway = new DeviceGateway(httpServer);
      deviceGateway.setDashboardBroadcaster((event, data) => {
        agentGateway?.broadcastToDashboards(event, data);
      });

      // 注入到路由
      setAgentGateway(agentGateway);
      setAISystemAgentGateway(agentGateway);
      commandDispatcherService.setAgentGateway(agentGateway);
      commandDispatcherService.setDeviceAdapter({
        getDevice: getDeviceById,
        executeCommand: executeDeviceCommandInternal
      });
      scannerTaskService.setBroadcaster((event, data) => {
        agentGateway?.broadcastToDashboards(event, data);
      });
      if (runtime.emulatorEnabled) {
        runtimeEmulatorService.start(agentGateway);
      } else {
        runtimeEmulatorService.stop();
      }
    } else {
      setAgentGateway(null);
      setAISystemAgentGateway(null as any);
      commandDispatcherService.setAgentGateway(null);
      commandDispatcherService.setDeviceAdapter(null);
      scannerTaskService.setBroadcaster(() => undefined);
    }

    if (runtime.workerEnabled) {
      await scannerTaskService.startWorker();
    }

    if (runtime.schedulerEnabled) {
      postgresShadowStoreService.startResyncLoop();
    }

    if (runtime.apiEnabled) {
      // 初始化多智能体系统
      try {
        await initializeAgentSystem();
        logger.info('Multi-Agent Decision System initialized');
      } catch (agentError: any) {
        logger.warn('Multi-Agent System initialization failed, continuing without AI agents', {
          error: agentError.message
        });
      }
    }

    // 启动 HTTP 服务器
    httpServer.listen(PORT, () => {
      logger.info(`FluxGuard Control Platform started`);
      logger.info(`API: http://localhost:${PORT}/api`);
      logger.info(`WebSocket: ws://localhost:${PORT}`);
      logger.info(`Dashboard: http://localhost:5173`);
      logger.info('Platform runtime descriptor', {
        runtime,
        queueBackend: jobQueueService.backend(),
        artifactStore: artifactStoreService.describe(),
        shadowStore: postgresShadowStoreService.describe()
      });
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
    scannerTaskService.stopWorker();

    if (agentGateway) {
      agentGateway.close();
    }
    if (deviceGateway) {
      deviceGateway.close();
    }
    runtimeEmulatorService.stop();

    httpServer.close();
    await postgresShadowStoreService.close();
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
