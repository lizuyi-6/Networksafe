import { Response, Router } from 'express';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { getAgentSystem } from './ai-system.routes';
import logger from '../../utils/logger';
import { securityOperationsService } from '../../services/security-operations.service';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';
import { getDatabase } from '../../config/database';

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
  return req.user?.tenantId || 'global';
}

function severityToInternal(severity: string): 'critical' | 'high' | 'medium' | 'low' {
  const normalized = severity.toLowerCase();
  if (normalized === 'critical' || normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized;
  }
  return 'medium';
}

export const addAlert = (alert: AlertPayload & { tenantId?: string }) => {
  const tenantId = alert.tenantId || 'global';
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

export const getAlerts = async (tenantId = 'global') => securityOperationsService.listAlertsView(tenantId, { limit: 100 });

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

    res.json(await securityOperationsService.listAlertsView(tenantId, { limit: 100 }));
  } catch (error: any) {
    logger.error('Failed to fetch alerts', { error: error.message });
    res.json([]);
  }
});

router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);
    const alert = await securityOperationsService.getAlertByIdView(tenantId, req.params.id);

    if (!alert) {
      return res.status(404).json({ success: false, error: 'backend.alert_not_found' });
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

    const alertRow = postgresShadowStoreService.canServeReads()
      ? await postgresShadowStoreService.queryOne<any>(`
          SELECT * FROM sec_alerts
          WHERE tenant_id = $1 AND alert_id = $2
          LIMIT 1
        `, [tenantId, req.params.id])
      : getDatabase().prepare(`
          SELECT * FROM sec_alerts
          WHERE tenant_id = ? AND alert_id = ?
          LIMIT 1
        `).get(tenantId, req.params.id) as any;

    const relatedFindings = alert.findingId
      ? [await securityOperationsService.getFindingByIdView(tenantId, alert.findingId)].filter(Boolean)
      : [];
    const relatedActions = postgresShadowStoreService.canServeReads()
      ? await postgresShadowStoreService.queryAll<any>(`
          SELECT * FROM sec_actions
          WHERE tenant_id = $1 AND (alert_id = $2 OR finding_id = $3)
          ORDER BY updated_at DESC
          LIMIT 20
        `, [tenantId, req.params.id, alert.findingId || null])
      : getDatabase().prepare(`
          SELECT * FROM sec_actions
          WHERE tenant_id = ? AND (alert_id = ? OR finding_id = ?)
          ORDER BY updated_at DESC
          LIMIT 20
        `).all(tenantId, req.params.id, alert.findingId || null) as any[];
    const relatedSessions = postgresShadowStoreService.canServeReads()
      ? await postgresShadowStoreService.queryAll<any>(`
          SELECT * FROM sec_traffic_sessions
          WHERE tenant_id = $1
          ORDER BY last_activity DESC
          LIMIT 20
        `, [tenantId])
      : getDatabase().prepare(`
          SELECT * FROM sec_traffic_sessions
          WHERE tenant_id = ?
          ORDER BY last_activity DESC
          LIMIT 20
        `).all(tenantId) as any[];

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

    res.json({
      success: true,
      data: {
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
            const metadata = parseJson(row.metadata_json, {});
            return metadata?.decision || row.source_asset_id === alert.assetId || row.dest_asset_id === alert.assetId;
          })
          .slice(0, 5)
          .map((row: any) => ({
            sessionId: row.session_id,
            sourceIP: row.source_ip,
            destIP: row.dest_ip,
            protocol: row.protocol,
            state: row.state,
            lastActivity: row.last_activity,
            metadata: parseJson(row.metadata_json, {})
          })),
        metadata: parseJson(alertRow?.metadata_json, {})
      }
    });
  } catch (error: any) {
    logger.error('Failed to fetch alert detail', { error: error.message });
    res.status(500).json({ success: false, error: 'backend.failed_to_fetch_alert_detail' });
  }
});

router.post('/:id/acknowledge', async (req: AuthenticatedRequest, res: Response) => {
  const alert = await securityOperationsService.transitionAlertView(tenantOf(req), req.params.id, 'acknowledged', req.user?.email || req.user?.userId || 'unknown');
  if (!alert) {
    return res.status(404).json({ error: 'backend.alert_not_found' });
  }
  res.json({ success: true, alert });
});

router.post('/:id/investigate', async (req: AuthenticatedRequest, res: Response) => {
  const alert = await securityOperationsService.transitionAlertView(tenantOf(req), req.params.id, 'investigating', req.user?.email || req.user?.userId || 'unknown');
  if (!alert) {
    return res.status(404).json({ error: 'backend.alert_not_found' });
  }
  res.json({ success: true, alert });
});

router.post('/:id/resolve', async (req: AuthenticatedRequest, res: Response) => {
  const alert = await securityOperationsService.transitionAlertView(tenantOf(req), req.params.id, 'resolved', req.user?.email || req.user?.userId || 'unknown');
  if (!alert) {
    return res.status(404).json({ error: 'backend.alert_not_found' });
  }
  res.json({ success: true, alert });
});

router.post('/:id/suppress', async (req: AuthenticatedRequest, res: Response) => {
  const alert = await securityOperationsService.transitionAlertView(tenantOf(req), req.params.id, 'suppressed', req.user?.email || req.user?.userId || 'unknown');
  if (!alert) {
    return res.status(404).json({ error: 'backend.alert_not_found' });
  }
  res.json({ success: true, alert });
});

export default router;
