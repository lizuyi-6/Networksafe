/**
 * Security Operations Service - Helper Functions Tests
 *
 * Tests for exported pure helper functions from security-operations.service.ts
 */

import {
  parseJson,
  normalizeSeverity,
  mapSeverityLabel,
  assetKey,
  relativeTime,
  mapAsset,
  mapFinding,
  severityWeight,
} from '../../services/security-operations.service';

describe('security-operations helpers', () => {
  // ── parseJson ────────────────────────────────────────────────────────

  describe('parseJson', () => {
    it('parses valid JSON string', () => {
      const result = parseJson('{"key":"value"}', {});
      expect(result).toEqual({ key: 'value' });
    });

    it('parses JSON array', () => {
      const result = parseJson('[1,2,3]', []);
      expect(result).toEqual([1, 2, 3]);
    });

    it('returns fallback for invalid JSON', () => {
      const fallback = { default: true };
      const result = parseJson('not valid json', fallback);
      expect(result).toBe(fallback);
    });

    it('returns fallback for null input', () => {
      const fallback = { default: true };
      const result = parseJson(null, fallback);
      expect(result).toBe(fallback);
    });

    it('returns fallback for undefined input', () => {
      const fallback = [];
      const result = parseJson(undefined, fallback);
      expect(result).toBe(fallback);
    });

    it('returns fallback for empty string', () => {
      const fallback = { empty: true };
      const result = parseJson('', fallback);
      expect(result).toBe(fallback);
    });

    it('returns fallback for object input (only strings parsed)', () => {
      const obj = { key: 'value' };
      const fallback = { default: true };
      const result = parseJson(obj, fallback);
      expect(result).toBe(fallback);
    });

    it('parses nested JSON objects', () => {
      const result = parseJson('{"a":{"b":1}}', {});
      expect(result).toEqual({ a: { b: 1 } });
    });
  });

  // ── normalizeSeverity ────────────────────────────────────────────────

  describe('normalizeSeverity', () => {
    it('returns critical for critical input', () => {
      expect(normalizeSeverity('critical')).toBe('critical');
    });

    it('returns high for high input', () => {
      expect(normalizeSeverity('high')).toBe('high');
    });

    it('returns medium for medium input', () => {
      expect(normalizeSeverity('medium')).toBe('medium');
    });

    it('returns low for low input', () => {
      expect(normalizeSeverity('low')).toBe('low');
    });

    it('returns medium for undefined input', () => {
      expect(normalizeSeverity(undefined)).toBe('medium');
    });

    it('returns medium for unknown severity', () => {
      expect(normalizeSeverity('unknown')).toBe('medium');
    });

    it('returns medium for empty string', () => {
      expect(normalizeSeverity('')).toBe('medium');
    });

    it('is case insensitive (converts to lowercase)', () => {
      expect(normalizeSeverity('CRITICAL')).toBe('critical');
      expect(normalizeSeverity('High')).toBe('high');
      expect(normalizeSeverity('MEDIUM')).toBe('medium');
      expect(normalizeSeverity('Low')).toBe('low');
    });
  });

  // ── mapSeverityLabel ─────────────────────────────────────────────────

  describe('mapSeverityLabel', () => {
    it('maps critical to Critical', () => {
      expect(mapSeverityLabel('critical')).toBe('Critical');
    });

    it('maps high to High', () => {
      expect(mapSeverityLabel('high')).toBe('High');
    });

    it('maps medium to Medium', () => {
      expect(mapSeverityLabel('medium')).toBe('Medium');
    });

    it('maps low to Low', () => {
      expect(mapSeverityLabel('low')).toBe('Low');
    });
  });

  // ── assetKey ─────────────────────────────────────────────────────────

  describe('assetKey', () => {
    it('creates key with tenant, type and ref', () => {
      expect(assetKey('tenant-1', 'url', 'https://example.com')).toBe('tenant-1:url:https://example.com');
    });

    it('creates key for ip asset type', () => {
      expect(assetKey('tenant-2', 'ip', '192.168.1.1')).toBe('tenant-2:ip:192.168.1.1');
    });

    it('creates key for host asset type', () => {
      expect(assetKey('tenant-3', 'host', 'server-01')).toBe('tenant-3:host:server-01');
    });

    it('handles special characters in externalRef', () => {
      expect(assetKey('t1', 'url', 'https://example.com/path?query=1')).toBe('t1:url:https://example.com/path?query=1');
    });
  });

  // ── relativeTime ──────────────────────────────────────────────────────

  describe('relativeTime', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns "Just now" for undefined timestamp', () => {
      expect(relativeTime(undefined)).toBe('Just now');
    });

    it('returns "Just now" for recent timestamp (< 1 min)', () => {
      const recent = new Date('2024-01-15T11:59:30Z').toISOString();
      expect(relativeTime(recent)).toBe('Just now');
    });

    it('returns "X mins ago" for timestamps within hour', () => {
      const fiveMinsAgo = new Date('2024-01-15T11:55:00Z').toISOString();
      expect(relativeTime(fiveMinsAgo)).toBe('5 mins ago');
    });

    it('returns "1 mins ago" for 1 minute ago', () => {
      const oneMinAgo = new Date('2024-01-15T11:59:00Z').toISOString();
      expect(relativeTime(oneMinAgo)).toBe('1 mins ago');
    });

    it('returns "X hours ago" for timestamps within day', () => {
      const twoHoursAgo = new Date('2024-01-15T10:00:00Z').toISOString();
      expect(relativeTime(twoHoursAgo)).toBe('2 hours ago');
    });

    it('returns "X days ago" for timestamps older than day', () => {
      const threeDaysAgo = new Date('2024-01-12T12:00:00Z').toISOString();
      expect(relativeTime(threeDaysAgo)).toBe('3 days ago');
    });

    it('handles exact minute boundary (converts to hours)', () => {
      const exactly60MinsAgo = new Date('2024-01-15T11:00:00Z').toISOString();
      expect(relativeTime(exactly60MinsAgo)).toBe('1 hours ago');
    });
  });

  // ── severityWeight ────────────────────────────────────────────────────

  describe('severityWeight', () => {
    it('critical has weight 100', () => {
      expect(severityWeight.critical).toBe(100);
    });

    it('high has weight 75', () => {
      expect(severityWeight.high).toBe(75);
    });

    it('medium has weight 45', () => {
      expect(severityWeight.medium).toBe(45);
    });

    it('low has weight 20', () => {
      expect(severityWeight.low).toBe(20);
    });
  });

  // ── mapAsset ───────────────────────────────────────────────────────────

  describe('mapAsset', () => {
    it('maps database row to AssetSummary', () => {
      const row = {
        asset_id: 'asset-1',
        tenant_id: 'tenant-1',
        asset_type: 'url',
        external_ref: 'https://example.com',
        display_name: 'Example Site',
        primary_address: '192.168.1.1',
        status: 'active',
        risk_score: 75,
        findings_open: 3,
        alerts_open: 1,
        metadata_json: '{"owner":"admin"}',
        last_seen_at: '2024-01-15T10:00:00Z',
      };

      const result = mapAsset(row);

      expect(result.assetId).toBe('asset-1');
      expect(result.tenantId).toBe('tenant-1');
      expect(result.assetType).toBe('url');
      expect(result.externalRef).toBe('https://example.com');
      expect(result.displayName).toBe('Example Site');
      expect(result.primaryAddress).toBe('192.168.1.1');
      expect(result.status).toBe('active');
      expect(result.riskScore).toBe(75);
      expect(result.findingsOpen).toBe(3);
      expect(result.alertsOpen).toBe(1);
      expect(result.metadata).toEqual({ owner: 'admin' });
      expect(result.lastSeenAt).toBe('2024-01-15T10:00:00Z');
    });

    it('handles null primary_address', () => {
      const row = {
        asset_id: 'asset-1',
        tenant_id: 'tenant-1',
        asset_type: 'ip',
        external_ref: '192.168.1.1',
        display_name: 'Server',
        primary_address: null,
        status: 'active',
        risk_score: 0,
        findings_open: 0,
        alerts_open: 0,
        metadata_json: null,
        last_seen_at: null,
      };

      const result = mapAsset(row);

      expect(result.primaryAddress).toBeUndefined();
      expect(result.metadata).toEqual({});
      expect(result.lastSeenAt).toBeUndefined();
    });

    it('handles undefined fields', () => {
      const row = {
        asset_id: 'asset-1',
        tenant_id: 'tenant-1',
        asset_type: 'host',
        external_ref: 'server-01',
        display_name: 'Server 01',
        status: 'inactive',
        risk_score: null,
        findings_open: null,
        alerts_open: null,
      };

      const result = mapAsset(row);

      expect(result.riskScore).toBe(0);
      expect(result.findingsOpen).toBe(0);
      expect(result.alertsOpen).toBe(0);
      expect(result.metadata).toEqual({});
    });

    it('parses metadata_json correctly', () => {
      const row = {
        asset_id: 'asset-1',
        tenant_id: 'tenant-1',
        asset_type: 'service',
        external_ref: 'api-v1',
        display_name: 'API Service',
        status: 'active',
        risk_score: 50,
        findings_open: 0,
        alerts_open: 0,
        metadata_json: '{"version":"1.0","team":"backend"}',
      };

      const result = mapAsset(row);

      expect(result.metadata).toEqual({ version: '1.0', team: 'backend' });
    });

    it('handles invalid metadata_json', () => {
      const row = {
        asset_id: 'asset-1',
        tenant_id: 'tenant-1',
        asset_type: 'device',
        external_ref: 'device-01',
        display_name: 'Device 01',
        status: 'active',
        risk_score: 0,
        findings_open: 0,
        alerts_open: 0,
        metadata_json: 'not valid json',
      };

      const result = mapAsset(row);

      expect(result.metadata).toEqual({});
    });
  });

  // ── mapFinding ─────────────────────────────────────────────────────────

  describe('mapFinding', () => {
    it('maps database row to FindingRecord', () => {
      const row = {
        finding_id: 'finding-1',
        tenant_id: 'tenant-1',
        asset_id: 'asset-1',
        source_type: 'scanner',
        source_ref: 'scan-123',
        target: 'https://example.com',
        category: 'xss',
        severity: 'high',
        status: 'open',
        title: 'XSS Vulnerability',
        description: 'Reflected XSS found',
        evidence_json: '{"payload":"<script>alert(1)</script>"}',
        remediation_json: '{"fix":"Sanitize input"}',
        fingerprint: 'fp-123',
        occurrence_count: 5,
        first_seen_at: '2024-01-10T10:00:00Z',
        last_seen_at: '2024-01-15T10:00:00Z',
      };

      const result = mapFinding(row);

      expect(result.findingId).toBe('finding-1');
      expect(result.tenantId).toBe('tenant-1');
      expect(result.assetId).toBe('asset-1');
      expect(result.sourceType).toBe('scanner');
      expect(result.sourceRef).toBe('scan-123');
      expect(result.target).toBe('https://example.com');
      expect(result.category).toBe('xss');
      expect(result.severity).toBe('high');
      expect(result.status).toBe('open');
      expect(result.title).toBe('XSS Vulnerability');
      expect(result.description).toBe('Reflected XSS found');
      expect(result.evidence).toEqual({ payload: '<script>alert(1)</script>' });
      expect(result.remediation).toEqual({ fix: 'Sanitize input' });
      expect(result.fingerprint).toBe('fp-123');
      expect(result.occurrenceCount).toBe(5);
      expect(result.firstSeenAt).toBe('2024-01-10T10:00:00Z');
      expect(result.lastSeenAt).toBe('2024-01-15T10:00:00Z');
    });

    it('handles null asset_id', () => {
      const row = {
        finding_id: 'finding-1',
        tenant_id: 'tenant-1',
        asset_id: null,
        source_type: 'manual',
        source_ref: 'manual-1',
        target: '192.168.1.1',
        category: 'port-scan',
        severity: 'medium',
        status: 'open',
        title: 'Open Port',
        description: 'Port 22 is open',
        evidence_json: null,
        remediation_json: null,
        fingerprint: 'fp-456',
        occurrence_count: 1,
        first_seen_at: '2024-01-15T10:00:00Z',
        last_seen_at: '2024-01-15T10:00:00Z',
      };

      const result = mapFinding(row);

      expect(result.assetId).toBeUndefined();
      expect(result.evidence).toEqual({});
      expect(result.remediation).toEqual({});
    });

    it('parses JSON evidence and remediation', () => {
      const row = {
        finding_id: 'finding-1',
        tenant_id: 'tenant-1',
        source_type: 'scanner',
        source_ref: 'scan-1',
        target: 'example.com',
        category: 'sqli',
        severity: 'critical',
        status: 'open',
        title: 'SQL Injection',
        description: 'SQLi in login form',
        evidence_json: '{"request":"POST /login","parameter":"username"}',
        remediation_json: '{"solution":"Use prepared statements","priority":"high"}',
        fingerprint: 'fp-sqli-1',
        occurrence_count: 10,
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-15T00:00:00Z',
      };

      const result = mapFinding(row);

      expect(result.evidence).toEqual({ request: 'POST /login', parameter: 'username' });
      expect(result.remediation).toEqual({ solution: 'Use prepared statements', priority: 'high' });
    });
  });
});
