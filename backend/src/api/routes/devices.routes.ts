﻿﻿﻿/**
 * FluxGuard - ESP32 Device Management API
 *
 * REST API for ESP32 firmware gateway
 * SECURITY FIX CVE-2026-031: Added authentication middleware
 * SECURITY FIX: Route ordering - static routes before dynamic routes
 */

import { Router, Request, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import logger from '../../utils/logger';

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

interface DeviceEvent {
    id: string;
    deviceId: string;
    type: 'register' | 'heartbeat' | 'data' | 'alert' | 'unknown_error' | 'disconnect' | 'command';
    payload: any;
    timestamp: string;
}

const devices = new Map<string, DeviceInfo>();
const deviceEvents = new Map<string, DeviceEvent[]>();

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

/**
 * GET /api/devices
 * Get all ESP32 device list
 */
router.get('/', (_req: Request, res: Response) => {
    try {
        const deviceList = Array.from(devices.values()).map(device => ({
            ...device,
            lastHeartbeat: device.lastHeartbeat.toISOString(),
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

        res.json({
            success: true,
            device: {
                ...device,
                lastHeartbeat: device.lastHeartbeat.toISOString(),
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
    try {
        const { id } = req.params;
        const { command, params } = req.body;

        const device = devices.get(id);

        if (!device) {
            return res.status(404).json({ success: false, error: 'backend.device_not_found' });
        }

        if (!device.isOnline) {
            return res.status(400).json({ success: false, error: 'backend.device_is_offline' });
        }

        logger.info('Command sent to device', {
            deviceId: id,
            command,
            params
        });

        res.json({
            success: true,
            message: `Command "${command}" queued for device ${id}`,
        });
    } catch (error: any) {
        logger.error('Failed to send command', { error: error.message });
        res.status(500).json({ success: false, error: 'backend.internal_server_error' });
    }
});

/**
 * PUT /api/devices/:id
 * Update device configuration
 */
router.put('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const device = devices.get(id);

        if (!device) {
            return res.status(404).json({ success: false, error: 'backend.device_not_found' });
        }

        if (req.body.connectedAgents) {
            device.connectedAgents = req.body.connectedAgents;
        }

        devices.set(id, device);

        logger.info('Device updated', { deviceId: id });

        res.json({
            success: true,
            device: {
                ...device,
                lastHeartbeat: device.lastHeartbeat.toISOString(),
            },
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
    logger.info('Device registered', { deviceId: info.deviceId });
}

export function updateDeviceStatus(deviceId: string, status: DeviceInfo['status']): void {
    const device = devices.get(deviceId);
    if (device) {
        device.status = status;
        device.lastHeartbeat = new Date();
        devices.set(deviceId, device);
    }
}

export function setDeviceOffline(deviceId: string): void {
    const device = devices.get(deviceId);
    if (device) {
        device.isOnline = false;
        devices.set(deviceId, device);
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
