import { Response, Router } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { sendError, sendSuccess } from '../../core/http/api-response';
import { PLATFORM_TENANT_ID } from '../../core/tenant/tenant-context';
import { getAgentSystem } from '../../services/agent-system.service';
import logger from '../../utils/logger';
import { securityOperationsService } from '../../services/security-operations.service';

const router = Router();

router.use(authenticate);

type AlertPayload = {
  title: string;
  message: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  type: 'security' | 'performance' | 'system';
  source: string;
  status?: 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'suppressed';
  assetRef?: string;
};

function tenantOf(req: AuthenticatedRequest): string {
  return req.user?.tenantId || PLATFORM_TENANT_ID;
}

function severityToInternal(severity: string): 'critical' | 'high' | 'medium' | 'low' {
  const normalized = severity.toLowerCase();
  if (normalized === 'critical' || normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized;
  }
  return 'medium';
}

export const addAlert = (alert: AlertPayload & { tenantId?: string }) => {
  const tenantId = alert.tenantId || PLATFORM_TENANT_ID;
  const asset = alert.assetRef
    ? securityOperationsService.upsertAsset({
        tenantId,
        assetType: 'host',
        externalRef: alert.assetRef,
        displayName: alert.assetRef,
        primaryAddress: alert.assetRef
      })
    : null;

  return securityOperationsService.createAlert({
    tenantId,
    assetId: asset?.assetId,
    sourceType: 'system',
    sourceRef: alert.source,
    title: alert.title,
    message: alert.message,
    severity: severityToInternal(alert.severity),
    alertType: alert.type,
    metadata: {
      injectedBy: 'alerts.addAlert'
    }
  });
};

export const getAlerts = async (tenantId = PLATFORM_TENANT_ID) => securityOperationsService.listAlertsView(tenantId, { limit: 100 });

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);
    const alerts = await securityOperationsService.listAlertsView(tenantId, {
      severity: String(req.query.severity || 'all'),
      status: String(req.query.status || 'all'),
      limit: Math.min(Number(req.query.limit || 50), 200)
    });

    const agentSystem = getAgentSystem();
    if (agentSystem && agentSystem.isInitialized()) {
      const probeReport = agentSystem.getProbeReport();
      const systemAlerts = probeReport.alerts || [];

      for (const systemAlert of systemAlerts.slice(0, 20)) {
        if (!systemAlert?.message) {
          continue;
        }

        addAlert({
          tenantId,
          title: `${systemAlert.metadata?.threatType || 'Threat'} detected`,
          message: systemAlert.message,
          severity: (systemAlert.severity || 'medium').charAt(0).toUpperCase() + (systemAlert.severity || 'medium').slice(1) as AlertPayload['severity'],
          type: 'security',
          source: systemAlert.metadata?.ruleId || 'AI System',
          assetRef: systemAlert.metadata?.sourceIP
        });
      }
    }

    const data = await securityOperationsService.listAlertsView(tenantId, { limit: 100 });
    return sendSuccess(res, data, {
      legacy: {
        alerts: data,
        count: data.length
      }
    });
  } catch (error: any) {
    logger.error('Failed to fetch alerts', { error: error.message });
    return sendError(res, 500, {
      code: 'ALERT_LIST_FAILED',
      message: 'backend.failed_to_fetch_alerts'
    }, {
      legacy: {
        alerts: []
      }
    });
  }
});

router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);
    const alert = await securityOperationsService.getAlertByIdView(tenantId, req.params.id);

    if (!alert) {
      return sendError(res, 404, {
        code: 'ALERT_NOT_FOUND',
        message: 'backend.alert_not_found'
      });
    }

    const parseJson = (value: any, fallback: any = {}) => {
      if (!value || typeof value !== 'string') {
        return fallback;
      }
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    };

    const relatedFindings = alert.findingId
      ? [await securityOperationsService.getFindingByIdView(tenantId, alert.findingId)].filter(Boolean)
      : [];
    const relatedActions = (await securityOperationsService.listActionsView(tenantId, 20))
      .filter((item) => item.alertId === req.params.id || (alert.findingId && item.findingId === alert.findingId));
    const relatedSessions = await securityOperationsService.listTrafficSessionsView(tenantId, 20);

    const assetContext = await securityOperationsService.getOperationalContextForAssetIdsView(
      tenantId,
      alert.assetId ? [alert.assetId] : [],
      10
    );
    const asset = alert.assetId
      ? await securityOperationsService.getAssetByIdView(tenantId, alert.assetId)
      : null;
    const relatedFindingIds = new Set(relatedFindings.map((finding: any) => finding?.findingId).filter(Boolean));
    const correlatedAlerts = assetContext.alerts.filter((item: any) =>
      item.id !== alert.id && (!item.findingId || relatedFindingIds.size === 0 || relatedFindingIds.has(item.findingId))
    );
    const correlatedActions = [
      ...relatedActions.map((row: any) => ({
        actionId: row.action_id,
        title: row.title,
        status: row.status,
        operator: row.operator,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        runLog: parseJson(row.run_log_json, [])
      })),
      ...assetContext.actions.filter((row: any) =>
        row.alertId === alert.id ||
        (row.findingId && relatedFindingIds.has(row.findingId))
      )
    ].filter((item: any, index: number, arr: any[]) =>
      arr.findIndex((candidate: any) => candidate.actionId === item.actionId) === index
    );

    const data = {
      summary: alert,
      asset,
      evidence: relatedFindings.map((finding: any) => ({
        findingId: finding.findingId,
        title: finding.title,
        severity: finding.severity,
        description: finding.description,
        evidence: finding.evidence,
        remediation: finding.remediation
      })),
      timeline: [
        {
          title: 'Alert created',
          description: alert.message,
          timestamp: alert.timestamp
        },
        ...(alert.investigationId ? [{
          title: 'Investigation assigned',
          description: `Investigation ${alert.investigationId} attached`,
          timestamp: alert.timestamp
        }] : [])
      ],
      relatedAssets: asset ? [asset] : [],
      relatedAlerts: correlatedAlerts,
      relatedScans: assetContext.scanRuns.length > 0
        ? assetContext.scanRuns
        : relatedFindings.map((finding: any) => ({
            sourceType: finding.sourceType,
            sourceRef: finding.sourceRef,
            target: finding.target
          })),
      relatedActions: correlatedActions,
      relatedSessions: relatedSessions
        .filter((row: any) => {
          const metadata = row.metadata || {};
          return metadata?.decision || row.sourceAssetId === alert.assetId || row.destAssetId === alert.assetId;
        })
        .slice(0, 5),
      metadata: alert.metadata || {}
    };

    return sendSuccess(res, data, {
      legacy: {
        alert: data.summary
      }
    });
  } catch (error: any) {
    logger.error('Failed to fetch alert detail', { error: error.message });
    return sendError(res, 500, {
      code: 'ALERT_DETAIL_FAILED',
      message: 'backend.failed_to_fetch_alert_detail'
    });
  }
});

// SECURITY FIX (audit 2026-08): alert state transitions previously had no
// role gate — any authenticated tenant_viewer could acknowledge, resolve or
// SUPPRESS real security alerts. Operators may acknowledge/investigate;
// resolve/suppress (hiding alerts) stays admin/tenant-admin only.
router.post('/:id/acknowledge', requireRole('admin', 'tenant', 'tenant_operator'), async (req: AuthenticatedRequest, res: Response) => {
  const alert = await securityOperationsService.transitionAlertView(tenantOf(req), req.params.id, 'acknowledged', req.user?.email || req.user?.userId || 'unknown');
  if (!alert) {
    return sendError(res, 404, {
      code: 'ALERT_NOT_FOUND',
      message: 'backend.alert_not_found'
    });
  }
  return sendSuccess(res, alert, {
    legacy: { alert }
  });
});

router.post('/:id/investigate', requireRole('admin', 'tenant', 'tenant_operator'), async (req: AuthenticatedRequest, res: Response) => {
  const alert = await securityOperationsService.transitionAlertView(tenantOf(req), req.params.id, 'investigating', req.user?.email || req.user?.userId || 'unknown');
  if (!alert) {
    return sendError(res, 404, {
      code: 'ALERT_NOT_FOUND',
      message: 'backend.alert_not_found'
    });
  }
  return sendSuccess(res, alert, {
    legacy: { alert }
  });
});

router.post('/:id/resolve', requireRole('admin', 'tenant'), async (req: AuthenticatedRequest, res: Response) => {
  const alert = await securityOperationsService.transitionAlertView(tenantOf(req), req.params.id, 'resolved', req.user?.email || req.user?.userId || 'unknown');
  if (!alert) {
    return sendError(res, 404, {
      code: 'ALERT_NOT_FOUND',
      message: 'backend.alert_not_found'
    });
  }
  return sendSuccess(res, alert, {
    legacy: { alert }
  });
});

router.post('/:id/suppress', requireRole('admin', 'tenant'), async (req: AuthenticatedRequest, res: Response) => {
  const alert = await securityOperationsService.transitionAlertView(tenantOf(req), req.params.id, 'suppressed', req.user?.email || req.user?.userId || 'unknown');
  if (!alert) {
    return sendError(res, 404, {
      code: 'ALERT_NOT_FOUND',
      message: 'backend.alert_not_found'
    });
  }
  return sendSuccess(res, alert, {
    legacy: { alert }
  });
});

export default router;
