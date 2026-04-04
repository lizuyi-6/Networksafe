/**
 * Job Queue Service Tests
 *
 * Tests for Redis-backed job queue with memory fallback
 */

// For the memory fallback tests, we test the memory queue path directly
// by ensuring Redis is not available (which the service checks via redisService.isAvailable)
describe('jobQueueService Memory Fallback', () => {
  let memoryService: any;

  beforeEach(() => {
    jest.resetModules();
    // Ensure Redis is not available so the service uses memory queue
    jest.doMock('../../security/redis.service', () => ({
      __esModule: true,
      default: { isAvailable: jest.fn().mockReturnValue(false) }
    }));
    jest.doMock('../../utils/logger', () => ({
      __esModule: true,
      default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    }));
    memoryService = require('../../services/job-queue.service').jobQueueService;
  });

  afterEach(() => {
    jest.resetModules();
  });

  describe('backend()', () => {
    it('returns memory when Redis is unavailable', () => {
      expect(memoryService.backend()).toBe('memory');
    });
  });

  describe('enqueue()', () => {
    it('adds job to memory queue', async () => {
      await memoryService.enqueue('scanner-runs', 'job-001');
      expect(await memoryService.size('scanner-runs')).toBe(1);
    });

    it('adds multiple jobs to queue', async () => {
      await memoryService.enqueue('scanner-runs', 'job-001');
      await memoryService.enqueue('scanner-runs', 'job-002');
      await memoryService.enqueue('scanner-runs', 'job-003');

      expect(await memoryService.size('scanner-runs')).toBe(3);
    });

    it('skips empty jobId', async () => {
      await memoryService.enqueue('scanner-runs', '');
      await memoryService.enqueue('scanner-runs', '  ');

      expect(await memoryService.size('scanner-runs')).toBe(0);
    });
  });

  describe('drain()', () => {
    it('removes and returns items from memory queue', async () => {
      await memoryService.enqueue('scanner-runs', 'job-001');
      await memoryService.enqueue('scanner-runs', 'job-002');
      const drained = await memoryService.drain('scanner-runs', 10);

      expect(drained).toContain('job-001');
      expect(drained).toContain('job-002');
      expect(await memoryService.size('scanner-runs')).toBe(0);
    });

    it('returns empty array when queue is empty', async () => {
      const drained = await memoryService.drain('scanner-runs', 10);
      expect(drained).toEqual([]);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await memoryService.enqueue('scanner-runs', `job-${i}`);
      }

      const drained = await memoryService.drain('scanner-runs', 3);

      expect(drained).toHaveLength(3);
      expect(await memoryService.size('scanner-runs')).toBe(7);
    });

    it('clamps negative limit to 1 (minimum)', async () => {
      await memoryService.enqueue('scanner-runs', 'job-001');
      const drained = await memoryService.drain('scanner-runs', -5);

      expect(drained).toHaveLength(1);
    });
  });

  describe('remove()', () => {
    it('removes specific job from queue', async () => {
      await memoryService.enqueue('scanner-runs', 'job-001');
      await memoryService.enqueue('scanner-runs', 'job-002');
      await memoryService.remove('scanner-runs', 'job-001');

      expect(await memoryService.size('scanner-runs')).toBe(1);
    });

    it('does nothing when job not in queue', async () => {
      await memoryService.enqueue('scanner-runs', 'job-001');
      await memoryService.remove('scanner-runs', 'nonexistent');

      expect(await memoryService.size('scanner-runs')).toBe(1);
    });
  });

  describe('size()', () => {
    it('returns correct queue length', async () => {
      await memoryService.enqueue('scanner-runs', 'a');
      await memoryService.enqueue('scanner-runs', 'b');
      await memoryService.enqueue('scanner-runs', 'c');

      expect(await memoryService.size('scanner-runs')).toBe(3);
    });

    it('returns 0 for empty queue', async () => {
      expect(await memoryService.size('scanner-runs')).toBe(0);
    });
  });
});
