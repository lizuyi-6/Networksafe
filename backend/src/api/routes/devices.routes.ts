/**
 * FluxGuard - ESP32 设备管理 API
 *
 * 提供 ESP32 硬件网关的 REST API 接口
 * SECURITY FIX CVE-2026-031: Added authentication middleware
 */

import { Router, Request, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import logger from '../../utils/logger';

const router = Router();

// SECURITY FIX CVE-2026-031: Apply authentication to all routes
router.use(authenticate);

// 设备存储 (内存 + 后续可扩展到数据库)
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

const devices = new Map<string, DeviceInfo>();

// 密码本
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
 * 获取所有 ESP32 设备列表
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
 * 获取单个设备详情
 */
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
 * 发送命令到设备
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

        // 记录命令日志
        logger.info('Command sent to device', {
            deviceId: id,
            command,
            params
        });

        // 实际发送命令需要通过 WebSocket Gateway
        // 这里返回成功，实际发送在 device-gateway.ts 中处理
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
 * 更新设备配置
 */
router.put('/:id', (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const device = devices.get(id);

        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        // 更新可配置字段
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
 * 注销设备
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
 * 获取密码本
 */
router.get('/codebook', (_req: Request, res: Response) => {
    res.json({
        success: true,
        codebook,
    });
});

/**
 * POST /api/devices/codebook
 * 更新密码本
 *
 * SECURITY FIX: 添加输入验证，防止恶意数据注入
 */
router.post('/codebook', (req: Request, res: Response) => {
    try {
        const { entries } = req.body;

        if (!entries || typeof entries !== 'object') {
            return res.status(400).json({ success: false, error: 'Invalid entries' });
        }

        // SECURITY: 验证所有 entries
        const maxEntries = 1000;
        const currentEntries = Object.keys(codebook).length;
        const newEntriesCount = Object.keys(entries).length;

        if (currentEntries + newEntriesCount > maxEntries) {
            return res.status(400).json({
                success: false,
                error: `Too many entries. Maximum ${maxEntries} entries allowed.`
            });
        }

        // 验证每个 entry 的格式
        for (const [key, value] of Object.entries(entries)) {
            // 验证 key: 只允许字母数字和特定符号
            if (!/^[A-Z0-9_-]+$/.test(key)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid key format: ${key}. Only uppercase letters, numbers, underscore and hyphen allowed.`
                });
            }

            // 验证 value: 字符串且限制长度
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

            // 检查是否包含潜在的恶意内容
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

// 导出设备管理函数供 WebSocket Gateway 使用
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

export default router;
