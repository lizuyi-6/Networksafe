import { Request, Response, NextFunction } from 'express';
import { CONCURRENCY, MONITORING } from '../config';
import logger from '../utils/logger';
import redisService from './redis.service';

/**
 * Concurrency control middleware for high-traffic scenarios
 * Prevents server overload and ensures fair resource allocation
 */

interface QueueItem {
  resolve: () => void;
  reject: (error: any) => void;
  timestamp: number;
}

class ConcurrencyController {
  private userQueues = new Map<string, QueueItem[]>();
  private activeRequests = new Map<string, number>();
  // Use locks to prevent race conditions
  private locks = new Map<string, Promise<void>>();

  /**
   * Acquire request slot for user (thread-safe)
   */
  async acquireSlot(userId: string): Promise<void> {
    // Wait for any existing operation on this user to complete
    let existingLock = this.locks.get(userId);
    while (existingLock) {
      await existingLock;
      existingLock = this.locks.get(userId);
    }

    // Create a new lock for this operation
    let resolveLock: (() => void) | undefined;
    const lockPromise = new Promise<void>(resolve => { resolveLock = resolve; });
    this.locks.set(userId, lockPromise);

    try {
      const active = this.activeRequests.get(userId) || 0;

      if (active < CONCURRENCY.MAX_CONCURRENT_REQUESTS_PER_USER) {
        // Slot available - atomic increment
        this.activeRequests.set(userId, active + 1);
        return;
      }

      // Wait in queue
      return new Promise((resolve, reject) => {
        let queue = this.userQueues.get(userId);

        if (!queue) {
          queue = [];
          this.userQueues.set(userId, queue);
        }

        // Check queue size limit
        if (queue.length >= CONCURRENCY.MAX_QUEUE_SIZE) {
          reject(new Error('Request queue full'));
          return;
        }

        queue.push({
          resolve: resolve as () => void,
          reject,
          timestamp: Date.now(),
        });
      });
    } finally {
      // Release the lock
      if (resolveLock) {
        resolveLock();
      }
      this.locks.delete(userId);
    }
  }

  /**
   * Release request slot for user
   */
  releaseSlot(userId: string): void {
    const active = this.activeRequests.get(userId) || 0;

    if (active > 0) {
      this.activeRequests.set(userId, active - 1);
    }

    // Process next request in queue
    const queue = this.userQueues.get(userId);

    if (queue && queue.length > 0) {
      const next = queue.shift();
      this.activeRequests.set(userId, (this.activeRequests.get(userId) || 0) + 1);
      next?.resolve();
    }
  }

  /**
   * Get current statistics
   */
  getStats(userId: string) {
    return {
      active: this.activeRequests.get(userId) || 0,
      queued: (this.userQueues.get(userId) || []).length,
    };
  }

  /**
   * Cleanup inactive users to prevent memory leaks
   */
  cleanup(): void {
    const now = Date.now();
    const staleThreshold = now - (60 * 60 * 1000); // 1 hour

    for (const [userId, queue] of this.userQueues.entries()) {
      const active = this.activeRequests.get(userId) || 0;
      const hasStaleRequests = queue.some(item => item.timestamp < staleThreshold);

      // Clean up if no active requests and only stale queued requests
      if (active === 0 && hasStaleRequests) {
        this.userQueues.delete(userId);
        this.activeRequests.delete(userId);
      }
    }
  }
}

const controller = new ConcurrencyController();

/**
 * Concurrency limiting middleware
 */
export const concurrencyLimit = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const userId = (req as any).user?.userId || 'anonymous';

  try {
    // Acquire slot
    await controller.acquireSlot(userId);

    logger.debug('Request slot acquired', { userId });

    // Release slot after response
    res.on('finish', () => {
      controller.releaseSlot(userId);
      logger.debug('Request slot released', { userId });
    });

    next();
  } catch (error) {
    logger.warn('Concurrency limit exceeded', { userId, error });

    res.status(429).json({
      success: false,
      error: {
        message: 'backend.too_many_concurrent_requests_please_retry_later',
        type: 'concurrency_limit_exceeded',
      },
    });
  }
};

/**
 * Performance monitoring middleware
 */
export const performanceMonitor = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!MONITORING.ENABLE_PERFORMANCE_TRACKING) {
    next();
    return;
  }

  const startTime = Date.now();
  const startMemory = process.memoryUsage();

  // Track response
  const originalJson = res.json.bind(res);

  res.json = function (body: any) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    const endMemory = process.memoryUsage();
    const memoryUsed = (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024; // MB

    // Log slow requests
    if (duration > MONITORING.SLOW_QUERY_THRESHOLD) {
      logger.warn('Slow request detected', {
        url: req.url,
        method: req.method,
        duration,
        memoryUsed: `${memoryUsed.toFixed(2)}MB`,
      });
    } else {
      logger.debug('Request completed', {
        url: req.url,
        method: req.method,
        duration,
        memoryUsed: `${memoryUsed.toFixed(2)}MB`,
      });
    }

    // Add performance headers
    res.setHeader('X-Response-Time', `${duration}ms`);

    return originalJson(body);
  };

  next();
};

// Store timer IDs for cleanup
let memoryMonitorInterval: NodeJS.Timeout | null = null;
let cpuMonitorInterval: NodeJS.Timeout | null = null;

/**
 * Memory usage monitoring
 */
export function startMemoryMonitoring(): void {
  // Clear existing interval if any
  if (memoryMonitorInterval) {
    clearInterval(memoryMonitorInterval);
  }

  memoryMonitorInterval = setInterval(() => {
    const memory = process.memoryUsage();
    const heapUsedMB = memory.heapUsed / 1024 / 1024;

    if (heapUsedMB > MONITORING.MEMORY_WARNING_THRESHOLD) {
      logger.warn('High memory usage detected', {
        heapUsed: `${heapUsedMB.toFixed(2)}MB`,
        heapTotal: `${(memory.heapTotal / 1024 / 1024).toFixed(2)}MB`,
        external: `${(memory.external / 1024 / 1024).toFixed(2)}MB`,
      });
    }
  }, 30000); // Check every 30 seconds
}

/**
 * CPU usage monitoring
 */
export function startCPUMonitoring(): void {
  // Clear existing interval if any
  if (cpuMonitorInterval) {
    clearInterval(cpuMonitorInterval);
  }

  // Reset baseline each time monitoring starts
  let startUsage = process.cpuUsage();

  cpuMonitorInterval = setInterval(() => {
    const usage = process.cpuUsage(startUsage);
    const userUsage = usage.user / 1000000; // Convert to seconds
    const systemUsage = usage.system / 1000000;

    logger.debug('CPU usage', {
      user: `${userUsage.toFixed(2)}s`,
      system: `${systemUsage.toFixed(2)}s`,
    });

    // Reset baseline for next interval
    startUsage = process.cpuUsage();
  }, 30000); // Check every 30 seconds
}

/**
 * Stop all monitoring intervals (for cleanup)
 */
export function stopMonitoring(): void {
  if (memoryMonitorInterval) {
    clearInterval(memoryMonitorInterval);
    memoryMonitorInterval = null;
  }
  if (cpuMonitorInterval) {
    clearInterval(cpuMonitorInterval);
    cpuMonitorInterval = null;
  }
}
