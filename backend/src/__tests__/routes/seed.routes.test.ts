/**
 * Seed Routes Tests
 *
 * Tests for seed data management routes
 */

import request from 'supertest';
import express from 'express';
import seedRouter from '../../api/routes/seed.routes';

// Mock auth
jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-001', role: 'admin', tenantId: 'tenant-001' };
    next();
  }),
  requireRole: jest.fn(() => (req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn() }
}));

// Mock SeedManager
const mockSeedStatus = jest.fn();
const mockSeedSeed = jest.fn();
const mockSeedClear = jest.fn();
const mockSeedIsSeeded = jest.fn();
const mockSeedCanSeed = jest.fn();

jest.mock('../../database/seeds/seed-manager', () => ({
  SeedManager: {
    status: (...args: any[]) => mockSeedStatus(...args),
    seed: (...args: any[]) => mockSeedSeed(...args),
    clear: (...args: any[]) => mockSeedClear(...args),
    isSeeded: (...args: any[]) => mockSeedIsSeeded(...args),
    canSeed: (...args: any[]) => mockSeedCanSeed(...args)
  }
}));

describe('Seed Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/seed', seedRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    mockSeedCanSeed.mockReturnValue(true);
    mockSeedSeed.mockResolvedValue(undefined);
    mockSeedClear.mockResolvedValue(undefined);
  });

  describe('GET /status', () => {
    it('returns seed status', async () => {
      mockSeedStatus.mockReturnValue({
        canSeed: true,
        appMode: 'demo',
        autoSeedEnabled: true,
        lastSeedTimestamp: '2026-04-01T00:00:00.000Z',
        seedVersion: '1.0.0'
      });

      const response = await request(app).get('/api/seed/status');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.canSeed).toBe(true);
      expect(response.body.data.appMode).toBe('demo');
    });

    it('returns 500 on status error', async () => {
      mockSeedStatus.mockImplementation(() => { throw new Error('DB error'); });

      const response = await request(app).get('/api/seed/status');

      expect(response.status).toBe(500);
    });
  });

  describe('POST /execute', () => {
    it('executes seeding in demo mode', async () => {
      mockSeedCanSeed.mockReturnValue(true);

      const response = await request(app)
        .post('/api/seed/execute')
        .send({ clearExisting: false, verbose: true });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockSeedSeed).toHaveBeenCalledWith({
        clearExisting: false,
        verbose: true,
        force: false
      });
    });

    it('executes with force flag', async () => {
      const response = await request(app)
        .post('/api/seed/execute')
        .send({ force: true });

      expect(response.status).toBe(200);
      expect(mockSeedSeed).toHaveBeenCalledWith(
        expect.objectContaining({ force: true })
      );
    });

    it('returns 403 in production mode without force', async () => {
      mockSeedCanSeed.mockReturnValue(false);

      const response = await request(app)
        .post('/api/seed/execute')
        .send({ force: false });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('production');
    });

    it('allows seeding in production with force=true', async () => {
      mockSeedCanSeed.mockReturnValue(false);

      const response = await request(app)
        .post('/api/seed/execute')
        .send({ force: true });

      expect(response.status).toBe(200);
    });

    it('returns 500 on seeding error', async () => {
      mockSeedSeed.mockRejectedValue(new Error('Seeding failed'));

      const response = await request(app)
        .post('/api/seed/execute')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('backend.seeding_failed');
    });
  });

  describe('DELETE /clear', () => {
    it('clears seed data in demo mode', async () => {
      mockSeedCanSeed.mockReturnValue(true);

      const response = await request(app)
        .delete('/api/seed/clear')
        .send({ verbose: true });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockSeedClear).toHaveBeenCalledWith(
        expect.objectContaining({ verbose: true })
      );
    });

    it('returns 403 in production mode without force', async () => {
      mockSeedCanSeed.mockReturnValue(false);

      const response = await request(app)
        .delete('/api/seed/clear')
        .send({});

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('production');
    });

    it('allows clearing in production with force=true', async () => {
      mockSeedCanSeed.mockReturnValue(false);

      const response = await request(app)
        .delete('/api/seed/clear')
        .send({ force: true });

      expect(response.status).toBe(200);
    });

    it('returns 500 on clear error', async () => {
      mockSeedClear.mockRejectedValue(new Error('Clear failed'));

      const response = await request(app)
        .delete('/api/seed/clear')
        .send({});

      expect(response.status).toBe(500);
    });
  });

  describe('GET /check', () => {
    it('returns isSeeded and canSeed status', async () => {
      mockSeedIsSeeded.mockReturnValue(true);
      mockSeedCanSeed.mockReturnValue(true);

      const response = await request(app).get('/api/seed/check');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.isSeeded).toBe(true);
      expect(response.body.data.canSeed).toBe(true);
    });

    it('returns false when not seeded', async () => {
      mockSeedIsSeeded.mockReturnValue(false);
      mockSeedCanSeed.mockReturnValue(true);

      const response = await request(app).get('/api/seed/check');

      expect(response.status).toBe(200);
      expect(response.body.data.isSeeded).toBe(false);
    });

    it('returns 500 on check error', async () => {
      mockSeedIsSeeded.mockImplementation(() => { throw new Error('DB error'); });

      const response = await request(app).get('/api/seed/check');

      expect(response.status).toBe(500);
    });
  });
});
