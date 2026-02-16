import { Router, Request, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { getAgentSystem } from '../../routes/ai-system';
import logger from '../../utils/logger';
import { isDemoMode } from '../../config/app-mode';

const router = Router();

router.use(authenticate);

interface Alert {
    id: string;
    title: string;
    message: string;
    severity: 'Critical' | 'High' | 'Medium' | 'Low';
    type: 'security' | 'performance' | 'system';
    source: string;
    time: string;
    status: 'active' | 'acknowledged' | 'resolved';
    timestamp: string;
}

let alertStore: Alert[] = [];

export const addAlert = (alert: Omit<Alert, 'id' | 'time' | 'timestamp'>) => {
    const newAlert: Alert = {
        ...alert,
        id: `ALT-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
        time: 'Just now',
        timestamp: new Date().toISOString()
    };
    alertStore.unshift(newAlert);
    if (alertStore.length > 100) {
        alertStore = alertStore.slice(0, 100);
    }
    logger.info('New alert generated', { alertId: newAlert.id, title: alert.title });
    return newAlert;
};

export const getAlerts = (): Alert[] => {
    return alertStore;
};

router.get('/', (req: AuthenticatedRequest, res: Response) => {
    try {
        const agentSystem = getAgentSystem();
        let alerts: Alert[] = [...alertStore];

        if (agentSystem && agentSystem.isInitialized()) {
            const probeReport = agentSystem.getProbeReport();
            const systemAlerts = probeReport.alerts || [];

            systemAlerts.forEach((alert: any, index: number) => {
                const existingAlert = alerts.find(a => 
                    a.message.includes(alert.metadata?.threatType || '') ||
                    a.title.includes(alert.metadata?.threatType || '')
                );

                if (!existingAlert) {
                    alerts.push({
                        id: `SYS-${Date.now()}-${index}`,
                        title: `${alert.metadata?.threatType || 'Threat'} Detected`,
                        message: alert.message || `Security event detected from ${alert.metadata?.sourceIP || 'unknown source'}`,
                        severity: mapSeverity(alert.severity),
                        type: 'security',
                        source: alert.metadata?.ruleId || 'AI System',
                        time: getTimeAgo(alert.timestamp),
                        status: 'active',
                        timestamp: alert.timestamp || new Date().toISOString()
                    });
                }
            });
        }

        if (alerts.length === 0 && isDemoMode()) {
            alerts = generateDefaultAlerts();
        }

        alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        res.json(alerts.slice(0, 50));
    } catch (error: any) {
        logger.error('Failed to fetch alerts', { error: error.message });
        res.json(isDemoMode() ? generateDefaultAlerts() : []);
    }
});

router.post('/:id/acknowledge', (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const alert = alertStore.find(a => a.id === id);
    if (alert) {
        alert.status = 'acknowledged';
        res.json({ success: true, alert });
    } else {
        res.status(404).json({ error: 'Alert not found' });
    }
});

router.post('/:id/resolve', (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const alert = alertStore.find(a => a.id === id);
    if (alert) {
        alert.status = 'resolved';
        res.json({ success: true, alert });
    } else {
        res.status(404).json({ error: 'Alert not found' });
    }
});

function mapSeverity(severity: string): 'Critical' | 'High' | 'Medium' | 'Low' {
    switch (severity?.toLowerCase()) {
        case 'critical': return 'Critical';
        case 'high': return 'High';
        case 'medium': return 'Medium';
        case 'low': return 'Low';
        default: return 'Medium';
    }
}

function getTimeAgo(timestamp: string): string {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} mins ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    return `${diffDays} days ago`;
}

function generateDefaultAlerts(): Alert[] {
    return [
        {
            id: 'ALT-DEMO-001',
            title: 'System Initialized',
            message: 'FluxGuard security system has been initialized successfully. All monitoring services are active.',
            severity: 'Low',
            type: 'system',
            source: 'System',
            time: 'Just now',
            status: 'active',
            timestamp: new Date().toISOString()
        }
    ];
}

export default router;
