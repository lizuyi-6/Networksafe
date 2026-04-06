/**
 * Alert State Service
 *
 * Thin wrappers around securityOperationsService for alert management.
 * Extracted from alerts.routes.ts – no Express/Router dependency.
 */

import { securityOperationsService } from './security-operations.service';
import { PLATFORM_TENANT_ID } from '../core/tenant/tenant-context';

export type AlertSeverity = 'Critical' | 'High' | 'Medium' | 'Low';
export type AlertType = 'security' | 'performance' | 'system';
export type AlertStatus = 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'suppressed';

export type AlertPayload = {
    title: string;
    message: string;
    severity: AlertSeverity;
    type: AlertType;
    source: string;
    status?: AlertStatus;
    assetRef?: string;
};

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

export const getAlerts = async (tenantId = PLATFORM_TENANT_ID) =>
    securityOperationsService.listAlertsView(tenantId, { limit: 100 });
