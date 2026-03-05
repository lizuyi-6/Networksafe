import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import redisService from './redis.service';
import logger from '../utils/logger';
import { defaultConfig as config } from '../config';

const KNOWN_BOTS = [
  'googlebot',
  'bingbot',
  'slurp',
  'duckduckbot',
  'baiduspider',
  'yandexbot',
  'sogou',
  'exabot',
  'facebot',
  'facebookexternalhit',
  'ia_archiver',
  'twitterbot',
  'linkedinbot',
  'embedly',
  'quora link preview',
  'showyoubot',
  'outbrain',
  'pinterest',
  'applebot',
  'semrushbot',
];

const SUSPICIOUS_PATTERNS = [
  /bot/i,
  /spider/i,
  /crawler/i,
  /scraper/i,
  /curl/i,
  /wget/i,
  /python/i,
  /java/i,
  /go-http-client/i,
  /node/i,
  /axios/i,
  /http.rb/i,
  /okhttp/i,
  /allover/i,
  /scan/i,
  /harvest/i,
];

const HONEYPOT_FIELD_NAME = 'website_confirm';

interface RequestFingerprint {
  ip: string;
  userAgent: string;
  acceptLanguage: string;
  acceptEncoding: string;
}

interface RequestLog {
  timestamp: number;
  id: string;
}

export class AntiBotMiddleware {
  private readonly REQUEST_THRESHOLD = 100;
  private readonly FAST_REQUEST_THRESHOLD = 10;
  private readonly BLOCK_DURATION = 3600;

  private requestLogsFallback: Map<string, RequestLog[]> = new Map();
  private blockedIPsFallback: Map<string, { reason: string; blockedAt: string }> = new Map();
  private lastRequestTimeFallback: Map<string, number> = new Map();

  private generateFingerprint(req: Request): RequestFingerprint {
    return {
      ip: req.ip || req.connection.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      acceptLanguage: req.headers['accept-language'] || 'unknown',
      acceptEncoding: req.headers['accept-encoding'] || 'unknown',
    };
  }

  private isKnownBot(userAgent: string): boolean {
    return KNOWN_BOTS.some(bot => userAgent.toLowerCase().includes(bot));
  }

  private isSuspiciousUserAgent(userAgent: string): boolean {
    if (!userAgent || userAgent.length < 10) {
      return true;
    }

    return SUSPICIOUS_PATTERNS.some(pattern => pattern.test(userAgent));
  }

  private async checkRequestRate(ip: string): Promise<{ allowed: boolean; rate: number }> {
    const now = Date.now();
    const windowStart = now - 60000;

    try {
      if (!redisService.isAvailable()) {
        return this.checkRequestRateFallback(ip, now, windowStart);
      }

      const key = `antibot:requests:${ip}`;

      await redisService.getClient().zadd(key, now, uuidv4());
      await redisService.getClient().zremrangebyscore(key, 0, windowStart);
      const count = await redisService.getClient().zcard(key);
      await redisService.getClient().expire(key, 60);

      const fastWindowStart = now - 10000;
      const fastCount = await redisService.getClient().zcount(key, fastWindowStart, now);

      const allowed = count < this.REQUEST_THRESHOLD && fastCount < this.FAST_REQUEST_THRESHOLD;

      return { allowed, rate: count };
    } catch (error) {
      logger.error('Error checking request rate', { error, ip });
      return { allowed: true, rate: 0 };
    }
  }

  private checkRequestRateFallback(ip: string, now: number, windowStart: number): { allowed: boolean; rate: number } {
    const logs = this.requestLogsFallback.get(ip) || [];
    const recentLogs = logs.filter(l => l.timestamp > windowStart);
    recentLogs.push({ timestamp: now, id: uuidv4() });
    this.requestLogsFallback.set(ip, recentLogs);

    const count = recentLogs.length;
    const fastWindowStart = now - 10000;
    const fastCount = recentLogs.filter(l => l.timestamp > fastWindowStart).length;

    const allowed = count < this.REQUEST_THRESHOLD && fastCount < this.FAST_REQUEST_THRESHOLD;
    return { allowed, rate: count };
  }

  private async checkFastSequentialRequests(ip: string): Promise<boolean> {
    const now = Date.now();

    try {
      if (!redisService.isAvailable()) {
        return this.checkFastSequentialRequestsFallback(ip, now);
      }

      const key = `antibot:fast:${ip}`;
      const lastRequest = await redisService.get(key);
      if (lastRequest) {
        const timeSinceLastRequest = now - parseInt(lastRequest);
        if (timeSinceLastRequest < 100) {
          return true;
        }
      }

      await redisService.set(key, now.toString(), 10);
      return false;
    } catch (error) {
      logger.error('Error checking fast requests', { error, ip });
      return false;
    }
  }

  private checkFastSequentialRequestsFallback(ip: string, now: number): boolean {
    const lastRequest = this.lastRequestTimeFallback.get(ip);
    if (lastRequest) {
      const timeSinceLastRequest = now - lastRequest;
      if (timeSinceLastRequest < 100) {
        return true;
      }
    }
    this.lastRequestTimeFallback.set(ip, now);
    return false;
  }

  private checkHoneypot(req: Request): boolean {
    if (req.body && typeof req.body === 'object') {
      const honeypotValue = req.body[HONEYPOT_FIELD_NAME];
      if (honeypotValue && honeypotValue.toString().trim().length > 0) {
        return true;
      }
    }
    return false;
  }

  private async blockIP(ip: string, reason: string): Promise<void> {
    try {
      if (!redisService.isAvailable()) {
        this.blockedIPsFallback.set(ip, {
          reason,
          blockedAt: new Date().toISOString(),
        });
        logger.warn('IP blocked (fallback)', { ip, reason });
        return;
      }

      const key = `antibot:blocked:${ip}`;
      await redisService.set(
        key,
        JSON.stringify({
          reason,
          blockedAt: new Date().toISOString(),
        }),
        this.BLOCK_DURATION
      );

      logger.warn('IP blocked for suspicious activity', { ip, reason });
    } catch (error) {
      logger.error('Error blocking IP', { error, ip });
    }
  }

  private async isIPBlocked(ip: string): Promise<boolean> {
    try {
      if (!redisService.isAvailable()) {
        return this.blockedIPsFallback.has(ip);
      }

      const key = `antibot:blocked:${ip}`;
      return await redisService.exists(key);
    } catch (error) {
      logger.error('Error checking blocked IP', { error, ip });
      return false;
    }
  }

  public protect = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const fingerprint = this.generateFingerprint(req);
    const userAgent = fingerprint.userAgent.toLowerCase();

    try {
      if (config.env !== 'production') {
        logger.debug('Skipping anti-bot checks in development environment', { ip: fingerprint.ip });
        next();
        return;
      }

      const isBlocked = await this.isIPBlocked(fingerprint.ip);
      if (isBlocked) {
        logger.warn('Blocked IP attempted access', { ip: fingerprint.ip });
        res.status(429).json({
          error: 'backend.too_many_requests',
          message: 'backend.your_access_has_been_temporarily_restricted_due_to_suspicious_activity',
        });
        return;
      }

      if (this.isKnownBot(userAgent)) {
        logger.debug('Known bot allowed', { ip: fingerprint.ip, userAgent: fingerprint.userAgent });
        next();
        return;
      }

      if (fingerprint.ip === '127.0.0.1' || fingerprint.ip === '::1' || fingerprint.ip === 'localhost') {
        logger.debug('Localhost allowed', { ip: fingerprint.ip });
        next();
        return;
      }

      if (this.isSuspiciousUserAgent(userAgent)) {
        await this.blockIP(fingerprint.ip, 'Suspicious user agent');
        logger.warn('Suspicious user agent blocked', { ip: fingerprint.ip, userAgent: fingerprint.userAgent });
        res.status(403).json({
          error: 'backend.access_denied',
          message: 'backend.your_request_appears_to_be_automated',
        });
        return;
      }

      if (this.checkHoneypot(req)) {
        await this.blockIP(fingerprint.ip, 'Honeypot triggered');
        logger.warn('Honeypot triggered', { ip: fingerprint.ip });
        res.status(403).json({
          error: 'backend.access_denied',
          message: 'backend.invalid_request',
        });
        return;
      }

      const rateCheck = await this.checkRequestRate(fingerprint.ip);
      if (!rateCheck.allowed) {
        await this.blockIP(fingerprint.ip, `Rate limit exceeded: ${rateCheck.rate} req/min`);
        logger.warn('Rate limit exceeded', { ip: fingerprint.ip, rate: rateCheck.rate });
        res.status(429).json({
          error: 'backend.too_many_requests',
          message: 'backend.rate_limit_exceeded_please_slow_down',
          retryAfter: this.BLOCK_DURATION,
        });
        return;
      }

      const isFastSequential = await this.checkFastSequentialRequests(fingerprint.ip);
      if (isFastSequential) {
        logger.warn('Fast sequential requests detected', { ip: fingerprint.ip });
      }

      if (!req.headers['user-agent'] || !req.headers['accept']) {
        logger.warn('Missing required headers', { ip: fingerprint.ip, headers: req.headers });
        res.status(400).json({
          error: 'backend.bad_request',
          message: 'backend.invalid_request_headers',
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('Error in anti-bot middleware', { error, ip: fingerprint.ip });
      next();
    }
  };

  public static getHoneypotFieldName(): string {
    return HONEYPOT_FIELD_NAME;
  }
}

export default new AntiBotMiddleware();
