/**
 * FastpathTrafficShadowService tests
 *
 * Covers: submitFromRequest, queue management, worker concurrency,
 * snapshot building, enqueue threshold, mismatch detection.
 *
 * NOTE: Uses jest.resetAllMocks() instead of jest.clearAllMocks() because
 * per-test mock implementations (mockResolvedValue/mockReturnValue) must be
 * reset between tests — clearAllMocks only resets call history, not
 * mock implementations or return values.
 */

import { fastpathTrafficShadowService } from '../../services/fastpath-traffic-shadow.service';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

jest.mock('../../services/http-traffic-evaluator.service', () => ({
  httpTrafficEvaluatorService: {
    evaluateBaseline: jest.fn()
  },
  hashTrafficSampleKey: jest.fn().mockReturnValue(0),
  normalizeThreatSignatures: jest.fn().mockImplementation(
    (threats: Array<{ type: string; severity: string; description: string }>) =>
      Array.from(new Set(threats.map((t) => `${t.type}:${t.severity}`))).sort()
  )
}));

jest.mock('../../services/fastpath-client.service', () => ({
  fastpathClientService: {
    evaluateHttpTraffic: jest.fn()
  }
}));

jest.mock('../../services/platform-config.service', () => ({
  platformConfigService: {
    getConfig: jest.fn()
  }
}));

const mockEvaluateBaseline = (overrides = {}) => ({
  verdict: 'allow' as const,
  threats: [] as Array<{ type: string; severity: string; description: string }>,
  matchedRule: null,
  protocol: 'http',
  ...overrides
});

const mockFastpathResponse = (overrides = {}) => ({
  verdict: 'allow' as const,
  threats: [] as Array<{ type: string; severity: string; description: string }>,
  matchedRule: null,
  protocol: 'http',
  ...overrides
});

const mockPlatformConfig = (overrides = {}) => ({
  fastpath: {
    enabled: true,
    trafficShadowEnabled: true,
    trafficShadowSampleRatePct: 100,
    trafficMaxBodyBytes: 65536,
    ...overrides
  }
});

function buildMockRequest(overrides: Record<string, any> = {}): any {
  return {
    method: 'POST',
    path: '/api/test',
    originalUrl: '/api/test?foo=bar',
    url: '/api/test',
    httpVersion: '1.1',
    ip: '192.168.1.100',
    socket: { remoteAddress: '192.168.1.100' },
    connection: {},
    headers: {
      'content-type': 'application/json',
      'x-request-id': `req-${Math.random().toString(36).slice(2)}`,
      'user-agent': 'jest-agent'
    },
    body: { key: 'value' },
    user: { tenantId: 'tenant-shadow-test' },
    ...overrides
  };
}

describe('FastpathTrafficShadowService', () => {
  let httpEvaluator: any;
  let fastpathClient: any;
  let platformConfig: any;

  beforeEach(() => {
    jest.resetAllMocks();
    fastpathTrafficShadowService.resetForTests();

    httpEvaluator = require('../../services/http-traffic-evaluator.service').httpTrafficEvaluatorService;
    fastpathClient = require('../../services/fastpath-client.service').fastpathClientService;
    platformConfig = require('../../services/platform-config.service').platformConfigService;

    // Re-apply normalizeThreatSignatures and hashTrafficSampleKey after resetAllMocks
    const httpModule = require('../../services/http-traffic-evaluator.service');
    httpModule.normalizeThreatSignatures.mockImplementation(
      (threats: Array<{ type: string; severity: string; description: string }>) =>
        Array.from(new Set(threats.map((t) => `${t.type}:${t.severity}`))).sort()
    );
    httpModule.hashTrafficSampleKey.mockReturnValue(0);

    // Default per-test setup — individual tests override these
    platformConfig.getConfig.mockResolvedValue(mockPlatformConfig());
    httpEvaluator.evaluateBaseline.mockReturnValue(mockEvaluateBaseline());
    fastpathClient.evaluateHttpTraffic.mockResolvedValue(mockFastpathResponse());
  });

  describe('submitFromRequest', () => {
    it('skips OPTIONS preflight requests', async () => {
      const optionsReq = buildMockRequest({ method: 'OPTIONS' });
      fastpathTrafficShadowService.submitFromRequest(optionsReq);
      await fastpathTrafficShadowService.awaitIdleForTests();

      expect(httpEvaluator.evaluateBaseline).not.toHaveBeenCalled();
    });

    it('skips /health endpoint', async () => {
      const healthReq = buildMockRequest({ path: '/health', method: 'GET' });
      fastpathTrafficShadowService.submitFromRequest(healthReq);
      await fastpathTrafficShadowService.awaitIdleForTests();

      expect(httpEvaluator.evaluateBaseline).not.toHaveBeenCalled();
    });

    it('skips /api/health endpoint', async () => {
      const healthReq = buildMockRequest({ path: '/api/health', method: 'GET' });
      fastpathTrafficShadowService.submitFromRequest(healthReq);
      await fastpathTrafficShadowService.awaitIdleForTests();

      expect(httpEvaluator.evaluateBaseline).not.toHaveBeenCalled();
    });

    it('skips multipart/form-data content type', async () => {
      const multipartReq = buildMockRequest({
        headers: { 'content-type': 'multipart/form-data; boundary=----WebKit' }
      });
      fastpathTrafficShadowService.submitFromRequest(multipartReq);
      await fastpathTrafficShadowService.awaitIdleForTests();

      expect(httpEvaluator.evaluateBaseline).not.toHaveBeenCalled();
    });

    it('skips application/octet-stream content type', async () => {
      const binaryReq = buildMockRequest({
        headers: { 'content-type': 'application/octet-stream' }
      });
      fastpathTrafficShadowService.submitFromRequest(binaryReq);
      await fastpathTrafficShadowService.awaitIdleForTests();

      expect(httpEvaluator.evaluateBaseline).not.toHaveBeenCalled();
    });

    it('submits normal JSON request for shadowing', async () => {
      const req = buildMockRequest();
      fastpathTrafficShadowService.submitFromRequest(req);
      await fastpathTrafficShadowService.awaitIdleForTests();

      expect(httpEvaluator.evaluateBaseline).toHaveBeenCalled();
      expect(fastpathClient.evaluateHttpTraffic).toHaveBeenCalled();
    });

    it('submits URL-encoded form request', async () => {
      const req = buildMockRequest({
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'username=test&password=secret'
      });
      fastpathTrafficShadowService.submitFromRequest(req);
      await fastpathTrafficShadowService.awaitIdleForTests();

      expect(httpEvaluator.evaluateBaseline).toHaveBeenCalled();
    });
  });

  describe('sample rate filtering', () => {
    it('skips shadowing when sample rate is 0', async () => {
      platformConfig.getConfig.mockResolvedValue(
        mockPlatformConfig({ trafficShadowSampleRatePct: 0 })
      );

      const req = buildMockRequest();
      fastpathTrafficShadowService.submitFromRequest(req);
      await fastpathTrafficShadowService.awaitIdleForTests();

      expect(httpEvaluator.evaluateBaseline).not.toHaveBeenCalled();
    });

    it('skips shadowing when trafficShadowEnabled is false', async () => {
      platformConfig.getConfig.mockResolvedValue(
        mockPlatformConfig({ trafficShadowEnabled: false })
      );

      const req = buildMockRequest();
      fastpathTrafficShadowService.submitFromRequest(req);
      await fastpathTrafficShadowService.awaitIdleForTests();

      expect(httpEvaluator.evaluateBaseline).not.toHaveBeenCalled();
    });

    it('skips shadowing when fastpath.enabled is false', async () => {
      platformConfig.getConfig.mockResolvedValue(
        mockPlatformConfig({ enabled: false })
      );

      const req = buildMockRequest();
      fastpathTrafficShadowService.submitFromRequest(req);
      await fastpathTrafficShadowService.awaitIdleForTests();

      expect(httpEvaluator.evaluateBaseline).not.toHaveBeenCalled();
    });
  });

  describe('queue management', () => {
    it('processes multiple queued tasks through worker drain', async () => {
      fastpathTrafficShadowService.setWorkerConfigForTests({ concurrency: 2, maxQueueSize: 100 });

      const req1 = buildMockRequest({ path: '/api/test1', headers: { 'x-request-id': 'req-1' } });
      const req2 = buildMockRequest({ path: '/api/test2', headers: { 'x-request-id': 'req-2' } });

      fastpathTrafficShadowService.submitFromRequest(req1);
      fastpathTrafficShadowService.submitFromRequest(req2);
      await fastpathTrafficShadowService.awaitIdleForTests();

      expect(httpEvaluator.evaluateBaseline).toHaveBeenCalledTimes(2);
      expect(fastpathClient.evaluateHttpTraffic).toHaveBeenCalledTimes(2);
    });

    it('drops tasks and logs warning when queue exceeds maxQueueSize', async () => {
      // concurrency=1, maxQueueSize=2: first request goes to worker, second fills
      // the queue. Submitting a third queues it (queue.length=2), a fourth
      // exceeds maxQueueSize=2 and is dropped with a warning.
      fastpathTrafficShadowService.setWorkerConfigForTests({ concurrency: 1, maxQueueSize: 2 });

      const req1 = buildMockRequest({ path: '/api/d1', headers: { 'x-request-id': 'd1' } });
      const req2 = buildMockRequest({ path: '/api/d2', headers: { 'x-request-id': 'd2' } });
      const req3 = buildMockRequest({ path: '/api/d3', headers: { 'x-request-id': 'd3' } });
      const req4 = buildMockRequest({ path: '/api/d4', headers: { 'x-request-id': 'd4' } });

      fastpathTrafficShadowService.submitFromRequest(req1);
      fastpathTrafficShadowService.submitFromRequest(req2);
      fastpathTrafficShadowService.submitFromRequest(req3);
      fastpathTrafficShadowService.submitFromRequest(req4);
      await fastpathTrafficShadowService.awaitIdleForTests();

      const logger = require('../../utils/logger') as any;
      const dropCalls = logger.default.warn.mock.calls.filter(
        (c: any[]) => c[0] === 'fastpath_traffic_shadow_dropped'
      );
      expect(dropCalls.length).toBeGreaterThan(0);
    });
  });

  describe('mismatch detection', () => {
    const logger = require('../../utils/logger') as any;

    it('logs warning when baseline and fastpath verdicts differ', async () => {
      httpEvaluator.evaluateBaseline.mockReturnValue(
        mockEvaluateBaseline({ verdict: 'block', threats: [{ type: 'sqli', severity: 'high', description: 'SQL injection' }] })
      );
      fastpathClient.evaluateHttpTraffic.mockResolvedValue(
        mockFastpathResponse({ verdict: 'allow', threats: [] })
      );

      const req = buildMockRequest();
      fastpathTrafficShadowService.submitFromRequest(req);
      await fastpathTrafficShadowService.awaitIdleForTests();

      const mismatchCalls = logger.default.warn.mock.calls.filter(
        (c: any[]) => c[0] === 'fastpath_traffic_shadow_mismatch'
      );
      expect(mismatchCalls.length).toBe(1);
      expect(mismatchCalls[0][1]).toMatchObject({
        baselineVerdict: 'block',
        fastpathVerdict: 'allow'
      });
    });

    it('logs warning when threat signatures differ (different types)', async () => {
      httpEvaluator.evaluateBaseline.mockReturnValue(
        mockEvaluateBaseline({
          verdict: 'block',
          threats: [
            { type: 'xss', severity: 'medium', description: 'XSS' },
            { type: 'sqli', severity: 'high', description: 'SQLi' }
          ]
        })
      );
      fastpathClient.evaluateHttpTraffic.mockResolvedValue(
        mockFastpathResponse({
          verdict: 'block',
          threats: [{ type: 'xss', severity: 'medium', description: 'XSS' }]
        })
      );

      const req = buildMockRequest();
      fastpathTrafficShadowService.submitFromRequest(req);
      await fastpathTrafficShadowService.awaitIdleForTests();

      const mismatchCalls = logger.default.warn.mock.calls.filter(
        (c: any[]) => c[0] === 'fastpath_traffic_shadow_mismatch'
      );
      expect(mismatchCalls.length).toBe(1);
      expect(mismatchCalls[0][1].baselineThreats).toContain('sqli:high');
    });

    it('does not log mismatch when baseline and fastpath fully agree', async () => {
      httpEvaluator.evaluateBaseline.mockReturnValue(
        mockEvaluateBaseline({ verdict: 'allow', threats: [] })
      );
      fastpathClient.evaluateHttpTraffic.mockResolvedValue(
        mockFastpathResponse({ verdict: 'allow', threats: [] })
      );

      const req = buildMockRequest();
      fastpathTrafficShadowService.submitFromRequest(req);
      await fastpathTrafficShadowService.awaitIdleForTests();

      const mismatchCalls = logger.default.warn.mock.calls.filter(
        (c: any[]) => c[0] === 'fastpath_traffic_shadow_mismatch'
      );
      expect(mismatchCalls.length).toBe(0);
    });

    it('logs warning when fastpath is unavailable (returns null)', async () => {
      fastpathClient.evaluateHttpTraffic.mockResolvedValue(null);
      httpEvaluator.evaluateBaseline.mockReturnValue(mockEvaluateBaseline());

      const req = buildMockRequest();
      fastpathTrafficShadowService.submitFromRequest(req);
      await fastpathTrafficShadowService.awaitIdleForTests();

      const errorCalls = logger.default.warn.mock.calls.filter(
        (c: any[]) => c[0] === 'fastpath_traffic_shadow_error'
      );
      expect(errorCalls.length).toBe(1);
      expect(errorCalls[0][1].error).toBe('fastpath_unavailable');
    });
  });

  describe('resetForTests', () => {
    it('clears internal queue and resets worker state', () => {
      fastpathTrafficShadowService.setWorkerConfigForTests({ concurrency: 5, maxQueueSize: 200 });

      fastpathTrafficShadowService.resetForTests();

      expect(fastpathTrafficShadowService['queue'].length).toBe(0);
      expect(fastpathTrafficShadowService['workerConfig'].concurrency).toBe(2);
      expect(fastpathTrafficShadowService['workerConfig'].maxQueueSize).toBe(512);
    });
  });

  describe('setWorkerConfigForTests', () => {
    it('updates concurrency and maxQueueSize', () => {
      fastpathTrafficShadowService.setWorkerConfigForTests({ concurrency: 5, maxQueueSize: 200 });

      expect(fastpathTrafficShadowService['workerConfig'].concurrency).toBe(5);
      expect(fastpathTrafficShadowService['workerConfig'].maxQueueSize).toBe(200);
    });

    it('clamps negative concurrency to 0', () => {
      fastpathTrafficShadowService.setWorkerConfigForTests({ concurrency: -10 });
      expect(fastpathTrafficShadowService['workerConfig'].concurrency).toBe(0);
    });

    it('clamps maxQueueSize below 1 to 1', () => {
      fastpathTrafficShadowService.setWorkerConfigForTests({ maxQueueSize: 0 });
      expect(fastpathTrafficShadowService['workerConfig'].maxQueueSize).toBe(1);
    });
  });
});
