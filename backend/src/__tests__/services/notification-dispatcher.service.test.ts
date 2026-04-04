/**
 * Notification Dispatcher Service Tests
 *
 * Tests for notification dispatching service
 */

describe('NotificationDispatcherService', () => {
  let mockPlatformGetConfig: jest.Mock;
  let mockCreateNotificationDelivery: jest.Mock;
  let mockUpdateNotificationDelivery: jest.Mock;
  let mockListDueNotificationDeliveries: jest.Mock;
  let mockFindByDedupe: jest.Mock;
  let mockAxiosPost: jest.Mock;
  let mockNodemailerSendMail: jest.Mock;
  let mockLoggerWarn: jest.Mock;
  let mockAuditLog: jest.Mock;
  let dispatcherService: any;

  beforeEach(() => {
    jest.resetModules();

    mockPlatformGetConfig = jest.fn();
    mockCreateNotificationDelivery = jest.fn();
    mockUpdateNotificationDelivery = jest.fn();
    mockListDueNotificationDeliveries = jest.fn().mockResolvedValue([]);
    mockFindByDedupe = jest.fn();
    mockAxiosPost = jest.fn();
    mockNodemailerSendMail = jest.fn();
    mockLoggerWarn = jest.fn();
    mockAuditLog = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../../config/database', () => ({
      getDatabase: jest.fn(() => ({ prepare: jest.fn(), exec: jest.fn() }))
    }));

    jest.doMock('../../services/platform-config.service', () => ({
      platformConfigService: {
        getConfig: mockPlatformGetConfig,
        createNotificationDelivery: mockCreateNotificationDelivery,
        updateNotificationDelivery: mockUpdateNotificationDelivery,
        listDueNotificationDeliveries: mockListDueNotificationDeliveries,
        findNotificationDeliveryByDedupe: mockFindByDedupe
      },
      isSeverityAtLeast: (value: string, minimum: string) => {
        const levels = ['low', 'medium', 'high', 'critical'];
        return levels.indexOf(value) >= levels.indexOf(minimum);
      }
    }));

    jest.doMock('../../security/audit-logger.service', () => ({
      __esModule: true,
      default: { log: mockAuditLog }
    }));

    jest.doMock('../../utils/logger', () => ({
      __esModule: true,
      default: { warn: mockLoggerWarn, info: jest.fn(), error: jest.fn() }
    }));

    jest.doMock('axios', () => ({
      post: mockAxiosPost,
      default: { post: mockAxiosPost }
    }));

    jest.doMock('nodemailer', () => ({
      createTransport: jest.fn(() => ({
        sendMail: mockNodemailerSendMail
      }))
    }));

    dispatcherService = require('../../services/notification-dispatcher.service').notificationDispatcherService;
  });

  afterEach(() => {
    dispatcherService.stopWorker?.();
    jest.clearAllMocks();
  });

  const defaultConfig = {
    notifications: {
      enabled: true,
      dedupeWindowSeconds: 300,
      retryDelaysSeconds: [30, 300, 900],
      channels: []
    }
  };

  const sampleAlert = {
    id: 'alert-001',
    title: 'SQL Injection Detected',
    message: 'A SQL injection attempt was blocked on /api/login',
    severity: 'High' as const,
    type: 'security',
    source: 'detection-engine',
    status: 'open' as const,
    timestamp: new Date().toISOString(),
    metadata: { fingerprint: 'sqli-001' }
  };

  const sampleChannel = {
    id: 'webhook-001',
    name: 'Slack Webhook',
    type: 'generic_webhook' as const,
    enabled: true,
    target: 'https://hooks.slack.com/services/test',
    minimumSeverity: 'medium' as const,
    headers: {},
    smtp: { host: '', port: 587, secure: false, username: '', password: '', from: '' }
  };

  describe('dispatchAlert', () => {
    it('creates notification delivery records', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        notifications: {
          ...defaultConfig.notifications,
          channels: [sampleChannel]
        }
      });
      mockFindByDedupe.mockResolvedValue(null);
      mockCreateNotificationDelivery.mockResolvedValue({
        id: 'delivery-001',
        tenantId: 'tenant-001',
        status: 'queued'
      });

      const deliveries = await dispatcherService.dispatchAlert('tenant-001', sampleAlert);

      expect(deliveries.length).toBeGreaterThan(0);
      expect(mockCreateNotificationDelivery).toHaveBeenCalled();
    });
  });

  describe('enqueueAlert', () => {
    it('skips when notifications are disabled', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        notifications: { ...defaultConfig.notifications, enabled: false }
      });

      const deliveries = await dispatcherService.enqueueAlert('tenant-001', sampleAlert);

      expect(deliveries).toEqual([]);
      expect(mockCreateNotificationDelivery).not.toHaveBeenCalled();
    });

    it('filters channels by minimum severity', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        notifications: {
          ...defaultConfig.notifications,
          channels: [
            { ...sampleChannel, minimumSeverity: 'critical' as const }
          ]
        }
      });
      mockFindByDedupe.mockResolvedValue(null);
      mockCreateNotificationDelivery.mockResolvedValue({
        id: 'delivery-001',
        status: 'queued'
      });

      const deliveries = await dispatcherService.enqueueAlert('tenant-001', {
        ...sampleAlert,
        severity: 'medium'
      });

      // Low severity does not meet critical minimum
      expect(deliveries).toHaveLength(0);
    });

    it('skips duplicate notifications within dedupe window', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        notifications: {
          ...defaultConfig.notifications,
          channels: [sampleChannel]
        }
      });
      mockFindByDedupe.mockResolvedValue({ id: 'existing-delivery' });
      mockCreateNotificationDelivery.mockResolvedValue({
        id: 'new-delivery',
        status: 'skipped'
      });

      const deliveries = await dispatcherService.enqueueAlert('tenant-001', sampleAlert);

      // Should create a skipped delivery for the deduped item
      expect(mockCreateNotificationDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'skipped' })
      );
    });
  });

  describe('testChannel', () => {
    it('creates a test delivery and processes it', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        notifications: {
          ...defaultConfig.notifications,
          channels: [
            {
              ...sampleChannel,
              type: 'generic_webhook',
              target: 'https://example.com/webhook'
            }
          ]
        }
      });
      mockCreateNotificationDelivery.mockResolvedValue({
        id: 'test-delivery-001',
        tenantId: 'tenant-001',
        channelId: 'webhook-001',
        status: 'queued',
        attemptCount: 0
      });
      mockUpdateNotificationDelivery.mockResolvedValue({
        id: 'test-delivery-001',
        status: 'sent'
      });
      mockAxiosPost.mockResolvedValue({ status: 200, data: 'ok' });

      const result = await dispatcherService.testChannel(
        'tenant-001',
        'webhook-001',
        { id: 'user-001', email: 'admin@test.com', ip: '127.0.0.1' }
      );

      expect(mockCreateNotificationDelivery).toHaveBeenCalled();
      expect(result.id).toBeDefined();
    });

    it('throws when channel not found', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        notifications: { ...defaultConfig.notifications, channels: [] }
      });

      await expect(
        dispatcherService.testChannel('tenant-001', 'nonexistent', { id: 'user-001' })
      ).rejects.toThrow('backend.notification_channel_not_found');
    });
  });

  describe('send (webhook)', () => {
    it('sends webhook successfully', async () => {
      mockAxiosPost.mockResolvedValue({
        status: 200,
        data: { ok: true }
      });

      const result = await (dispatcherService as any).send(sampleChannel, {
        title: 'Test',
        alertId: 'test'
      });

      expect(result.status).toBe(200);
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/test',
        expect.any(Object),
        expect.objectContaining({ timeout: 10000 })
      );
    });

    it('throws on webhook failure', async () => {
      mockAxiosPost.mockResolvedValue({ status: 500, data: 'Server Error' });

      await expect(
        (dispatcherService as any).send(sampleChannel, { title: 'Test' })
      ).rejects.toThrow('Webhook delivery failed with status 500');
    });
  });

  describe('processDelivery', () => {
    it('marks delivery as skipped when notifications disabled', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        notifications: { ...defaultConfig.notifications, enabled: false }
      });
      mockUpdateNotificationDelivery.mockResolvedValue({
        id: 'delivery-001',
        status: 'skipped'
      });

      const delivery = {
        id: 'delivery-001',
        tenantId: 'tenant-001',
        channelId: 'webhook-001',
        status: 'queued',
        attemptCount: 0
      };

      const result = await (dispatcherService as any).processDelivery(delivery);

      expect(mockUpdateNotificationDelivery).toHaveBeenCalledWith(
        'tenant-001',
        'delivery-001',
        expect.objectContaining({ status: 'skipped' })
      );
    });

    it('marks delivery as sent on webhook success', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        notifications: {
          ...defaultConfig.notifications,
          channels: [{ ...sampleChannel }]
        }
      });
      mockUpdateNotificationDelivery.mockResolvedValue({
        id: 'delivery-001',
        status: 'sent'
      });
      mockAxiosPost.mockResolvedValue({ status: 200, data: 'ok' });

      const delivery = {
        id: 'delivery-001',
        tenantId: 'tenant-001',
        channelId: 'webhook-001',
        status: 'queued',
        attemptCount: 0
      };

      const result = await (dispatcherService as any).processDelivery(delivery);

      expect(mockUpdateNotificationDelivery).toHaveBeenCalledWith(
        'tenant-001',
        'delivery-001',
        expect.objectContaining({ status: 'sent' })
      );
    });

    it('schedules retry on failure within retry window', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        notifications: {
          ...defaultConfig.notifications,
          channels: [{ ...sampleChannel }],
          retryDelaysSeconds: [30, 300, 900]
        }
      });
      mockUpdateNotificationDelivery.mockResolvedValue({
        id: 'delivery-001',
        status: 'retrying'
      });
      mockAxiosPost.mockRejectedValue(new Error('Network error'));

      const delivery = {
        id: 'delivery-001',
        tenantId: 'tenant-001',
        channelId: 'webhook-001',
        status: 'queued',
        attemptCount: 0
      };

      const result = await (dispatcherService as any).processDelivery(delivery);

      expect(mockUpdateNotificationDelivery).toHaveBeenCalledWith(
        'tenant-001',
        'delivery-001',
        expect.objectContaining({ status: 'retrying' })
      );
      expect(result.status).toBe('retrying');
    });

    it('marks as failed after exhausting retries', async () => {
      mockPlatformGetConfig.mockResolvedValue({
        ...defaultConfig,
        notifications: {
          ...defaultConfig.notifications,
          channels: [{ ...sampleChannel }],
          retryDelaysSeconds: [30, 300, 900]
        }
      });
      mockUpdateNotificationDelivery.mockResolvedValue({
        id: 'delivery-001',
        status: 'failed'
      });
      mockAxiosPost.mockRejectedValue(new Error('Network error'));

      // attemptCount = 3 means the 4th attempt (exhausts 3 delays)
      const delivery = {
        id: 'delivery-001',
        tenantId: 'tenant-001',
        channelId: 'webhook-001',
        status: 'retrying',
        attemptCount: 3
      };

      const result = await (dispatcherService as any).processDelivery(delivery);

      expect(mockUpdateNotificationDelivery).toHaveBeenCalledWith(
        'tenant-001',
        'delivery-001',
        expect.objectContaining({ status: 'failed' })
      );
      expect(result.status).toBe('failed');
    });
  });
});
