import { Router } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import auditLogger from '../../security/audit-logger.service';
import { notificationDispatcherService } from '../../services/notification-dispatcher.service';
import { platformConfigService } from '../../services/platform-config.service';

const router = Router();

function tenantOf(req: AuthenticatedRequest): string {
  return req.user?.tenantId || 'global';
}

router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const config = await platformConfigService.getConfig(tenantOf(req));
    res.json(config);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'backend.failed_to_load_configuration' });
  }
});

router.post('/', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const tenantId = tenantOf(req);
    const config = await platformConfigService.saveConfig(
      tenantId,
      req.body || {},
      req.user?.userId || 'unknown'
    );

    await auditLogger.log({
      tenantId,
      eventType: 'platform_config_updated',
      category: 'system',
      severity: 'warning',
      actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: req.ip },
      action: 'update_platform_config',
      target: { type: 'tenant', id: tenantId },
      details: {
        antiBotEnabled: config.antiBot.enabled,
        rateLimitRequestsPerMinute: config.rateLimit.requestsPerMinute,
        notificationChannels: config.notifications.channels.length,
        aiRoutingMode: config.aiRouting.mode,
        privacyMode: config.privacyMode,
        deploymentDefault: config.deploymentDefaults.serverType,
        deviceGatewayPrimaryPath: config.deviceGateway.primaryPath
      },
      status: 'success'
    });

    res.json({ success: true, message: 'backend.configuration_saved', config });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_save_configuration' });
  }
});

router.get('/notifications/deliveries', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const deliveries = await platformConfigService.listNotificationDeliveries(tenantOf(req), limit);
    res.json({ success: true, deliveries });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_load_notification_deliveries' });
  }
});

router.post('/notifications/test', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const channelId = String(req.body?.channelId || '');
    if (!channelId) {
      return res.status(400).json({ success: false, error: 'backend.notification_channel_id_required' });
    }

    const delivery = await notificationDispatcherService.testChannel(tenantOf(req), channelId, {
      id: req.user?.userId || 'unknown',
      email: req.user?.email,
      ip: req.ip
    });

    res.json({ success: true, delivery });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_send_test_notification' });
  }
});

export default router;
