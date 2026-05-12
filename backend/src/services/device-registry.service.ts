/**
 * Device Registry Service
 *
 * Pure state container for ESP32 device registry.
 * Extracted from devices.routes.ts – no Express/Router dependency.
 */

import logger from '../utils/logger';
import { securityOperationsService } from './security-operations.service';
import { commandDispatcherService } from './command-dispatcher.service';
import { PLATFORM_TENANT_ID } from '../core/tenant/tenant-context';
import { allowGatewayDestructiveCommands } from '../config/enterprise-runtime';
import { requiresPhysicalConfirmation } from '../security/command-risk-policy';

// ---- Types ----

export interface DeviceInfo {
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
    physicalAuth?: {
        publicKeyPem: string;
    };
}

export interface DeviceConfig {
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

export interface DeviceCommandRecord {
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

export interface DeviceEvent {
    id: string;
    deviceId: string;
    type: 'register' | 'heartbeat' | 'data' | 'alert' | 'unknown_error' | 'disconnect' | 'command';
    payload: any;
    timestamp: string;
}

// ---- Internal State ----

const devices = new Map<string, DeviceInfo>();
const deviceEvents = new Map<string, DeviceEvent[]>();
const deviceConfigs = new Map<string, DeviceConfig>();
const deviceCommands = new Map<string, DeviceCommandRecord[]>();
let deviceCommandTransport: ((deviceId: string, command: string, params?: Record<string, any>) => Promise<boolean> | boolean) | null = null;

function isProductionBlockedDeviceCommand(command: string): boolean {
    return !allowGatewayDestructiveCommands() && requiresPhysicalConfirmation(command);
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

// ---- Internal Helpers ----

function buildDefaultConfig(device: DeviceInfo): DeviceConfig {
    return {
        displayName: device.deviceId,
        group: device.mode === 'online' ? 'core-edge' : 'field-edge',
        site: device.systemInfo?.hostname || 'unassigned-site',
        networkProfile: device.mode === 'online' ? 'cloud-mesh' : 'standalone-buffer',
        scanProfile: device.isOnline ? 'balanced' : 'offline-recovery',
        notes: `${device.chipModel} running firmware ${device.version}`,
        commandPermissions: [
            'collect',
            'reboot',
            'sync-config',
            'ota_update',
            'deploy_bundle',
            'host_install',
            'host_remove',
            'recovery_flash',
            'factory_reset',
            'diagnostic_unlock',
            'wipe_data',
            'critical_config_change'
        ],
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

// ---- Exported Functions ----

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
    hardwareGrant?: any;
}): Promise<{ success: boolean; record?: DeviceCommandRecord; message: string; reason?: string }> {
    const device = devices.get(input.deviceId);
    if (!device) {
        return { success: false, message: 'Device not found.', reason: 'device_not_found' };
    }

    if (isProductionBlockedDeviceCommand(input.command)) {
        return {
            success: false,
            message: `Command ${input.command} is blocked on the experimental device gateway in the current enterprise runtime.`,
            reason: 'device_command_requires_enterprise_serial_run'
        };
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

// ---- Additional accessors needed by routes ----

export function getDeviceEvents(deviceId: string): DeviceEvent[] {
    return deviceEvents.get(deviceId) || [];
}

export function getDeviceConfig(deviceId: string): DeviceConfig | undefined {
    return deviceConfigs.get(deviceId);
}

export function setDeviceConfig(deviceId: string, config: DeviceConfig): void {
    deviceConfigs.set(deviceId, config);
}

export function getDeviceCommandHistoryPublic(deviceId: string, limit = 10): DeviceCommandRecord[] {
    return getDeviceCommandHistory(deviceId, limit);
}

export function deleteDevice(deviceId: string): boolean {
    return devices.delete(deviceId);
}

export function hasDevice(deviceId: string): boolean {
    return devices.has(deviceId);
}

export function setDevice(deviceId: string, device: DeviceInfo): void {
    devices.set(deviceId, device);
}

// Wire up command dispatcher on module load
commandDispatcherService.setDeviceAdapter({
    getDevice: getDeviceById,
    executeCommand: executeDeviceCommandInternal
});
