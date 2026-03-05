﻿﻿﻿/**
 * FluxGuard - ESP32 设备 WebSocket 网关
 *
 * 处理 ESP32 固件网关的 WebSocket 连接
 * - 设备注册
 * - 心跳监控
 * - 数据接收
 * - 命令下发
 *
 * SECURITY FIX CVE-2026-032/033: Added CORS restrictions and API key validation
 * SECURITY FIX CVE-2026-DEV001: Added rate limiting
 * SECURITY FIX CVE-2026-DEV002: Added command signing with HMAC-SHA256
 * SECURITY FIX CVE-2026-DEV003: Added comprehensive audit logging
 */

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import crypto from 'crypto';
import logger from '../utils/logger';
import auditLogger from '../security/audit-logger.service';
import redisService from '../security/redis.service';
import {
    registerDevice,
    updateDeviceStatus,
    setDeviceOffline,
    getCodebook,
    addDeviceEvent,
} from '../api/routes/devices.routes';

interface DeviceSocket extends Socket {
    deviceId?: string;
}

interface SignedDeviceCommand {
    command: {
        cmd: string;
        params?: any;
        timestamp: number;
        nonce: string;
    };
    signature: string;
    deviceId: string;
}

function secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
        crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
        return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_WINDOW = 100;
const DEVICE_RATE_LIMIT_WINDOW = 60000;
const MAX_DEVICE_REQUESTS_PER_WINDOW = 100;

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

class RateLimiter {
    private memoryFallback: Map<string, RateLimitEntry> = new Map();

    async checkLimit(key: string, limit: number, window: number): Promise<boolean> {
        const now = Date.now();
        const resetTime = now + window;

        try {
            const current = await redisService.get(`ratelimit:device:${key}`);

            if (current === null) {
                await redisService.set(`ratelimit:device:${key}`, '1', window / 1000);
                await redisService.set(`ratelimit:device:${key}:reset`, resetTime.toString(), window / 1000);
                return true;
            }

            const count = parseInt(current, 10);

            if (count >= limit) {
                logger.warn(`[DeviceGateway] Rate limit exceeded for ${key}`, { count, limit });
                return false;
            }

            await redisService.incr(`ratelimit:device:${key}`);
            return true;
        } catch (error) {
            return this.checkLimitMemory(key, limit, window);
        }
    }

    private checkLimitMemory(key: string, limit: number, window: number): boolean {
        const now = Date.now();
        const limits = this.memoryFallback.get(key);

        if (!limits || now > limits.resetTime) {
            this.memoryFallback.set(key, { count: 1, resetTime: now + window });
            return true;
        }

        if (limits.count >= limit) {
            logger.warn(`[DeviceGateway] Rate limit exceeded (memory) for ${key}`);
            return false;
        }

        limits.count++;
        return true;
    }

    cleanup(): void {
        const now = Date.now();
        for (const [key, limits] of this.memoryFallback.entries()) {
            if (now > limits.resetTime) {
                this.memoryFallback.delete(key);
            }
        }
    }
}

const rateLimiter = new RateLimiter();

const rateLimiterCleanupTimer = setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000);
rateLimiterCleanupTimer.unref?.();

async function checkDeviceRateLimit(deviceId: string): Promise<boolean> {
    const withinLimit = await rateLimiter.checkLimit(
        `device:${deviceId}`,
        MAX_DEVICE_REQUESTS_PER_WINDOW,
        DEVICE_RATE_LIMIT_WINDOW
    );

    if (!withinLimit) {
        await auditLogger.log({
            eventType: 'rate_limit_exceeded',
            category: 'agent',
            severity: 'warning',
            actor: { type: 'agent', id: deviceId },
            action: 'rate_limit_check',
            details: { limit: MAX_DEVICE_REQUESTS_PER_WINDOW, window: DEVICE_RATE_LIMIT_WINDOW },
            status: 'failure'
        });
    }

    return withinLimit;
}

async function checkSocketRateLimit(socketId: string): Promise<boolean> {
    return rateLimiter.checkLimit(
        `socket:${socketId}`,
        MAX_REQUESTS_PER_WINDOW,
        RATE_LIMIT_WINDOW
    );
}

export class DeviceGateway {
    private io: Server;
    private deviceSockets: Map<string, DeviceSocket> = new Map();
    private dashboardBroadcaster: ((event: string, data: any) => void) | null = null;
    private readonly commandSigningSecret: string;
    private usedNonces: Map<string, number> = new Map();
    private cleanupInterval: NodeJS.Timeout;

    constructor(httpServer: HttpServer) {
        this.commandSigningSecret = process.env.DEVICE_COMMAND_SECRET || '';
        
        if (!this.commandSigningSecret) {
            logger.warn('[DeviceGateway] DEVICE_COMMAND_SECRET not set, command signing disabled');
        } else if (this.commandSigningSecret.length < 32) {
            logger.warn('[DeviceGateway] DEVICE_COMMAND_SECRET should be at least 32 characters');
        }

        const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'];

        this.io = new Server(httpServer, {
            path: '/ws/device',
            cors: {
                origin: allowedOrigins,
                methods: ['GET', 'POST'],
                credentials: true
            },
        });

        this.setupEventHandlers();
        
        this.cleanupInterval = setInterval(() => this.cleanupUsedNonces(), 5 * 60 * 1000);
        this.cleanupInterval.unref?.();
        
        logger.info('[DeviceGateway] Initialized on /ws/device with restricted CORS, rate limiting, and command signing');
    }

    private cleanupUsedNonces(): void {
        const now = Date.now();
        const maxAge = 120000;
        for (const [nonce, timestamp] of this.usedNonces.entries()) {
            if (now - timestamp > maxAge) {
                this.usedNonces.delete(nonce);
            }
        }
    }

    private getDeviceSecretKey(deviceId: string): string | null {
        const deviceSpecificKey = process.env[`DEVICE_KEY_${deviceId}`];
        if (deviceSpecificKey) {
            return deviceSpecificKey;
        }
        return this.commandSigningSecret || null;
    }

    private signCommand(deviceId: string, commandType: string, params?: any): SignedDeviceCommand | null {
        const secretKey = this.getDeviceSecretKey(deviceId);
        
        if (!secretKey) {
            logger.warn(`[DeviceGateway] Cannot sign command: no secret key for device ${deviceId}`);
            return null;
        }

        const nonce = crypto.randomBytes(16).toString('hex');
        const command = {
            cmd: commandType,
            params,
            timestamp: Date.now(),
            nonce
        };

        const message = JSON.stringify(command);
        const signature = crypto
            .createHmac('sha256', secretKey)
            .update(message)
            .digest('hex');

        return {
            command,
            signature,
            deviceId
        };
    }

    public setDashboardBroadcaster(fn: (event: string, data: any) => void): void {
        this.dashboardBroadcaster = fn;
    }

    private emitToDashboard(event: string, data: any): void {
        if (this.dashboardBroadcaster) {
            this.dashboardBroadcaster(event, data);
            return;
        }
        this.io.emit(event, data);
    }

    private setupEventHandlers() {
        this.io.on('connection', (socket: DeviceSocket) => {
            logger.info('[DeviceGateway] New device connection', { socketId: socket.id });

            socket.on('register', (data: any) => {
                this.handleRegister(socket, data);
            });

            socket.on('heartbeat', (data: any) => {
                this.handleHeartbeat(socket, data);
            });

            socket.on('data', (data: any) => {
                this.handleData(socket, data);
            });

            socket.on('alert', (data: any) => {
                this.handleAlert(socket, data);
            });

            socket.on('unknown_error', (data: any) => {
                this.handleUnknownError(socket, data);
            });

            socket.on('codebook_sync', () => {
                this.handleCodebookSync(socket);
            });

            socket.on('disconnect', (reason: string) => {
                this.handleDisconnect(socket, reason);
            });
        });
    }

    private async handleRegister(socket: DeviceSocket, data: any) {
        const {
            device_id,
            version,
            chip_model,
            flash_size,
            free_heap,
            sdk_version,
            api_key,
        } = data;

        if (!(await checkSocketRateLimit(socket.id))) {
            socket.emit('register_error', { error: 'backend.rate_limit_exceeded' });
            socket.disconnect();
            return;
        }

        const validApiKeys = process.env.DEVICE_API_KEYS?.split(',').filter(k => k.trim()) || [];

        if (validApiKeys.length === 0) {
            logger.error('[DeviceGateway] No DEVICE_API_KEYS configured');
            socket.emit('register_error', { error: 'backend.server_configuration_error' });
            socket.disconnect();
            return;
        }

        if (!api_key) {
            logger.warn('[DeviceGateway] Device connection without API key', { device_id });
            socket.emit('register_error', { error: 'backend.api_key_required' });
            socket.disconnect();
            return;
        }

        const isValidKey = validApiKeys.some(validKey => secureCompare(api_key, validKey.trim()));
        if (!isValidKey) {
            logger.warn('[DeviceGateway] Invalid API key from device', { device_id });
            socket.emit('register_error', { error: 'backend.invalid_api_key' });
            socket.disconnect();
            
            await auditLogger.log({
                eventType: 'device_register_failed',
                category: 'auth',
                severity: 'warning',
                actor: { type: 'agent', id: device_id || 'unknown', ip: socket.handshake.address },
                action: 'register',
                details: { reason: 'invalid_api_key' },
                status: 'failure'
            });
            return;
        }

        socket.deviceId = device_id;
        this.deviceSockets.set(device_id, socket);

        registerDevice({
            deviceId: device_id,
            version,
            chipModel: chip_model,
            flashSize: flash_size,
            freeHeap: free_heap,
            sdkVersion: sdk_version,
            mode: 'online',
        });
        addDeviceEvent(device_id, 'register', {
            version,
            chipModel: chip_model,
            sdkVersion: sdk_version
        });

        socket.emit('register_success', {
            message: 'backend.device_registered_successfully',
            codebook: getCodebook(),
        });

        this.emitToDashboard('device:online', {
            deviceId: device_id,
            version,
            timestamp: new Date().toISOString(),
        });

        await auditLogger.log({
            eventType: 'device_registered',
            category: 'agent',
            severity: 'info',
            actor: { type: 'agent', id: device_id, ip: socket.handshake.address },
            action: 'register',
            details: { version, chipModel: chip_model, sdkVersion: sdk_version },
            status: 'success'
        });

        logger.info('[DeviceGateway] Device registered', { deviceId: device_id, version });
    }

    private async handleHeartbeat(socket: DeviceSocket, data: any) {
        if (!socket.deviceId) return;

        if (!(await checkDeviceRateLimit(socket.deviceId))) {
            socket.emit('heartbeat_error', { error: 'backend.rate_limit_exceeded' });
            return;
        }

        const { uptime, free_heap, wifi_rssi } = data;

        updateDeviceStatus(socket.deviceId, {
            cpuUsage: data.cpu_usage || 0,
            memoryUsage: 100 - (free_heap / (4 * 1024 * 1024) * 100),
            uptime,
            wifiRssi: wifi_rssi,
        });
        addDeviceEvent(socket.deviceId, 'heartbeat', {
            uptime,
            freeHeap: free_heap,
            wifiRssi: wifi_rssi
        });

        socket.emit('heartbeat_ack', { timestamp: Date.now() });
    }

    private async handleData(socket: DeviceSocket, data: any) {
        if (!socket.deviceId) return;

        if (!(await checkDeviceRateLimit(socket.deviceId))) {
            return;
        }

        const { payload, timestamp } = data;

        let decodedPayload = payload;
        if (typeof payload === 'string') {
            try {
                const parsed = JSON.parse(payload);
                if (parsed.codes) {
                    const codebook = getCodebook();
                    parsed.errors = parsed.codes.map((code: string) => codebook[code] || code);
                    delete parsed.codes;
                    decodedPayload = parsed;
                }
            } catch {
            }
        }

        logger.info('[DeviceGateway] Data received', {
            deviceId: socket.deviceId,
            timestamp,
            dataSize: JSON.stringify(decodedPayload).length,
        });

        addDeviceEvent(socket.deviceId, 'data', { payload: decodedPayload });
        this.emitToDashboard('device:data', {
            deviceId: socket.deviceId,
            data: decodedPayload,
            timestamp: new Date().toISOString(),
        });
    }

    private async handleAlert(socket: DeviceSocket, data: any) {
        if (!socket.deviceId) return;

        if (!(await checkDeviceRateLimit(socket.deviceId))) {
            return;
        }

        const { alert_type, message, timestamp } = data;

        logger.warn('[DeviceGateway] Alert from device', {
            deviceId: socket.deviceId,
            alertType: alert_type,
            message,
        });

        await auditLogger.log({
            eventType: 'device_alert',
            category: 'agent',
            severity: 'warning',
            actor: { type: 'agent', id: socket.deviceId },
            action: 'alert',
            details: { alertType: alert_type, message },
            status: 'success'
        });

        addDeviceEvent(socket.deviceId, 'alert', { alertType: alert_type, message });
        this.emitToDashboard('device:alert', {
            deviceId: socket.deviceId,
            alertType: alert_type,
            message,
            timestamp: timestamp || new Date().toISOString(),
        });
    }

    private async handleUnknownError(socket: DeviceSocket, data: any) {
        if (!socket.deviceId) return;

        const { message, timestamp } = data;

        logger.error('[DeviceGateway] Unknown error from device', {
            deviceId: socket.deviceId,
            message,
        });

        await auditLogger.log({
            eventType: 'device_unknown_error',
            category: 'agent',
            severity: 'critical',
            actor: { type: 'agent', id: socket.deviceId },
            action: 'unknown_error',
            details: { message },
            status: 'failure'
        });

        addDeviceEvent(socket.deviceId, 'unknown_error', { message });
        this.emitToDashboard('device:unknown_error', {
            deviceId: socket.deviceId,
            message,
            timestamp: timestamp || new Date().toISOString(),
        });
    }

    private handleCodebookSync(socket: DeviceSocket) {
        socket.emit('codebook_sync', { codebook: getCodebook() });
        logger.info('[DeviceGateway] Codebook synced', { deviceId: socket.deviceId });
    }

    private async handleDisconnect(socket: DeviceSocket, reason: string) {
        if (socket.deviceId) {
            this.deviceSockets.delete(socket.deviceId);
            setDeviceOffline(socket.deviceId);

            addDeviceEvent(socket.deviceId, 'disconnect', { reason });
            this.emitToDashboard('device:offline', {
                deviceId: socket.deviceId,
                reason,
                timestamp: new Date().toISOString(),
            });

            await auditLogger.log({
                eventType: 'device_disconnected',
                category: 'agent',
                severity: 'info',
                actor: { type: 'agent', id: socket.deviceId },
                action: 'disconnect',
                details: { reason },
                status: 'success'
            });

            logger.info('[DeviceGateway] Device disconnected', {
                deviceId: socket.deviceId,
                reason,
            });
        }
    }

    public async sendCommand(deviceId: string, command: string, params?: any): Promise<boolean> {
        const socket = this.deviceSockets.get(deviceId);

        if (!socket || !socket.connected) {
            logger.warn('[DeviceGateway] Cannot send command, device offline', { deviceId });
            return false;
        }

        const signedCommand = this.signCommand(deviceId, command, params);
        
        if (signedCommand) {
            socket.emit('command', signedCommand);
        } else {
            socket.emit('command', { cmd: command, params, timestamp: Date.now() });
        }

        addDeviceEvent(deviceId, 'command', { command, params });

        await auditLogger.log({
            eventType: 'device_command_sent',
            category: 'command',
            severity: 'info',
            actor: { type: 'system', id: 'device-gateway' },
            action: 'send_command',
            target: { type: 'agent', id: deviceId },
            details: { command, params, signed: !!signedCommand },
            status: 'success'
        });

        logger.info('[DeviceGateway] Command sent', {
            deviceId,
            command,
            signed: !!signedCommand,
        });

        return true;
    }

    public async broadcastCommand(command: string, params?: any): Promise<number> {
        let count = 0;

        for (const [deviceId, socket] of this.deviceSockets.entries()) {
            if (socket.connected) {
                const signedCommand = this.signCommand(deviceId, command, params);
                
                if (signedCommand) {
                    socket.emit('command', signedCommand);
                } else {
                    socket.emit('command', { cmd: command, params, timestamp: Date.now() });
                }
                
                addDeviceEvent(deviceId, 'command', { command, params });
                count++;
            }
        }

        await auditLogger.log({
            eventType: 'device_broadcast_command',
            category: 'command',
            severity: 'info',
            actor: { type: 'system', id: 'device-gateway' },
            action: 'broadcast_command',
            details: { command, deviceCount: count },
            status: 'success'
        });

        logger.info('[DeviceGateway] Broadcast command', {
            command,
            deviceCount: count,
        });

        return count;
    }

    public getOnlineCount(): number {
        let count = 0;
        this.deviceSockets.forEach((socket) => {
            if (socket.connected) count++;
        });
        return count;
    }

    public close() {
        clearInterval(this.cleanupInterval);
        this.io.close();
        logger.info('[DeviceGateway] Closed');
    }
}

export default DeviceGateway;
