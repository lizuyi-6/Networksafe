// Type Definitions for Security Middleware

export interface SecurityConfig {
    // Environment
    env: 'development' | 'production' | 'test';

    // Rate Limiting
    rateLimit: {
        requestsPerMinute: number;
        windowSeconds: number;
    };

    // Anti-Bot
    antiBot: {
        enabled: boolean;
        requestThreshold: number;
        fastRequestThreshold: number;
        blockDuration: number;
        allowKnownBots: boolean;
    };

    // Concurrency
    concurrency: {
        maxConcurrentRequestsPerUser: number;
        maxQueueSize: number;
    };

    // Auth Security
    authSecurity: {
        maxLoginAttempts: number;
        lockoutDuration: number;
        attemptWindow: number;
        passwordPolicy: PasswordPolicy;
    };

    // Monitoring
    monitoring: {
        enablePerformanceTracking: boolean;
        slowQueryThreshold: number;
        memoryWarningThreshold: number;
    };
}

export interface PasswordPolicy {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
    maxLength?: number;
}

export interface LoginAttempt {
    email: string;
    ip: string;
    success: boolean;
    timestamp: number;
}

export interface RequestFingerprint {
    ip: string;
    userAgent: string;
    acceptLanguage: string;
    acceptEncoding: string;
}

export interface RateLimitInfo {
    limit: number;
    remaining: number;
    reset: number;
}

export interface SecurityMetrics {
    requestsPerMinute: number;
    blockedRequests: number;
    activeConnections: number;
    memoryUsage: number;
    cpuUsage: number;
}
