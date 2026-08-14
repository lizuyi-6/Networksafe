import { Router } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { sendError, sendSuccess } from '../../core/http/api-response';
import auditLogger from '../../security/audit-logger.service';
import { notificationDispatcherService } from '../../services/notification-dispatcher.service';
import { platformConfigService, redactPlatformConfigSecrets } from '../../services/platform-config.service';
import { canUseModel, normalizePlan } from '../../utils/model-access';
import { normalizeRole } from '../../security/permissions';

const router = Router();

function tenantOf(req: AuthenticatedRequest): string {
  return req.user?.tenantId || 'global';
}

/**
 * SECURITY FIX (audit 2026-08, AG-B07): GET /api/config previously returned
 * smtp.password and webhook header secrets to ANY authenticated user. Only
 * platform admins (the same role allowed to save config) get real secrets;
 * every other role receives a redacted copy. This also fixes FE-005 (secrets
 * materialized in browser memory for non-admin operators).
 */
function isAdminViewer(req: AuthenticatedRequest): boolean {
  return normalizeRole(req.user?.role) === 'platform_admin';
}

router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const raw = await platformConfigService.getConfig(tenantOf(req));
    const config = isAdminViewer(req) ? raw : redactPlatformConfigSecrets(raw);
    // Strip legacy sub-fields from edgeAuto.protocolDefaults before sending
    if (config?.edgeAuto?.protocolDefaults?.legacy) {
      const { legacy, ...rest } = config.edgeAuto.protocolDefaults;
      config.edgeAuto.protocolDefaults = rest;
    }
    sendSuccess(res, config, { legacy: config });
  } catch (error: any) {
    sendError(res, 500, {
      code: 'backend.failed_to_load_configuration',
      message: error?.message || 'backend.failed_to_load_configuration'
    });
  }
});

router.post('/', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const tenantId = tenantOf(req);
    const preferredModelId = req.body?.aiRouting?.preferredModelId;
    if (
      preferredModelId !== undefined
      && preferredModelId !== null
      && (
        typeof preferredModelId !== 'string'
        || !canUseModel(normalizePlan(req.user?.plan), preferredModelId.trim())
      )
    ) {
      return sendError(res, 403, {
        code: 'backend.model_access_denied',
        message: 'backend.model_access_denied'
      });
    }
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
          preferredModelId: config.aiRouting.preferredModelId,
          detectionRuleFirstEnabled: config.detectionPipeline.ruleFirstEnabled,
          detectionEscalationThreshold: config.detectionPipeline.aiEscalationThreshold,
          privacyMode: config.privacyMode,
          deploymentDefault: config.deploymentDefaults.serverType,
          deviceGatewayPrimaryPath: config.deviceGateway.primaryPath
        },
      status: 'success'
    });

    sendSuccess(res, { config }, {
      legacy: {
        message: 'backend.configuration_saved',
        config
      }
    });
  } catch (error: any) {
    sendError(res, 500, {
      code: 'backend.failed_to_save_configuration',
      message: error?.message || 'backend.failed_to_save_configuration'
    });
  }
});

router.get('/notifications/deliveries', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const deliveries = await platformConfigService.listNotificationDeliveries(tenantOf(req), limit);
    sendSuccess(res, { deliveries }, { legacy: { deliveries } });
  } catch (error: any) {
    sendError(res, 500, {
      code: 'backend.failed_to_load_notification_deliveries',
      message: error?.message || 'backend.failed_to_load_notification_deliveries'
    });
  }
});

router.post('/notifications/test', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const channelId = String(req.body?.channelId || '');
    if (!channelId) {
      return sendError(res, 400, {
        code: 'backend.notification_channel_id_required',
        message: 'backend.notification_channel_id_required'
      });
    }

    const delivery = await notificationDispatcherService.testChannel(tenantOf(req), channelId, {
      id: req.user?.userId || 'unknown',
      email: req.user?.email,
      ip: req.ip
    });

    sendSuccess(res, { delivery }, { legacy: { delivery } });
  } catch (error: any) {
    sendError(res, 500, {
      code: 'backend.failed_to_send_test_notification',
      message: error?.message || 'backend.failed_to_send_test_notification'
    });
  }
});

export default router;
