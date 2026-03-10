import {
  ApiRateLimitEngineService,
  ApiRateLimitEngineCheckInput,
  hashRateLimitFingerprint
} from '../../services/api-rate-limit-engine.service';
import redisService from '../../security/redis.service';

jest.mock('../../security/redis.service', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn(),
    getClient: jest.fn()
  }
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn()
  }
}));

interface FakeStringEntry {
  value: string;
  expiresAtMs: number | null;
}

interface FakeListEntry {
  values: string[];
  expiresAtMs: number | null;
}

interface FakeRedisState {
  strings: Map<string, FakeStringEntry>;
  lists: Map<string, FakeListEntry>;
}

function createFakeRedisState(): FakeRedisState {
  return {
    strings: new Map(),
    lists: new Map()
  };
}

function cleanupExpired(state: FakeRedisState, nowMs: number): void {
  for (const [key, entry] of state.strings.entries()) {
    if (entry.expiresAtMs != null && entry.expiresAtMs <= nowMs) {
      state.strings.delete(key);
    }
  }

  for (const [key, entry] of state.lists.entries()) {
    if (entry.expiresAtMs != null && entry.expiresAtMs <= nowMs) {
      state.lists.delete(key);
    }
  }
}

function getStringValue(state: FakeRedisState, key: string, nowMs: number): string | null {
  cleanupExpired(state, nowMs);
  return state.strings.get(key)?.value ?? null;
}

function setStringValue(state: FakeRedisState, key: string, value: string, expiresAtMs: number | null): void {
  state.strings.set(key, { value, expiresAtMs });
}

function setListValue(state: FakeRedisState, key: string, values: string[], expiresAtMs: number | null): void {
  state.lists.set(key, { values, expiresAtMs });
}

function pttl(state: FakeRedisState, key: string, nowMs: number): number {
  cleanupExpired(state, nowMs);
  const entry = state.strings.get(key);
  if (!entry || entry.expiresAtMs == null) {
    return -1;
  }
  return Math.max(entry.expiresAtMs - nowMs, 0);
}

function pexpire(state: FakeRedisState, key: string, nowMs: number, ttlMs: number): void {
  const entry = state.strings.get(key);
  if (!entry) {
    return;
  }
  entry.expiresAtMs = nowMs + ttlMs;
}

function incr(state: FakeRedisState, key: string, nowMs: number): number {
  cleanupExpired(state, nowMs);
  const entry = state.strings.get(key);
  const nextValue = Number(entry?.value || '0') + 1;
  setStringValue(state, key, String(nextValue), entry?.expiresAtMs ?? null);
  return nextValue;
}

function lrange(state: FakeRedisState, key: string, nowMs: number): string[] {
  cleanupExpired(state, nowMs);
  return [...(state.lists.get(key)?.values ?? [])];
}

function lpos(state: FakeRedisState, key: string, value: string, nowMs: number): number | null {
  cleanupExpired(state, nowMs);
  const index = (state.lists.get(key)?.values ?? []).indexOf(value);
  return index >= 0 ? index : null;
}

function lpush(state: FakeRedisState, key: string, value: string, nowMs: number): void {
  cleanupExpired(state, nowMs);
  const existing = state.lists.get(key);
  const values = existing ? [value, ...existing.values] : [value];
  setListValue(state, key, values, existing?.expiresAtMs ?? null);
}

function ltrim(state: FakeRedisState, key: string, start: number, stop: number): void {
  const entry = state.lists.get(key);
  if (!entry) {
    return;
  }
  entry.values = entry.values.slice(start, stop + 1);
}

function expireList(state: FakeRedisState, key: string, nowMs: number, ttlSeconds: number): void {
  const entry = state.lists.get(key);
  if (!entry) {
    return;
  }
  entry.expiresAtMs = nowMs + (ttlSeconds * 1000);
}

function trim(value: string): string {
  return value.trim();
}

function evaluateScript(keys: string[], argv: string[], state: FakeRedisState): Array<number | string> {
  const nowMs = Number(argv[0]);
  const windowMs = Number(argv[1]);
  const maxRequests = Number(argv[2]);
  const ipLimit = Number(argv[3]);
  const endpointLimit = Number(argv[4]);
  const combinedLimit = Number(argv[5]);
  const endpointActive = Number(argv[6]) === 1;
  const fingerprint = String(argv[7] || '');
  const fingerprintTtlMs = Number(argv[8]);
  const forwardedFor = String(argv[9] || '');
  const realIp = String(argv[10] || '');
  const sourceIp = String(argv[11] || '');
  const sessionId = String(argv[12] || '');
  const protocol = String(argv[13] || '');
  const recentIpLimit = Number(argv[14]);
  const ipRotationThreshold = Number(argv[15]);
  const recentIpTtlSeconds = Number(argv[16]);
  const riskFlags: string[] = [];
  let blockReason = '';

  const addFlag = (flag: string): void => {
    if (flag && !riskFlags.includes(flag)) {
      riskFlags.push(flag);
    }
  };

  const checkDimension = (key: string, limit: number) => {
    const count = incr(state, key, nowMs);
    let ttlMs = pttl(state, key, nowMs);

    if (count === 1 || ttlMs < 0) {
      pexpire(state, key, nowMs, windowMs);
      ttlMs = windowMs;
    }

    if (ttlMs < 0) {
      ttlMs = windowMs;
    }

    return {
      allowed: count <= limit,
      remaining: count <= limit ? Math.max(limit - count, 0) : 0,
      ttlMs
    };
  };

  if (!sourceIp) {
    addFlag('missing_source_ip');
  }

  if (forwardedFor && realIp) {
    const forwardedFirst = trim(forwardedFor.split(',')[0] || forwardedFor);
    if (forwardedFirst !== trim(realIp)) {
      addFlag('ip_header_mismatch');
    }
  }

  if (protocol.startsWith('ws') && !sessionId) {
    addFlag('missing_session_id');
  }

  if (fingerprint) {
    const previousFingerprint = getStringValue(state, keys[4], nowMs);
    setStringValue(state, keys[4], fingerprint, nowMs + fingerprintTtlMs);
    if (previousFingerprint && previousFingerprint !== fingerprint) {
      addFlag('fingerprint_changed');
    }
  }

  if (sourceIp) {
    const ipExists = lpos(state, keys[5], sourceIp, nowMs);
    if (ipExists == null) {
      const recentIps = lrange(state, keys[5], nowMs);
      const uniqueIps = new Set(recentIps);
      if (uniqueIps.size >= ipRotationThreshold && recentIps.length >= ipRotationThreshold) {
        blockReason = 'Rapid IP rotation detected';
      }
    }
    lpush(state, keys[5], sourceIp, nowMs);
    ltrim(state, keys[5], 0, recentIpLimit - 1);
    expireList(state, keys[5], nowMs, recentIpTtlSeconds);
  }

  const userResult = checkDimension(keys[0], maxRequests);
  const ipResult = checkDimension(keys[1], ipLimit);
  const endpointResult = endpointActive
    ? checkDimension(keys[2], endpointLimit)
    : { allowed: true, remaining: maxRequests, ttlMs: windowMs };
  const combinedResult = checkDimension(keys[3], combinedLimit);

  let allowed = true;
  let remaining = combinedResult.remaining;
  let minTtlMs = combinedResult.ttlMs;

  if (!userResult.allowed) {
    allowed = false;
    remaining = 0;
    minTtlMs = userResult.ttlMs;
    blockReason = 'User rate limit exceeded';
  } else if (!ipResult.allowed) {
    allowed = false;
    remaining = 0;
    minTtlMs = ipResult.ttlMs;
    blockReason = 'IP rate limit exceeded';
  } else if (!endpointResult.allowed) {
    allowed = false;
    remaining = 0;
    minTtlMs = endpointResult.ttlMs;
    blockReason = 'Endpoint rate limit exceeded';
  } else if (!combinedResult.allowed) {
    allowed = false;
    remaining = 0;
    minTtlMs = combinedResult.ttlMs;
    blockReason = 'Combined rate limit exceeded';
  } else if (blockReason) {
    allowed = false;
    remaining = 0;
  }

  return [
    allowed ? 1 : 0,
    remaining,
    nowMs + minTtlMs,
    blockReason,
    riskFlags.join(',')
  ];
}

function createFakeRedisClient(state: FakeRedisState): any {
  const loadedScripts = new Set<string>();
  let loadCount = 0;

  return {
    script: jest.fn(async (command: string) => {
      if (String(command).toUpperCase() !== 'LOAD') {
        throw new Error(`Unsupported script command: ${command}`);
      }
      const sha = `sha:${loadCount += 1}`;
      loadedScripts.add(sha);
      return sha;
    }),
    evalsha: jest.fn(async (sha: string, keyCount: number, ...args: string[]) => {
      if (!loadedScripts.has(String(sha))) {
        throw new Error('NOSCRIPT No matching script. Please use EVAL.');
      }
      const keys = args.slice(0, keyCount);
      const argv = args.slice(keyCount);
      return evaluateScript(keys, argv, state);
    })
  };
}

function createInput(overrides: Partial<ApiRateLimitEngineCheckInput> = {}): ApiRateLimitEngineCheckInput {
  return {
    identifier: 'user:alpha',
    ip: '127.0.0.1',
    endpoint: 'GET:/api/test',
    maxRequests: 20,
    windowMs: 60000,
    fingerprint: hashRateLimitFingerprint('user:alpha|127.0.0.1|test'),
    sessionId: 'session-1',
    protocol: 'http',
    ...overrides
  };
}

describe('ApiRateLimitEngineService', () => {
  let state: FakeRedisState;
  let client: any;

  beforeEach(() => {
    state = createFakeRedisState();
    client = createFakeRedisClient(state);
    (redisService.isAvailable as jest.Mock).mockReturnValue(true);
    (redisService.getClient as jest.Mock).mockReturnValue(client);
  });

  it('allows requests through the redis lua engine', async () => {
    const service = new ApiRateLimitEngineService();

    const result = await service.check(createInput({ endpoint: undefined }));

    expect(result).toEqual(
      expect.objectContaining({
        allowed: true,
        decisionSource: 'redis-lua-api-rate-limit',
        remaining: 19,
        riskFlags: []
      })
    );
  });

  it('blocks once the shared user limit is exceeded', async () => {
    const service = new ApiRateLimitEngineService();
    const input = createInput({ endpoint: undefined, maxRequests: 2 });

    const first = await service.check(input);
    const second = await service.check(input);
    const third = await service.check(input);

    expect(first?.allowed).toBe(true);
    expect(second?.allowed).toBe(true);
    expect(second?.remaining).toBe(0);
    expect(third).toEqual(
      expect.objectContaining({
        allowed: false,
        remaining: 0,
        reason: 'User rate limit exceeded'
      })
    );
  });

  it('flags missing source ip without blocking by itself', async () => {
    const service = new ApiRateLimitEngineService();

    const result = await service.check(createInput({
      ip: '',
      endpoint: undefined,
      fingerprint: hashRateLimitFingerprint('user:alpha|missing-ip')
    }));

    expect(result?.allowed).toBe(true);
    expect(result?.riskFlags).toContain('missing_source_ip');
  });

  it('flags ip header mismatch without blocking by itself', async () => {
    const service = new ApiRateLimitEngineService();

    const result = await service.check(createInput({
      forwardedFor: '10.0.0.1, 10.0.0.2',
      realIp: '10.0.0.9'
    }));

    expect(result?.allowed).toBe(true);
    expect(result?.riskFlags).toContain('ip_header_mismatch');
  });

  it('flags missing websocket session id', async () => {
    const service = new ApiRateLimitEngineService();

    const result = await service.check(createInput({
      sessionId: '',
      protocol: 'ws-agent'
    }));

    expect(result?.allowed).toBe(true);
    expect(result?.riskFlags).toContain('missing_session_id');
  });

  it('flags fingerprint changes for the same identifier', async () => {
    const service = new ApiRateLimitEngineService();

    await service.check(createInput({
      endpoint: undefined,
      fingerprint: hashRateLimitFingerprint('fingerprint-a')
    }));
    const result = await service.check(createInput({
      endpoint: undefined,
      fingerprint: hashRateLimitFingerprint('fingerprint-b')
    }));

    expect(result?.allowed).toBe(true);
    expect(result?.riskFlags).toContain('fingerprint_changed');
  });

  it('blocks rapid ip rotation for the same identifier', async () => {
    const service = new ApiRateLimitEngineService();

    for (let index = 0; index < 5; index += 1) {
      const result = await service.check(createInput({
        maxRequests: 100,
        endpoint: undefined,
        ip: `10.0.0.${index + 1}`,
        fingerprint: hashRateLimitFingerprint(`rotation:${index}`)
      }));
      expect(result?.allowed).toBe(true);
    }

    const blocked = await service.check(createInput({
      maxRequests: 100,
      endpoint: undefined,
      ip: '10.0.0.99',
      fingerprint: hashRateLimitFingerprint('rotation:blocked')
    }));

    expect(blocked).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: 'Rapid IP rotation detected'
      })
    );
  });

  it('falls back when redis is unavailable', async () => {
    const service = new ApiRateLimitEngineService();
    (redisService.isAvailable as jest.Mock).mockReturnValue(false);

    const result = await service.check(createInput());
    const metrics = service.snapshotMetrics();

    expect(result).toBeNull();
    expect(metrics.fallbackCount).toBe(1);
  });

  it('falls back when lua execution fails', async () => {
    const service = new ApiRateLimitEngineService();
    (redisService.getClient as jest.Mock).mockReturnValue({
      script: jest.fn().mockResolvedValue('sha:broken'),
      evalsha: jest.fn().mockRejectedValue(new Error('lua_failed'))
    });

    const result = await service.check(createInput());
    const metrics = service.snapshotMetrics();

    expect(result).toBeNull();
    expect(metrics.fallbackCount).toBe(1);
  });

  it('shares strong consistency across service instances', async () => {
    const serviceA = new ApiRateLimitEngineService();
    const serviceB = new ApiRateLimitEngineService();
    const input = createInput({ endpoint: undefined, maxRequests: 4 });

    const first = await serviceA.check(input);
    const second = await serviceB.check(input);
    const third = await serviceA.check(input);
    const fourth = await serviceB.check(input);
    const blocked = await serviceA.check(input);

    expect(first?.remaining).toBe(3);
    expect(second?.remaining).toBe(2);
    expect(third?.remaining).toBe(1);
    expect(fourth?.remaining).toBe(0);
    expect(blocked).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: 'User rate limit exceeded'
      })
    );
  });
});
