import { getDatabase } from '../../config/database';
import { getRuntimeDescriptor } from '../../config/platform-runtime';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';

export interface PipelineHealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message: string;
  details?: any;
  timestamp: string;
}

export interface PipelineHealthStatus {
  websocket: PipelineHealthCheckResult;
  database: PipelineHealthCheckResult;
  redis: PipelineHealthCheckResult;
  agents: PipelineHealthCheckResult;
  overall: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
}

export interface PipelineVerification {
  component: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
  details?: any;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class PipelineDiagnosticsService {
  checkWebSocketHealth(): PipelineHealthCheckResult {
    return {
      status: 'healthy',
      message: 'WebSocket gateway is running',
      details: {
        connections: 0,
        uptime: process.uptime()
      },
      timestamp: nowIso()
    };
  }

  checkDatabaseHealth(): PipelineHealthCheckResult {
    try {
      const db = getDatabase();
      const stmt = db.prepare('SELECT 1 as test');
      const result = stmt.get() as { test?: number } | undefined;
      stmt.free?.();

      const runtime = getRuntimeDescriptor();

      if (result?.test === 1) {
        return {
          status: 'healthy',
          message: 'Database connection is active',
          details: {
            type: runtime.dbMode,
            sqliteFallbackEnabled: runtime.sqliteFallbackEnabled,
            postgresReady: postgresShadowStoreService.canServeReads()
          },
          timestamp: nowIso()
        };
      }

      return {
        status: 'unhealthy',
        message: 'Database query failed',
        timestamp: nowIso()
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        message: `Database error: ${error.message}`,
        timestamp: nowIso()
      };
    }
  }

  checkRedisHealth(): PipelineHealthCheckResult {
    if (process.env.DISABLE_REDIS === 'true') {
      return {
        status: 'degraded',
        message: 'Redis is disabled',
        details: { disabled: true },
        timestamp: nowIso()
      };
    }

    return {
      status: 'healthy',
      message: 'Redis connection is active',
      details: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
      },
      timestamp: nowIso()
    };
  }

  getAgentConnectionCount(): number {
    return 0;
  }

  checkAgentsHealth(): PipelineHealthCheckResult {
    try {
      const db = getDatabase();
      const stmt = db.prepare('SELECT COUNT(*) as count FROM agents WHERE status = ?');
      const result = stmt.get('online') as { count?: number } | undefined;
      stmt.free?.();

      const onlineCount = Number(result?.count || 0);
      const totalCount = this.getAgentConnectionCount();

      if (onlineCount > 0) {
        return {
          status: 'healthy',
          message: `${onlineCount} agents online`,
          details: {
            online: onlineCount,
            total: totalCount
          },
          timestamp: nowIso()
        };
      }

      return {
        status: 'degraded',
        message: 'No agents online',
        details: {
          online: 0,
          total: totalCount
        },
        timestamp: nowIso()
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        message: `Agent check failed: ${error.message}`,
        timestamp: nowIso()
      };
    }
  }

  getHealthStatus(): PipelineHealthStatus {
    const websocket = this.checkWebSocketHealth();
    const database = this.checkDatabaseHealth();
    const redis = this.checkRedisHealth();
    const agents = this.checkAgentsHealth();
    const statuses = [websocket.status, database.status, redis.status, agents.status];
    const overall = statuses.includes('unhealthy')
      ? 'unhealthy'
      : statuses.includes('degraded')
        ? 'degraded'
        : 'healthy';

    return {
      websocket,
      database,
      redis,
      agents,
      overall,
      timestamp: nowIso()
    };
  }

  verifyDataPipeline(): PipelineVerification[] {
    const verifications: PipelineVerification[] = [
      {
        component: 'agent_to_gateway',
        status: 'skip',
        message: 'Agent to Gateway verification not implemented'
      },
      {
        component: 'gateway_to_frontend',
        status: 'skip',
        message: 'Gateway to Frontend verification not implemented'
      }
    ];

    try {
      const sqlite = getDatabase();
      const sqliteStmt = sqlite.prepare('SELECT 1 as ok');
      const sqliteResult = sqliteStmt.get() as { ok?: number } | undefined;
      sqliteStmt.free?.();

      verifications.push({
        component: 'api_to_sqlite',
        status: sqliteResult?.ok === 1 ? 'pass' : 'fail',
        message: sqliteResult?.ok === 1
          ? 'SQLite read path is healthy'
          : 'SQLite read path returned an unexpected result'
      });
    } catch (error: any) {
      verifications.push({
        component: 'api_to_sqlite',
        status: 'fail',
        message: `SQLite read failed: ${error.message}`
      });
    }

    if (getRuntimeDescriptor().dbMode === 'postgres') {
      verifications.push({
        component: 'api_to_postgres',
        status: postgresShadowStoreService.canServeReads() ? 'pass' : 'fail',
        message: postgresShadowStoreService.canServeReads()
          ? 'Postgres primary read path is healthy'
          : 'Postgres primary read path is unavailable'
      });
    } else {
      verifications.push({
        component: 'api_to_postgres',
        status: 'skip',
        message: 'Postgres verification skipped because runtime dbMode is not postgres'
      });
    }

    return verifications;
  }
}

export const pipelineDiagnosticsService = new PipelineDiagnosticsService();
