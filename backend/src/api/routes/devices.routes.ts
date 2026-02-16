/**
 * FluxGuard - ESP32 璁惧绠＄悊 API
 *
 * 鎻愪緵 ESP32 纭欢缃戝叧鐨?REST API 鎺ュ彛
 * SECURITY FIX CVE-2026-031: Added authentication middleware
 */

import { Router, Request, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import logger from '../../utils/logger';

const router = Router();

// SECURITY FIX CVE-2026-031: Apply authentication to all routes
router.use(authenticate);

// 璁惧瀛樺偍 (鍐呭瓨 + 鍚庣画鍙墿灞曞埌鏁版嵁搴?
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

// 瀵嗙爜鏈?
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
 * 鑾峰彇鎵€鏈?ESP32 璁惧鍒楄〃
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
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * GET /api/devices/:id
 * 鑾峰彇鍗曚釜璁惧璇︽儏
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
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});
router.get('/:id', (req: Request, res: Response) => {
    try {
        const device = devices.get(req.params.id);

        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
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
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /api/devices/:id/cmd
 * 鍙戦€佸懡浠ゅ埌璁惧
 * SECURITY FIX: Require admin role for command execution
 */
router.post('/:id/cmd', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { command, params } = req.body;

        const device = devices.get(id);

        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        if (!device.isOnline) {
            return res.status(400).json({ success: false, error: 'Device is offline' });
        }

        // 璁板綍鍛戒护鏃ュ織
        logger.info('Command sent to device', {
            deviceId: id,
            command,
            params
        });

        // 瀹為檯鍙戦€佸懡浠ら渶瑕侀€氳繃 WebSocket Gateway
        // 杩欓噷杩斿洖鎴愬姛锛屽疄闄呭彂閫佸湪 device-gateway.ts 涓鐞?
        res.json({
            success: true,
            message: `Command "${command}" queued for device ${id}`,
        });
    } catch (error: any) {
        logger.error('Failed to send command', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * PUT /api/devices/:id
 * 鏇存柊璁惧閰嶇疆
 */
router.put('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const device = devices.get(id);

        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        // 鏇存柊鍙厤缃瓧娈?
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
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * DELETE /api/devices/:id
 * 娉ㄩ攢璁惧
 * SECURITY FIX: Require admin role for device deletion
 */
router.delete('/:id', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;

        if (!devices.has(id)) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        devices.delete(id);

        logger.info('Device unregistered', { deviceId: id });

        res.json({
            success: true,
            message: `Device ${id} unregistered`,
        });
    } catch (error: any) {
        logger.error('Failed to delete device', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * GET /api/devices/codebook
 * 鑾峰彇瀵嗙爜鏈?
 */
router.get('/codebook', (_req: Request, res: Response) => {
    res.json({
        success: true,
        codebook,
    });
});

/**
 * POST /api/devices/codebook
 * 鏇存柊瀵嗙爜鏈?
 *
 * SECURITY FIX: 娣诲姞杈撳叆楠岃瘉锛岄槻姝㈡伓鎰忔暟鎹敞鍏?
 */
router.post('/codebook', (req: Request, res: Response) => {
    try {
        const { entries } = req.body;

        if (!entries || typeof entries !== 'object') {
            return res.status(400).json({ success: false, error: 'Invalid entries' });
        }

        // SECURITY: 楠岃瘉鎵€鏈?entries
        const maxEntries = 1000;
        const currentEntries = Object.keys(codebook).length;
        const newEntriesCount = Object.keys(entries).length;

        if (currentEntries + newEntriesCount > maxEntries) {
            return res.status(400).json({
                success: false,
                error: `Too many entries. Maximum ${maxEntries} entries allowed.`
            });
        }

        // 楠岃瘉姣忎釜 entry 鐨勬牸寮?
        for (const [key, value] of Object.entries(entries)) {
            // 楠岃瘉 key: 鍙厑璁稿瓧姣嶆暟瀛楀拰鐗瑰畾绗﹀彿
            if (!/^[A-Z0-9_-]+$/.test(key)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid key format: ${key}. Only uppercase letters, numbers, underscore and hyphen allowed.`
                });
            }

            // 楠岃瘉 value: 瀛楃涓蹭笖闄愬埗闀垮害
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

            // 妫€鏌ユ槸鍚﹀寘鍚綔鍦ㄧ殑鎭舵剰鍐呭
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
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// 瀵煎嚭璁惧绠＄悊鍑芥暟渚?WebSocket Gateway 浣跨敤
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



