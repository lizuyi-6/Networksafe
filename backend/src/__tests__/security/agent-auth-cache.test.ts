/**
 * Regression tests for the agent-auth Redis cache verification path.
 *
 * SECURITY FIX (audit 2026-08, Critical): a cache hit used to return the
 * cached AuthenticatedAgent WITHOUT re-verifying the presented apiKey, so any
 * non-empty key authenticated as a recently-connected agent for the whole
 * CACHE_TTL window. These tests pin the fixed behavior.
 */
import crypto from 'crypto';

jest.mock('../../utils/logger');

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();

jest.mock('../../security/redis.service', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
    isAvailable: () => true,
  },
}));

const mockDbPrepare = jest.fn();

jest.mock('../../config/database', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => mockDbPrepare(sql),
  }),
}));

import agentAuthService from '../../security/agent-auth.service';
import redisService from '../../security/redis.service';

const AGENT_ID = 'agent-11111111-2222-3333-4444-555555555555';
const REAL_KEY = 'agent_' + 'ab'.repeat(24); // matches generateApiKey shape
const REAL_KEY_HASH = crypto.createHash('sha256').update(REAL_KEY).digest('hex');

function seedDbRow(row: Record<string, unknown> | null) {
  mockDbPrepare.mockImplementation((sql: string) => {
    if (sql.includes('PRAGMA table_info')) {
      return {
        all: () => [
          { name: 'agent_id' }, { name: 'hostname' }, { name: 'platform' },
          { name: 'api_key_hash' }, { name: 'status' }, { name: 'tenant_id' },
          { name: 'secret_key' }, { name: 'fingerprint' }, { name: 'created_at' },
        ],
      };
    }
    return {
      get: () => (sql.includes('SELECT') ? row : null),
      run: () => ({}),
      all: () => [],
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  seedDbRow(null);
});

describe('agent-auth verifyAgent cache path (cache hit must still verify the key)', () => {
  it('REJECTS a bogus apiKey even when a valid cache entry exists (critical regression)', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      agentId: AGENT_ID,
      hostname: 'prod-web-01',
      platform: 'linux',
      tenantId: 'tenant-1',
      apiKeyHash: REAL_KEY_HASH,
    }));

    const result = await agentAuthService.verifyAgent(AGENT_ID, 'agent_bogusbogusbogusbogusbogusbogusbogus');
    expect(result).toBeNull();
    // Must NOT have consulted the DB cache-hit short circuit... it falls
    // through to the DB path, which finds no row here -> null.
    expect(mockDbPrepare).toHaveBeenCalled(); // PRAGMA/DB fallback is fine
  });

  it('accepts the correct apiKey on a cache hit without a DB row lookup', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      agentId: AGENT_ID,
      hostname: 'prod-web-01',
      platform: 'linux',
      tenantId: 'tenant-1',
      apiKeyHash: REAL_KEY_HASH,
    }));

    const result = await agentAuthService.verifyAgent(AGENT_ID, REAL_KEY);
    expect(result).toEqual({
      agentId: AGENT_ID,
      hostname: 'prod-web-01',
      platform: 'linux',
      tenantId: 'tenant-1',
    });
  });

  it('rejects an empty apiKey even with a warm cache entry', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      agentId: AGENT_ID,
      hostname: 'prod-web-01',
      platform: 'linux',
      apiKeyHash: REAL_KEY_HASH,
    }));

    const result = await agentAuthService.verifyAgent(AGENT_ID, '');
    expect(result).toBeNull();
  });

  it('treats legacy cache entries without apiKeyHash as a miss and verifies against the DB', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      agentId: AGENT_ID,
      hostname: 'prod-web-01',
      platform: 'linux',
      tenantId: 'tenant-1',
    }));
    seedDbRow({
      agent_id: AGENT_ID,
      hostname: 'prod-web-01',
      platform: 'linux',
      api_key_hash: REAL_KEY_HASH,
      status: 'approved',
      tenant_id: 'tenant-1',
    });

    const ok = await agentAuthService.verifyAgent(AGENT_ID, REAL_KEY);
    expect(ok).toEqual({
      agentId: AGENT_ID,
      hostname: 'prod-web-01',
      platform: 'linux',
      tenantId: 'tenant-1',
    });

    // And a bogus key against the same legacy entry is rejected.
    mockRedisGet.mockResolvedValue(JSON.stringify({
      agentId: AGENT_ID,
      hostname: 'prod-web-01',
      platform: 'linux',
      tenantId: 'tenant-1',
    }));
    const bad = await agentAuthService.verifyAgent(AGENT_ID, 'agent_nope');
    expect(bad).toBeNull();
  });

  it('writes the apiKeyHash into newly cached entries so future hits can re-verify', async () => {
    mockRedisGet.mockResolvedValue(null);
    seedDbRow({
      agent_id: AGENT_ID,
      hostname: 'prod-web-01',
      platform: 'linux',
      api_key_hash: REAL_KEY_HASH,
      status: 'approved',
      tenant_id: 'tenant-1',
    });

    await agentAuthService.verifyAgent(AGENT_ID, REAL_KEY);
    const setCall = mockRedisSet.mock.calls[0];
    expect(setCall).toBeDefined();
    const cachedJson = setCall[1];
    const cached = JSON.parse(cachedJson);
    expect(cached.apiKeyHash).toBe(REAL_KEY_HASH);
  });
});
