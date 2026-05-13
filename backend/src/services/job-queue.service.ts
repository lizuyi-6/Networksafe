import redisService from '../security/redis.service';
import logger from '../utils/logger';

type QueueName = 'scanner-runs' | 'detection-async-reviews';

class JobQueueService {
  private memoryQueues = new Map<QueueName, string[]>();

  private getMemoryQueue(queue: QueueName): string[] {
    const existing = this.memoryQueues.get(queue);
    if (existing) {
      return existing;
    }
    const next: string[] = [];
    this.memoryQueues.set(queue, next);
    return next;
  }

  async enqueue(queue: QueueName, jobId: string): Promise<void> {
    const normalizedId = String(jobId || '').trim();
    if (!normalizedId) {
      return;
    }

    if (redisService.isAvailable()) {
      try {
        const client = redisService.getClient();
        const queueKey = `job-queue:${queue}`;
        const memberKey = `job-queue:${queue}:members`;
        const added = await client.sadd(memberKey, normalizedId);
        if (added === 1) {
          await client.rpush(queueKey, normalizedId);
        }
        return;
      } catch (error: any) {
        logger.warn('Redis queue enqueue failed, falling back to memory queue', {
          queue,
          jobId: normalizedId,
          error: error?.message
        });
      }
    }

    const rows = this.getMemoryQueue(queue);
    if (!rows.includes(normalizedId)) {
      rows.push(normalizedId);
    }
  }

  async drain(queue: QueueName, limit = 100): Promise<string[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));

    if (redisService.isAvailable()) {
      try {
        const client = redisService.getClient();
        const queueKey = `job-queue:${queue}`;
        const memberKey = `job-queue:${queue}:members`;
        const drained: string[] = [];

        for (let index = 0; index < safeLimit; index += 1) {
          const next = await client.lpop(queueKey);
          if (!next) {
            break;
          }
          await client.srem(memberKey, next);
          drained.push(next);
        }

        if (drained.length > 0) {
          return drained;
        }
      } catch (error: any) {
        logger.warn('Redis queue drain failed, falling back to memory queue', {
          queue,
          error: error?.message
        });
      }
    }

    const rows = this.getMemoryQueue(queue);
    return rows.splice(0, safeLimit);
  }

  async remove(queue: QueueName, jobId: string): Promise<void> {
    const normalizedId = String(jobId || '').trim();
    if (!normalizedId) {
      return;
    }

    if (redisService.isAvailable()) {
      try {
        const client = redisService.getClient();
        const queueKey = `job-queue:${queue}`;
        const memberKey = `job-queue:${queue}:members`;
        await client.lrem(queueKey, 0, normalizedId);
        await client.srem(memberKey, normalizedId);
      } catch (error: any) {
        logger.warn('Redis queue remove failed, falling back to memory queue', {
          queue,
          jobId: normalizedId,
          error: error?.message
        });
      }
    }

    const rows = this.getMemoryQueue(queue);
    const filtered = rows.filter((item) => item !== normalizedId);
    this.memoryQueues.set(queue, filtered);
  }

  async size(queue: QueueName): Promise<number> {
    if (redisService.isAvailable()) {
      try {
        const client = redisService.getClient();
        const size = await client.llen(`job-queue:${queue}`);
        return Number(size || 0);
      } catch (error: any) {
        logger.warn('Redis queue size failed, falling back to memory queue', {
          queue,
          error: error?.message
        });
      }
    }

    return this.getMemoryQueue(queue).length;
  }

  backend(): 'redis' | 'memory' {
    return redisService.isAvailable() ? 'redis' : 'memory';
  }
}

export const jobQueueService = new JobQueueService();
