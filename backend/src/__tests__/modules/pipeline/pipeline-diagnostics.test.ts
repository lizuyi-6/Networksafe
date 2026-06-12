/**
 * Pipeline Diagnostics Service Tests
 *
 * Tests for PipelineDiagnosticsService: health checks, overall status
 * aggregation, and data pipeline verification.
 */

// ---------------------------------------------------------------------------
// Mock bridge
// ---------------------------------------------------------------------------
export {}; // Mark as module so top-level declarations are file-scoped, not global.

const mocks = {
  dbPrepare: null as jest.Mock | null,
  dbMode: 'sqlite',
  sqliteFallbackEnabled: false,
  canServeReads: true,
  agentGateway: null as any,
};

mocks.dbPrepare = jest.fn();

jest.doMock('../../../config/database', () => ({
  getDatabase: () => ({
    prepare: mocks.dbPrepare,
  }),
}));

jest.doMock('../../../config/platform-runtime', () => ({
  getRuntimeDescriptor: () => ({
    dbMode: mocks.dbMode,
    sqliteFallbackEnabled: mocks.sqliteFallbackEnabled,
  }),
}));

jest.doMock('../../../services/postgres-shadow-store.service', () => ({
  postgresShadowStoreService: {
    canServeReads: () => mocks.canServeReads,
  },
}));

jest.doMock('../../../services/agent-system.service', () => ({
  getAgentGateway: () => mocks.agentGateway,
}));

let PipelineDiagnosticsService: typeof import('../../../modules/pipeline/pipeline-diagnostics.service').PipelineDiagnosticsService;

beforeAll(() => {
  ({ PipelineDiagnosticsService } = require('../../../modules/pipeline/pipeline-diagnostics.service'));
});

beforeEach(() => {
  jest.clearAllMocks();
  mocks.dbMode = 'sqlite';
  mocks.sqliteFallbackEnabled = false;
  mocks.canServeReads = true;
  mocks.agentGateway = {
    getOnlineCount: jest.fn(() => 0),
    getDashboardConnectionCount: jest.fn(() => 0),
  };

  // Default: SELECT 1 returns { test: 1 }
  mocks.dbPrepare!.mockImplementation((sql: string) => {
    const mockStmt = {
      get: jest.fn().mockReturnValue({ test: 1 }),
      free: jest.fn(),
    };
    if (sql.includes('COUNT')) {
      mockStmt.get = jest.fn().mockReturnValue({ count: 0 });
    }
    return mockStmt;
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createService() {
  return new PipelineDiagnosticsService();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('PipelineDiagnosticsService', () => {
  // -----------------------------------------------------------------------
  // checkWebSocketHealth
  // -----------------------------------------------------------------------
  describe('checkWebSocketHealth', () => {
    it('returns healthy with connections=0', () => {
      const svc = createService();
      const result = svc.checkWebSocketHealth();
      expect(result.status).toBe('healthy');
      expect(result.details.connections).toBe(0);
      expect(result.details.uptime).toBeGreaterThan(0);
    });

    it('has a valid ISO timestamp', () => {
      const svc = createService();
      const result = svc.checkWebSocketHealth();
      expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    });

    it('message says WebSocket gateway is running', () => {
      const svc = createService();
      const result = svc.checkWebSocketHealth();
      expect(result.message).toBe('WebSocket gateway is running');
    });

    it('returns degraded when gateway is not attached', () => {
      mocks.agentGateway = null;
      const svc = createService();
      const result = svc.checkWebSocketHealth();
      expect(result.status).toBe('degraded');
      expect(result.message).toBe('WebSocket gateway is not attached');
    });
  });

  // -----------------------------------------------------------------------
  // checkRedisHealth
  // -----------------------------------------------------------------------
  describe('checkRedisHealth', () => {
    it('returns degraded when DISABLED_REDIS=true', () => {
      process.env.DISABLE_REDIS = 'true';
      const svc = createService();
      const result = svc.checkRedisHealth();
      expect(result.status).toBe('degraded');
      expect(result.details.disabled).toBe(true);
      delete process.env.DISABLE_REDIS;
    });

    it('returns healthy when DISABLED_REDIS is not set', () => {
      delete process.env.DISABLE_REDIS;
      const svc = createService();
      const result = svc.checkRedisHealth();
      expect(result.status).toBe('healthy');
      expect(result.message).toBe('Redis connection is active');
    });

    it('returns healthy with default host and port in details', () => {
      delete process.env.DISABLE_REDIS;
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      const svc = createService();
      const result = svc.checkRedisHealth();
      expect(result.details.host).toBe('localhost');
      expect(result.details.port).toBe(6379);
    });

    it('uses custom REDIS_HOST and REDIS_PORT when set', () => {
      process.env.REDIS_HOST = 'redis.example.com';
      process.env.REDIS_PORT = '6380';
      const svc = createService();
      const result = svc.checkRedisHealth();
      expect(result.details.host).toBe('redis.example.com');
      expect(result.details.port).toBe('6380');
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
    });
  });

  // -----------------------------------------------------------------------
  // checkDatabaseHealth
  // -----------------------------------------------------------------------
  describe('checkDatabaseHealth', () => {
    it('returns healthy when SELECT 1 returns test=1', () => {
      const svc = createService();
      const result = svc.checkDatabaseHealth();
      expect(result.status).toBe('healthy');
      expect(result.message).toBe('Database connection is active');
    });

    it('returns unhealthy when SELECT 1 returns unexpected result', () => {
      mocks.dbPrepare!.mockImplementation(() => ({
        get: jest.fn().mockReturnValue({ test: 99 }),
        free: jest.fn(),
      }));
      const svc = createService();
      const result = svc.checkDatabaseHealth();
      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('Database query failed');
    });

    it('returns unhealthy when database throws an error', () => {
      mocks.dbPrepare!.mockImplementation(() => {
        throw new Error('DB locked');
      });
      const svc = createService();
      const result = svc.checkDatabaseHealth();
      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('DB locked');
    });

    it('includes dbMode and postgresReady in healthy details', () => {
      mocks.dbMode = 'postgres';
      mocks.canServeReads = true;
      const svc = createService();
      const result = svc.checkDatabaseHealth();
      expect(result.details.type).toBe('postgres');
      expect(result.details.postgresReady).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // checkAgentsHealth
  // -----------------------------------------------------------------------
  describe('checkAgentsHealth', () => {
    it('returns healthy when agents are online', () => {
      mocks.dbPrepare!.mockImplementation((sql: string) => {
        if (sql.includes('COUNT')) {
          return {
            get: jest.fn().mockReturnValue({ count: 2 }),
            free: jest.fn(),
          };
        }
        return { get: jest.fn().mockReturnValue({ test: 1 }), free: jest.fn() };
      });
      const svc = createService();
      const result = svc.checkAgentsHealth();
      expect(result.status).toBe('healthy');
      expect(result.message).toContain('2 agents online');
      expect(result.details.online).toBe(2);
    });

    it('returns degraded when no agents are online', () => {
      const svc = createService();
      const result = svc.checkAgentsHealth();
      expect(result.status).toBe('degraded');
      expect(result.message).toBe('No agents online');
      expect(result.details.online).toBe(0);
    });

    it('returns unhealthy on database error', () => {
      mocks.dbPrepare!.mockImplementation((sql: string) => {
        if (sql.includes('COUNT')) {
          throw new Error('table agents not found');
        }
        return { get: jest.fn().mockReturnValue({ test: 1 }), free: jest.fn() };
      });
      const svc = createService();
      const result = svc.checkAgentsHealth();
      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('table agents not found');
    });
  });

  // -----------------------------------------------------------------------
  // getHealthStatus
  // -----------------------------------------------------------------------
  describe('getHealthStatus', () => {
    it('overall status is healthy when all subsystems healthy', () => {
      mocks.dbPrepare!.mockImplementation((sql: string) => {
        if (sql.includes('COUNT')) {
          return { get: jest.fn().mockReturnValue({ count: 1 }), free: jest.fn() };
        }
        return { get: jest.fn().mockReturnValue({ test: 1 }), free: jest.fn() };
      });
      const svc = createService();
      const result = svc.getHealthStatus();
      expect(result.overall).toBe('healthy');
      expect(result).toHaveProperty('websocket');
      expect(result).toHaveProperty('database');
      expect(result).toHaveProperty('redis');
      expect(result).toHaveProperty('agents');
    });

    it('overall is degraded when some subsystems degraded', () => {
      process.env.DISABLE_REDIS = 'true';
      const svc = createService();
      const result = svc.getHealthStatus();
      expect(result.overall).toBe('degraded');
      delete process.env.DISABLE_REDIS;
    });

    it('overall is unhealthy when any subsystem unhealthy', () => {
      mocks.dbPrepare!.mockImplementation(() => {
        throw new Error('DB broken');
      });
      const svc = createService();
      const result = svc.getHealthStatus();
      expect(result.overall).toBe('unhealthy');
    });
  });

  // -----------------------------------------------------------------------
  // verifyDataPipeline
  // -----------------------------------------------------------------------
  describe('verifyDataPipeline', () => {
    it('api_to_sqlite passes when SELECT 1 returns ok=1', () => {
      // Default mock for SELECT 1 as ok returns test=1 — need to adapt
      // The verifyDataPipeline does: SELECT 1 as ok, checks sqliteResult?.ok === 1
      mocks.dbPrepare!.mockImplementation((sql: string) => {
        if (sql.includes('ok')) {
          return { get: jest.fn().mockReturnValue({ ok: 1 }), free: jest.fn() };
        }
        return { get: jest.fn().mockReturnValue({ test: 1 }), free: jest.fn() };
      });
      const svc = createService();
      const results = svc.verifyDataPipeline();
      const sqliteStep = results.find((v) => v.component === 'api_to_sqlite');
      expect(sqliteStep).toBeDefined();
      expect(sqliteStep!.status).toBe('pass');
    });

    it('api_to_sqlite fails when SELECT 1 returns unexpected result', () => {
      mocks.dbPrepare!.mockImplementation((sql: string) => {
        if (sql.includes('ok')) {
          return { get: jest.fn().mockReturnValue({ ok: 0 }), free: jest.fn() };
        }
        return { get: jest.fn().mockReturnValue({ test: 1 }), free: jest.fn() };
      });
      const svc = createService();
      const results = svc.verifyDataPipeline();
      const sqliteStep = results.find((v) => v.component === 'api_to_sqlite');
      expect(sqliteStep!.status).toBe('fail');
    });

    it('api_to_sqlite fails when database throws', () => {
      mocks.dbPrepare!.mockImplementation((sql: string) => {
        if (sql.includes('ok')) {
          throw new Error('disk full');
        }
        return { get: jest.fn().mockReturnValue({ test: 1 }), free: jest.fn() };
      });
      const svc = createService();
      const results = svc.verifyDataPipeline();
      const sqliteStep = results.find((v) => v.component === 'api_to_sqlite');
      expect(sqliteStep!.status).toBe('fail');
      expect(sqliteStep!.message).toContain('disk full');
    });

    it('agent_to_gateway and gateway_to_frontend skip when no live clients are connected', () => {
      mocks.dbPrepare!.mockImplementation((sql: string) => {
        if (sql.includes('ok')) {
          return { get: jest.fn().mockReturnValue({ ok: 1 }), free: jest.fn() };
        }
        return { get: jest.fn().mockReturnValue({ test: 1 }), free: jest.fn() };
      });
      const svc = createService();
      const results = svc.verifyDataPipeline();
      expect(results[0].component).toBe('agent_to_gateway');
      expect(results[0].status).toBe('skip');
      expect(results[1].component).toBe('gateway_to_frontend');
      expect(results[1].status).toBe('skip');
      expect(results[0].message).not.toContain('not implemented');
      expect(results[1].message).not.toContain('not implemented');
    });

    it('agent_to_gateway and gateway_to_frontend pass when live clients are connected', () => {
      mocks.agentGateway = {
        getOnlineCount: jest.fn(() => 2),
        getDashboardConnectionCount: jest.fn(() => 1),
      };
      mocks.dbPrepare!.mockImplementation((sql: string) => {
        if (sql.includes('ok')) {
          return { get: jest.fn().mockReturnValue({ ok: 1 }), free: jest.fn() };
        }
        return { get: jest.fn().mockReturnValue({ test: 1 }), free: jest.fn() };
      });

      const svc = createService();
      const results = svc.verifyDataPipeline();
      expect(results[0].status).toBe('pass');
      expect(results[1].status).toBe('pass');
    });

    it('api_to_postgres skips when dbMode is sqlite', () => {
      mocks.dbMode = 'sqlite';
      mocks.dbPrepare!.mockImplementation((sql: string) => {
        if (sql.includes('ok')) {
          return { get: jest.fn().mockReturnValue({ ok: 1 }), free: jest.fn() };
        }
        return { get: jest.fn().mockReturnValue({ test: 1 }), free: jest.fn() };
      });
      const svc = createService();
      const results = svc.verifyDataPipeline();
      const pgStep = results.find((v) => v.component === 'api_to_postgres');
      expect(pgStep!.status).toBe('skip');
      expect(pgStep!.message).toContain('not postgres');
    });

    it('api_to_postgres passes when dbMode is postgres and canServeReads true', () => {
      mocks.dbMode = 'postgres';
      mocks.canServeReads = true;
      mocks.dbPrepare!.mockImplementation((sql: string) => {
        if (sql.includes('ok')) {
          return { get: jest.fn().mockReturnValue({ ok: 1 }), free: jest.fn() };
        }
        return { get: jest.fn().mockReturnValue({ test: 1 }), free: jest.fn() };
      });
      const svc = createService();
      const results = svc.verifyDataPipeline();
      const pgStep = results.find((v) => v.component === 'api_to_postgres');
      expect(pgStep!.status).toBe('pass');
    });

    it('api_to_postgres fails when dbMode is postgres but canServeReads false', () => {
      mocks.dbMode = 'postgres';
      mocks.canServeReads = false;
      mocks.dbPrepare!.mockImplementation((sql: string) => {
        if (sql.includes('ok')) {
          return { get: jest.fn().mockReturnValue({ ok: 1 }), free: jest.fn() };
        }
        return { get: jest.fn().mockReturnValue({ test: 1 }), free: jest.fn() };
      });
      const svc = createService();
      const results = svc.verifyDataPipeline();
      const pgStep = results.find((v) => v.component === 'api_to_postgres');
      expect(pgStep!.status).toBe('fail');
    });
  });
});
