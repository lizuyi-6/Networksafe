/**
 * Platform Config Service - Normalization Functions Tests
 *
 * Tests for pure normalization functions exported from platform-config.service.ts
 */

jest.mock('../../config/database', () => ({
  getDatabase: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('../../api/routes/ai-system.routes', () => ({
  getTrafficStats: jest.fn().mockReturnValue({ packetsProcessed: 0, packetsInspected: 0, packetsAllowed: 0, packetsBlocked: 0, bytesProcessed: 0, activeFlows: [], threats: new Map() }),
}));

jest.mock('../../api/routes/devices.routes', () => ({
  addDeviceEvent: jest.fn(),
  getDeviceList: jest.fn().mockReturnValue([]),
  registerDevice: jest.fn(),
  setDeviceOffline: jest.fn(),
  updateDeviceStatus: jest.fn(),
}));

jest.mock('../../websocket/agent-gateway', () => ({
  AgentGateway: jest.fn(),
}));

jest.mock('../../config/platform-runtime', () => ({
  getRuntimeProfile: jest.fn().mockReturnValue({}),
  isRuntimeEmulatorEnabled: jest.fn().mockReturnValue(false),
}));

import {
  normalizeNumber,
  normalizeBoolean,
  normalizeString,
  normalizeSeverity,
  severityRank,
  isSeverityAtLeast,
  normalizeHeaders,
  normalizeChannel,
  normalizeNotifications,
  normalizeRoutingMode,
  normalizeAiRouting,
  normalizePrivacyMode,
  normalizeAuditArchive,
  normalizeFastpath,
  normalizeDetectionPipeline,
  normalizeDeploymentTarget,
  normalizeDeploymentDefaults,
  normalizeDeviceGateway,
  normalizePlatformConfig,
  cloneDefaultConfig,
  cloneConfig,
} from '../../services/platform-config.service';

describe('normalizeNumber', () => {
  it('clamps value above max to max', () => {
    expect(normalizeNumber(150, 100, 0, 100)).toBe(100);
  });

  it('clamps value below min to min', () => {
    expect(normalizeNumber(-5, 10, 0, 100)).toBe(0);
  });

  it('returns value within range unchanged', () => {
    expect(normalizeNumber(50, 10, 0, 100)).toBe(50);
  });

  it('uses fallback for undefined', () => {
    expect(normalizeNumber(undefined, 10, 0, 100)).toBe(10);
  });

  it('returns fallback for non-numeric', () => {
    expect(normalizeNumber('abc' as any, 10, 0, 100)).toBe(10);
  });

  it('rounds to nearest integer', () => {
    expect(normalizeNumber(50.7, 10, 0, 100)).toBe(51);
    expect(normalizeNumber(50.3, 10, 0, 100)).toBe(50);
  });

  it('returns fallback for NaN', () => {
    expect(normalizeNumber(NaN, 5, 0, 100)).toBe(5);
  });

  it('handles string numbers', () => {
    expect(normalizeNumber('42', 0, 0, 100)).toBe(42);
  });

  it('clamps negative max correctly', () => {
    expect(normalizeNumber(10, 0, -50, -10)).toBe(-10);
  });
});

describe('normalizeBoolean', () => {
  it('returns true for boolean true', () => {
    expect(normalizeBoolean(true, false)).toBe(true);
  });

  it('returns true for string "yes"', () => {
    expect(normalizeBoolean('yes', false)).toBe(true);
  });

  it('returns true for string "on"', () => {
    expect(normalizeBoolean('on', false)).toBe(true);
  });

  it('returns true for string "true"', () => {
    expect(normalizeBoolean('true', false)).toBe(true);
  });

  it('returns true for number 1', () => {
    expect(normalizeBoolean(1, false)).toBe(true);
  });

  it('returns true for string "1"', () => {
    expect(normalizeBoolean('1', false)).toBe(true);
  });

  it('returns false for boolean false', () => {
    expect(normalizeBoolean(false, true)).toBe(false);
  });

  it('returns false for string "false"', () => {
    expect(normalizeBoolean('false', true)).toBe(false);
  });

  it('returns false for string "no"', () => {
    expect(normalizeBoolean('no', true)).toBe(false);
  });

  it('returns false for string "off"', () => {
    expect(normalizeBoolean('off', true)).toBe(false);
  });

  it('returns false for number 0', () => {
    expect(normalizeBoolean(0, true)).toBe(false);
  });

  it('returns false for string "0"', () => {
    expect(normalizeBoolean('0', true)).toBe(false);
  });

  it('uses fallback for unrecognized values', () => {
    expect(normalizeBoolean('unknown' as any, false)).toBe(false);
    expect(normalizeBoolean('unknown' as any, true)).toBe(true);
  });

  it('trims whitespace before checking', () => {
    expect(normalizeBoolean('  true  ', false)).toBe(true);
    expect(normalizeBoolean('  false  ', true)).toBe(false);
  });
});

describe('normalizeString', () => {
  it('trims whitespace', () => {
    expect(normalizeString('  test  ', '')).toBe('test');
  });

  it('returns fallback for undefined', () => {
    expect(normalizeString(undefined, 'default')).toBe('default');
  });

  it('returns fallback for null', () => {
    expect(normalizeString(null as any, 'default')).toBe('default');
  });

  it('returns trimmed empty string as empty string', () => {
    // normalizeString returns the trimmed value, even if empty
    expect(normalizeString('   ', 'default')).toBe('');
  });

  it('leaves valid string unchanged', () => {
    expect(normalizeString('hello world', 'default')).toBe('hello world');
  });
});

describe('normalizeSeverity', () => {
  it('maps HIGH to high', () => {
    expect(normalizeSeverity('HIGH')).toBe('high');
  });

  it('maps Critical to critical', () => {
    expect(normalizeSeverity('Critical')).toBe('critical');
  });

  it('maps LOW to low', () => {
    expect(normalizeSeverity('LOW')).toBe('low');
  });

  it('maps MEDIUM to medium', () => {
    expect(normalizeSeverity('MEDIUM')).toBe('medium');
  });

  it('maps invalid to medium (default)', () => {
    expect(normalizeSeverity('invalid')).toBe('medium');
    expect(normalizeSeverity('UNKNOWN')).toBe('medium');
  });

  it('returns low/medium/high/critical unchanged (lowercase)', () => {
    expect(normalizeSeverity('high')).toBe('high');
    expect(normalizeSeverity('medium')).toBe('medium');
    expect(normalizeSeverity('low')).toBe('low');
    expect(normalizeSeverity('critical')).toBe('critical');
  });

  it('uses custom fallback when provided', () => {
    expect(normalizeSeverity('invalid', 'high')).toBe('high');
    expect(normalizeSeverity('invalid', 'low')).toBe('low');
  });

  it('handles undefined', () => {
    expect(normalizeSeverity(undefined)).toBe('medium');
  });
});

describe('severityRank', () => {
  it('returns 4 for critical', () => {
    expect(severityRank('critical')).toBe(4);
  });

  it('returns 3 for high', () => {
    expect(severityRank('high')).toBe(3);
  });

  it('returns 2 for medium', () => {
    expect(severityRank('medium')).toBe(2);
  });

  it('returns 1 for low', () => {
    expect(severityRank('low')).toBe(1);
  });

  it('returns 1 for unknown (default case)', () => {
    expect(severityRank('unknown' as any)).toBe(1);
  });
});

describe('isSeverityAtLeast', () => {
  it('returns true when value meets minimum', () => {
    expect(isSeverityAtLeast('high', 'medium')).toBe(true);
    expect(isSeverityAtLeast('critical', 'high')).toBe(true);
    expect(isSeverityAtLeast('critical', 'critical')).toBe(true);
    expect(isSeverityAtLeast('high', 'low')).toBe(true);
    expect(isSeverityAtLeast('medium', 'low')).toBe(true);
  });

  it('returns true when value equals minimum', () => {
    expect(isSeverityAtLeast('high', 'high')).toBe(true);
    expect(isSeverityAtLeast('medium', 'medium')).toBe(true);
    expect(isSeverityAtLeast('low', 'low')).toBe(true);
    expect(isSeverityAtLeast('critical', 'critical')).toBe(true);
  });

  it('returns false when value is below minimum', () => {
    expect(isSeverityAtLeast('low', 'high')).toBe(false);
    expect(isSeverityAtLeast('medium', 'critical')).toBe(false);
    expect(isSeverityAtLeast('low', 'medium')).toBe(false);
  });
});

describe('normalizeHeaders', () => {
  it('converts to Record<string, string>', () => {
    expect(normalizeHeaders({ 'Content-Type': 'application/json' })).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('handles null values by converting to empty string', () => {
    // null ?? '' = '' and String('') = ''
    expect(normalizeHeaders({ 'X-Custom': null as any })).toEqual({ 'X-Custom': '' });
  });

  it('handles undefined values', () => {
    expect(normalizeHeaders({ 'X-Custom': undefined })).toEqual({ 'X-Custom': '' });
  });

  it('returns empty object for non-object input', () => {
    expect(normalizeHeaders(null)).toEqual({});
    expect(normalizeHeaders('string' as any)).toEqual({});
    expect(normalizeHeaders([] as any)).toEqual({});
  });

  it('skips empty keys', () => {
    expect(normalizeHeaders({ '': 'value' })).toEqual({});
  });

  it('normalizes multiple headers', () => {
    const result = normalizeHeaders({
      'Content-Type': 'application/json',
      'X-Request-Id': '123',
    });
    expect(result['Content-Type']).toBe('application/json');
    expect(result['X-Request-Id']).toBe('123');
  });
});

describe('normalizeChannel', () => {
  it('creates channel with defaults', () => {
    const result = normalizeChannel({}, 0);
    expect(result.type).toBe('generic_webhook');
    expect(result.enabled).toBe(true);
    expect(result.id).toMatch(/^channel-1-/);
  });

  it('recognizes valid channel types', () => {
    expect(normalizeChannel({ type: 'email' }, 0).type).toBe('email');
    expect(normalizeChannel({ type: 'smtp' }, 0).type).toBe('smtp');
    expect(normalizeChannel({ type: 'slack_webhook' }, 0).type).toBe('slack_webhook');
  });

  it('falls back to generic_webhook for invalid type', () => {
    expect(normalizeChannel({ type: 'invalid' }, 0).type).toBe('generic_webhook');
  });

  it('normalizes smtp config', () => {
    const result = normalizeChannel(
      { smtp: { host: 'smtp.example.com', port: 587, secure: true } },
      0
    );
    expect(result.smtp.host).toBe('smtp.example.com');
    expect(result.smtp.port).toBe(587);
    expect(result.smtp.secure).toBe(true);
  });
});

describe('normalizeNotifications', () => {
  it('returns defaults when input is empty', () => {
    const result = normalizeNotifications({});
    expect(result.enabled).toBe(true);
    expect(result.dedupeWindowSeconds).toBe(300);
  });

  it('normalizes retry delays', () => {
    const result = normalizeNotifications({ retryDelaysSeconds: [10, 30, 60] });
    expect(result.retryDelaysSeconds).toEqual([10, 30, 60]);
  });

  it('filters duplicate retry delays', () => {
    const result = normalizeNotifications({ retryDelaysSeconds: [30, 30, 60, 60] });
    expect(result.retryDelaysSeconds).toEqual([30, 60]);
  });

  it('filters zero and negative retry delays', () => {
    const result = normalizeNotifications({ retryDelaysSeconds: [0, 30, -5, 60] });
    expect(result.retryDelaysSeconds).toEqual([30, 60]);
  });
});

describe('normalizeRoutingMode', () => {
  it('maps cloud_only', () => {
    expect(normalizeRoutingMode('cloud_only')).toBe('cloud_only');
  });

  it('maps local_preferred', () => {
    expect(normalizeRoutingMode('local_preferred')).toBe('local_preferred');
  });

  it('maps local_only', () => {
    expect(normalizeRoutingMode('local_only')).toBe('local_only');
  });

  it('maps hybrid_verify', () => {
    expect(normalizeRoutingMode('hybrid_verify')).toBe('hybrid_verify');
  });

  it('returns cloud_only fallback for invalid', () => {
    expect(normalizeRoutingMode('invalid' as any)).toBe('cloud_only');
  });

  it('is case insensitive', () => {
    expect(normalizeRoutingMode('CLOUD_ONLY')).toBe('cloud_only');
    expect(normalizeRoutingMode('Local_Preferred')).toBe('local_preferred');
  });
});

describe('normalizeAiRouting', () => {
  it('returns defaults when input is empty', () => {
    const result = normalizeAiRouting({});
    expect(result.mode).toBe('local_only');
    expect(result.fallbackAllowed).toBe(false);
  });

  it('normalizes all fields', () => {
    const result = normalizeAiRouting({
      mode: 'cloud_only',
      localEndpointId: 'local-1',
      cloudEndpointId: 'cloud-1',
      fallbackAllowed: false,
    });
    expect(result.mode).toBe('cloud_only');
    expect(result.localEndpointId).toBe('local-1');
    expect(result.cloudEndpointId).toBe('cloud-1');
    expect(result.fallbackAllowed).toBe(false);
  });
});

describe('normalizePrivacyMode', () => {
  it('returns strict for "strict"', () => {
    expect(normalizePrivacyMode('strict')).toBe('strict');
  });

  it('returns off for "off"', () => {
    expect(normalizePrivacyMode('off')).toBe('off');
  });

  it('returns fallback for invalid values', () => {
    expect(normalizePrivacyMode('invalid' as any)).toBe('off');
    expect(normalizePrivacyMode('invalid' as any, 'strict')).toBe('strict');
  });
});

describe('normalizeAuditArchive', () => {
  it('returns defaults when input is empty', () => {
    const result = normalizeAuditArchive({});
    expect(result.bucket).toBe('aetherguard-audit-lock');
    expect(result.retentionDays).toBe(30);
  });

  it('clamps retentionDays to max of 3650', () => {
    const result = normalizeAuditArchive({ retentionDays: 5000 });
    expect(result.retentionDays).toBe(3650);
  });

  it('normalizes all fields', () => {
    const result = normalizeAuditArchive({
      bucket: 'my-bucket',
      retentionDays: 60,
      objectLockRequired: false,
      verifyIntervalMinutes: 120,
    });
    expect(result.bucket).toBe('my-bucket');
    expect(result.retentionDays).toBe(60);
    expect(result.objectLockRequired).toBe(false);
    expect(result.verifyIntervalMinutes).toBe(120);
  });
});

describe('normalizeFastpath', () => {
  it('returns defaults when input is empty', () => {
    const result = normalizeFastpath({});
    expect(result.enabled).toBe(true);
    expect(result.timeoutMs).toBe(1500);
  });

  it('normalizes transport to unix on linux', () => {
    const result = normalizeFastpath({ transport: 'unix' });
    expect(result.transport).toBe('unix');
  });

  it('clamps numeric values to ranges', () => {
    const result = normalizeFastpath({ timeoutMs: 50000, trafficMaxBodyBytes: 2000000 });
    expect(result.timeoutMs).toBe(30000);
    expect(result.trafficMaxBodyBytes).toBe(1048576);
  });
});

describe('normalizeDetectionPipeline', () => {
  it('returns defaults when input is empty', () => {
    const result = normalizeDetectionPipeline({});
    expect(result.ruleFirstEnabled).toBe(true);
    expect(result.aiEscalationThreshold).toBe(0.4);
  });

  it('normalizes threshold values between 0 and 1', () => {
    const result = normalizeDetectionPipeline({ aiEscalationThreshold: 0.8 });
    expect(result.aiEscalationThreshold).toBe(0.8);
  });

  it('clamps out-of-range thresholds', () => {
    const result = normalizeDetectionPipeline({ aiEscalationThreshold: 1.5 });
    expect(result.aiEscalationThreshold).toBe(1);
  });

  it('normalizes learning mode', () => {
    const result = normalizeDetectionPipeline({ learningMode: 'malicious_review_queue' });
    expect(result.learningMode).toBe('malicious_review_queue');
  });

  it('normalizes detection channels', () => {
    const result = normalizeDetectionPipeline({ learningCloudVerificationChannels: ['http_api', 'packet'] });
    expect(result.learningCloudVerificationChannels).toContain('http_api');
    expect(result.learningCloudVerificationChannels).toContain('packet');
  });
});

describe('normalizeDeploymentTarget', () => {
  it('accepts valid deployment targets', () => {
    expect(normalizeDeploymentTarget('nginx')).toBe('nginx');
    expect(normalizeDeploymentTarget('apache')).toBe('apache');
    expect(normalizeDeploymentTarget('caddy')).toBe('caddy');
    expect(normalizeDeploymentTarget('docker_compose')).toBe('docker_compose');
    expect(normalizeDeploymentTarget('binary_agent')).toBe('binary_agent');
    expect(normalizeDeploymentTarget('k8s_daemonset')).toBe('k8s_daemonset');
  });

  it('returns nginx fallback for invalid', () => {
    expect(normalizeDeploymentTarget('invalid' as any)).toBe('nginx');
  });
});

describe('normalizeDeploymentDefaults', () => {
  it('returns defaults when input is empty', () => {
    const result = normalizeDeploymentDefaults({});
    expect(result.serverType).toBe('nginx');
    expect(result.profileTemplates).toBeDefined();
    expect(result.profileTemplates.nginx.port).toBe(8080);
  });

  it('normalizes server type', () => {
    const result = normalizeDeploymentDefaults({ serverType: 'docker_compose' });
    expect(result.serverType).toBe('docker_compose');
  });
});

describe('normalizeDeviceGateway', () => {
  it('returns defaults when input is empty', () => {
    const result = normalizeDeviceGateway({});
    expect(result.primaryPath).toBe('/ws/device');
    expect(result.localPort).toBe(8080);
  });

  it('normalizes aliases', () => {
    const result = normalizeDeviceGateway({ aliases: ['/ws/status', '/ws/status'] });
    expect(result.aliases).toContain('/ws/status');
    expect(result.aliases.length).toBe(1);
  });

  it('filters empty aliases', () => {
    const result = normalizeDeviceGateway({ aliases: ['', '/ws/status', ''] });
    expect(result.aliases).toEqual(['/ws/status']);
  });
});

describe('normalizePlatformConfig', () => {
  it('normalizes antiBot enabled string to boolean', () => {
    const input = { antiBot: { enabled: 'true', blockLevel: 'high' } };
    const result = normalizePlatformConfig(input as any);
    expect(result.antiBot.enabled).toBe(true);
  });

  it('normalizes rate limit values', () => {
    const input = { rateLimit: { requestsPerMinute: '200' } };
    const result = normalizePlatformConfig(input as any);
    expect(result.rateLimit.requestsPerMinute).toBe(200);
  });

  it('merges with current config when provided', () => {
    const current = {
      antiBot: { enabled: false, requestThreshold: 50, fastRequestThreshold: 5, blockDuration: 1800 },
      rateLimit: { requestsPerMinute: 60, windowSeconds: 60 },
      notifications: { enabled: true, dedupeWindowSeconds: 300, retryDelaysSeconds: [30], channels: [] },
      aiRouting: { mode: 'local_preferred', localEndpointId: null, localHotPathEndpointId: null, cloudEndpointId: null, fallbackAllowed: true, redactionEnabled: true },
      privacyMode: 'off',
      auditArchive: { bucket: 'default', retentionDays: 30, objectLockRequired: true, verifyIntervalMinutes: 60 },
      fastpath: { enabled: true, baseUrl: 'http://localhost', transport: 'tcp' as const, socketPath: null, timeoutMs: 1500, fallbackEnabled: true, trafficShadowEnabled: false, trafficShadowSampleRatePct: 10, trafficMaxBodyBytes: 65536, configCacheTtlMs: 30000 },
      detectionPipeline: { ruleFirstEnabled: true, aiEscalationMode: 'high_risk_allowed_only' as const, classificationLevel: 'standard' as const, blockingDiscussionTimeoutMs: 30000, hotPathRouteMode: 'local_only' as const, asyncReviewEnabled: true, blockingReviewForHighRiskActions: true, enableHttpApi: true, enablePacketInterceptor: true, enableAgentAsyncReview: true, aiEscalationThreshold: 0.4, candidateMinConfidence: 0.85, learningMode: 'malicious_review_queue' as const, learningCloudVerificationEnabled: true, learningCloudVerificationMode: 'cloud_only' as const, learningCloudVerificationChannels: ['http_api', 'packet', 'agent'] as any, learningCloudVerificationOnSuspicious: true, learningCloudVerificationOnMissingConfidence: true, learningFromBlockedEnabled: true, learningFromBlockedMinSeverity: 'medium' as const },
      deploymentDefaults: { serverType: 'nginx' as const, profileTemplates: {} as any },
      deviceGateway: { primaryPath: '/ws/device', aliases: [], syncMaskApiKeys: true, firmwareLocalHost: '', wifiSSID: '', localPort: 8080, firmwareChannel: 'stable', firmwareRetentionDays: 30, statusAliasEnabled: true },
    };
    const input = { antiBot: { enabled: true } };
    const result = normalizePlatformConfig(input as any, current as any);
    expect(result.antiBot.enabled).toBe(true);
    expect(result.antiBot.requestThreshold).toBe(50);
  });

  it('deep clones without reference sharing', () => {
    const config = { name: 'test', nested: { value: 1 } };
    const clone = cloneConfig(config);
    clone.nested.value = 999;
    expect(config.nested.value).toBe(1);
  });
});

describe('cloneDefaultConfig', () => {
  it('returns an object', () => {
    const result = cloneDefaultConfig();
    expect(typeof result).toBe('object');
  });

  it('returns a deep clone', () => {
    const result = cloneDefaultConfig();
    result.notifications.channels = [];
    const second = cloneDefaultConfig();
    expect(second.notifications.channels).toEqual([]);
  });

  it('contains expected structure', () => {
    const result = cloneDefaultConfig();
    expect(result.antiBot).toBeDefined();
    expect(result.rateLimit).toBeDefined();
    expect(result.notifications).toBeDefined();
    expect(result.fastpath).toBeDefined();
  });
});

describe('cloneConfig', () => {
  it('clones primitive values', () => {
    expect(cloneConfig(42)).toBe(42);
    expect(cloneConfig('string')).toBe('string');
    expect(cloneConfig(true)).toBe(true);
  });

  it('clones arrays', () => {
    const original = [1, 2, 3];
    const cloned = cloneConfig(original);
    cloned.push(4);
    expect(original).toEqual([1, 2, 3]);
  });

  it('clones nested objects', () => {
    const original = { a: { b: { c: 1 } } };
    const cloned = cloneConfig(original);
    cloned.a.b.c = 999;
    expect(original.a.b.c).toBe(1);
  });
});
