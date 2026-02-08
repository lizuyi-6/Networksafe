/**
 * Nonce Manager Service
 *
 * SECURITY FIX for RISK-002: Redis Single Point of Failure
 *
 * Provides nonce management with Redis + memory fallback to prevent
 * replay attacks even when Redis is unavailable.
 */

import logger from '../utils/logger';
import redisService from './redis.service';

interface NonceEntry {
  nonce: string;
  timestamp: number;
  expiresAt: number;
}

/**
 * Nonce Manager with dual storage (Redis + Memory)
 */
export class NonceManager {
  private memoryStore: Map<string, NonceEntry> = new Map();
  private readonly MEMORY_TTL = 600000; // 10 minutes (same as Redis)
  private readonly CLEANUP_INTERVAL = 60000; // Cleanup every minute

  constructor() {
    // Periodic cleanup of expired nonces in memory
    setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
  }

  /**
   * Check if nonce exists and mark as used
   *
   * Returns: true if nonce is new (allow), false if duplicate (reject)
   */
  async checkAndUseNonce(nonce: string, ttl: number = 600): Promise<boolean> {
    const nonceKey = `nonce:${nonce}`;
    const now = Date.now();
    const expiresAt = now + (ttl * 1000);

    try {
      // Try Redis first
      const nonceExists = await redisService.exists(nonceKey);

      if (nonceExists) {
        logger.warn('Replay attack detected - duplicate nonce (Redis)');
        return false;
      }

      // Mark nonce as used in Redis
      await redisService.set(nonceKey, '1', ttl);

      // Also store in memory as backup
      this.memoryStore.set(nonceKey, {
        nonce,
        timestamp: now,
        expiresAt,
      });

      return true;

    } catch (error) {
      // Redis failed - use memory fallback
      logger.warn('Redis nonce check failed, using memory fallback', { error, nonce });

      return this.checkAndUseNonceMemory(nonceKey, expiresAt);
    }
  }

  /**
   * Memory fallback for nonce management
   */
  private checkAndUseNonceMemory(nonceKey: string, expiresAt: number): boolean {
    const entry = this.memoryStore.get(nonceKey);

    if (entry) {
      // Check if expired
      if (Date.now() > entry.expiresAt) {
        // Expired, remove and allow reuse
        this.memoryStore.delete(nonceKey);

        const newEntry: NonceEntry = {
          nonce: nonceKey,
          timestamp: Date.now(),
          expiresAt,
        };

        this.memoryStore.set(nonceKey, newEntry);
        return true;
      }

      // Exists and not expired - replay attack detected
      logger.warn('Replay attack detected - duplicate nonce (Memory)');
      return false;
    }

    // New nonce
    const newEntry: NonceEntry = {
      nonce: nonceKey,
      timestamp: Date.now(),
      expiresAt,
    };

    this.memoryStore.set(nonceKey, newEntry);
    return true;
  }

  /**
   * Check if nonce exists without marking it as used
   */
  async hasNonce(nonce: string): Promise<boolean> {
    const nonceKey = `nonce:${nonce}`;

    try {
      // Check Redis first
      const exists = await redisService.exists(nonceKey);
      if (exists) return true;

      // Check memory fallback
      const entry = this.memoryStore.get(nonceKey);
      if (entry && Date.now() <= entry.expiresAt) {
        return true;
      }

      return false;

    } catch (error) {
      // Redis failed - check memory only
      logger.warn('Redis nonce check failed, checking memory', { error });
      const entry = this.memoryStore.get(nonceKey);
      return entry !== undefined && Date.now() <= entry.expiresAt;
    }
  }

  /**
   * Manually mark a nonce as used (for testing or admin purposes)
   */
  async markNonceUsed(nonce: string, ttl: number = 600): Promise<void> {
    const nonceKey = `nonce:${nonce}`;
    const now = Date.now();
    const expiresAt = now + (ttl * 1000);

    try {
      await redisService.set(nonceKey, '1', ttl);
    } catch (error) {
      logger.warn('Failed to mark nonce in Redis, using memory', { error });
    }

    // Always store in memory as backup
    this.memoryStore.set(nonceKey, {
      nonce,
      timestamp: now,
      expiresAt,
    });
  }

  /**
   * Cleanup expired nonces from memory
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.memoryStore.entries()) {
      if (now > entry.expiresAt) {
        this.memoryStore.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Cleaned up expired nonces from memory', {
        cleaned,
        remaining: this.memoryStore.size,
      });
    }
  }

  /**
   * Get statistics about nonce storage
   */
  getStats(): {
    memoryCount: number;
    redisAvailable: boolean;
  } {
    return {
      memoryCount: this.memoryStore.size,
      redisAvailable: redisService.isAvailable(),
    };
  }

  /**
   * Clear all nonces (for testing)
   */
  async clearAll(): Promise<void> {
    this.memoryStore.clear();

    try {
      // This would require Redis SCAN to delete all nonce:* keys
      logger.info('Cleared all nonces from memory');
    } catch (error) {
      logger.error('Failed to clear nonces from Redis', { error });
    }
  }

  /**
   * Migrate Redis nonces to memory (for Redis migration scenarios)
   */
  async migrateFromRedis(pattern: string = 'nonce:*'): Promise<number> {
    logger.warn('Redis to memory migration requested', { pattern });
    // Implementation would use Redis SCAN
    return 0;
  }
}

// Singleton instance
export default new NonceManager();
