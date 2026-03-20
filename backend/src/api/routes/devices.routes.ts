﻿﻿﻿/**
 * AetherGuard - ESP32 Device Management API
 *
 * REST API for ESP32 firmware gateway
 * SECURITY FIX CVE-2026-031: Added authentication middleware
 * SECURITY FIX: Route ordering - static routes before dynamic routes
 */

import { Router, Request, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import logger from '../../utils/logger';
import { securityOperationsService } from '../../services/security-operations.service';
import auditLogger from '../../security/audit-logger.service';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { PLATFORM_TENANT_ID, resolveRequestTenantContext } from '../../core/tenant/tenant-context';

const router = Router();

// SECURITY FIX CVE-2026-031: Apply authentication to all routes
router.use(authenticate);

// Device storage (in-memory + can be extended to database)
interface DeviceInfo {
    deviceId: string;
    version: string;
    chipModel: string;
    flashSize: number;
    freeHeap: number;
    sdkVersion: string;
    mode: 'online' | 'offline';
    isOnline: boolean;
    lastHeartbeat: Date;
    connectedAgents: string[];
    status?: {
        cpuUsage: number;
        memoryUsage: number;
        uptime: number;
        wifiRssi: number;
    };
    systemInfo?: {
        hostname: string;
        os: string;
        kernel: string;
        arch: string;
    };
}

interface DeviceConfig {
    displayName: string;
    group: string;
    site: string;
    networkProfile: string;
    scanProfile: string;
    notes: string;
    commandPermissions: string[];
    tags: string[];
    updatedAt: string;
}

interface DeviceCommandRecord {
    id: string;
    deviceId: string;
    command: string;
    status: 'queued' | 'completed' | 'failed';
    message: string;
    executedBy: string;
    createdAt: string;
    completedAt?: string;
    params?: Record<string, any>;
}

interface DeviceEvent {
    id: string;
    deviceId: string;
    type: 'register' | 'heartbeat' | 'data' | 'alert' | 'unknown_error' | 'disconnect' | 'command';
    payload: any;
    timestamp: string;
}

const devices = new Map<string, DeviceInfo>();
const deviceEvents = new Map<string, DeviceEvent[]>();
const deviceConfigs = new Map<string, DeviceConfig>();
const deviceCommands = new Map<string, DeviceCommandRecord[]>();
let deviceCommandTransport: ((deviceId: string, command: string, params?: Record<string, any>) => Promise<boolean> | boolean) | null = null;

function resolveActorTenantId(req?: AuthenticatedRequest): string {
    if (!req) {
        return PLATFORM_TENANT_ID;
    }

    const context = resolveRequestTenantContext(req, {
        allowAdminPlatformFallback: req.user?.role === 'admin'
    });

    return context?.tenantId || req.user?.tenantId || PLATFORM_TENANT_ID;
}

function safeAuditLog(payload: any): void {
    Promise.resolve(auditLogger.log(payload)).catch((error: any) => {
        logger.warn('Device audit log unavailable', { error: error?.message });
    });
}

// Codebook
const codebook: Record<string, string> = {
    'E001': 'Connection refused',
    'E002': 'Permission denied',
    'E003': 'Out of memory',
    'E004': 'Disk full',
    'E005': 'Service unavailable',
    'S001': 'CPU usage critical (>90%)',
    'S002': 'Memory usage critical (>85%)',
    'S003': 'Disk usage critical (>90%)',
    'A001': 'SQL Injection detected',
    'A002': 'XSS attempt blocked',
    'A003': 'Path traversal attempt',
    'A004': 'Command injection detected',
    'A005': 'Brute force attack',
    'A006': 'DDoS pattern detected',
};

function buildDefaultConfig(device: DeviceInfo): DeviceConfig {
    return {
        displayName: device.deviceId,
        group: device.mode === 'online' ? 'core-edge' : 'field-edge',
        site: device.systemInfo?.hostname || 'unassigned-site',
        networkProfile: device.mode === 'online' ? 'cloud-mesh' : 'standalone-buffer',
        scanProfile: device.isOnline ? 'balanced' : 'offline-recovery',
        notes: `${device.chipModel} running firmware ${device.version}`,
        commandPermissions: ['collect', 'reboot', 'sync-config', 'ota_update'],
        tags: [device.chipModel.toLowerCase(), device.mode, device.isOnline ? 'online' : 'offline'],
        updatedAt: new Date().toISOString()
    };
}

function ensureDeviceConfig(device: DeviceInfo): DeviceConfig {
    const existing = deviceConfigs.get(device.deviceId);
    if (existing) {
        return existing;
    }
    const next = buildDefaultConfig(device);
    deviceConfigs.set(device.deviceId, next);
    return next;
}

function getDeviceCommandHistory(deviceId: string, limit = 10): DeviceCommandRecord[] {
    return (deviceCommands.get(deviceId) || []).slice(0, limit);
}

function pushDeviceCommand(record: DeviceCommandRecord): void {
    const rows = deviceCommands.get(record.deviceId) || [];
    rows.unshift(record);
    if (rows.length > 50) {
        rows.length = 50;
    }
    deviceCommands.set(record.deviceId, rows);
}

export function getDeviceById(deviceId: string): DeviceInfo | undefined {
    return devices.get(deviceId);
}

export function setDeviceCommandTransport(
    transport: ((deviceId: string, command: string, params?: Record<string, any>) => Promise<boolean> | boolean) | null
): void {
    deviceCommandTransport = transport;
}

export async function executeDeviceCommandInternal(input: {
    deviceId: string;
    command: string;
    params?: Record<string, any>;
    actorId: string;
    actorEmail?: string;
    actorIp?: string;
    actionId?: string;
}): Promise<{ success: boolean; record?: DeviceCommandRecord; message: string; reason?: string }> {
    const device = devices.get(input.deviceId);
    if (!device) {
        return { success: false, message: 'Device not found.', reason: 'device_not_found' };
    }

    const config = ensureDeviceConfig(device);
    if (!config.commandPermissions.includes(input.command)) {
        return { success: false, message: `Command ${input.command} is not permitted for this device.`, reason: 'command_not_permitted' };
    }

    if (!device.isOnline) {
        return { success: false, message: 'Device is offline.', reason: 'device_offline' };
    }

    if (deviceCommandTransport) {
        const accepted = await Promise.resolve(deviceCommandTransport(input.deviceId, input.command, input.params || {}));
        if (!accepted) {
            return { success: false, message: `Device gateway rejected command ${input.command}.`, reason: 'device_gateway_rejected' };
        }
    }

    const now = new Date().toISOString();
    const record: DeviceCommandRecord = {
        id: input.actionId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        deviceId: input.deviceId,
        command: input.command,
        status: 'completed',
        message: `Command "${input.command}" executed successfully on ${input.deviceId}`,
        executedBy: input.actorEmail || input.actorId || 'unknown',
        createdAt: now,
        completedAt: now,
        params: input.params || {}
    };

    pushDeviceCommand(record);
    addDeviceEvent(input.deviceId, 'command', {
        action: input.command,
        params: input.params || {},
        status: record.status,
        message: record.message,
        queuedBy: record.executedBy,
        actionId: input.actionId || null
    });

    if (input.command === 'collect') {
        device.lastHeartbeat = new Date();
        device.freeHeap = Math.max(64_000, device.freeHeap - 2_048);
    }

    if (input.command === 'reboot') {
        device.lastHeartbeat = new Date();
        device.status = device.status
            ? { ...device.status, uptime: 0, cpuUsage: Math.max(5, Math.round(device.status.cpuUsage * 0.6)) }
            : device.status;
    }

    devices.set(input.deviceId, device);
    try {
        const asset = ensureDeviceAsset(device);
        syncDeviceSignals(device, asset.assetId);
    } catch {
        // Ignore when operations database is unavailable.
    }

    logger.info('Command sent to device', {
        deviceId: input.deviceId,
        command: input.command,
        params: input.params || {},
        actionId: input.actionId || null
    });

    return {
        success: true,
        record,
        message: record.message
    };
}

commandDispatcherService.setDeviceAdapter({
    getDevice: getDeviceById,
    executeCommand: executeDeviceCommandInternal
});

function ensureDeviceAsset(device: DeviceInfo) {
    const config = ensureDeviceConfig(device);
    return securityOperationsService.upsertAsset({
        tenantId: PLATFORM_TENANT_ID,
        assetType: 'device',
        externalRef: device.deviceId,
        displayName: config.displayName || device.deviceId,
        primaryAddress: device.systemInfo?.hostname,
        status: device.isOnline ? 'online' : 'offline',
        metadata: {
            chipModel: device.chipModel,
            firmwareVersion: device.version,
            group: config.group,
            site: config.site,
            networkProfile: config.networkProfile,
            scanProfile: config.scanProfile,
            tags: config.tags
        }
    });
}

function syncDeviceSignals(device: DeviceInfo, assetId?: string): void {
    const target = device.systemInfo?.hostname || device.deviceId;
    const heartbeatAgeMs = Date.now() - device.lastHeartbeat.getTime();
    const staleHeartbeat = device.isOnline && heartbeatAgeMs > 15 * 60 * 1000;

    securityOperationsService.syncSignalFinding({
        tenantId: PLATFORM_TENANT_ID,
        active: !device.isOnline || staleHeartbeat,
        assetId,
        sourceType: 'device-health',
        sourceRef: device.deviceId,
        target,
        category: 'device-health',
        severity: 'high',
        title: !device.isOnline ? 'Device Offline' : 'Device Heartbeat Stale',
        description: !device.isOnline
            ? `Device ${device.deviceId} is offline and not reporting telemetry.`
            : `Device ${device.deviceId} has not reported for more than 15 minutes.`,
        evidence: {
            deviceId: device.deviceId,
            lastHeartbeat: device.lastHeartbeat.toISOString(),
            isOnline: device.isOnline,
            staleHeartbeat
        },
        remediation: {
            title: 'Recover device connectivity',
            owner: 'operations',
            priority: 'high',
            suggestedSteps: [
                'Check the device power and network connectivity.',
                'Verify the gateway can still reach the device.',
                'Reboot or re-enroll the device if telemetry does not resume.'
            ]
        },
        fingerprint: `device:${device.deviceId}:health:availability`,
        createAlert: true,
        alertType: 'system'
    });

    securityOperationsService.syncSignalFinding({
        tenantId: PLATFORM_TENANT_ID,
        active: Boolean(device.status && device.status.cpuUsage >= 90),
        assetId,
        sourceType: 'device-health',
        sourceRef: device.deviceId,
        target,
        category: 'device-health',
        severity: 'high',
        title: 'Device CPU Saturation',
        description: `Device ${device.deviceId} CPU usage is ${device.status?.cpuUsage || 0}%.`,
        evidence: {
            deviceId: device.deviceId,
            cpuUsage: device.status?.cpuUsage || 0
        },
        remediation: {
            title: 'Reduce device CPU pressure',
            owner: 'operations',
            priority: 'high',
            suggestedSteps: [
                'Inspect the running workload and recent commands.',
                'Reduce concurrent collection tasks or reboot the device.',
                'Validate CPU returns to a stable baseline after mitigation.'
            ]
        },
        fingerprint: `device:${device.deviceId}:health:cpu`,
        createAlert: true,
        alertType: 'system'
    });

    securityOperationsService.syncSignalFinding({
        tenantId: PLATFORM_TENANT_ID,
        active: Boolean(device.status && device.status.memoryUsage >= 85),
        assetId,
        sourceType: 'device-health',
        sourceRef: device.deviceId,
        target,
        category: 'device-health',
        severity: 'medium',
        title: 'Device Memory Pressure',
        description: `Device ${device.deviceId} memory usage is ${device.status?.memoryUsage || 0}%.`,
        evidence: {
            deviceId: device.deviceId,
            memoryUsage: device.status?.memoryUsage || 0,
            freeHeap: device.freeHeap
        },
        remediation: {
            title: 'Stabilize device memory usage',
            owner: 'operations',
            priority: 'medium',
            suggestedSteps: [
                'Collect a fresh heap snapshot from the device.',
                'Reduce the active workload or restart memory-heavy modules.',
                'Confirm free heap recovers after the change.'
            ]
        },
        fingerprint: `device:${device.deviceId}:health:memory`,
        createAlert: false,
        alertType: 'system'
    });

    securityOperationsService.syncSignalFinding({
        tenantId: PLATFORM_TENANT_ID,
        active: Boolean(device.status && device.status.wifiRssi <= -80),
        assetId,
        sourceType: 'device-health',
        sourceRef: device.deviceId,
        target,
        category: 'device-connectivity',
        severity: 'medium',
        title: 'Device Signal Weak',
        description: `Device ${device.deviceId} signal strength dropped to ${device.status?.wifiRssi || 0} dBm.`,
        evidence: {
            deviceId: device.deviceId,
            wifiRssi: device.status?.wifiRssi || 0
        },
        remediation: {
            title: 'Improve device link quality',
            owner: 'operations',
            priority: 'medium',
            suggestedSteps: [
                'Validate access point proximity and interference.',
                'Move the device or reassign the wireless profile if needed.',
                'Confirm telemetry stability after the signal recovers.'
            ]
        },
        fingerprint: `device:${device.deviceId}:health:wifi`,
        createAlert: false,
        alertType: 'system'
    });
}

function recordDeviceAction(device: DeviceInfo, input: { title: string; status: 'pending' | 'running' | 'completed' | 'failed'; operator: string; rollbackNotes?: string; runLog?: Record<string, any>[]; }): void {
    try {
        const asset = ensureDeviceAsset(device);
        securityOperationsService.recordActionRun({
            tenantId: PLATFORM_TENANT_ID,
            assetId: asset.assetId,
            title: input.title,
            status: input.status,
            operator: input.operator,
            rollbackNotes: input.rollbackNotes,
            runLog: input.runLog
        });
    } catch {
        // Ignore when operations database is unavailable in lightweight tests.
    }
}

function summarizeSecurity(device: DeviceInfo) {
    const commandHistory = getDeviceCommandHistory(device.deviceId, 5);
    try {
        const asset = ensureDeviceAsset(device);
        if (device.systemInfo?.hostname) {
            securityOperationsService.upsertAsset({
                tenantId: PLATFORM_TENANT_ID,
                assetType: 'host',
                externalRef: device.systemInfo.hostname,
                displayName: device.systemInfo.hostname,
                primaryAddress: device.systemInfo.hostname,
                status: device.isOnline ? 'online' : 'offline',
                metadata: {
                    deviceId: device.deviceId,
                    chipModel: device.chipModel
                }
            });
        }
        syncDeviceSignals(device, asset.assetId);
        const context = securityOperationsService.getOperationalContextForExternalRefs(
            PLATFORM_TENANT_ID,
            [device.deviceId, device.systemInfo?.hostname || ''],
            ['device', 'host']
        );
        return {
            asset: context.assets.find((item) => item.assetId === asset.assetId) || context.assets[0] || asset,
            findings: context.findings,
            alerts: context.alerts,
            actions: context.actions,
            recentScans: context.scanRuns,
            serviceExposure: context.serviceExposure,
            relatedSessions: context.trafficSessions,
            latestCommand: commandHistory[0] || null
        };
    } catch {
        return {
            asset: null,
            findings: [],
            alerts: [],
            actions: [],
            recentScans: [],
            serviceExposure: [],
            relatedSessions: [],
            latestCommand: commandHistory[0] || null
        };
    }
}

/**
 * GET /api/devices
 * Get all ESP32 device list
 */
router.get('/', (_req: Request, res: Response) => {
    try {
        const deviceList = Array.from(devices.values()).map(device => ({
            ...(() => {
                const config = ensureDeviceConfig(device);
                try {
                    securityOperationsService.upsertAsset({
                        tenantId: PLATFORM_TENANT_ID,
                        assetType: 'device',
                        externalRef: device.deviceId,
                        displayName: device.deviceId,
                        primaryAddress: device.systemInfo?.hostname,
                        status: device.isOnline ? 'online' : 'offline',
                        metadata: {
                            chipModel: device.chipModel,
                            firmwareVersion: device.version,
                            group: config.group,
                            site: config.site
                        }
                    });
                } catch {
                    // Ignore when operations database is not initialized.
                }
                return {};
            })(),
            ...device,
            lastHeartbeat: device.lastHeartbeat.toISOString(),
            config: ensureDeviceConfig(device),
            securitySummary: summarizeSecurity(device)
        }));

        res.json({
            success: true,
            total: deviceList.length,
            online: deviceList.filter(d => d.isOnline).length,
            devices: deviceList,
        });
    } catch (error: any) {
        logger.error('Failed to get devices', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});

/**
 * GET /api/devices/codebook
 * NOTE: This static route must be defined BEFORE /:id routes
 */
router.get('/codebook', (_req: Request, res: Response) => {
    res.json({
        success: true,
        codebook,
    });
});

/**
 * POST /api/devices/codebook
 * NOTE: This static route must be defined BEFORE /:id routes
 */
router.post('/codebook', (req: Request, res: Response) => {
    try {
        const { entries } = req.body;

        if (!entries || typeof entries !== 'object') {
            return res.status(400).json({ success: false, error: 'backend.invalid_entries' });
        }

        const maxEntries = 1000;
        const currentEntries = Object.keys(codebook).length;
        const newEntriesCount = Object.keys(entries).length;

        if (currentEntries + newEntriesCount > maxEntries) {
            return res.status(400).json({
                success: false,
                error: `Too many entries. Maximum ${maxEntries} entries allowed.`
            });
        }

        for (const [key, value] of Object.entries(entries)) {
            if (!/^[A-Z0-9_-]+$/.test(key)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid key format: ${key}. Only uppercase letters, numbers, underscore and hyphen allowed.`
                });
            }

            if (typeof value !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: `Value for key ${key} must be a string`
                });
            }

            if (value.length > 500) {
                return res.status(400).json({
                    success: false,
                    error: `Value for key ${key} is too long. Maximum 500 characters allowed.`
                });
            }

            const dangerousPatterns = [
                /<script/i,
                /javascript:/i,
                /on\w+\s*=/i,
                /<iframe/i,
                /<object/i,
                /<embed/i
            ];

            for (const pattern of dangerousPatterns) {
                if (pattern.test(value)) {
                    logger.warn('Blocked malicious codebook entry', { key, pattern: pattern.source });
                    return res.status(400).json({
                        success: false,
                        error: `Invalid value for key ${key}: potentially malicious content detected`
                    });
                }
            }
        }

        Object.assign(codebook, entries);

        logger.info('Codebook updated', { entriesAdded: Object.keys(entries).length });

        res.json({
            success: true,
            totalEntries: Object.keys(codebook).length,
        });
    } catch (error: any) {
        logger.error('Failed to update codebook', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});

/**
 * GET /api/devices/:id/events
 */
router.get('/:id/events', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const limitRaw = Number(req.query.limit || 100);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
        const events = deviceEvents.get(id) || [];

        res.json({
            success: true,
            deviceId: id,
            events: events.slice(-limit).reverse()
        });
    } catch (error: any) {
        logger.error('Failed to get device events', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});

router.get('/:id/config', (req: Request, res: Response) => {
    try {
        const device = devices.get(req.params.id);
        if (!device) {
            return res.status(404).json({ success: false, error: 'backend.device_not_found' });
        }

        res.json({
            success: true,
            config: ensureDeviceConfig(device),
            commandHistory: getDeviceCommandHistory(device.deviceId, 10)
        });
    } catch (error: any) {
        logger.error('Failed to get device config', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});

/**
 * GET /api/devices/:id
 * Get single device details
 */
router.get('/:id', (req: Request, res: Response) => {
    try {
        const device = devices.get(req.params.id);

        if (!device) {
            return res.status(404).json({ success: false, error: 'backend.device_not_found' });
        }

        try {
                    securityOperationsService.upsertAsset({
                        tenantId: PLATFORM_TENANT_ID,
                assetType: 'device',
                externalRef: device.deviceId,
                displayName: device.deviceId,
                primaryAddress: device.systemInfo?.hostname,
                status: device.isOnline ? 'online' : 'offline',
                metadata: {
                    chipModel: device.chipModel,
                    firmwareVersion: device.version
                }
            });
        } catch {
            // Ignore when operations database is not initialized.
        }

        res.json({
            success: true,
            device: {
                ...device,
                lastHeartbeat: device.lastHeartbeat.toISOString(),
                config: ensureDeviceConfig(device),
                securitySummary: summarizeSecurity(device)
            },
        });
    } catch (error: any) {
        logger.error('Failed to get device', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});

/**
 * POST /api/devices/:id/cmd
 * Send command to device
 * SECURITY FIX: Require admin role for command execution
 */
router.post('/:id/cmd', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
    (async () => {
        try {
        const { id } = req.params;
        const { command, params } = req.body;
        const device = devices.get(id);
        if (!device) {
            return res.status(404).json({ success: false, error: 'backend.device_not_found' });
        }

        const result = await commandDispatcherService.dispatchDeviceCommand({
            deviceId: id,
            commandType: String(command || '').trim(),
            payload: params || {},
            actor: {
                tenantId: resolveActorTenantId(req),
                userId: req.user?.userId || 'unknown',
                email: req.user?.email,
                ip: req.ip
            },
            approved: Boolean(req.body?.approved)
        });

        if (!result.success && result.status === 'failed') {
            const errorCode =
                result.reason === 'device_offline'
                    ? 'backend.device_is_offline'
                    : result.reason === 'device_not_found' || result.reason === 'device_not_available'
                        ? 'backend.device_not_found'
                        : result.reason === 'command_not_permitted'
                            ? 'backend.device_command_not_permitted'
                            : 'backend.device_command_failed';
            const statusCode =
                result.reason === 'device_not_found' || result.reason === 'device_not_available'
                    ? 404
                    : 400;

            return res.status(statusCode).json({
                success: false,
                error: errorCode,
                message: result.message,
                status: result.status,
                actionId: result.actionId
            });
        }

        return res.json({
            success: true,
            message: result.message,
            status: result.status,
            actionId: result.actionId,
            command: result.record || null,
            latestCommand: result.record || null
        });
        } catch (error: any) {
            logger.error('Failed to send command', { error: error.message });
            return res.status(500).json({ success: false, error: 'backend.internal_server_error' });
        }
    })();
});

/**
 * PUT /api/devices/:id
 * Update device configuration
 */
router.put('/:id', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const device = devices.get(id);

        if (!device) {
            return res.status(404).json({ success: false, error: 'backend.device_not_found' });
        }

        if (req.body.connectedAgents) {
            device.connectedAgents = req.body.connectedAgents;
        }

        const currentConfig = ensureDeviceConfig(device);
        const nextConfig: DeviceConfig = {
            ...currentConfig,
            displayName: typeof req.body.displayName === 'string' ? req.body.displayName.trim() || currentConfig.displayName : currentConfig.displayName,
            group: typeof req.body.group === 'string' ? req.body.group.trim() || currentConfig.group : currentConfig.group,
            site: typeof req.body.site === 'string' ? req.body.site.trim() || currentConfig.site : currentConfig.site,
            networkProfile: typeof req.body.networkProfile === 'string' ? req.body.networkProfile.trim() || currentConfig.networkProfile : currentConfig.networkProfile,
            scanProfile: typeof req.body.scanProfile === 'string' ? req.body.scanProfile.trim() || currentConfig.scanProfile : currentConfig.scanProfile,
            notes: typeof req.body.notes === 'string' ? req.body.notes.trim() : currentConfig.notes,
            commandPermissions: Array.isArray(req.body.commandPermissions) ? req.body.commandPermissions.filter(Boolean) : currentConfig.commandPermissions,
            tags: Array.isArray(req.body.tags) ? req.body.tags.filter(Boolean) : currentConfig.tags,
            updatedAt: new Date().toISOString()
        };
        deviceConfigs.set(id, nextConfig);
        addDeviceEvent(id, 'command', {
            action: 'sync-config',
            status: 'completed',
            message: 'Device configuration updated',
            updatedBy: req.user?.email || req.user?.userId || 'unknown',
            config: nextConfig
        });

        devices.set(id, device);
        try {
            const asset = ensureDeviceAsset(device);
            syncDeviceSignals(device, asset.assetId);
        } catch {
            // Ignore when operations database is unavailable.
        }
        recordDeviceAction(device, {
            title: 'Device configuration updated',
            status: 'completed',
            operator: req.user?.email || req.user?.userId || 'unknown',
            rollbackNotes: 'Restore the previous configuration if the device stops reporting after the change.',
            runLog: [
                {
                    at: nextConfig.updatedAt,
                    actor: req.user?.email || req.user?.userId || 'unknown',
                    message: 'Applied device configuration update.',
                    config: {
                        displayName: nextConfig.displayName,
                        group: nextConfig.group,
                        site: nextConfig.site,
                        networkProfile: nextConfig.networkProfile,
                        scanProfile: nextConfig.scanProfile
                    }
                }
            ]
        });

        logger.info('Device updated', { deviceId: id });
        safeAuditLog({
            tenantId: resolveActorTenantId(req),
            eventType: 'device_config_updated',
            category: 'system',
            severity: 'warning',
            actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: req.ip },
            target: { type: 'server', id },
            action: 'update_device_config',
            details: {
                deviceId: id,
                displayName: nextConfig.displayName,
                group: nextConfig.group,
                site: nextConfig.site,
                scanProfile: nextConfig.scanProfile
            },
            status: 'success'
        });

        res.json({
            success: true,
            device: {
                ...device,
                lastHeartbeat: device.lastHeartbeat.toISOString(),
                config: nextConfig
            },
            config: nextConfig,
            commandHistory: getDeviceCommandHistory(id, 10)
        });
    } catch (error: any) {
        logger.error('Failed to update device', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});

/**
 * DELETE /api/devices/:id
 * Unregister device
 * SECURITY FIX: Require admin role for device deletion
 */
router.delete('/:id', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;

        if (!devices.has(id)) {
            return res.status(404).json({ success: false, error: 'backend.device_not_found' });
        }

        devices.delete(id);

        logger.info('Device unregistered', { deviceId: id });
        safeAuditLog({
            tenantId: resolveActorTenantId(req),
            eventType: 'device_deleted',
            category: 'system',
            severity: 'critical',
            actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: req.ip },
            target: { type: 'server', id },
            action: 'delete_device',
            details: { deviceId: id },
            status: 'success'
        });

        res.json({
            success: true,
            message: `Device ${id} unregistered`,
        });
    } catch (error: any) {
        logger.error('Failed to delete device', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});

// Export device management functions for WebSocket Gateway
export function registerDevice(info: Omit<DeviceInfo, 'isOnline' | 'lastHeartbeat' | 'connectedAgents'>): void {
    const device: DeviceInfo = {
        ...info,
        isOnline: true,
        lastHeartbeat: new Date(),
        connectedAgents: [],
    };
    devices.set(info.deviceId, device);
    ensureDeviceConfig(device);
    try {
        const asset = ensureDeviceAsset(device);
        syncDeviceSignals(device, asset.assetId);
    } catch {
        // Ignore when the security operations database is not initialized in lightweight tests.
    }
    logger.info('Device registered', { deviceId: info.deviceId });
}

export function updateDeviceStatus(deviceId: string, status: DeviceInfo['status']): void {
    const device = devices.get(deviceId);
    if (device) {
        device.status = status;
        device.lastHeartbeat = new Date();
        devices.set(deviceId, device);
        try {
            const asset = ensureDeviceAsset(device);
            syncDeviceSignals(device, asset.assetId);
        } catch {
            // Ignore when the security operations database is unavailable.
        }
    }
}

export function setDeviceOffline(deviceId: string): void {
    const device = devices.get(deviceId);
    if (device) {
        device.isOnline = false;
        devices.set(deviceId, device);
        try {
            const asset = ensureDeviceAsset(device);
            syncDeviceSignals(device, asset.assetId);
        } catch {
            // Ignore when the security operations database is unavailable.
        }
        logger.info('Device went offline', { deviceId });
    }
}

export function getDeviceList(): DeviceInfo[] {
    return Array.from(devices.values());
}

export function getCodebook(): Record<string, string> {
    return codebook;
}

export function addDeviceEvent(deviceId: string, type: DeviceEvent['type'], payload: any): void {
    const event: DeviceEvent = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        deviceId,
        type,
        payload,
        timestamp: new Date().toISOString()
    };

    const rows = deviceEvents.get(deviceId) || [];
    rows.push(event);
    if (rows.length > 1000) {
        rows.splice(0, rows.length - 1000);
    }
    deviceEvents.set(deviceId, rows);
}


export default router;
