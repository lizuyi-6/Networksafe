// Default Configuration

import { SecurityConfig } from './types';

export const defaultConfig: SecurityConfig = {
    env: (process.env.NODE_ENV as SecurityConfig['env']) || 'development',

    rateLimit: {
        requestsPerMinute: 60,
        windowSeconds: 60,
    },

    antiBot: {
        enabled: true,
        requestThreshold: 100,
        fastRequestThreshold: 10,
        blockDuration: 3600,
        allowKnownBots: true,
    },

    concurrency: {
        maxConcurrentRequestsPerUser: 5,
        maxQueueSize: 20,
    },

    authSecurity: {
        maxLoginAttempts: 5,
        lockoutDuration: 900,
        attemptWindow: 300,
        passwordPolicy: {
            minLength: 8,
            requireUppercase: true,
            requireLowercase: true,
            requireNumbers: true,
            requireSpecialChars: true,
            maxLength: 128,
        },
    },

    monitoring: {
        enablePerformanceTracking: true,
        slowQueryThreshold: 1000,
        memoryWarningThreshold: 500,
    },
};

// HTTP Status Codes
export const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
};

// Redis Keys
export const REDIS_KEYS = {
    RATE_LIMIT_PREFIX: 'ratelimit',
    REQUEST_COUNT_SUFFIX: 'requests',
    LIMIT_SUFFIX: 'limit',
    WINDOW_SUFFIX: 'window',
    ANTIBOT_PREFIX: 'antibot',
    AUTH_PREFIX: 'auth',
};

// Performance Constants
export const CONCURRENCY = {
    MAX_CONCURRENT_REQUESTS_PER_USER: 5,
    MAX_QUEUE_SIZE: 20,
};

export const MONITORING = {
    ENABLE_PERFORMANCE_TRACKING: true,
    SLOW_QUERY_THRESHOLD: 1000,
    MEMORY_WARNING_THRESHOLD: 500,
};

export const RATE_LIMIT = {
    WINDOW_SECONDS: 60,
    DEFAULT_REQUESTS_PER_MINUTE: 60,
};
