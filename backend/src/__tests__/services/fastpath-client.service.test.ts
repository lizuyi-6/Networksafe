/**
 * Fastpath Client Service Tests
 *
 * Tests for Rust fastpath traffic processor client
 */

describe('FastpathClientService', () => {
  // Store original implementations
  let mockPlatformGetConfig: jest.Mock;
  let mockAxiosPost: jest.Mock;
  let mockAxiosGet: jest.Mock;
  let mockAxiosCreate: jest.Mock;
  let mockLoggerWarn: jest.Mock;
  let mockLoggerError: jest.Mock;

  let fastpathClientService: any;

  beforeEach(() => {
    jest.resetModules();

    mockAxiosPost = jest.fn();
    mockAxiosGet = jest.fn();
    mockAxiosCreate = jest.fn().mockReturnValue({
      get: mockAxiosGet,
      post: mockAxiosPost,
      // RF-001: production code registers an HMAC-signing request interceptor
      // on every client instance.
      interceptors: { request: { use: jest.fn() } }
    });
    mockLoggerWarn = jest.fn();
    mockLoggerError = jest.fn();

    // Mock axios
    jest.doMock('axios', () => ({
      create: mockAxiosCreate,
      default: { create: mockAxiosCreate }
    }));

    // Mock platform config service
    mockPlatformGetConfig = jest.fn();
    jest.doMock('../../services/platform-config.service', () => ({
      platformConfigService: {
        getConfig: mockPlatformGetConfig
      }
    }));

    // Mock logger
    jest.doMock('../../utils/logger', () => ({
      __esModule: true,
      default: {
        warn: mockLoggerWarn,
        info: jest.fn(),
        error: mockLoggerError
      }
    }));

    // Import after mocks
    fastpathClientService = require('../../services/fastpath-client.service').fastpathClientService;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const defaultConfig = {
    fastpath: {
      enabled: true,
      baseUrl: 'http://fastpath:8081',
      transport: 'tcp' as const,
      socketPath: null as string | null,
      timeoutMs: 1500,
      fallbackEnabled: true,
      trafficShadowEnabled: false,
      trafficShadowSampleRatePct: 10,
      trafficMaxBodyBytes: 65536,
      configCacheTtlMs: 30000
    }
  };

  describe('getRuntimeSettings', () => {
    it('returns TCP transport settings', async () => {
      mockPlatformGetConfig.mockResolvedValue(defaultConfig);

      const settings = await fastpathClientService.getRuntimeSettings('tenant-001');

      expect(settings.tenantId).toBe('tenant-001');
      expect(settings.enabled).toBe(true);
      expect(settings.transport).toBe('tcp');
      expect(settings.fallbackEnabled).toBe(true);
    });

    it('uses Unix socket when transport is unix', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        fastpath: { ...defaultConfig.fastpath, transport: 'unix', socketPath: '/var/run/fastpath.sock' }
      });

      const settings = await fastpathClientService.getRuntimeSettings();

      expect(settings.transport).toBe('unix');
      expect(settings.socketPath).toBe('/var/run/fastpath.sock');
    });

    it('returns disabled settings when fastpath is disabled', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        fastpath: { ...defaultConfig.fastpath, enabled: false }
      });

      const settings = await fastpathClientService.getRuntimeSettings();

      expect(settings.enabled).toBe(false);
    });
  });

  describe('health', () => {
    it('returns true when fastpath responds with 200', async () => {
      mockPlatformGetConfig.mockResolvedValue(defaultConfig);
      mockAxiosGet.mockResolvedValue({ status: 200, data: {} });

      const result = await fastpathClientService.health();

      expect(result).toBe(true);
    });

    it('returns false when fastpath responds with non-200', async () => {
      mockPlatformGetConfig.mockResolvedValue(defaultConfig);
      mockAxiosGet.mockResolvedValue({ status: 500, data: {} });

      const result = await fastpathClientService.health();

      expect(result).toBe(false);
    });

    it('returns false when fastpath is disabled', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        fastpath: { ...defaultConfig.fastpath, enabled: false }
      });

      const result = await fastpathClientService.health();

      expect(result).toBe(false);
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('returns false when fastpath is unreachable', async () => {
      mockPlatformGetConfig.mockResolvedValue(defaultConfig);
      mockAxiosGet.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await fastpathClientService.health();

      expect(result).toBe(false);
    });
  });

  describe('checkRate', () => {
    it('returns rate check result', async () => {
      mockPlatformGetConfig.mockResolvedValue(defaultConfig);
      mockAxiosPost.mockResolvedValue({
        status: 200,
        data: {
          allowed: true,
          remaining: 95,
          resetAtMs: Date.now() + 60000,
          riskFlags: ['new-ip']
        }
      });

      const result = await fastpathClientService.checkRate({
        key: 'req-127.0.0.1',
        windowMs: 60000,
        limit: 100,
        sourceIp: '127.0.0.1'
      });

      expect(result).not.toBeNull();
      expect(result!.allowed).toBe(true);
      expect(result!.remaining).toBe(95);
      expect(result!.riskFlags).toContain('new-ip');
    });

    it('returns null when fastpath is disabled', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        fastpath: { ...defaultConfig.fastpath, enabled: false }
      });

      const result = await fastpathClientService.checkRate({
        key: 'req-127.0.0.1',
        windowMs: 60000,
        limit: 100
      });

      expect(result).toBeNull();
    });

    it('falls back gracefully when fallbackEnabled and fastpath fails', async () => {
      mockPlatformGetConfig.mockResolvedValue(defaultConfig);
      mockAxiosPost.mockRejectedValue(new Error('fastpath unavailable'));

      const result = await fastpathClientService.checkRate({
        key: 'req-127.0.0.1',
        windowMs: 60000,
        limit: 100
      });

      expect(result).toBeNull();
    });

    it('throws when fallbackEnabled is false and fastpath fails', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        fastpath: { ...defaultConfig.fastpath, fallbackEnabled: false }
      });
      mockAxiosPost.mockRejectedValue(new Error('fastpath unavailable'));

      await expect(
        fastpathClientService.checkRate({
          key: 'req-127.0.0.1',
          windowMs: 60000,
          limit: 100
        })
      ).rejects.toThrow('fastpath unavailable');
    });
  });

  describe('checkSocket', () => {
    it('calls the socket check endpoint', async () => {
      mockPlatformGetConfig.mockResolvedValue(defaultConfig);
      mockAxiosPost.mockResolvedValue({
        status: 200,
        data: { allowed: false, remaining: 0, resetAtMs: Date.now() + 60000, riskFlags: [] }
      });

      const result = await fastpathClientService.checkSocket({
        key: 'socket-key',
        windowMs: 60000,
        limit: 10
      });

      expect(mockAxiosPost).toHaveBeenCalledWith(
        '/v1/socket/check',
        expect.objectContaining({ key: 'socket-key' })
      );
      expect(result).not.toBeNull();
      expect(result!.allowed).toBe(false);
    });
  });

  describe('evaluateHttpTraffic', () => {
    it('returns traffic evaluation result', async () => {
      mockPlatformGetConfig.mockResolvedValue(defaultConfig);
      mockAxiosPost.mockResolvedValue({
        status: 200,
        data: {
          verdict: 'block',
          matchedRule: 'sqli-blocklist',
          threats: [{ type: 'sql_injection', severity: 'high', description: 'SQL injection' }]
        }
      });

      const result = await fastpathClientService.evaluateHttpTraffic({
        requestId: 'req-001',
        method: 'POST',
        path: '/api/login',
        headers: { 'user-agent': 'test' }
      });

      expect(result).not.toBeNull();
      expect(result!.verdict).toBe('block');
      expect(result!.matchedRule).toBe('sqli-blocklist');
      expect(result!.threats[0].type).toBe('sql_injection');
    });

    it('returns null for non-2xx response', async () => {
      mockPlatformGetConfig.mockResolvedValue(defaultConfig);
      mockAxiosPost.mockResolvedValue({ status: 500, data: {} });

      const result = await fastpathClientService.evaluateHttpTraffic({
        requestId: 'req-001'
      });

      expect(result).toBeNull();
    });

    it('returns null when fastpath is disabled', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        fastpath: { ...defaultConfig.fastpath, enabled: false }
      });

      const result = await fastpathClientService.evaluateHttpTraffic({
        requestId: 'req-001'
      });

      expect(result).toBeNull();
    });
  });

  describe('evaluateProtocol (multi-protocol plugin API)', () => {
    it('returns the protocol evaluation result', async () => {
      mockPlatformGetConfig.mockResolvedValue(defaultConfig);
      mockAxiosPost.mockResolvedValue({
        status: 200,
        data: { protocol: 'canbus', verdict: 'block', action: 'block', findings: [{ code: 'CAN_DIAGNOSTIC_FRAME', severity: 'high', message: 'diag' }] }
      });

      const result = await fastpathClientService.evaluateProtocol({ tenantId: 't1', protocol: 'canbus', metadata: { canId: 2015 } });
      expect(result).not.toBeNull();
      expect(result!.verdict).toBe('block');
      expect(mockAxiosPost).toHaveBeenCalledWith('/v1/protocols/evaluate', expect.objectContaining({ protocol: 'canbus' }));
    });

    it('forwards per-protocol policy metadata (e.g. canbus enabled/blockDiagnosticFrames) verbatim', async () => {
      mockPlatformGetConfig.mockResolvedValue(defaultConfig);
      mockAxiosPost.mockResolvedValue({ status: 200, data: { protocol: 'canbus', verdict: 'allow', action: 'inspect', findings: [] } });

      await fastpathClientService.evaluateProtocol({
        tenantId: 't1',
        protocol: 'canbus',
        metadata: { canId: 0x7DF, canDlc: 8, enabled: false, blockDiagnosticFrames: false }
      });
      expect(mockAxiosPost).toHaveBeenCalledWith(
        '/v1/protocols/evaluate',
        expect.objectContaining({
          metadata: expect.objectContaining({ enabled: false, blockDiagnosticFrames: false, canId: 0x7DF })
        })
      );
    });

    it('returns null when fastpath is disabled', async () => {
      mockPlatformGetConfig.mockResolvedValue({ ...defaultConfig, fastpath: { ...defaultConfig.fastpath, enabled: false } });
      const result = await fastpathClientService.evaluateProtocol({ protocol: 'mqtt' });
      expect(result).toBeNull();
    });
  });

  describe('listProtocolManifests', () => {
    it('returns the registered protocol manifests', async () => {
      mockPlatformGetConfig.mockResolvedValue(defaultConfig);
      mockAxiosGet.mockResolvedValue({ status: 200, data: { protocols: [{ id: 'http' }, { id: 'canbus' }] } });
      const result = await fastpathClientService.listProtocolManifests('t1');
      expect(result).toEqual([{ id: 'http' }, { id: 'canbus' }]);
      expect(mockAxiosGet).toHaveBeenCalledWith('/v1/protocols/manifests');
    });

    it('returns null for non-2xx', async () => {
      mockPlatformGetConfig.mockResolvedValue(defaultConfig);
      mockAxiosGet.mockResolvedValue({ status: 500, data: {} });
      expect(await fastpathClientService.listProtocolManifests('t1')).toBeNull();
    });
  });
});
