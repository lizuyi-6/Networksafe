/**
 * Devices Routes Tests
 *
 * Tests for ESP32 device management API endpoints
 */

import request from 'supertest';
import express from 'express';
import devicesRouter, {
  registerDevice,
  setDeviceOffline,
  getDeviceList,
  getCodebook
} from '../../api/routes/devices.routes';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// Mock dependencies
jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = {
      userId: 'test-user',
      email: 'test@example.com',
      role: 'admin',
      tenantId: 'tenant-001'
    };
    next();
  }),
  requireRole: jest.fn(() => (req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Devices Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/devices', devicesRouter);

  beforeAll(() => {
    jest.spyOn(commandDispatcherService, 'dispatchDeviceCommand').mockResolvedValue({
      success: true,
      status: 'completed',
      actionId: 'test-action',
      message: 'ok',
      record: { ok: true }
    } as any);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Register a test device
    registerDevice({
      deviceId: 'device-001',
      version: '1.0.0',
      chipModel: 'ESP32-WROOM-32',
      flashSize: 4096,
      freeHeap: 200000,
      sdkVersion: '4.4.0',
      mode: 'online'
    });
  });

  describe('GET /api/devices', () => {
    it('should return list of devices', async () => {
      const response = await request(app).get('/api/devices');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.devices).toBeDefined();
      expect(Array.isArray(response.body.devices)).toBe(true);
    });

    it('should return device count', async () => {
      const response = await request(app).get('/api/devices');

      expect(response.body.total).toBeDefined();
      expect(response.body.online).toBeDefined();
    });
  });

  describe('GET /api/devices/:id', () => {
    it('should return device by ID', async () => {
      const response = await request(app).get('/api/devices/device-001');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.device).toBeDefined();
      expect(response.body.device.deviceId).toBe('device-001');
    });

    it('should return 404 for non-existent device', async () => {
      const response = await request(app).get('/api/devices/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('backend.device_not_found');
    });
  });

  describe('GET /api/devices/:id/events', () => {
    it('should return device events', async () => {
      const response = await request(app).get('/api/devices/device-001/events');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.events)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const response = await request(app).get('/api/devices/device-001/events?limit=10');

      expect(response.status).toBe(200);
      expect(response.body.events.length).toBeLessThanOrEqual(10);
    });
  });

  describe('POST /api/devices/:id/cmd', () => {
    it('should send command to device', async () => {
      const response = await request(app)
        .post('/api/devices/device-001/cmd')
        .type('application/json')
        .send({ command: 'reboot', params: {} });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent device', async () => {
      const response = await request(app)
        .post('/api/devices/non-existent/cmd')
        .type('application/json')
        .send({ command: 'reboot' });

      expect(response.status).toBe(404);
    });

    it('should return 400 if device is offline', async () => {
      (commandDispatcherService.dispatchDeviceCommand as jest.Mock).mockResolvedValueOnce({
        success: false,
        status: 'failed',
        actionId: 'test-action-offline',
        message: 'Device is offline.',
        reason: 'device_offline'
      });

      const response = await request(app)
        .post('/api/devices/device-001/cmd')
        .type('application/json')
        .send({ command: 'reboot' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('DEVICE_IS_OFFLINE');
    });
  });

  describe('PUT /api/devices/:id', () => {
    it('should update device configuration', async () => {
      const response = await request(app)
        .put('/api/devices/device-001')
        .type('application/json')
        .send({ connectedAgents: ['agent-001'] });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent device', async () => {
      const response = await request(app)
        .put('/api/devices/non-existent')
        .type('application/json')
        .send({ connectedAgents: [] });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/devices/:id', () => {
    it('should delete device', async () => {
      const response = await request(app).delete('/api/devices/device-001');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent device', async () => {
      const response = await request(app).delete('/api/devices/non-existent');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/devices/codebook', () => {
    it('should return codebook entries', async () => {
      const response = await request(app).get('/api/devices/codebook');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.codebook).toBeDefined();
    });
  });

  describe('POST /api/devices/codebook', () => {
    it('should update codebook entries', async () => {
      const response = await request(app)
        .post('/api/devices/codebook')
        .type('application/json')
        .send({ entries: { E100: 'Test error message' } });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.totalEntries).toBeDefined();
    });

    it('should return 400 for invalid entries', async () => {
      const response = await request(app)
        .post('/api/devices/codebook')
        .type('application/json')
        .send({});

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid key format', async () => {
      const response = await request(app)
        .post('/api/devices/codebook')
        .type('application/json')
        .send({ entries: { 'invalid-key!': 'Test' } });

      expect(response.status).toBe(400);
    });

    it('should return 400 for malicious content', async () => {
      const response = await request(app)
        .post('/api/devices/codebook')
        .type('application/json')
        .send({ entries: { E101: '<script>alert(1)</script>' } });

      expect(response.status).toBe(400);
    });
  });

  describe('Exported functions', () => {
    it('should register device', () => {
      registerDevice({
        deviceId: 'device-002',
        version: '1.0.0',
        chipModel: 'ESP32-WROOM-32',
        flashSize: 4096,
        freeHeap: 200000,
        sdkVersion: '4.4.0',
        mode: 'online'
      });

      const devices = getDeviceList();
      expect(devices.some(d => d.deviceId === 'device-002')).toBe(true);
    });

    it('should return codebook', () => {
      const codebook = getCodebook();
      expect(codebook).toBeDefined();
      expect(typeof codebook).toBe('object');
    });
  });
});
