import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import redisService from '../services/redis.service';
import logger from '../utils/logger';
import { config } from '../config';

// Known bot user agents
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

// Suspicious patterns (scrapers/crawlers)
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

// Honey pot field names (hidden fields that bots might fill)
const HONEYPOT_FIELD_NAME = 'website_confirm';

interface RequestFingerprint {
  ip: string;
  userAgent: string;
  acceptLanguage: string;
  acceptEncoding: string;
}

export class AntiBotMiddleware {
  private readonly REQUEST_THRESHOLD = 100; // requests per minute
  private readonly FAST_REQUEST_THRESHOLD = 10; // requests in 10 seconds
  private readonly BLOCK_DURATION = 3600; // 1 hour in seconds

  // Generate request fingerprint
  private generateFingerprint(req: Request): RequestFingerprint {
    return {
      ip: req.ip || req.connection.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      acceptLanguage: req.headers['accept-language'] || 'unknown',
      acceptEncoding: req.headers['accept-encoding'] || 'unknown',
    };
  }

  // Check if user agent is a known bot
  private isKnownBot(userAgent: string): boolean {
    return KNOWN_BOTS.some(bot => userAgent.toLowerCase().includes(bot));
  }

  // Check if user agent looks suspicious
  private isSuspiciousUserAgent(userAgent: string): boolean {
    // Empty user agent is suspicious
    if (!userAgent || userAgent.length < 10) {
      return true;
    }

    // Check against suspicious patterns
    return SUSPICIOUS_PATTERNS.some(pattern => pattern.test(userAgent));
  }

  // Check request rate using sliding window
  private async checkRequestRate(ip: string): Promise<{ allowed: boolean; rate: number }> {
    const key = `antibot:requests:${ip}`;
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window

    try {
      // Add current request timestamp
      await redisService.getClient().zadd(key, now, uuidv4());

      // Remove old entries outside the window
      await redisService.getClient().zremrangebyscore(key, 0, windowStart);

      // Count requests in the window
      const count = await redisService.getClient().zcard(key);

      // Set expiry
      await redisService.getClient().expire(key, 60);

      // Check fast request rate (10 requests in 10 seconds)
      const fastWindowStart = now - 10000;
      const fastCount = await redisService.getClient().zcount(key, fastWindowStart, now);

      // Determine if allowed
      const allowed = count < this.REQUEST_THRESHOLD && fastCount < this.FAST_REQUEST_THRESHOLD;

      return { allowed, rate: count };
    } catch (error) {
      logger.error('Error checking request rate', { error, ip });
      return { allowed: true, rate: 0 };
    }
  }

  // Check for fast sequential requests (possible automation)
  private async checkFastSequentialRequests(ip: string): Promise<boolean> {
    const key = `antibot:fast:${ip}`;
    const now = Date.now();

    try {
      const lastRequest = await redisService.get(key);
      if (lastRequest) {
        const timeSinceLastRequest = now - parseInt(lastRequest);
        // If requests are less than 100ms apart, it's likely automated
        if (timeSinceLastRequest < 100) {
          return true; // Suspicious
        }
      }

      // Update last request time
      await redisService.set(key, now.toString(), 10);
      return false;
    } catch (error) {
      logger.error('Error checking fast requests', { error, ip });
      return false;
    }
  }

  // Check honeypot field (if present in request body)
  private checkHoneypot(req: Request): boolean {
    if (req.body && typeof req.body === 'object') {
      const honeypotValue = req.body[HONEYPOT_FIELD_NAME];
      // If honeypot field is filled, it's likely a bot
      if (honeypotValue && honeypotValue.toString().trim().length > 0) {
        return true;
      }
    }
    return false;
  }

  // Block IP address
  private async blockIP(ip: string, reason: string): Promise<void> {
    const key = `antibot:blocked:${ip}`;
    try {
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

  // Check if IP is blocked
  private async isIPBlocked(ip: string): Promise<boolean> {
    const key = `antibot:blocked:${ip}`;
    try {
      const blocked = await redisService.exists(key);
      return blocked;
    } catch (error) {
      logger.error('Error checking blocked IP', { error, ip });
      return false;
    }
  }

  // Main middleware function
  public protect = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const fingerprint = this.generateFingerprint(req);
    const userAgent = fingerprint.userAgent.toLowerCase();

    try {
      // Skip all checks in development/test environment for testing purposes
      if (config.env !== 'production') {
        logger.debug('Skipping anti-bot checks in development environment', { ip: fingerprint.ip });
        next();
        return;
      }

      // Check if IP is already blocked
      const isBlocked = await this.isIPBlocked(fingerprint.ip);
      if (isBlocked) {
        logger.warn('Blocked IP attempted access', { ip: fingerprint.ip });
        res.status(429).json({
          error: 'Too many requests',
          message: 'Your access has been temporarily restricted due to suspicious activity',
        });
        return;
      }

      // Allow known good bots (Google, Bing, etc.)
      if (this.isKnownBot(userAgent)) {
        logger.debug('Known bot allowed', { ip: fingerprint.ip, userAgent: fingerprint.userAgent });
        next();
        return;
      }

      // Allow localhost/127.0.0.1/::1 for development
      if (fingerprint.ip === '127.0.0.1' || fingerprint.ip === '::1' || fingerprint.ip === 'localhost') {
        logger.debug('Localhost allowed', { ip: fingerprint.ip });
        next();
        return;
      }

      // Check for suspicious user agent
      if (this.isSuspiciousUserAgent(userAgent)) {
        await this.blockIP(fingerprint.ip, 'Suspicious user agent');
        logger.warn('Suspicious user agent blocked', { ip: fingerprint.ip, userAgent: fingerprint.userAgent });
        res.status(403).json({
          error: 'Access denied',
          message: 'Your request appears to be automated',
        });
        return;
      }

      // Check honeypot
      if (this.checkHoneypot(req)) {
        await this.blockIP(fingerprint.ip, 'Honeypot triggered');
        logger.warn('Honeypot triggered', { ip: fingerprint.ip });
        res.status(403).json({
          error: 'Access denied',
          message: 'Invalid request',
        });
        return;
      }

      // Check request rate
      const rateCheck = await this.checkRequestRate(fingerprint.ip);
      if (!rateCheck.allowed) {
        await this.blockIP(fingerprint.ip, `Rate limit exceeded: ${rateCheck.rate} req/min`);
        logger.warn('Rate limit exceeded', { ip: fingerprint.ip, rate: rateCheck.rate });
        res.status(429).json({
          error: 'Too many requests',
          message: 'Rate limit exceeded. Please slow down.',
          retryAfter: this.BLOCK_DURATION,
        });
        return;
      }

      // Check for fast sequential requests
      const isFastSequential = await this.checkFastSequentialRequests(fingerprint.ip);
      if (isFastSequential) {
        logger.warn('Fast sequential requests detected', { ip: fingerprint.ip });
        // Don't block immediately, but log the suspicious activity
      }

      // Check for missing required headers
      if (!req.headers['user-agent'] || !req.headers['accept']) {
        logger.warn('Missing required headers', { ip: fingerprint.ip, headers: req.headers });
        res.status(400).json({
          error: 'Bad request',
          message: 'Invalid request headers',
        });
        return;
      }

      // All checks passed
      next();
    } catch (error) {
      logger.error('Error in anti-bot middleware', { error, ip: fingerprint.ip });
      // Fail open to avoid blocking legitimate traffic on error
      next();
    }
  };

  // Get honeypot field name (for use in forms)
  public static getHoneypotFieldName(): string {
    return HONEYPOT_FIELD_NAME;
  }
}

// Export singleton instance
export default new AntiBotMiddleware();
