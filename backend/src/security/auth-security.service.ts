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
  private readonly LOCKOUT_DURATION = 900; // 15 minutes in seconds
  private readonly ATTEMPT_WINDOW = 300; // 5 minutes in seconds

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
    /1234.*56/, // Sequential numbers
    /abcd.*ef/, // Sequential letters
    /qwerty.*uiop/, // Keyboard patterns
    /(.+)\1{2,}/, // Repeated characters (aaa111)
  ];

  // Check password strength
  public validatePassword(password: string): { valid: boolean; errors: string[]; strength: string } {
    const errors: string[] = [];
    let strength = 'weak';

    // Check length
    if (password.length < this.PASSWORD_POLICY.minLength) {
      errors.push(`Password must be at least ${this.PASSWORD_POLICY.minLength} characters long`);
    } else if (password.length >= 12) {
      strength = 'strong';
    } else if (password.length >= 8) {
      strength = 'medium';
    }

    // Check max length
    if (this.PASSWORD_POLICY.maxLength && password.length > this.PASSWORD_POLICY.maxLength) {
      errors.push(`Password must not exceed ${this.PASSWORD_POLICY.maxLength} characters`);
    }

    // Check uppercase
    if (this.PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    // Check lowercase
    if (this.PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    // Check numbers
    if (this.PASSWORD_POLICY.requireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    // Check special characters
    if (this.PASSWORD_POLICY.requireSpecialChars && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    // Check against common passwords
    if (this.COMMON_PASSWORDS.includes(password.toLowerCase())) {
      errors.push('Password is too common');
      strength = 'weak';
    }

    // Check for suspicious patterns
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

  // Record login attempt
  public async recordLoginAttempt(email: string, ip: string, success: boolean): Promise<void> {
    const key = `auth:attempts:${email.toLowerCase()}`;

    try {
      const attempt: LoginAttempt = {
        email: email.toLowerCase(),
        ip,
        success,
        timestamp: Date.now(),
      };

      // Add attempt to Redis list
      await redisService.getClient().lpush(key, JSON.stringify(attempt));

      // Remove old attempts outside the window
      const cutoffTime = Date.now() - (this.ATTEMPT_WINDOW * 1000);
      const attempts = await redisService.getClient().lrange(key, 0, -1);

      // Filter and keep only recent attempts
      const recentAttempts = attempts
        .map(a => {
          try {
            return JSON.parse(a);
          } catch {
            return null;
          }
        })
        .filter((a: LoginAttempt | null) => a !== null && a.timestamp > cutoffTime) as LoginAttempt[];

      // Clear and repopulate with recent attempts
      await redisService.del(key);
      for (const a of recentAttempts.reverse()) {
        await redisService.getClient().rpush(key, JSON.stringify(a));
      }

      // Set expiry
      await redisService.getClient().expire(key, this.ATTEMPT_WINDOW);

      // If failed attempt, check if we need to lock the account
      if (!success) {
        await this.checkAndLockAccount(email, ip);
      }
    } catch (error) {
      logger.error('Error recording login attempt', { error, email });
    }
  }

  // Check and lock account if too many failed attempts
  private async checkAndLockAccount(email: string, ip: string): Promise<void> {
    const key = `auth:attempts:${email.toLowerCase()}`;

    try {
      const attempts = await redisService.getClient().lrange(key, 0, -1);
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
        // Lock the account
        const lockKey = `auth:locked:${email.toLowerCase()}`;
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

  // Check if account is locked
  public async isAccountLocked(email: string): Promise<boolean> {
    const key = `auth:locked:${email.toLowerCase()}`;

    try {
      return await redisService.exists(key);
    } catch (error) {
      logger.error('Error checking account lock', { error, email });
      return false;
    }
  }

  // Get lock information
  public async getLockInfo(email: string): Promise<{ locked: boolean; reason?: string; remainingTime?: number }> {
    const key = `auth:locked:${email.toLowerCase()}`;

    try {
      const lockData = await redisService.get(key);
      if (!lockData) {
        return { locked: false };
      }

      const ttl = await redisService.getClient().ttl(key);
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

  // Unlock account (admin only or after lockout period)
  public async unlockAccount(email: string): Promise<void> {
    const key = `auth:locked:${email.toLowerCase()}`;

    try {
      await redisService.del(key);
      logger.info('Account unlocked', { email });
    } catch (error) {
      logger.error('Error unlocking account', { error, email });
    }
  }

  // Check IP for multiple failed login attempts (possible brute force)
  public async checkIPBruteForce(ip: string): Promise<boolean> {
    const key = `auth:ip:attempts:${ip}`;

    try {
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

      // If more than 10 failed attempts from same IP, it's suspicious
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

  // Get failed login attempts for monitoring
  public async getFailedAttempts(email: string): Promise<LoginAttempt[]> {
    const key = `auth:attempts:${email.toLowerCase()}`;

    try {
      const attempts = await redisService.getClient().lrange(key, 0, -1);
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

  // Detect suspicious login behavior
  public async detectSuspiciousLogin(req: Request, email: string): Promise<string[]> {
    const warnings: string[] = [];
    const ip = req.ip || req.connection.remoteAddress || 'unknown';

    // Check if account is locked
    const isLocked = await this.isAccountLocked(email);
    if (isLocked) {
      const lockInfo = await this.getLockInfo(email);
      warnings.push(`Account is locked: ${lockInfo.reason}`);
    }

    // Check IP for brute force
    const isBruteForce = await this.checkIPBruteForce(ip);
    if (isBruteForce) {
      warnings.push('Multiple failed login attempts detected from your IP');
    }

    // Check for unusual login time (optional)
    const hour = new Date().getHours();
    if (hour >= 2 && hour <= 5) {
      // Logins between 2-5 AM are suspicious
      warnings.push('Unusual login time detected');
    }

    // Check User-Agent consistency (optional enhancement)
    const userAgent = req.headers['user-agent'];
    if (!userAgent || userAgent.length < 10) {
      warnings.push('Invalid User-Agent');
    }

    return warnings;
  }

  // Generate session ID for additional security
  public generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  // Validate session
  public async validateSession(userId: string, sessionId: string): Promise<boolean> {
    const key = `auth:session:${userId}`;

    try {
      const storedSessionId = await redisService.get(key);
      return storedSessionId === sessionId;
    } catch (error) {
      logger.error('Error validating session', { error, userId });
      return false;
    }
  }

  // Invalidate session (logout)
  public async invalidateSession(userId: string): Promise<void> {
    const key = `auth:session:${userId}`;

    try {
      await redisService.del(key);
      logger.info('Session invalidated', { userId });
    } catch (error) {
      logger.error('Error invalidating session', { error, userId });
    }
  }

  // Check for concurrent sessions
  public async checkConcurrentSessions(userId: string, maxSessions: number = 3): Promise<boolean> {
    const key = `auth:concurrent:${userId}`;

    try {
      const sessionCount = await redisService.getClient().scard(key);
      return sessionCount < maxSessions;
    } catch (error) {
      logger.error('Error checking concurrent sessions', { error, userId });
      return true;
    }
  }

  // Add session
  public async addSession(userId: string, sessionId: string, deviceInfo: Record<string, unknown>): Promise<void> {
    const key = `auth:concurrent:${userId}`;

    try {
      await redisService.getClient().sadd(key, sessionId);
      await redisService.getClient().expire(key, 86400); // 24 hours

      // Store session details
      const sessionKey = `auth:session:${sessionId}`;
      await redisService.set(
        sessionKey,
        JSON.stringify({
          userId,
          deviceInfo,
          createdAt: Date.now(),
        }),
        86400
      );
    } catch (error) {
      logger.error('Error adding session', { error, userId });
    }
  }

  // Remove session
  public async removeSession(userId: string, sessionId: string): Promise<void> {
    const key = `auth:concurrent:${userId}`;
    const sessionKey = `auth:session:${sessionId}`;

    try {
      await redisService.getClient().srem(key, sessionId);
      await redisService.del(sessionKey);
    } catch (error) {
      logger.error('Error removing session', { error, userId });
    }
  }
}

export default new AuthSecurityService();
