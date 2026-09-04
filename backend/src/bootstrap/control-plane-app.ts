import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { authenticate, optionalAuth, requestTimingMiddleware } from '../middleware/auth.middleware';
import { apiRateLimit } from '../middleware/rate-limit.middleware';
import { apiTrafficShadowMiddleware } from '../middleware/api-traffic-shadow.middleware';
import { metricsMiddleware } from '../middleware/metrics.middleware';
import {
  preParsePrototypePollutionGuard,
  postParsePrototypePollutionGuard
} from '../middleware/prototype-pollution-guard.middleware';
import logger from '../utils/logger';
import { sendError, sendSuccess } from '../core/http/api-response';
import { buildRuntimeHealthSnapshot } from '../core/health/runtime-health';

import statsRoutes from '../api/routes/stats.routes';
import configRoutes from '../api/routes/config.routes';
import logsRoutes from '../api/routes/logs.routes';
import { addLog } from '../services/log-state.service';
import sitesRoutes from '../api/routes/sites.routes';
import adminRoutes from '../api/routes/admin.routes';
import scannerRouter from '../api/routes/scanner.routes';
import smartFixRouter from '../api/routes/smart-fix.routes';
import deploymentsRouter from '../api/routes/deployments.routes';
import agentsRouter from '../api/routes/agents.routes';
import devicesRouter from '../api/routes/devices.routes';
import finalDefenseRouter from '../api/routes/final-defense.routes';
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
import enterpriseHelperRoutes from '../api/routes/enterprise-helper.routes';
import announcementsAdminRoutes from '../modules/announcements/announcements.routes';
import { listPublishedAnnouncements } from '../modules/announcements/announcements.repository';
import { buildAllowedOrigins } from './allowed-origins';

export { buildAllowedOrigins } from './allowed-origins';

interface CreateControlPlaneAppOptions {
  runtime: Record<string, any> & { profile: 'prod' | 'dev' | 'demo'; dbMode: string; sqliteFallbackEnabled: boolean; };
  getAgentCount: () => number;
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
  // Trust exactly one configured reverse-proxy hop when explicitly enabled.
  // The default remains fail-safe (no forwarded-header trust), so an exposed
  // backend cannot let clients forge the IP used by rate limiting and the
  // step-up risk signal.
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
  const allowedOrigins = buildAllowedOrigins();

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      if (origin === 'null') {
        logger.warn('Blocked CORS request from null origin');
        return callback(null, false);
      }
      const normalizedOrigin = origin.trim().replace(/\/+$/, '');
      if (allowedOrigins.includes(normalizedOrigin)) {
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

  // SECURITY (R6 V1.6): Reject prototype-pollution attempts at the URL level
  // BEFORE the body parsers see them. Mounted at the app root so it covers
  // every route, including health checks.
  app.use(preParsePrototypePollutionGuard);

  // Observability: count and time every HTTP request, including 4xx/5xx and
  // pre-route rejections. Mounted before the body parsers so the latency
  // measurement starts as early as possible.
  app.use(metricsMiddleware);

  const captureRawBody = (req: express.Request, _res: express.Response, buffer: Buffer): void => {
    if (buffer.length > 0) {
      (req as any).rawBody = Buffer.from(buffer);
    }
  };

  // SECURITY (audit 2026-08, AUD-08-1): tiered body limits. The global
  // JSON cap drops to 1mb; only the firmware-upload route mounts a larger
  // parser (base64 artifact payloads). Everything else — auth, config,
  // detection ingest — refuses oversized bodies instead of paying for a
  // 25mb parse on every request.
  const FIRMWARE_UPLOAD_LIMIT = '30mb';
  app.use('/api/admin/devices/firmware', express.json({ limit: FIRMWARE_UPLOAD_LIMIT, verify: captureRawBody }));

  app.use(express.json({ limit: '1mb', verify: captureRawBody }));
  app.use(express.urlencoded({ extended: true, limit: '1mb', verify: captureRawBody }));
  app.use(express.text({ type: 'text/*', limit: '1mb', verify: captureRawBody }));

  // SECURITY (audit 2026-08, AUD-08-1): Origin gate for cookie-credentialed
  // state-changing requests (CSRF defense-in-depth on top of SameSite).
  // A browser ALWAYS sends Origin on cross-site writes; `origin: null`
  // (sandboxed/file:) and any origin outside the allowlist are rejected.
  // Non-browser clients (no Origin header) pass — they do not carry
  // ambient cookie authority by construction.
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    const hasCookies = Boolean(req.headers.cookie);
    const origin = req.headers.origin;
    if (!hasCookies || !origin) {
      next();
      return;
    }
    const allowed = buildAllowedOrigins();
    if (allowed.includes('*') || allowed.includes(origin)) {
      next();
      return;
    }
    logger.warn('Blocked state-changing request with disallowed Origin', {
      origin,
      method: req.method,
      path: req.path
    });
    res.status(403).json({
      success: false,
      error: 'backend.origin_not_allowed'
    });
  });

  // SECURITY (R6 V1.6): Walk parsed body / query / params for prototype-
  // pollution keys (`__proto__`, `constructor`, `prototype`). Catches the
  // attack vector where JSON.parse surfaces an own `__proto__` property.
  app.use(postParsePrototypePollutionGuard);

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
    res.status(200).json({ status: 'ok' });
  });

  app.get('/health/live', (_req, res) => {
    res.status(200).json({ status: 'alive' });
  });

  app.get('/health/ready', async (_req, res) => {
    try {
      const snapshot = await buildRuntimeHealthSnapshot({
        runtime: options.runtime,
        agentCount: options.getAgentCount()
      });
      const statusCode = snapshot.readiness.status === 'ready' ? 200 : 503;
      res.status(statusCode).json({ status: snapshot.readiness.status });
    } catch {
      res.status(503).json({ status: 'not_ready' });
    }
  });

  const apiRouter = express.Router();
  apiRouter.use(apiRateLimit);

  apiRouter.get('/health', authenticate, async (_req, res) => {
    try {
      await respondWithHealthSnapshot(res, options);
    } catch (error: any) {
      sendError(res, 500, {
        code: 'backend.health_check_failed',
        message: error?.message || 'Health snapshot failed'
      });
    }
  });

  apiRouter.get('/health/live', authenticate, (_req, res) => {
    const payload = {
      status: 'alive',
      timestamp: new Date().toISOString()
    };
    sendSuccess(res, payload, { legacy: payload });
  });

  apiRouter.get('/health/ready', authenticate, async (_req, res) => {
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

  apiRouter.get('/health/dependencies', authenticate, async (_req, res) => {
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
    // Establish a tenant only from a fully revalidated JWT before shadow
    // persistence. Invalid or API-key-only requests remain in the anonymous
    // isolation domain until their route-specific authenticator runs.
    apiRouter.use(optionalAuth);
    // Authentication must run before traffic shadowing so anonymous stats
    // requests cannot be converted into dependency-driven 5xx responses.
    apiRouter.use('/stats', authenticate);
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
    apiRouter.use('/final-defense', finalDefenseRouter);
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
    apiRouter.use('/', enterpriseHelperRoutes);

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
    // AUD-08-1: body-parser overflows surface as 413 (Payload Too Large),
    // not a misleading 500.
    if (err?.type === 'entity.too.large' || err?.statusCode === 413) {
      sendError(res, 413, {
        code: 'backend.payload_too_large',
        message: 'backend.payload_too_large'
      });
      return;
    }
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    sendError(res, 500, {
      code: 'backend.internal_server_error',
      message: 'backend.internal_server_error'
    });
  });

  return app;
}
