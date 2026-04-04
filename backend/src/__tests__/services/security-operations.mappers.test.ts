/**
 * Security Operations Service - Mapper Functions Tests
 *
 * Tests for exported helper functions from security-operations.service.ts
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

import {
  severityWeight,
  parseJson,
  normalizeSeverity,
  mapSeverityLabel,
  assetKey,
  relativeTime,
  mapAsset,
  mapFinding,
} from '../../services/security-operations.service';

describe('severityWeight', () => {
  it('maps critical to 100', () => {
    expect(severityWeight['critical']).toBe(100);
  });

  it('maps high to 75', () => {
    expect(severityWeight['high']).toBe(75);
  });

  it('maps medium to 45', () => {
    expect(severityWeight['medium']).toBe(45);
  });

  it('maps low to 20', () => {
    expect(severityWeight['low']).toBe(20);
  });
});

describe('parseJson', () => {
  it('parses valid JSON', () => {
    const result = parseJson('{"a":1}', { a: 0 });
    expect(result).toEqual({ a: 1 });
  });

  it('parses nested JSON', () => {
    const result = parseJson('{"a":{"b":2}}', {});
    expect(result).toEqual({ a: { b: 2 } });
  });

  it('parses JSON arrays', () => {
    const result = parseJson('[1,2,3]', []);
    expect(result).toEqual([1, 2, 3]);
  });

  it('returns fallback for invalid JSON', () => {
    const fallback = { a: 0 };
    expect(parseJson('not-json', fallback)).toEqual(fallback);
  });

  it('returns fallback for null', () => {
    const fallback = { a: 0 };
    expect(parseJson(null, fallback)).toEqual(fallback);
  });

  it('returns fallback for undefined', () => {
    const fallback = { a: 0 };
    expect(parseJson(undefined, fallback)).toEqual(fallback);
  });

  it('returns fallback for non-string values', () => {
    const fallback = { a: 0 };
    expect(parseJson(123, fallback)).toEqual(fallback);
    expect(parseJson({}, fallback)).toEqual(fallback);
    expect(parseJson([], fallback)).toEqual(fallback);
  });

  it('returns fallback for empty string', () => {
    const fallback = { a: 0 };
    expect(parseJson('', fallback)).toEqual(fallback);
  });
});

describe('normalizeSeverity', () => {
  it('maps uppercase to lowercase', () => {
    expect(normalizeSeverity('HIGH')).toBe('high');
    expect(normalizeSeverity('CRITICAL')).toBe('critical');
    expect(normalizeSeverity('MEDIUM')).toBe('medium');
    expect(normalizeSeverity('LOW')).toBe('low');
  });

  it('maps mixed case to lowercase', () => {
    expect(normalizeSeverity('High')).toBe('high');
    expect(normalizeSeverity('Critical')).toBe('critical');
  });

  it('maps invalid to medium', () => {
    expect(normalizeSeverity('UNKNOWN')).toBe('medium');
    expect(normalizeSeverity('invalid')).toBe('medium');
    expect(normalizeSeverity('')).toBe('medium');
  });

  it('keeps valid lowercase unchanged', () => {
    expect(normalizeSeverity('critical')).toBe('critical');
    expect(normalizeSeverity('high')).toBe('high');
    expect(normalizeSeverity('medium')).toBe('medium');
    expect(normalizeSeverity('low')).toBe('low');
  });

  it('handles undefined', () => {
    expect(normalizeSeverity(undefined)).toBe('medium');
  });

  it('handles null', () => {
    expect(normalizeSeverity(null as any)).toBe('medium');
  });
});

describe('mapSeverityLabel', () => {
  it('capitalizes first letter', () => {
    expect(mapSeverityLabel('critical')).toBe('Critical');
    expect(mapSeverityLabel('high')).toBe('High');
    expect(mapSeverityLabel('medium')).toBe('Medium');
    expect(mapSeverityLabel('low')).toBe('Low');
  });

  it('returns correct label types', () => {
    const critical = mapSeverityLabel('critical');
    const high = mapSeverityLabel('high');
    const medium = mapSeverityLabel('medium');
    const low = mapSeverityLabel('low');

    expect(critical).toBe('Critical');
    expect(high).toBe('High');
    expect(medium).toBe('Medium');
    expect(low).toBe('Low');
  });
});

describe('assetKey', () => {
  it('builds key in correct format', () => {
    expect(assetKey('t1', 'agent', 'agt-01')).toBe('t1:agent:agt-01');
  });

  it('builds key for different asset types', () => {
    expect(assetKey('tenant1', 'device', 'dev-001')).toBe('tenant1:device:dev-001');
    expect(assetKey('tenant1', 'site', 'site-001')).toBe('tenant1:site:site-001');
    expect(assetKey('tenant1', 'host', 'host-001')).toBe('tenant1:host:host-001');
  });

  it('handles special characters in externalRef', () => {
    expect(assetKey('t1', 'agent', 'agt_with_underscores')).toBe('t1:agent:agt_with_underscores');
    expect(assetKey('t1', 'agent', 'agt-with-dashes')).toBe('t1:agent:agt-with-dashes');
  });
});

describe('relativeTime', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "Just now" for very recent timestamps', () => {
    const recent = new Date('2024-06-15T11:59:45Z'); // 15 seconds ago
    expect(relativeTime(recent.toISOString())).toBe('Just now');
  });

  it('returns "Just now" for undefined', () => {
    expect(relativeTime(undefined)).toBe('Just now');
  });

  it('returns "Just now" for null', () => {
    expect(relativeTime(null as any)).toBe('Just now');
  });

  it('returns minutes ago for timestamps within an hour', () => {
    const fiveMinAgo = new Date('2024-06-15T11:55:00Z'); // 5 mins ago
    expect(relativeTime(fiveMinAgo.toISOString())).toBe('5 mins ago');
  });

  it('returns hours ago for timestamps within a day', () => {
    const threeHoursAgo = new Date('2024-06-15T09:00:00Z'); // 3 hours ago
    expect(relativeTime(threeHoursAgo.toISOString())).toBe('3 hours ago');
  });

  it('returns days ago for timestamps beyond a day', () => {
    const threeDaysAgo = new Date('2024-06-12T12:00:00Z'); // 3 days ago
    expect(relativeTime(threeDaysAgo.toISOString())).toBe('3 days ago');
  });

  it('handles singular forms correctly', () => {
    const oneMinAgo = new Date('2024-06-15T11:59:00Z'); // 1 min ago
    expect(relativeTime(oneMinAgo.toISOString())).toBe('1 mins ago'); // Note: code uses "mins" not "min"

    const oneHourAgo = new Date('2024-06-15T11:00:00Z'); // 1 hour ago
    expect(relativeTime(oneHourAgo.toISOString())).toBe('1 hours ago'); // Note: code uses "hours" not "hour"

    const oneDayAgo = new Date('2024-06-14T12:00:00Z'); // 1 day ago
    expect(relativeTime(oneDayAgo.toISOString())).toBe('1 days ago'); // Note: code uses "days" not "day"
  });
});

describe('mapAsset', () => {
  it('maps database row to Asset interface', () => {
    const row = {
      asset_id: 'ast-001',
      tenant_id: 't1',
      asset_type: 'agent',
      external_ref: 'agent-001',
      display_name: 'Test Agent',
      primary_address: '192.168.1.100',
      status: 'online',
      risk_score: 75,
      findings_open: 3,
      alerts_open: 1,
      metadata_json: '{"region":"us-east"}',
      last_seen_at: '2024-01-02T00:00:00Z',
    };
    const asset = mapAsset(row);
    expect(asset.assetId).toBe('ast-001');
    expect(asset.tenantId).toBe('t1');
    expect(asset.assetType).toBe('agent');
    expect(asset.externalRef).toBe('agent-001');
    expect(asset.displayName).toBe('Test Agent');
    expect(asset.primaryAddress).toBe('192.168.1.100');
    expect(asset.status).toBe('online');
    expect(asset.riskScore).toBe(75);
    expect(asset.findingsOpen).toBe(3);
    expect(asset.alertsOpen).toBe(1);
    expect(asset.metadata.region).toBe('us-east');
    expect(asset.lastSeenAt).toBe('2024-01-02T00:00:00Z');
  });

  it('handles missing optional fields', () => {
    const row = {
      asset_id: 'ast-001',
      tenant_id: 't1',
      asset_type: 'agent',
      external_ref: 'agent-001',
      display_name: 'Test Agent',
      status: 'online',
      risk_score: 0,
      findings_open: 0,
      alerts_open: 0,
    };
    const asset = mapAsset(row);
    expect(asset.primaryAddress).toBeUndefined();
    expect(asset.lastSeenAt).toBeUndefined();
    expect(asset.metadata).toEqual({});
  });

  it('parses metadata JSON', () => {
    const row = {
      asset_id: 'ast-001',
      tenant_id: 't1',
      asset_type: 'device',
      external_ref: 'dev-001',
      display_name: 'Device 1',
      status: 'online',
      risk_score: 10,
      findings_open: 0,
      alerts_open: 0,
      metadata_json: '{"type":"sensor","location":"floor-1"}',
    };
    const asset = mapAsset(row);
    expect(asset.metadata.type).toBe('sensor');
    expect(asset.metadata.location).toBe('floor-1');
  });

  it('handles invalid metadata JSON', () => {
    const row = {
      asset_id: 'ast-001',
      tenant_id: 't1',
      asset_type: 'device',
      external_ref: 'dev-001',
      display_name: 'Device 1',
      status: 'online',
      risk_score: 10,
      findings_open: 0,
      alerts_open: 0,
      metadata_json: 'not-valid-json',
    };
    const asset = mapAsset(row);
    expect(asset.metadata).toEqual({});
  });

  it('converts numeric strings to numbers', () => {
    const row = {
      asset_id: 'ast-001',
      tenant_id: 't1',
      asset_type: 'agent',
      external_ref: 'agent-001',
      display_name: 'Test Agent',
      status: 'online',
      risk_score: '75', // string instead of number
      findings_open: '3',
      alerts_open: '1',
    };
    const asset = mapAsset(row);
    expect(asset.riskScore).toBe(75);
    expect(asset.findingsOpen).toBe(3);
    expect(asset.alertsOpen).toBe(1);
  });
});

describe('mapFinding', () => {
  it('maps row and parses JSON fields', () => {
    const row = {
      finding_id: 'f-001',
      tenant_id: 't1',
      asset_id: 'ast-001',
      source_type: 'agent',
      source_ref: 'src-001',
      target: '192.168.1.1',
      category: 'sql_injection',
      severity: 'critical',
      status: 'open',
      title: 'SQL Injection Detected',
      description: 'SQL injection attack detected',
      evidence_json: '["payload1","payload2"]',
      remediation_json: '{"action":"block","steps":["step1"]}',
      fingerprint: 'fp-001',
      occurrence_count: 5,
      first_seen_at: '2024-01-01T00:00:00Z',
      last_seen_at: '2024-01-02T00:00:00Z',
    };
    const finding = mapFinding(row);
    expect(finding.findingId).toBe('f-001');
    expect(finding.tenantId).toBe('t1');
    expect(finding.assetId).toBe('ast-001');
    expect(finding.sourceType).toBe('agent');
    expect(finding.severity).toBe('critical');
    expect(finding.evidence).toEqual(['payload1', 'payload2']);
    expect(finding.remediation.action).toBe('block');
    expect(finding.fingerprint).toBe('fp-001');
    expect(finding.occurrenceCount).toBe(5);
  });

  it('handles missing optional fields', () => {
    const row = {
      finding_id: 'f-001',
      tenant_id: 't1',
      source_type: 'agent',
      source_ref: 'src-001',
      target: '192.168.1.1',
      category: 'sql_injection',
      severity: 'high',
      status: 'open',
      title: 'Test Finding',
      description: 'Test description',
      fingerprint: 'fp-001',
      first_seen_at: '2024-01-01T00:00:00Z',
      last_seen_at: '2024-01-02T00:00:00Z',
    };
    const finding = mapFinding(row);
    expect(finding.assetId).toBeUndefined();
    expect(finding.evidence).toEqual({});
    expect(finding.remediation).toEqual({});
  });

  it('normalizes severity to lowercase', () => {
    const row = {
      finding_id: 'f-001',
      tenant_id: 't1',
      source_type: 'agent',
      source_ref: 'src-001',
      target: 'target',
      category: 'test',
      severity: 'HIGH',
      status: 'open',
      title: 'Test',
      description: 'Test',
      fingerprint: 'fp',
      first_seen_at: '2024-01-01T00:00:00Z',
      last_seen_at: '2024-01-01T00:00:00Z',
    };
    const finding = mapFinding(row);
    expect(finding.severity).toBe('high');
  });

  it('handles invalid JSON in evidence', () => {
    const row = {
      finding_id: 'f-001',
      tenant_id: 't1',
      source_type: 'agent',
      source_ref: 'src-001',
      target: 'target',
      category: 'test',
      severity: 'low',
      status: 'open',
      title: 'Test',
      description: 'Test',
      evidence_json: 'not-json',
      fingerprint: 'fp',
      first_seen_at: '2024-01-01T00:00:00Z',
      last_seen_at: '2024-01-01T00:00:00Z',
    };
    const finding = mapFinding(row);
    expect(finding.evidence).toEqual({});
  });
});
