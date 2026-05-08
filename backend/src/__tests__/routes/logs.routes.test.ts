import express from 'express';
import request from 'supertest';
import logsRouter from '../../api/routes/logs.routes';
import { addLog } from '../../services/log-state.service';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((_req: any, _res: any, next: any) => next())
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));

jest.mock('../../services/traffic-stats.service', () => ({
  getTrafficStats: jest.fn().mockReturnValue({ activeFlows: [] }),
}));

jest.mock('../../services/agent-system.service', () => ({
  getAgentSystem: jest.fn().mockReturnValue(null),
  getAgentGateway: jest.fn().mockReturnValue(null),
}));

jest.mock('../../config/app-mode', () => ({
  isDemoMode: jest.fn().mockReturnValue(false)
}));

const app = express();
app.use(logsRouter);

describe('GET /', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset logs: call addLog until array is cleared (max 100)
    // The simplest approach: add a known marker and filter
  });

  it('returns 200 with array', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('addLog adds a log entry that appears in response', async () => {
    addLog({
      type: 'Auth',
      level: 'WARN',
      message: 'Failed login attempt',
      ip: '192.168.1.10',
      method: 'POST',
      path: '/api/auth/login'
    });

    const response = await request(app).get('/');

    const found = response.body.find(
      (log: any) => log.message === 'Failed login attempt'
    );
    expect(found).toBeDefined();
    expect(found.ip).toBe('192.168.1.10');
  });

  it('getTrafficStats is called', async () => {
    const { getTrafficStats } = require('../../services/traffic-stats.service');

    await request(app).get('/');

    expect(getTrafficStats).toHaveBeenCalled();
  });

  it('getAgentSystem is called', async () => {
    const { getAgentSystem } = require('../../services/agent-system.service');

    await request(app).get('/');

    expect(getAgentSystem).toHaveBeenCalled();
  });

  it('sorts logs by time descending', async () => {
    addLog({
      type: 'Early',
      level: 'INFO',
      message: 'First log',
      ip: '10.0.0.1'
    });
    addLog({
      type: 'Late',
      level: 'INFO',
      message: 'Second log',
      ip: '10.0.0.2'
    });

    const response = await request(app).get('/');
    const times = response.body.map((log: any) => new Date(log.time).getTime());
    for (let i = 0; i < times.length - 1; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i + 1]);
    }
  });

  it('limits to 50 logs', async () => {
    // Add 55 logs to exceed the 50 limit
    for (let i = 0; i < 55; i++) {
      addLog({
        type: 'Bulk',
        level: 'INFO',
        message: `Log ${i}`,
        ip: '10.0.0.1'
      });
    }

    const response = await request(app).get('/');
    expect(response.body.length).toBeLessThanOrEqual(50);
  });

  it('returns empty array on error from getTrafficStats', async () => {
    const { getTrafficStats } = require('../../services/traffic-stats.service');
    getTrafficStats.mockImplementationOnce(() => {
      throw new Error('Simulated failure');
    });

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});
