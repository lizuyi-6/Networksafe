/**
 * Tenant Oversight Service - Helper Functions Tests
 *
 * Tests for exported helper functions from tenant-oversight.service.ts
 */

jest.mock('../../config/database', () => ({
  getDatabase: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('../../services/postgres-shadow-store.service', () => ({
  postgresShadowStoreService: {
    canServeReads: jest.fn().mockReturnValue(false),
    upsert: jest.fn(),
    queryAll: jest.fn().mockResolvedValue([]),
    queryOne: jest.fn().mockResolvedValue(null),
    execute: jest.fn().mockResolvedValue(0),
  },
}));

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    getDashboardSummary: jest.fn().mockReturnValue({
      openCriticalFindings: 0,
      highRiskFindings: 0,
      activeAlerts: 0,
      runningScans: 0,
      queuedScans: 0,
      pendingActions: 0,
      failedValidations: 0,
      assetsAtRisk: 0,
      observedSessions: 0,
      trafficAnomalies: 0,
      recentActions: [],
      recentValidations: [],
    }),
    listAlerts: jest.fn().mockReturnValue([]),
    listActions: jest.fn().mockReturnValue([]),
    listValidationRuns: jest.fn().mockReturnValue([]),
  },
}));

jest.mock('../../services/scanner-task.service', () => ({
  scannerTaskService: {
    getHistory: jest.fn().mockReturnValue([]),
    getHistoryView: jest.fn().mockResolvedValue([]),
    getTask: jest.fn(),
    getTaskResults: jest.fn(),
    getTaskView: jest.fn(),
    getTaskResultsView: jest.fn(),
  },
}));

jest.mock('../../security/audit-logger.service', () => ({
  __esModule: true,
  default: {
    getLogs: jest.fn().mockReturnValue([]),
    getLogsView: jest.fn().mockResolvedValue([]),
    verifyIntegrity: jest.fn().mockReturnValue(true),
    verifyIntegrityView: jest.fn().mockResolvedValue(true),
    getLogByIdView: jest.fn(),
  },
}));

import {
  severityWeight,
  buildWindow,
  withinWindow,
  matchesUser,
  toTimelineEvent,
} from '../../services/tenant-oversight.service';

describe('severityWeight', () => {
  it('maps critical to 4', () => {
    expect(severityWeight('critical')).toBe(4);
  });

  it('maps high to 3', () => {
    expect(severityWeight('high')).toBe(3);
  });

  it('maps medium to 2', () => {
    expect(severityWeight('medium')).toBe(2);
  });

  it('maps low to 1', () => {
    expect(severityWeight('low')).toBe(1);
  });

  it('returns 0 for unknown', () => {
    expect(severityWeight('unknown')).toBe(0);
    expect(severityWeight('')).toBe(0);
    expect(severityWeight(undefined)).toBe(0);
  });

  it('is case insensitive', () => {
    expect(severityWeight('CRITICAL')).toBe(4);
    expect(severityWeight('HIGH')).toBe(3);
    expect(severityWeight('Medium')).toBe(2);
    expect(severityWeight('Low')).toBe(1);
  });
});

describe('buildWindow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns empty object for all', () => {
    const result = buildWindow('all');
    expect(result).toEqual({});
  });

  it('returns empty object for undefined', () => {
    const result = buildWindow(undefined);
    expect(result).toEqual({});
  });

  it('returns empty object for invalid range', () => {
    expect(buildWindow('invalid')).toEqual({});
    expect(buildWindow('-5')).toEqual({});
    expect(buildWindow('0')).toEqual({});
  });

  it('returns 7-day window for 7', () => {
    const result = buildWindow('7');
    expect(result).toHaveProperty('from');
    expect(result).toHaveProperty('to');
    const daysDiff = (new Date(result.to!).getTime() - new Date(result.from!).getTime()) / (1000 * 60 * 60 * 24);
    expect(Math.round(daysDiff)).toBe(7);
  });

  it('returns 30-day window for 30', () => {
    const result = buildWindow('30');
    const daysDiff = (new Date(result.to!).getTime() - new Date(result.from!).getTime()) / (1000 * 60 * 60 * 24);
    expect(Math.round(daysDiff)).toBe(30);
  });

  it('returns 1-day window for 1', () => {
    const result = buildWindow('1');
    const daysDiff = (new Date(result.to!).getTime() - new Date(result.from!).getTime()) / (1000 * 60 * 60 * 24);
    expect(Math.round(daysDiff)).toBe(1);
  });

  it('handles string numbers', () => {
    const result = buildWindow('14');
    expect(result).toHaveProperty('from');
    expect(result).toHaveProperty('to');
    const daysDiff = (new Date(result.to!).getTime() - new Date(result.from!).getTime()) / (1000 * 60 * 60 * 24);
    expect(Math.round(daysDiff)).toBe(14);
  });
});

describe('withinWindow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns true when timestamp within window', () => {
    const now = new Date();
    const filters = {
      tenantId: 't1',
      from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      to: now.toISOString()
    };
    const recent = new Date(now.getTime() - 1000).toISOString();
    expect(withinWindow(recent, filters)).toBe(true);
  });

  it('returns false when timestamp outside window (too old)', () => {
    const now = new Date();
    const filters = {
      tenantId: 't1',
      from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      to: now.toISOString()
    };
    const old = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(withinWindow(old, filters)).toBe(false);
  });

  it('returns false when timestamp is in the future', () => {
    const now = new Date();
    const filters = {
      tenantId: 't1',
      from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      to: now.toISOString()
    };
    const future = new Date(now.getTime() + 60 * 1000).toISOString();
    expect(withinWindow(future, filters)).toBe(false);
  });

  it('returns true for undefined timestamp', () => {
    const filters = { tenantId: 't1' };
    expect(withinWindow(undefined, filters)).toBe(true);
  });

  it('returns true when only "from" is set and timestamp is after', () => {
    const now = new Date();
    const filters = {
      tenantId: 't1',
      from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    };
    const recent = new Date(now.getTime() - 1000).toISOString();
    expect(withinWindow(recent, filters)).toBe(true);
  });

  it('returns true when only "to" is set and timestamp is before', () => {
    const now = new Date();
    const filters = {
      tenantId: 't1',
      to: now.toISOString()
    };
    const recent = new Date(now.getTime() - 1000).toISOString();
    expect(withinWindow(recent, filters)).toBe(true);
  });

  it('returns true when no from/to filters set', () => {
    const filters = { tenantId: 't1' };
    const timestamp = new Date().toISOString();
    expect(withinWindow(timestamp, filters)).toBe(true);
  });
});

describe('matchesUser', () => {
  it('returns true when userId matches', () => {
    const user = { userId: 'u1', email: 'test@test.com' };
    const filters = { tenantId: 't1', userId: 'u1' };
    expect(matchesUser(user, filters, 'u1', 'test@test.com')).toBe(true);
  });

  it('returns false when userId does not match', () => {
    const user = { userId: 'u1', email: 'test@test.com' };
    const filters = { tenantId: 't1', userId: 'u2' };
    // Neither actorId nor actorEmail match
    expect(matchesUser(user, filters, 'u1', 'different@test.com')).toBe(false);
  });

  it('returns true when filters.userId is not set', () => {
    const user = { userId: 'u1', email: 'test@test.com' };
    const filters = { tenantId: 't1' };
    expect(matchesUser(user, filters, 'u1', 'test@test.com')).toBe(true);
  });

  it('returns true when actorEmail matches user.email', () => {
    const user = { userId: 'u1', email: 'test@test.com' };
    const filters = { tenantId: 't1', userId: 'u2' };
    expect(matchesUser(user, filters, 'u2', 'test@test.com')).toBe(true);
  });

  it('returns false when neither actorId nor actorEmail matches', () => {
    const user = { userId: 'u1', email: 'test@test.com' };
    const filters = { tenantId: 't1', userId: 'u3' };
    expect(matchesUser(user, filters, 'u2', 'other@test.com')).toBe(false);
  });

  it('handles null user', () => {
    const filters = { tenantId: 't1', userId: 'u1' };
    expect(matchesUser(null, filters, 'u1', 'test@test.com')).toBe(true);
    expect(matchesUser(null, filters, 'u2', 'test@test.com')).toBe(false);
  });
});

describe('toTimelineEvent', () => {
  it('applies default severity info when not provided', () => {
    const input = {
      id: '1',
      tenantId: 't1',
      category: 'alert' as const,
      action: 'test_action',
      status: 'completed',
      timestamp: new Date().toISOString(),
      source: 'test',
    };
    const result = toTimelineEvent(input);
    expect(result.severity).toBe('info');
  });

  it('preserves provided severity', () => {
    const input = {
      id: '1',
      tenantId: 't1',
      category: 'alert' as const,
      action: 'test_action',
      status: 'completed',
      timestamp: new Date().toISOString(),
      source: 'test',
      severity: 'critical',
    };
    const result = toTimelineEvent(input);
    expect(result.severity).toBe('critical');
  });

  it('applies empty array for evidenceRefs when not provided', () => {
    const input = {
      id: '1',
      tenantId: 't1',
      category: 'alert' as const,
      action: 'test_action',
      status: 'completed',
      timestamp: new Date().toISOString(),
      source: 'test',
    };
    const result = toTimelineEvent(input);
    expect(result.evidenceRefs).toEqual([]);
  });

  it('preserves provided evidenceRefs', () => {
    const input = {
      id: '1',
      tenantId: 't1',
      category: 'alert' as const,
      action: 'test_action',
      status: 'completed',
      timestamp: new Date().toISOString(),
      source: 'test',
      evidenceRefs: ['e1', 'e2'],
    };
    const result = toTimelineEvent(input);
    expect(result.evidenceRefs).toEqual(['e1', 'e2']);
  });

  it('maps all fields correctly', () => {
    const input = {
      id: 'event-1',
      tenantId: 'tenant-1',
      category: 'scanner' as const,
      action: 'scan_completed',
      status: 'success',
      timestamp: '2024-01-01T00:00:00Z',
      source: 'scanner',
      severity: 'high',
      evidenceRefs: ['evidence-1'],
      actor: { type: 'user', id: 'user-1' },
      target: { type: 'scan', id: 'scan-1' },
      details: { findingCount: 5 },
    };
    const result = toTimelineEvent(input);
    expect(result.id).toBe('event-1');
    expect(result.tenantId).toBe('tenant-1');
    expect(result.category).toBe('scanner');
    expect(result.action).toBe('scan_completed');
    expect(result.status).toBe('success');
    expect(result.timestamp).toBe('2024-01-01T00:00:00Z');
    expect(result.source).toBe('scanner');
    expect(result.severity).toBe('high');
    expect(result.evidenceRefs).toEqual(['evidence-1']);
    expect(result.actor).toEqual({ type: 'user', id: 'user-1' });
    expect(result.target).toEqual({ type: 'scan', id: 'scan-1' });
    expect(result.details).toEqual({ findingCount: 5 });
  });
});
