import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { requestTimingMiddleware } from '../middleware/auth.middleware';
import { apiRateLimit } from '../middleware/rate-limit.middleware';
import { apiTrafficShadowMiddleware } from '../middleware/api-traffic-shadow.middleware';
import logger from '../utils/logger';
import { sendError, sendSuccess } from '../core/http/api-response';
import { buildRuntimeHealthSnapshot } from '../core/health/runtime-health';

import statsRoutes from '../api/routes/stats.routes';
import configRoutes from '../api/routes/config.routes';
import logsRoutes from '../api/routes/logs.routes';
import { addLog } from '../services/log-state.service';
import { recordApiRequest } from '../services/api-request-tracker.service';
import sitesRoutes from '../api/routes/sites.routes';
import adminRoutes from '../api/routes/admin.routes';
import scannerRouter from '../api/routes/scanner.routes';
import smartFixRouter from '../api/routes/smart-fix.routes';
import deploymentsRouter from '../api/routes/deployments.routes';
import agentsRouter from '../api/routes/agents.routes';
import devicesRouter from '../api/routes/devices.routes';
import hardwareAuthorizationRouter from '../api/routes/hardware-authorization.routes';
import aiEndpointsRouter from '../api/routes/ai-endpoints.routes';
import authRouter from '../api/routes/auth.routes';
import attackRoutes from '../api/routes/attack.routes';
import aiSystemRouter from '../api/routes/ai-system.routes';
import trafficRouter from '../api/routes/traffic.routes';
import alertsRouter from '../api/routes/alerts.routes';
import systemRouter from '../api/routes/system.routes';
import agentOnboardingRouter from '../api/routes/agent-onboarding.routes';
import dashboardRouter from '../api/routes/dashboard.routes';
import fixHistoryRouter from '../api/routes/fix-history.routes';
import investigationRoutes from '../api/routes/investigation.routes';
import seedRoutes from '../api/routes/seed.routes';
import pipelineRoutes from '../api/routes/pipeline.routes';
import rulesRoutes from '../api/routes/rules.routes';
import announcementsAdminRoutes from '../modules/announcements/announcements.routes';
import { listPublishedAnnouncements } from '../modules/announcements/announcements.repository';

interface CreateControlPlaneAppOptions {
  runtime: Record<string, any> & { profile: 'prod' | 'dev' | 'demo'; dbMode: string; sqliteFallbackEnabled: boolean; };
  getAgentCount: () => number;
}

function buildAllowedOrigins(): string[] {
  return process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1:8080'
  ];
}

async function respondWithHealthSnapshot(
  res: express.Response,
  options: CreateControlPlaneAppOptions
): Promise<void> {
  const snapshot = await buildRuntimeHealthSnapshot({
    runtime: options.runtime,
    agentCount: options.getAgentCount()
  });

  sendSuccess(
    res,
    snapshot,
    {
      legacy: {
        status: snapshot.status,
        timestamp: snapshot.liveness.timestamp,
        runtime: snapshot.runtime,
        agents: snapshot.agents,
        queueBackend: snapshot.queueBackend,
        emulator: snapshot.emulator
      }
    },
    snapshot.readiness.status === 'ready' ? 200 : 503
  );
}

export function createControlPlaneApp(options: CreateControlPlaneAppOptions): express.Express {
  const app = express();
  const allowedOrigins = buildAllowedOrigins();

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      logger.warn(`Blocked CORS request from: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400,
  }));

  app.use(helmet({
    contentSecurityPolicy: false,
  }));

  app.use(compression());
  app.use(cookieParser());
  app.use(requestTimingMiddleware);

  const captureRawBody = (req: express.Request, _res: express.Response, buffer: Buffer): void => {
    if (buffer.length > 0) {
      (req as any).rawBody = Buffer.from(buffer);
    }
  };

  app.use(express.json({ limit: '25mb', verify: captureRawBody }));
  app.use(express.urlencoded({ extended: true, limit: '1mb', verify: captureRawBody }));
  app.use(express.text({ type: 'text/*', limit: '1mb', verify: captureRawBody }));

  app.use((req, _res, next) => {
    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 50),
    });

    // Record request in live log stream
    // Skip repetitive polling endpoints to reduce noise
    const isPolling = /^\/api\/(stats|stats\/badges|logs|health)/.test(req.path);
    if (!isPolling) {
      const isAttack = /union|select|script|alert|whoami|passwd|etc\/|rm -rf|\.\.\//i.test(
        req.url + ' ' + JSON.stringify(req.body || {}).substring(0, 500)
      );
      addLog({
        type: isAttack ? 'attack' : 'request',
        level: isAttack ? 'WARN' : 'INFO',
        message: isAttack
          ? `Suspicious request detected: ${req.method} ${req.path}`
          : `${req.method} ${req.path}`,
        ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown',
        status: 200,
        method: req.method,
        path: req.path,
      });
    }

    next();
  });

  app.get('/health', (_req, res) => {
    const payload = {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
    sendSuccess(res, payload, { legacy: payload });
  });

  const apiRouter = express.Router();
  apiRouter.use(apiRateLimit);

  // Count every API request for dashboard stats
  apiRouter.use((_req, _res, next) => {
    recordApiRequest(false);
    next();
  });

  apiRouter.get('/health', async (_req, res) => {
    try {
      await respondWithHealthSnapshot(res, options);
    } catch (error: any) {
      sendError(res, 500, {
        code: 'backend.health_check_failed',
        message: error?.message || 'Health snapshot failed'
      });
    }
  });

  apiRouter.get('/health/live', (_req, res) => {
    const payload = {
      status: 'alive',
      timestamp: new Date().toISOString()
    };
    sendSuccess(res, payload, { legacy: payload });
  });

  apiRouter.get('/health/ready', async (_req, res) => {
    try {
      const snapshot = await buildRuntimeHealthSnapshot({
        runtime: options.runtime,
        agentCount: options.getAgentCount()
      });
      sendSuccess(
        res,
        snapshot.readiness,
        {
          legacy: {
            status: snapshot.readiness.status,
            blockers: snapshot.readiness.blockers
          }
        },
        snapshot.readiness.status === 'ready' ? 200 : 503
      );
    } catch (error: any) {
      sendError(res, 500, {
        code: 'backend.readiness_check_failed',
        message: error?.message || 'Readiness check failed'
      });
    }
  });

  apiRouter.get('/health/dependencies', async (_req, res) => {
    try {
      const snapshot = await buildRuntimeHealthSnapshot({
        runtime: options.runtime,
        agentCount: options.getAgentCount()
      });
      sendSuccess(res, snapshot.dependencies, { legacy: snapshot.dependencies });
    } catch (error: any) {
      sendError(res, 500, {
        code: 'backend.dependency_check_failed',
        message: error?.message || 'Dependency check failed'
      });
    }
  });

  if (options.runtime.apiEnabled) {
    apiRouter.use(apiTrafficShadowMiddleware);
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
    apiRouter.use('/', hardwareAuthorizationRouter);
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
    apiRouter.use('/investigation', investigationRoutes);
    apiRouter.use('/seed', seedRoutes);
    apiRouter.use('/pipeline', pipelineRoutes);
    apiRouter.use('/rules', rulesRoutes);

    // Announcements admin routes (CRUD, publish, archive)
    apiRouter.use('/admin', announcementsAdminRoutes);

    // Public announcements endpoint (no auth required)
    apiRouter.get('/announcements', async (_req, res) => {
      try {
        const announcements = listPublishedAnnouncements();
        return sendSuccess(res, announcements || []);
      } catch (error: any) {
        return sendError(res, 500, { code: 'ANNOUNCEMENTS_LIST_FAILED', message: error?.message || 'backend.failed_to_list_announcements' });
      }
    });
  }

  app.use('/api', apiRouter);

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    sendError(res, 500, {
      code: 'backend.internal_server_error',
      message: 'backend.internal_server_error'
    });
  });

  return app;
}
