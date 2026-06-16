/**
 * Runtime Health Tests
 *
 * Tests for buildRuntimeHealthSnapshot(), liveness/readiness probes,
 * and dependency health checks.
 */

// Force module scope so the top-level `mocks` const does not collide with
// the same-named const in other script-style test files.
export {};

import type { RuntimeProfile } from '../../../config/platform-runtime';

// ---------------------------------------------------------------------------
// Mock bridge: factories capture these at hoist time, tests read them later.
// ---------------------------------------------------------------------------
const mocks = {
  shadowDescribe: null as jest.Mock | null,
  artifactDescribe: null as jest.Mock | null,
  emulatorDescribe: null as jest.Mock | null,
  redisHealthCheck: null as jest.Mock | null,
  redisIsDisabled: null as jest.Mock | null,
  fastpathHealth: null as jest.Mock | null,
  queueBackend: null as jest.Mock | null,
  aiLayerHealth: null as jest.Mock | null,
};

// Populate BEFORE jest.doMock factories run (hoisted).
mocks.shadowDescribe = jest.fn().mockReturnValue({
  enabled: true,
  connected: true,
  mode: 'postgres',
  healthy: true,
  endpoint: 'localhost:5432',
});
mocks.artifactDescribe = jest.fn().mockReturnValue({
  requestedMode: 'local',
  activeMode: 'local',
});
mocks.emulatorDescribe = jest.fn().mockReturnValue({ active: false });
mocks.redisHealthCheck = jest.fn().mockResolvedValue({ healthy: true, latency: 2 });
mocks.redisIsDisabled = jest.fn().mockReturnValue(false);
mocks.fastpathHealth = jest.fn().mockResolvedValue(true);
mocks.queueBackend = jest.fn().mockReturnValue('memory');
mocks.aiLayerHealth = jest.fn().mockReturnValue({ available: true, degraded: false, prepared: true, mode: 'multi-agent', message: 'Multi-agent analyzer is wired and active.' });

// ---------------------------------------------------------------------------
// Module mocks (hoisted by jest)
// ---------------------------------------------------------------------------
jest.doMock('../../../services/postgres-shadow-store.service', () => ({
  postgresShadowStoreService: { describe: mocks.shadowDescribe },
}));
jest.doMock('../../../services/artifact-store.service', () => ({
  artifactStoreService: { describe: mocks.artifactDescribe },
}));
jest.doMock('../../../services/runtime-emulator.service', () => ({
  runtimeEmulatorService: { describe: mocks.emulatorDescribe },
}));
jest.doMock('../../../services/detection-pipeline.service', () => ({
  detectionPipelineService: { getAiLayerHealth: mocks.aiLayerHealth },
}));
jest.doMock('../../../security/redis.service', () => ({
  __esModule: true,
  default: { healthCheck: mocks.redisHealthCheck, isDisabled: mocks.redisIsDisabled },
}));
jest.doMock('../../../services/fastpath-client.service', () => ({
  fastpathClientService: {
    health: mocks.fastpathHealth,
  },
}));
jest.doMock('../../../services/job-queue.service', () => ({
  jobQueueService: { backend: mocks.queueBackend },
}));
jest.doMock('../../../utils/model-access', () => ({
  PLATFORM_API_CONFIG: {
    provider: 'dashscope',
    providerId: 'dashscope',
    protocol: 'openai-compatible',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
}));
jest.doMock('../../../config/platform-runtime', () => ({}));

// ---------------------------------------------------------------------------
// Import AFTER mocks are registered
// ---------------------------------------------------------------------------
let buildRuntimeHealthSnapshot: typeof import('../../../core/health/runtime-health').buildRuntimeHealthSnapshot;

beforeAll(() => {
  ({ buildRuntimeHealthSnapshot } = require('../../../core/health/runtime-health'));
});

beforeEach(() => {
  jest.clearAllMocks();
  // Reset defaults
  mocks.shadowDescribe!.mockReturnValue({
    enabled: true,
    connected: true,
    mode: 'postgres',
    healthy: true,
    endpoint: 'localhost:5432',
  });
  mocks.artifactDescribe!.mockReturnValue({
    requestedMode: 'local',
    activeMode: 'local',
  });
  mocks.emulatorDescribe!.mockReturnValue({ active: false });
  mocks.redisHealthCheck!.mockResolvedValue({ healthy: true, latency: 2 });
  mocks.redisIsDisabled!.mockReturnValue(false);
  mocks.fastpathHealth!.mockResolvedValue(true);
  mocks.queueBackend!.mockReturnValue('memory');
  delete process.env.PLATFORM_API_KEY;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const defaultInput = () => ({
  runtime: {
    profile: 'dev' as RuntimeProfile,
    dbMode: 'sqlite',
    sqliteFallbackEnabled: false,
    extra: true,
  },
  agentCount: 3,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('buildRuntimeHealthSnapshot', () => {
  it('returns a RuntimeHealthSnapshot with liveness, readiness, and dependencies', async () => {
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot).toHaveProperty('liveness');
    expect(snapshot).toHaveProperty('readiness');
    expect(snapshot).toHaveProperty('dependencies');
    expect(snapshot).toHaveProperty('runtime');
    expect(snapshot).toHaveProperty('queueBackend');
    expect(snapshot).toHaveProperty('agents');
    expect(snapshot).toHaveProperty('emulator');
    expect(snapshot).toHaveProperty('status');
  });

  it('liveness always returns { status: "alive", timestamp }', async () => {
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.liveness.status).toBe('alive');
    expect(snapshot.liveness.timestamp).toBeTruthy();
    // Valid ISO string
    expect(new Date(snapshot.liveness.timestamp).getTime()).not.toBeNaN();
  });

  it('readiness returns "ready" when no blockers', async () => {
    const input = defaultInput();
    input.runtime.dbMode = 'sqlite'; // postgres blocker requires dbMode=postgres
    const snapshot = await buildRuntimeHealthSnapshot(input);
    expect(snapshot.readiness.status).toBe('ready');
    expect(snapshot.readiness.blockers).toEqual([]);
  });

  it('readiness returns "not_ready" with postgres blocker when postgres is down in postgres mode', async () => {
    mocks.shadowDescribe!.mockReturnValue({
      enabled: true,
      connected: false,
      mode: 'postgres',
      healthy: false,
      lastError: 'Connection refused',
    });
    const input = defaultInput();
    input.runtime.dbMode = 'postgres';
    const snapshot = await buildRuntimeHealthSnapshot(input);
    expect(snapshot.readiness.status).toBe('not_ready');
    expect(snapshot.readiness.blockers).toContain('postgres');
  });

  it('overall status is "unhealthy" when readiness is not_ready', async () => {
    mocks.shadowDescribe!.mockReturnValue({
      enabled: true,
      connected: false,
      mode: 'postgres',
      lastError: 'Connection refused',
    });
    const input = defaultInput();
    input.runtime.dbMode = 'postgres';
    const snapshot = await buildRuntimeHealthSnapshot(input);
    expect(snapshot.status).toBe('unhealthy');
  });
});

describe('dependency health: redis', () => {
  it('redis is healthy when healthCheck returns healthy', async () => {
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.dependencies.redis.status).toBe('healthy');
    expect(snapshot.dependencies.redis.message).toBe('Redis is connected.');
  });

  it('redis is degraded when not healthy and not disabled', async () => {
    mocks.redisHealthCheck!.mockResolvedValue({ healthy: false, error: 'Connection refused' });
    mocks.redisIsDisabled!.mockReturnValue(false);
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.dependencies.redis.status).toBe('degraded');
    expect(snapshot.dependencies.redis.message).toBe('Connection refused');
    expect(snapshot.dependencies.redis.details!.disabled).toBe(false);
  });

  it('redis is disabled when DISABLED_REDIS and healthCheck reports not healthy', async () => {
    mocks.redisHealthCheck!.mockResolvedValue({ healthy: false, error: 'Redis is disabled' });
    mocks.redisIsDisabled!.mockReturnValue(true);
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.dependencies.redis.status).toBe('disabled');
    expect(snapshot.dependencies.redis.details!.disabled).toBe(true);
  });

  it('redis healthy includes latencyMs in details', async () => {
    mocks.redisHealthCheck!.mockResolvedValue({ healthy: true, latency: 5 });
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.dependencies.redis.details!.latencyMs).toBe(5);
  });
});

describe('dependency health: postgres', () => {
  it('postgres is healthy when shadow store is enabled and connected', async () => {
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.dependencies.postgres.status).toBe('healthy');
    expect(snapshot.dependencies.postgres.message).toContain('connected');
  });

  it('postgres is unhealthy when enabled but not connected', async () => {
    mocks.shadowDescribe!.mockReturnValue({
      enabled: true,
      connected: false,
      mode: 'postgres',
      lastError: 'ECONNREFUSED',
    });
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.dependencies.postgres.status).toBe('unhealthy');
    expect(snapshot.dependencies.postgres.message).toBe('ECONNREFUSED');
  });

  it('postgres is disabled when shadow store is not enabled', async () => {
    mocks.shadowDescribe!.mockReturnValue({
      enabled: false,
      connected: false,
      mode: 'sqlite',
    });
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.dependencies.postgres.status).toBe('disabled');
    expect(snapshot.dependencies.postgres.message).toContain('disabled');
  });
});

describe('dependency health: artifact store', () => {
  it('artifact store is healthy when requestedMode matches activeMode', async () => {
    mocks.artifactDescribe!.mockReturnValue({
      requestedMode: 's3',
      activeMode: 's3',
    });
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.dependencies.artifactStore.status).toBe('healthy');
    expect(snapshot.dependencies.artifactStore.message).toContain('s3');
  });

  it('artifact store is degraded when activeMode differs from requestedMode', async () => {
    mocks.artifactDescribe!.mockReturnValue({
      requestedMode: 's3',
      activeMode: 'local',
    });
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.dependencies.artifactStore.status).toBe('degraded');
    expect(snapshot.dependencies.artifactStore.message).toContain('fell back to local');
  });
});

describe('dependency health: fastpath', () => {
  it('fastpath is healthy when health returns true', async () => {
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.dependencies.fastpath.status).toBe('healthy');
  });

  it('fastpath is disabled in dev profile when health returns false', async () => {
    mocks.fastpathHealth!.mockResolvedValue(false);
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.dependencies.fastpath.status).toBe('disabled');
  });

  it('fastpath is degraded in prod profile when health returns false', async () => {
    mocks.fastpathHealth!.mockResolvedValue(false);
    const input = defaultInput();
    input.runtime.profile = 'prod';
    const snapshot = await buildRuntimeHealthSnapshot(input);
    expect(snapshot.dependencies.fastpath.status).toBe('degraded');
    expect(snapshot.dependencies.fastpath.message).toContain('fallback');
  });
});

describe('dependency health: AI provider', () => {
  it('aiProvider is disabled when no PLATFORM_API_KEY in non-prod', async () => {
    delete process.env.PLATFORM_API_KEY;
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.dependencies.aiProvider.status).toBe('disabled');
    expect(snapshot.dependencies.aiProvider.details).toHaveProperty('provider');
    expect(snapshot.dependencies.aiProvider.details).toHaveProperty('protocol');
    expect(snapshot.dependencies.aiProvider.details).toHaveProperty('baseURL');
  });

  it('aiProvider is degraded when no PLATFORM_API_KEY in prod', async () => {
    delete process.env.PLATFORM_API_KEY;
    const input = defaultInput();
    input.runtime.profile = 'prod';
    const snapshot = await buildRuntimeHealthSnapshot(input);
    expect(snapshot.dependencies.aiProvider.status).toBe('degraded');
    expect(snapshot.dependencies.aiProvider.message).toContain('not configured');
  });

  it('aiProvider is healthy when PLATFORM_API_KEY is set', async () => {
    process.env.PLATFORM_API_KEY = 'test-key-12345';
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.dependencies.aiProvider.status).toBe('healthy');
    expect(snapshot.dependencies.aiProvider.message).toContain('present');
  });

  it('aiProvider is healthy in prod when PLATFORM_API_KEY is set', async () => {
    process.env.PLATFORM_API_KEY = 'test-key-12345';
    const input = defaultInput();
    input.runtime.profile = 'prod';
    const snapshot = await buildRuntimeHealthSnapshot(input);
    expect(snapshot.dependencies.aiProvider.status).toBe('healthy');
  });
});

describe('dependency health: AI layer (multi-agent analyzer)', () => {
  afterEach(() => {
    mocks.aiLayerHealth!.mockReturnValue({ available: true, degraded: false, prepared: true, mode: 'multi-agent', message: 'Multi-agent analyzer is wired and active.' });
  });

  it('aiLayer is healthy when the analyzer is wired', async () => {
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.dependencies.aiLayer.status).toBe('healthy');
    expect(snapshot.dependencies.aiLayer.details.mode).toBe('multi-agent');
  });

  it('aiLayer is degraded in non-prod when the analyzer is unavailable (fail-closed)', async () => {
    mocks.aiLayerHealth!.mockReturnValue({ available: false, degraded: true, prepared: true, mode: 'fail-closed-degraded', message: 'AI analyzer unavailable — pipeline is in fail-closed degraded mode (rules guardrail only).' });
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.dependencies.aiLayer.status).toBe('degraded');
    expect(snapshot.dependencies.aiLayer.details.mode).toBe('fail-closed-degraded');
  });

  it('aiLayer is unhealthy in prod when the analyzer is unavailable', async () => {
    mocks.aiLayerHealth!.mockReturnValue({ available: false, degraded: true, prepared: true, mode: 'fail-closed-degraded', message: 'degraded' });
    process.env.NODE_ENV = 'production';
    try {
      const input = defaultInput();
      input.runtime.profile = 'prod';
      const snapshot = await buildRuntimeHealthSnapshot(input);
      expect(snapshot.dependencies.aiLayer.status).toBe('unhealthy');
    } finally {
      delete process.env.NODE_ENV;
    }
  });
});
describe('overall status computation', () => {
  it('overall status is healthy when all dependencies healthy', async () => {
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.status).toBe('healthy');
  });

  it('overall status is degraded when some dependencies degraded but readiness ready', async () => {
    mocks.redisHealthCheck!.mockResolvedValue({ healthy: false, error: 'down' });
    mocks.redisIsDisabled!.mockReturnValue(false);
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    // dbMode is sqlite so postgres blocker does not apply
    expect(snapshot.readiness.status).toBe('ready');
    expect(snapshot.status).toBe('degraded');
  });

  it('queueBackend is read from jobQueueService.backend()', async () => {
    mocks.queueBackend!.mockReturnValue('redis');
    const snapshot = await buildRuntimeHealthSnapshot(defaultInput());
    expect(snapshot.queueBackend).toBe('redis');
  });

  it('agents count is passed through from input', async () => {
    const input = defaultInput();
    input.agentCount = 7;
    const snapshot = await buildRuntimeHealthSnapshot(input);
    expect(snapshot.agents).toBe(7);
  });
});
