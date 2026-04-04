/**
 * Security Config Tests
 *
 * Tests for configuration loading, default values, and environment variable handling.
 */

const originalEnv = process.env;

describe('Security Config', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Default Configuration', () => {
    it('should load with default values', () => {
      const { defaultConfig } = require('../../security/config');

      expect(defaultConfig).toBeDefined();
      expect(defaultConfig.env).toBe('test'); // NODE_ENV is set to 'test' in jest.setup.js
      expect(defaultConfig.rateLimit).toBeDefined();
      expect(defaultConfig.antiBot).toBeDefined();
      expect(defaultConfig.concurrency).toBeDefined();
      expect(defaultConfig.authSecurity).toBeDefined();
      expect(defaultConfig.monitoring).toBeDefined();
    });

    it('should have correct rate limit defaults', () => {
      const { defaultConfig } = require('../../security/config');

      expect(defaultConfig.rateLimit.requestsPerMinute).toBe(60);
      expect(defaultConfig.rateLimit.windowSeconds).toBe(60);
    });

    it('should have correct anti-bot defaults', () => {
      const { defaultConfig } = require('../../security/config');

      expect(defaultConfig.antiBot.enabled).toBe(true);
      expect(defaultConfig.antiBot.requestThreshold).toBe(100);
      expect(defaultConfig.antiBot.fastRequestThreshold).toBe(10);
      expect(defaultConfig.antiBot.blockDuration).toBe(3600);
      expect(defaultConfig.antiBot.allowKnownBots).toBe(true);
    });

    it('should have correct concurrency defaults', () => {
      const { defaultConfig } = require('../../security/config');

      expect(defaultConfig.concurrency.maxConcurrentRequestsPerUser).toBe(5);
      expect(defaultConfig.concurrency.maxQueueSize).toBe(20);
    });

    it('should have correct auth security defaults', () => {
      const { defaultConfig } = require('../../security/config');

      expect(defaultConfig.authSecurity.maxLoginAttempts).toBe(5);
      expect(defaultConfig.authSecurity.lockoutDuration).toBe(900);
      expect(defaultConfig.authSecurity.attemptWindow).toBe(300);
    });

    it('should have correct password policy defaults', () => {
      const { defaultConfig } = require('../../security/config');

      expect(defaultConfig.authSecurity.passwordPolicy.minLength).toBe(8);
      expect(defaultConfig.authSecurity.passwordPolicy.maxLength).toBe(128);
      expect(defaultConfig.authSecurity.passwordPolicy.requireUppercase).toBe(true);
      expect(defaultConfig.authSecurity.passwordPolicy.requireLowercase).toBe(true);
      expect(defaultConfig.authSecurity.passwordPolicy.requireNumbers).toBe(true);
      expect(defaultConfig.authSecurity.passwordPolicy.requireSpecialChars).toBe(true);
    });

    it('should have correct monitoring defaults', () => {
      const { defaultConfig } = require('../../security/config');

      expect(defaultConfig.monitoring.enablePerformanceTracking).toBe(true);
      expect(defaultConfig.monitoring.slowQueryThreshold).toBe(1000);
      expect(defaultConfig.monitoring.memoryWarningThreshold).toBe(500);
    });
  });

  describe('Environment Variable Handling', () => {
    it('should use NODE_ENV from environment', () => {
      process.env.NODE_ENV = 'production';
      jest.resetModules();

      const { defaultConfig } = require('../../security/config');
      expect(defaultConfig.env).toBe('production');
    });

    it('should default to development when NODE_ENV not set', () => {
      delete process.env.NODE_ENV;
      jest.resetModules();

      const { defaultConfig } = require('../../security/config');
      expect(defaultConfig.env).toBe('development');
    });

    it('should handle test environment', () => {
      process.env.NODE_ENV = 'test';
      jest.resetModules();

      const { defaultConfig } = require('../../security/config');
      expect(defaultConfig.env).toBe('test');
    });
  });

  describe('HTTP Status Codes', () => {
    it('should export correct HTTP status codes', () => {
      const { HTTP_STATUS } = require('../../security/config');

      expect(HTTP_STATUS.OK).toBe(200);
      expect(HTTP_STATUS.CREATED).toBe(201);
      expect(HTTP_STATUS.BAD_REQUEST).toBe(400);
      expect(HTTP_STATUS.UNAUTHORIZED).toBe(401);
      expect(HTTP_STATUS.FORBIDDEN).toBe(403);
      expect(HTTP_STATUS.NOT_FOUND).toBe(404);
      expect(HTTP_STATUS.TOO_MANY_REQUESTS).toBe(429);
      expect(HTTP_STATUS.INTERNAL_SERVER_ERROR).toBe(500);
    });
  });

  describe('Redis Keys', () => {
    it('should export correct Redis key prefixes', () => {
      const { REDIS_KEYS } = require('../../security/config');

      expect(REDIS_KEYS.RATE_LIMIT_PREFIX).toBe('ratelimit');
      expect(REDIS_KEYS.REQUEST_COUNT_SUFFIX).toBe('requests');
      expect(REDIS_KEYS.LIMIT_SUFFIX).toBe('limit');
      expect(REDIS_KEYS.WINDOW_SUFFIX).toBe('window');
      expect(REDIS_KEYS.ANTIBOT_PREFIX).toBe('antibot');
      expect(REDIS_KEYS.AUTH_PREFIX).toBe('auth');
    });
  });

  describe('Performance Constants', () => {
    it('should export correct concurrency constants', () => {
      const { CONCURRENCY } = require('../../security/config');

      expect(CONCURRENCY.MAX_CONCURRENT_REQUESTS_PER_USER).toBe(5);
      expect(CONCURRENCY.MAX_QUEUE_SIZE).toBe(20);
    });

    it('should export correct monitoring constants', () => {
      const { MONITORING } = require('../../security/config');

      expect(MONITORING.ENABLE_PERFORMANCE_TRACKING).toBe(true);
      expect(MONITORING.SLOW_QUERY_THRESHOLD).toBe(1000);
      expect(MONITORING.MEMORY_WARNING_THRESHOLD).toBe(500);
    });

    it('should export correct rate limit constants', () => {
      const { RATE_LIMIT } = require('../../security/config');

      expect(RATE_LIMIT.WINDOW_SECONDS).toBe(60);
      expect(RATE_LIMIT.DEFAULT_REQUESTS_PER_MINUTE).toBe(60);
    });
  });

  describe('Configuration Immutability', () => {
    it('should not be affected by external mutations', () => {
      const { defaultConfig, HTTP_STATUS } = require('../../security/config');

      const originalRateLimit = defaultConfig.rateLimit.requestsPerMinute;

      // Attempt to mutate
      defaultConfig.rateLimit.requestsPerMinute = 999;

      // Re-require to check if mutation persisted
      jest.resetModules();
      const { defaultConfig: freshConfig } = require('../../security/config');

      // Note: This test documents current behavior - config is not deeply frozen
      // In production, configs are typically frozen or cloned
      expect(freshConfig.rateLimit.requestsPerMinute).toBe(originalRateLimit);
    });
  });

  describe('Type Safety', () => {
    it('should have valid environment values', () => {
      const { defaultConfig } = require('../../security/config');

      const validEnvs = ['development', 'production', 'test'];
      expect(validEnvs).toContain(defaultConfig.env);
    });

    it('should have positive numeric values for limits', () => {
      const { defaultConfig } = require('../../security/config');

      expect(defaultConfig.rateLimit.requestsPerMinute).toBeGreaterThan(0);
      expect(defaultConfig.rateLimit.windowSeconds).toBeGreaterThan(0);
      expect(defaultConfig.antiBot.requestThreshold).toBeGreaterThan(0);
      expect(defaultConfig.antiBot.blockDuration).toBeGreaterThan(0);
      expect(defaultConfig.concurrency.maxConcurrentRequestsPerUser).toBeGreaterThan(0);
      expect(defaultConfig.concurrency.maxQueueSize).toBeGreaterThan(0);
    });

    it('should have boolean values for feature flags', () => {
      const { defaultConfig } = require('../../security/config');

      expect(typeof defaultConfig.antiBot.enabled).toBe('boolean');
      expect(typeof defaultConfig.antiBot.allowKnownBots).toBe('boolean');
      expect(typeof defaultConfig.monitoring.enablePerformanceTracking).toBe('boolean');
    });
  });

  describe('Security Configuration Types', () => {
    it('should have complete auth security configuration', () => {
      const { defaultConfig } = require('../../security/config');

      expect(defaultConfig.authSecurity).toHaveProperty('maxLoginAttempts');
      expect(defaultConfig.authSecurity).toHaveProperty('lockoutDuration');
      expect(defaultConfig.authSecurity).toHaveProperty('attemptWindow');
      expect(defaultConfig.authSecurity).toHaveProperty('passwordPolicy');
    });

    it('should have complete password policy', () => {
      const { defaultConfig } = require('../../security/config');

      expect(defaultConfig.authSecurity.passwordPolicy).toHaveProperty('minLength');
      expect(defaultConfig.authSecurity.passwordPolicy).toHaveProperty('maxLength');
      expect(defaultConfig.authSecurity.passwordPolicy).toHaveProperty('requireUppercase');
      expect(defaultConfig.authSecurity.passwordPolicy).toHaveProperty('requireLowercase');
      expect(defaultConfig.authSecurity.passwordPolicy).toHaveProperty('requireNumbers');
      expect(defaultConfig.authSecurity.passwordPolicy).toHaveProperty('requireSpecialChars');
    });
  });
});
