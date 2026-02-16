// Redis Service

import Redis from 'ioredis';
import logger from '../utils/logger';

class RedisService {
  private client: Redis | null = null;
  private disabled: boolean = false;
  private connectionReady: boolean = false;

  constructor() {
    if (process.env.DISABLE_REDIS === 'true' || process.env.NODE_ENV === 'test') {
      this.disabled = true;
      logger.warn('Redis disabled in test environment');
      return;
    }
    this.connect();
  }

  private connect(): void {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

      this.client = new Redis(redisUrl, {
        retryStrategy: (times) => {
          if (times > 10) {
            logger.warn('Redis connection retry limit reached, stopping retries');
            return null;
          }
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 1,
        commandTimeout: 1000,
        connectTimeout: 1000,
      });

      this.client.on('connect', () => {
        this.connectionReady = true;
        logger.info('Redis connected successfully');
      });

      this.client.on('ready', () => {
        this.connectionReady = true;
        logger.info('Redis ready for operations');
      });

      this.client.on('error', (error) => {
        this.connectionReady = false;
        logger.error('Redis connection error', { error: error.message });
      });

      this.client.on('close', () => {
        this.connectionReady = false;
        logger.warn('Redis connection closed');
      });

      this.client.on('end', () => {
        this.connectionReady = false;
        logger.warn('Redis connection ended');
      });

    } catch (error) {
      this.connectionReady = false;
      logger.error('Failed to initialize Redis', { error });
    }
  }

  getClient(): Redis {
    if (this.disabled) {
      throw new Error('Redis is disabled');
    }
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    if (this.disabled || !this.connectionReady) return null;
    try {
      return await this.getClient().get(key);
    } catch (error) {
      logger.error('Redis GET error', { error, key });
      return null;
    }
  }

  async set(key: string, value: string, seconds?: number): Promise<void> {
    if (this.disabled || !this.connectionReady) return;
    try {
      if (seconds) {
        await this.getClient().setex(key, seconds, value);
      } else {
        await this.getClient().set(key, value);
      }
    } catch (error) {
      logger.error('Redis SET error', { error, key });
    }
  }

  async del(key: string): Promise<void> {
    if (this.disabled || !this.connectionReady) return;
    try {
      await this.getClient().del(key);
    } catch (error) {
      logger.error('Redis DEL error', { error, key });
    }
  }

  async exists(key: string): Promise<boolean> {
    if (this.disabled || !this.connectionReady) return false;
    try {
      const result = await this.getClient().exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Redis EXISTS error', { error, key });
      return false;
    }
  }

  async incr(key: string): Promise<number> {
    if (this.disabled || !this.connectionReady) return 0;
    try {
      return await this.getClient().incr(key);
    } catch (error) {
      logger.error('Redis INCR error', { error, key });
      return 0;
    }
  }

  async disconnect(): Promise<void> {
    if (this.disabled) return;
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connectionReady = false;
    }
  }

  isAvailable(): boolean {
    return !this.disabled && this.client !== null && this.connectionReady;
  }

  isDisabled(): boolean {
    return this.disabled;
  }
}

export default new RedisService();
