import crypto from 'crypto';
import redisService from './redis.service';
import logger from '../utils/logger';
import { Request } from 'express';

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

export class AuthSecurityService {
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION = 900;
  private readonly ATTEMPT_WINDOW = 300;
  private readonly SESSION_TTL_SECONDS = 86_400;

  private loginAttemptsFallback: Map<string, LoginAttempt[]> = new Map();
  private lockedAccountsFallback: Map<string, { reason: string; lockedAt: string }> = new Map();
  private sessionsFallback: Map<string, string> = new Map();
  private concurrentSessionsFallback: Map<string, Set<string>> = new Map();

  private readonly PASSWORD_POLICY: PasswordPolicy = {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    maxLength: 128,
  };

  private readonly COMMON_PASSWORDS = [
    'password', '123456', '12345678', 'qwerty', 'abc123',
    'monkey', 'master', 'dragon', '111111', 'baseball',
    'iloveyou', 'trustno1', 'sunshine', 'princess', 'admin',
    'welcome', 'shadow', 'ashley', 'football', 'jesus',
    'michael', 'ninja', 'mustang', 'password1', 'password123',
  ];

  private readonly SUSPICIOUS_PATTERNS = [
    /1234.*56/,
    /abcd.*ef/,
    /qwerty.*uiop/,
    /(.+)\1{2,}/,
  ];

  public validatePassword(password: string): { valid: boolean; errors: string[]; strength: string } {
    const errors: string[] = [];
    let strength = 'weak';

    if (password.length < this.PASSWORD_POLICY.minLength) {
      errors.push(`Password must be at least ${this.PASSWORD_POLICY.minLength} characters long`);
    } else if (password.length >= 12) {
      strength = 'strong';
    } else if (password.length >= 8) {
      strength = 'medium';
    }

    if (this.PASSWORD_POLICY.maxLength && password.length > this.PASSWORD_POLICY.maxLength) {
      errors.push(`Password must not exceed ${this.PASSWORD_POLICY.maxLength} characters`);
    }

    if (this.PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (this.PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (this.PASSWORD_POLICY.requireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (this.PASSWORD_POLICY.requireSpecialChars && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    if (this.COMMON_PASSWORDS.includes(password.toLowerCase())) {
      errors.push('Password is too common');
      strength = 'weak';
    }

    for (const pattern of this.SUSPICIOUS_PATTERNS) {
      if (pattern.test(password)) {
        errors.push('Password contains predictable patterns');
        strength = 'weak';
        break;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      strength,
    };
  }

  public async recordLoginAttempt(email: string, ip: string, success: boolean): Promise<void> {
    const key = email.toLowerCase();

    try {
      const attempt: LoginAttempt = {
        email: key,
        ip,
        success,
        timestamp: Date.now(),
      };

      if (!redisService.isAvailable()) {
        this.recordLoginAttemptFallback(key, attempt);
        return;
      }

      const redisKey = `auth:attempts:${key}`;
      await redisService.getClient().lpush(redisKey, JSON.stringify(attempt));

      const cutoffTime = Date.now() - (this.ATTEMPT_WINDOW * 1000);
      const attempts = await redisService.getClient().lrange(redisKey, 0, -1);

      const recentAttempts = attempts
        .map(a => {
          try {
            return JSON.parse(a);
          } catch {
            return null;
          }
        })
        .filter((a: LoginAttempt | null) => a !== null && a.timestamp > cutoffTime) as LoginAttempt[];

      await redisService.del(redisKey);
      for (const a of recentAttempts.reverse()) {
        await redisService.getClient().rpush(redisKey, JSON.stringify(a));
      }

      await redisService.getClient().expire(redisKey, this.ATTEMPT_WINDOW);

      if (!success) {
        await this.checkAndLockAccount(email, ip);
      }
    } catch (error) {
      logger.error('Error recording login attempt', { error, email });
    }
  }

  private recordLoginAttemptFallback(key: string, attempt: LoginAttempt): void {
    const attempts = this.loginAttemptsFallback.get(key) || [];
    const cutoffTime = Date.now() - (this.ATTEMPT_WINDOW * 1000);
    const recentAttempts = attempts.filter(a => a.timestamp > cutoffTime);
    recentAttempts.unshift(attempt);
    this.loginAttemptsFallback.set(key, recentAttempts);

    if (!attempt.success) {
      const failedAttempts = recentAttempts.filter(a => !a.success);
      if (failedAttempts.length >= this.MAX_LOGIN_ATTEMPTS) {
        this.lockedAccountsFallback.set(key, {
          reason: `Too many failed login attempts (${this.MAX_LOGIN_ATTEMPTS})`,
          lockedAt: new Date().toISOString(),
        });
        logger.error('Account locked (fallback)', { email: key, attempts: failedAttempts.length });
      }
    }
  }

  private async checkAndLockAccount(email: string, ip: string): Promise<void> {
    const key = email.toLowerCase();

    try {
      if (!redisService.isAvailable()) {
        return;
      }

      const redisKey = `auth:attempts:${key}`;
      const attempts = await redisService.getClient().lrange(redisKey, 0, -1);
      const failedAttempts = attempts
        .map(a => {
          try {
            return JSON.parse(a);
          } catch {
            return null;
          }
        })
        .filter((a: LoginAttempt | null): a is LoginAttempt => a !== null && !a.success);

      if (failedAttempts.length >= this.MAX_LOGIN_ATTEMPTS) {
        const lockKey = `auth:locked:${key}`;
        await redisService.set(
          lockKey,
          JSON.stringify({
            reason: `Too many failed login attempts (${this.MAX_LOGIN_ATTEMPTS})`,
            lockedAt: new Date().toISOString(),
            attempts: failedAttempts.slice(0, this.MAX_LOGIN_ATTEMPTS),
          }),
          this.LOCKOUT_DURATION
        );

        logger.error('Account locked due to too many failed attempts', {
          email,
          ip,
          attempts: failedAttempts.length,
        });
      }
    } catch (error) {
      logger.error('Error checking account lock', { error, email });
    }
  }

  public async isAccountLocked(email: string): Promise<boolean> {
    const key = email.toLowerCase();

    try {
      if (!redisService.isAvailable()) {
        return this.lockedAccountsFallback.has(key);
      }

      return await redisService.exists(`auth:locked:${key}`);
    } catch (error) {
      logger.error('Error checking account lock', { error, email });
      return false;
    }
  }

  public async getLockInfo(email: string): Promise<{ locked: boolean; reason?: string; remainingTime?: number }> {
    const key = email.toLowerCase();

    try {
      if (!redisService.isAvailable()) {
        const lock = this.lockedAccountsFallback.get(key);
        if (lock) {
          return { locked: true, reason: lock.reason, remainingTime: this.LOCKOUT_DURATION };
        }
        return { locked: false };
      }

      const redisKey = `auth:locked:${key}`;
      const lockData = await redisService.get(redisKey);
      if (!lockData) {
        return { locked: false };
      }

      const ttl = await redisService.getClient().ttl(redisKey);
      const lock = JSON.parse(lockData);

      return {
        locked: true,
        reason: lock.reason,
        remainingTime: ttl > 0 ? ttl : 0,
      };
    } catch (error) {
      logger.error('Error getting lock info', { error, email });
      return { locked: false };
    }
  }

  public async unlockAccount(email: string): Promise<void> {
    const key = email.toLowerCase();

    try {
      if (!redisService.isAvailable()) {
        this.lockedAccountsFallback.delete(key);
        logger.info('Account unlocked (fallback)', { email });
        return;
      }

      await redisService.del(`auth:locked:${key}`);
      logger.info('Account unlocked', { email });
    } catch (error) {
      logger.error('Error unlocking account', { error, email });
    }
  }

  public async checkIPBruteForce(ip: string): Promise<boolean> {
    try {
      if (!redisService.isAvailable()) {
        return false;
      }

      const key = `auth:ip:attempts:${ip}`;
      const attempts = await redisService.getClient().lrange(key, 0, -1);
      const recentAttempts = attempts
        .map(a => {
          try {
            return JSON.parse(a);
          } catch {
            return null;
          }
        })
        .filter((a: LoginAttempt | null): a is LoginAttempt => {
          if (!a) return false;
          const timeSinceAttempt = Date.now() - a.timestamp;
          return timeSinceAttempt < (this.ATTEMPT_WINDOW * 1000);
        });

      const failedAttempts = recentAttempts.filter((a: LoginAttempt) => !a.success);
      if (failedAttempts.length > 10) {
        logger.error('Possible brute force attack detected', {
          ip,
          attempts: failedAttempts.length,
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error checking IP brute force', { error, ip });
      return false;
    }
  }

  public async getFailedAttempts(email: string): Promise<LoginAttempt[]> {
    const key = email.toLowerCase();

    try {
      if (!redisService.isAvailable()) {
        const attempts = this.loginAttemptsFallback.get(key) || [];
        return attempts.filter(a => !a.success);
      }

      const redisKey = `auth:attempts:${key}`;
      const attempts = await redisService.getClient().lrange(redisKey, 0, -1);
      return attempts
        .map(a => {
          try {
            return JSON.parse(a);
          } catch {
            return null;
          }
        })
        .filter((a: LoginAttempt | null): a is LoginAttempt => a !== null && !a.success);
    } catch (error) {
      logger.error('Error getting failed attempts', { error, email });
      return [];
    }
  }

  public async detectSuspiciousLogin(req: Request, email: string): Promise<string[]> {
    const warnings: string[] = [];
    const ip = req.ip || req.connection.remoteAddress || 'unknown';

    const isLocked = await this.isAccountLocked(email);
    if (isLocked) {
      const lockInfo = await this.getLockInfo(email);
      warnings.push(`Account is locked: ${lockInfo.reason}`);
    }

    const isBruteForce = await this.checkIPBruteForce(ip);
    if (isBruteForce) {
      warnings.push('Multiple failed login attempts detected from your IP');
    }

    const hour = new Date().getHours();
    if (hour >= 2 && hour <= 5) {
      warnings.push('Unusual login time detected');
    }

    const userAgent = req.headers['user-agent'];
    if (!userAgent || userAgent.length < 10) {
      warnings.push('Invalid User-Agent');
    }

    return warnings;
  }

  public generateSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  public async validateSession(userId: string, sessionId: string): Promise<boolean> {
    try {
      if (!redisService.isAvailable()) {
        const storedUserId = this.sessionsFallback.get(sessionId);
        return storedUserId === userId;
      }

      const key = `auth:session:${sessionId}`;
      const storedSession = await redisService.get(key);
      if (!storedSession) {
        return false;
      }

      try {
        const parsed = JSON.parse(storedSession);
        return parsed?.userId === userId;
      } catch {
        return storedSession === userId;
      }
    } catch (error) {
      logger.error('Error validating session', { error, userId });
      return false;
    }
  }

  public async invalidateSession(userId: string): Promise<void> {
    try {
      if (!redisService.isAvailable()) {
        // Find and remove by userId (any session for this user)
        for (const [sid, uid] of this.sessionsFallback.entries()) {
          if (uid === userId) this.sessionsFallback.delete(sid);
        }
        if (this.concurrentSessionsFallback.has(userId)) {
          this.concurrentSessionsFallback.delete(userId);
        }
        logger.info('Session invalidated (fallback)', { userId });
        return;
      }

      const concurrentKey = `auth:concurrent:${userId}`;
      const sessionIds = await redisService.getClient().smembers(concurrentKey);
      if (sessionIds.length > 0) {
        await Promise.all(sessionIds.map((sessionId) => redisService.del(`auth:session:${sessionId}`)));
      }
      await redisService.del(concurrentKey);
      await redisService.del(`auth:session:${userId}`);
      logger.info('Session invalidated', { userId });
    } catch (error) {
      logger.error('Error invalidating session', { error, userId });
    }
  }

  public async checkConcurrentSessions(userId: string, maxSessions: number = 3): Promise<boolean> {
    try {
      if (!redisService.isAvailable()) {
        const sessions = this.concurrentSessionsFallback.get(userId);
        return !sessions || sessions.size < maxSessions;
      }

      const key = `auth:concurrent:${userId}`;
      await this.pruneConcurrentSessions(userId);
      const sessionCount = await redisService.getClient().scard(key);
      return sessionCount < maxSessions;
    } catch (error) {
      logger.error('Error checking concurrent sessions', { error, userId });
      return true;
    }
  }

  public async addSession(userId: string, sessionId: string, deviceInfo: Record<string, unknown>): Promise<void> {
    try {
      if (!redisService.isAvailable()) {
        if (!this.concurrentSessionsFallback.has(userId)) {
          this.concurrentSessionsFallback.set(userId, new Set());
        }
        this.concurrentSessionsFallback.get(userId)!.add(sessionId);
        this.sessionsFallback.set(sessionId, userId);
        return;
      }

      const key = `auth:concurrent:${userId}`;
      const sessionKey = `auth:session:${sessionId}`;
      const client = redisService.getClient();
      await client.setex(
        sessionKey,
        this.SESSION_TTL_SECONDS,
        JSON.stringify({
          userId,
          deviceInfo,
          createdAt: Date.now(),
        })
      );
      await client.sadd(key, sessionId);
      await client.expire(key, this.SESSION_TTL_SECONDS);
      await this.pruneConcurrentSessions(userId);
    } catch (error) {
      logger.error('Error adding session', { error, userId });
    }
  }

  public async removeSession(userId: string, sessionId: string): Promise<void> {
    try {
      if (!redisService.isAvailable()) {
        const sessions = this.concurrentSessionsFallback.get(userId);
        if (sessions) {
          sessions.delete(sessionId);
        }
        this.sessionsFallback.delete(sessionId);
        return;
      }

      const key = `auth:concurrent:${userId}`;
      const sessionKey = `auth:session:${sessionId}`;
      await redisService.getClient().srem(key, sessionId);
      await redisService.del(sessionKey);
    } catch (error) {
      logger.error('Error removing session', { error, userId });
    }
  }

  private async pruneConcurrentSessions(userId: string): Promise<void> {
    if (!redisService.isAvailable()) {
      return;
    }

    const key = `auth:concurrent:${userId}`;
    const client = redisService.getClient();
    const sessionIds = await client.smembers(key);
    if (sessionIds.length === 0) {
      return;
    }

    const staleSessionIds: string[] = [];
    await Promise.all(sessionIds.map(async (sessionId) => {
      const exists = await client.exists(`auth:session:${sessionId}`);
      if (exists !== 1) {
        staleSessionIds.push(sessionId);
      }
    }));

    if (staleSessionIds.length > 0) {
      await client.srem(key, ...staleSessionIds);
    }
  }
}

export default new AuthSecurityService();
