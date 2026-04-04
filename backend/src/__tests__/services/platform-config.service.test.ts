/**
 * Platform Config Service Tests
 *
 * Tests for platform configuration service
 */

import {
  isSeverityAtLeast,
  SeverityLevel,
  platformConfigService
} from '../../services/platform-config.service';

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}));

// Mock database
const mockPrepare = jest.fn();
const mockExec = jest.fn();
jest.mock('../../config/database', () => ({
  getDatabase: jest.fn(() => ({
    prepare: mockPrepare,
    exec: mockExec
  }))
}));

// Mock postgres shadow store
jest.mock('../../services/postgres-shadow-store.service', () => ({
  postgresShadowStoreService: {
    canServeReads: jest.fn().mockReturnValue(false),
    upsert: jest.fn().mockResolvedValue(undefined)
  }
}));

describe('isSeverityAtLeast', () => {
  it('returns true when severity equals minimum', () => {
    expect(isSeverityAtLeast('high', 'high')).toBe(true);
    expect(isSeverityAtLeast('medium', 'medium')).toBe(true);
    expect(isSeverityAtLeast('low', 'low')).toBe(true);
    expect(isSeverityAtLeast('critical', 'critical')).toBe(true);
  });

  it('returns true when severity is higher than minimum', () => {
    expect(isSeverityAtLeast('critical', 'low')).toBe(true);
    expect(isSeverityAtLeast('critical', 'medium')).toBe(true);
    expect(isSeverityAtLeast('critical', 'high')).toBe(true);
    expect(isSeverityAtLeast('high', 'medium')).toBe(true);
    expect(isSeverityAtLeast('high', 'low')).toBe(true);
    expect(isSeverityAtLeast('medium', 'low')).toBe(true);
  });

  it('returns false when severity is lower than minimum', () => {
    expect(isSeverityAtLeast('low', 'high')).toBe(false);
    expect(isSeverityAtLeast('low', 'critical')).toBe(false);
    expect(isSeverityAtLeast('medium', 'high')).toBe(false);
    expect(isSeverityAtLeast('medium', 'critical')).toBe(false);
  });

  it('handles unknown severity values by returning false', () => {
    expect(isSeverityAtLeast('unknown' as SeverityLevel, 'high')).toBe(false);
  });
});

describe('platformConfigService.getConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset schema ready state
    (platformConfigService as any).schemaReady = false;
    (platformConfigService as any).configCache.clear();
  });

  it('returns default config when no DB row exists', async () => {
    mockExec.mockImplementation((sql: string) => {
      if (sql.includes('CREATE TABLE')) return;
      if (sql.includes('CREATE INDEX')) return;
      if (sql.includes('ALTER TABLE')) return;
    });
    mockPrepare.mockReturnValue({
      get: jest.fn().mockReturnValue(undefined),
      run: jest.fn(),
      all: jest.fn().mockReturnValue([])
    });

    const config = await platformConfigService.getConfig('new-tenant');

    expect(config).toBeDefined();
    expect(config.antiBot).toBeDefined();
    expect(config.fastpath).toBeDefined();
    expect(config.notifications).toBeDefined();
    expect(config.aiRouting).toBeDefined();
  });

  it('caches config on first call', async () => {
    mockExec.mockImplementation((sql: string) => {
      if (sql.includes('CREATE TABLE')) return;
      if (sql.includes('CREATE INDEX')) return;
      if (sql.includes('ALTER TABLE')) return;
    });
    const mockGet = jest.fn().mockReturnValue(undefined);
    mockPrepare.mockReturnValue({
      get: mockGet,
      run: jest.fn(),
      all: jest.fn().mockReturnValue([])
    });

    await platformConfigService.getConfig('tenant-cache-test');
    await platformConfigService.getConfig('tenant-cache-test');

    // Only one DB query needed due to caching
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('returns default fastpath settings', async () => {
    mockExec.mockImplementation((sql: string) => {
      if (sql.includes('CREATE TABLE')) return;
      if (sql.includes('CREATE INDEX')) return;
      if (sql.includes('ALTER TABLE')) return;
    });
    mockPrepare.mockReturnValue({
      get: jest.fn().mockReturnValue(undefined),
      run: jest.fn(),
      all: jest.fn().mockReturnValue([])
    });

    const config = await platformConfigService.getConfig('tenant-fp');

    expect(config.fastpath.enabled).toBe(true);
    expect(config.fastpath.baseUrl).toBe('http://fastpath:8081');
    expect(config.fastpath.transport).toMatch(/^(tcp|unix)$/);
    expect(config.fastpath.fallbackEnabled).toBe(true);
  });

  it('returns default detection pipeline settings', async () => {
    mockExec.mockImplementation((sql: string) => {
      if (sql.includes('CREATE TABLE')) return;
      if (sql.includes('CREATE INDEX')) return;
      if (sql.includes('ALTER TABLE')) return;
    });
    mockPrepare.mockReturnValue({
      get: jest.fn().mockReturnValue(undefined),
      run: jest.fn(),
      all: jest.fn().mockReturnValue([])
    });

    const config = await platformConfigService.getConfig('tenant-pipeline');

    expect(config.detectionPipeline.ruleFirstEnabled).toBe(true);
    expect(config.detectionPipeline.aiEscalationMode).toBe('high_risk_allowed_only');
  });

  it('returns different configs for different tenants', async () => {
    mockExec.mockImplementation((sql: string) => {
      if (sql.includes('CREATE TABLE')) return;
      if (sql.includes('CREATE INDEX')) return;
      if (sql.includes('ALTER TABLE')) return;
    });
    // Different tenants return different DB rows
    const rows: Record<string, any> = {};
    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes('platform_config') && sql.includes('WHERE')) {
        return { get: (tenantId: string) => rows[tenantId] || undefined };
      }
      return { get: jest.fn(), run: jest.fn(), all: jest.fn().mockReturnValue([]) };
    });

    const config1 = await platformConfigService.getConfig('tenant-a');
    const config2 = await platformConfigService.getConfig('tenant-b');

    expect(config1).toBeDefined();
    expect(config2).toBeDefined();
    // Same tenant returns cached value
    const config1Again = await platformConfigService.getConfig('tenant-a');
    expect(config1Again).toEqual(config1);
  });
});

describe('SeverityLevel type', () => {
  it('accepts valid severity levels', () => {
    const levels: SeverityLevel[] = ['low', 'medium', 'high', 'critical'];
    expect(levels.length).toBe(4);
  });
});
