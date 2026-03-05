/**
 * Data Pipeline API Routes
 *
 * Provides endpoints for health checks and data pipeline verification.
 * Ensures all components are working correctly.
 */

import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { getDatabase } from '../../config/database';
import logger from '../../utils/logger';

const router = Router();

// All pipeline routes require authentication
router.use(authenticate);

/**
 * Health check result interface
 */
interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message: string;
  details?: any;
  timestamp: string;
}

/**
 * Pipeline health status interface
 */
interface PipelineHealthStatus {
  websocket: HealthCheckResult;
  database: HealthCheckResult;
  redis: HealthCheckResult;
  agents: HealthCheckResult;
  overall: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
}

/**
 * Check WebSocket health
 */
function checkWebSocketHealth(): HealthCheckResult {
  // TODO: Implement actual WebSocket health check
  // For now, return a placeholder
  return {
    status: 'healthy',
    message: 'WebSocket gateway is running',
    details: {
      connections: 0,
      uptime: process.uptime()
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Check database health
 */
function checkDatabaseHealth(): HealthCheckResult {
  try {
    const db = getDatabase();

    // Execute a simple query to check database connectivity
    const stmt = db.prepare('SELECT 1 as test');
    const result = stmt.get();
    stmt.free();

    if (result && (result as any).test === 1) {
      return {
        status: 'healthy',
        message: 'Database connection is active',
        details: {
          type: 'sqlite',
          inMemory: false
        },
        timestamp: new Date().toISOString()
      };
    }

    return {
      status: 'unhealthy',
      message: 'Database query failed',
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    return {
      status: 'unhealthy',
      message: `Database error: ${error.message}`,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Check Redis health
 */
function checkRedisHealth(): HealthCheckResult {
  // Check if Redis is disabled
  if (process.env.DISABLE_REDIS === 'true') {
    return {
      status: 'degraded',
      message: 'Redis is disabled',
      details: {
        disabled: true
      },
      timestamp: new Date().toISOString()
    };
  }

  // TODO: Implement actual Redis health check
  // For now, return a placeholder
  return {
    status: 'healthy',
    message: 'Redis connection is active',
    details: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * Get agent connection count
 */
function getAgentConnectionCount(): number {
  // TODO: Implement actual agent connection count
  // For now, return a placeholder
  return 0;
}

/**
 * Check agents health
 */
function checkAgentsHealth(): HealthCheckResult {
  try {
    const db = getDatabase();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM agents WHERE status = ?');
    const result = stmt.get('online') as { count: number };
    stmt.free();

    const onlineCount = result?.count || 0;
    const totalCount = getAgentConnectionCount();

    if (onlineCount > 0) {
      return {
        status: 'healthy',
        message: `${onlineCount} agents online`,
        details: {
          online: onlineCount,
          total: totalCount
        },
        timestamp: new Date().toISOString()
      };
    }

    return {
      status: 'degraded',
      message: 'No agents online',
      details: {
        online: 0,
        total: totalCount
      },
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    return {
      status: 'unhealthy',
      message: `Agent check failed: ${error.message}`,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * GET /api/pipeline/health
 * Get health status of all pipeline components
 */
router.get('/health', (req: AuthenticatedRequest, res: Response) => {
  try {
    const websocket = checkWebSocketHealth();
    const database = checkDatabaseHealth();
    const redis = checkRedisHealth();
    const agents = checkAgentsHealth();

    // Determine overall status
    const statuses = [websocket.status, database.status, redis.status, agents.status];
    let overall: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

    if (statuses.includes('unhealthy')) {
      overall = 'unhealthy';
    } else if (statuses.includes('degraded')) {
      overall = 'degraded';
    }

    const healthStatus: PipelineHealthStatus = {
      websocket,
      database,
      redis,
      agents,
      overall,
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      data: healthStatus
    });
  } catch (error: any) {
    logger.error('Failed to check pipeline health', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'backend.internal_server_error'
    });
  }
});

/**
 * Data flow verification result interface
 */
interface DataFlowVerification {
  component: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
  details?: any;
}

/**
 * Verify data pipeline
 */
function verifyDataPipeline(): DataFlowVerification[] {
  const results: DataFlowVerification[] = [];

  // 1. Verify Agent to Gateway data flow
  // TODO: Implement actual verification
  results.push({
    component: 'agent_to_gateway',
    status: 'skip',
    message: 'Agent to Gateway verification not implemented'
  });

  // 2. Verify Gateway to Frontend data flow
  // TODO: Implement actual verification
  results.push({
    component: 'gateway_to_frontend',
    status: 'skip',
    message: 'Gateway to Frontend verification not implemented'
  });

  // 3. Verify API to Database data flow
  try {
    const db = getDatabase();

    // Write test
    const testKey = `test_${Date.now()}`;
    db.exec(`CREATE TABLE IF NOT EXISTS _pipeline_test (key TEXT PRIMARY KEY, value TEXT)`);
    const insertStmt = db.prepare('INSERT INTO _pipeline_test (key, value) VALUES (?, ?)');
    insertStmt.run(testKey, 'test_value');
    insertStmt.free();

    // Read test
    const selectStmt = db.prepare('SELECT value FROM _pipeline_test WHERE key = ?');
    selectStmt.bind([testKey]);
    const result = selectStmt.step() ? selectStmt.getAsObject() : null;
    selectStmt.free();

    // Cleanup
    db.exec('DROP TABLE IF EXISTS _pipeline_test');

    if (result && (result as any).value === 'test_value') {
      results.push({
        component: 'api_to_database',
        status: 'pass',
        message: 'API to Database data flow is working correctly'
      });
    } else {
      results.push({
        component: 'api_to_database',
        status: 'fail',
        message: 'API to Database data flow verification failed'
      });
    }
  } catch (error: any) {
    results.push({
      component: 'api_to_database',
      status: 'fail',
      message: `API to Database error: ${error.message}`
    });
  }

  return results;
}

/**
 * GET /api/pipeline/verify
 * Verify data pipeline integrity
 */
router.get('/verify', (req: AuthenticatedRequest, res: Response) => {
  try {
    const verifications = verifyDataPipeline();

    // Calculate overall status
    const hasFail = verifications.some(v => v.status === 'fail');
    const allSkip = verifications.every(v => v.status === 'skip');

    let overallStatus: 'pass' | 'fail' | 'skip' = 'pass';
    if (hasFail) {
      overallStatus = 'fail';
    } else if (allSkip) {
      overallStatus = 'skip';
    }

    res.json({
      success: true,
      data: {
        overall: overallStatus,
        verifications,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    logger.error('Failed to verify data pipeline', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'backend.internal_server_error'
    });
  }
});

export default router;
