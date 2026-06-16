/**
 * Scanner Task Service - Helper Functions Tests
 *
 * Tests for pure helper functions exported from scanner-task.service.ts
 */

jest.mock('../../config/database', () => ({
  getDatabase: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('../../api/routes/ai-system.routes', () => ({
  getAgentGateway: jest.fn(),
  getTrafficStats: jest.fn().mockReturnValue({ packetsProcessed: 0, packetsInspected: 0, packetsAllowed: 0, packetsBlocked: 0, bytesProcessed: 0, activeFlows: [], threats: new Map() }),
}));

jest.mock('../../api/routes/devices.routes', () => ({
  getDeviceList: jest.fn().mockReturnValue([]),
}));

jest.mock('../../scanner/optimization-engine', () => ({
  OptimizationEngine: jest.fn(),
}));

jest.mock('../../scanner/nuclei-scanner', () => ({
  NucleiScanner: jest.fn(),
}));

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    upsertAsset: jest.fn().mockReturnValue({ assetId: 'test-asset-id' }),
    upsertTrafficSession: jest.fn(),
    syncSignalFinding: jest.fn(),
    getDashboardSummary: jest.fn().mockReturnValue({}),
    listAlerts: jest.fn().mockReturnValue([]),
    listActions: jest.fn().mockReturnValue([]),
    listValidationRuns: jest.fn().mockReturnValue([]),
  },
}));

jest.mock('../../services/job-queue.service', () => ({
  jobQueueService: {
    backend: jest.fn().mockReturnValue('memory'),
    drain: jest.fn().mockResolvedValue([]),
    enqueue: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../../services/artifact-store.service', () => ({
  artifactStoreService: {
    describe: jest.fn().mockReturnValue({ activeMode: 'memory' }),
  },
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
  compareSemver,
  isIp,
  ipToLong,
  longToIp,
  expandIpv4Cidr,
  normalizeSeverity,
} from '../../services/scanner-task.service';

describe('compareSemver', () => {
  it('returns 1 when left > right (patch version)', () => {
    expect(compareSemver('2.4.1', '2.4.0')).toBe(1);
    expect(compareSemver('1.0.9', '1.0.8')).toBe(1);
  });

  it('returns 1 when left > right (minor version)', () => {
    expect(compareSemver('2.4.0', '2.3.6')).toBe(1);
    expect(compareSemver('1.10.0', '1.9.0')).toBe(1);
  });

  it('returns 1 when left > right (major version)', () => {
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
    expect(compareSemver('3.0.0', '2.9.9')).toBe(1);
  });

  it('returns 0 when left === right', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('2.4.1', '2.4.1')).toBe(0);
  });

  it('returns -1 when left < right (patch version)', () => {
    expect(compareSemver('2.3.6', '2.3.7')).toBe(-1);
    expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
  });

  it('returns -1 when left < right (minor version)', () => {
    expect(compareSemver('2.3.6', '2.4.0')).toBe(-1);
    expect(compareSemver('1.9.0', '1.10.0')).toBe(-1);
  });

  it('returns -1 when left < right (major version)', () => {
    expect(compareSemver('1.9.9', '2.0.0')).toBe(-1);
    expect(compareSemver('2.9.9', '3.0.0')).toBe(-1);
  });

  it('handles missing version parts', () => {
    expect(compareSemver('1', '1.0.0')).toBe(0);
    expect(compareSemver('1.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.0', '1')).toBe(0);
  });

  it('handles non-numeric version parts as 0', () => {
    expect(compareSemver('1.a.0', '1.0.0')).toBe(0);
  });

  it('handles empty strings', () => {
    expect(compareSemver('', '')).toBe(0);
    expect(compareSemver('', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0', '')).toBe(1);
  });
});

describe('isIp', () => {
  it('returns truthy for IPv4', () => {
    expect(isIp('192.168.1.1')).toBeTruthy();
    expect(isIp('10.0.0.1')).toBeTruthy();
    expect(isIp('255.255.255.255')).toBeTruthy();
    expect(isIp('0.0.0.0')).toBeTruthy();
  });

  it('returns truthy for IPv6', () => {
    expect(isIp('::1')).toBeTruthy();
    expect(isIp('2001:db8::1')).toBeTruthy();
  });

  it('returns false for hostname', () => {
    expect(isIp('example.com')).toBe(false);
    expect(isIp('localhost')).toBe(false);
  });

  it('returns false for invalid strings', () => {
    expect(isIp('not-an-ip')).toBe(false);
    expect(isIp('256.256.256.256')).toBe(false);
    expect(isIp('')).toBe(false);
  });
});

describe('ipToLong and longToIp', () => {
  it('converts IPv4 to long and back', () => {
    const ip = '255.255.255.255';
    const long = ipToLong(ip);
    expect(long).toBe(0xffffffff);
    expect(longToIp(long)).toBe(ip);
  });

  it('roundtrips 0.0.0.0', () => {
    const ip = '0.0.0.0';
    expect(longToIp(ipToLong(ip))).toBe(ip);
  });

  it('roundtrips typical IP', () => {
    const ip = '192.168.1.100';
    expect(longToIp(ipToLong(ip))).toBe(ip);
  });

  it('roundtrips 127.0.0.1 (localhost)', () => {
    const ip = '127.0.0.1';
    expect(longToIp(ipToLong(ip))).toBe(ip);
  });

  it('roundtrips first IP in range', () => {
    const ip = '10.0.0.0';
    expect(longToIp(ipToLong(ip))).toBe(ip);
  });

  it('roundtrips last IP in range', () => {
    const ip = '10.255.255.255';
    expect(longToIp(ipToLong(ip))).toBe(ip);
  });
});

describe('expandIpv4Cidr', () => {
  it('expands /28 to 16 IPs', () => {
    const ips = expandIpv4Cidr('192.168.1.0/28');
    expect(ips.length).toBe(16);
  });

  it('expands /30 to 4 IPs', () => {
    const ips = expandIpv4Cidr('10.0.0.0/30');
    expect(ips.length).toBe(4);
  });

  it('expands /24 to 256 IPs when maxHosts allows', () => {
    // With maxHosts=256, /24 should return all 256 IPs
    const ips = expandIpv4Cidr('10.0.0.0/24', 256);
    expect(ips.length).toBe(256);
  });

  it('limits /24 to default maxHosts of 64', () => {
    // Default maxHosts is 64
    const ips = expandIpv4Cidr('10.0.0.0/24');
    expect(ips.length).toBe(64);
  });

  it('expands /32 to single IP', () => {
    const ips = expandIpv4Cidr('192.168.1.1/32');
    expect(ips.length).toBe(1);
    expect(ips[0]).toBe('192.168.1.1');
  });

  it('expands /0 to all IPs (limited by maxHosts)', () => {
    const ips = expandIpv4Cidr('0.0.0.0/0', 16);
    expect(ips.length).toBe(16);
  });

  it('returns empty array for invalid CIDR', () => {
    expect(expandIpv4Cidr('1.2.3.4/33')).toEqual([]);
    expect(expandIpv4Cidr('not-cidr')).toEqual([]);
    expect(expandIpv4Cidr('')).toEqual([]);
  });

  it('returns empty array for non-IPv4 CIDR', () => {
    expect(expandIpv4Cidr('::1/128')).toEqual([]);
  });

  it('respects maxHosts limit', () => {
    const ips = expandIpv4Cidr('192.168.1.0/28', 8);
    expect(ips.length).toBe(8);
  });

  it('uses default maxHosts of 64', () => {
    const ips = expandIpv4Cidr('10.0.0.0/24');
    expect(ips.length).toBe(64);
  });

  it('calculates first IP correctly for /28', () => {
    const ips = expandIpv4Cidr('192.168.1.0/28');
    expect(ips[0]).toBe('192.168.1.0');
    expect(ips[15]).toBe('192.168.1.15');
  });

  it('calculates correctly for non-zero host bits in base', () => {
    const ips = expandIpv4Cidr('192.168.1.16/28');
    expect(ips[0]).toBe('192.168.1.16');
    expect(ips[15]).toBe('192.168.1.31');
  });
});

describe('normalizeSeverity', () => {
  it('maps uppercase to lowercase', () => {
    expect(normalizeSeverity('CRITICAL')).toBe('critical');
    expect(normalizeSeverity('HIGH')).toBe('high');
    expect(normalizeSeverity('MEDIUM')).toBe('medium');
    expect(normalizeSeverity('LOW')).toBe('low');
  });

  it('maps mixed case to lowercase', () => {
    expect(normalizeSeverity('Critical')).toBe('critical');
    expect(normalizeSeverity('High')).toBe('high');
    expect(normalizeSeverity('Medium')).toBe('medium');
    expect(normalizeSeverity('Low')).toBe('low');
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

  it('handles null/undefined', () => {
    expect(normalizeSeverity(null as any)).toBe('medium');
    expect(normalizeSeverity(undefined as any)).toBe('medium');
  });

  it('handles numeric input', () => {
    expect(normalizeSeverity(123 as any)).toBe('medium');
  });
});
