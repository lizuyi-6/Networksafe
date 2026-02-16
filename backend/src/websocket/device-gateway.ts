/**
 * FluxGuard - ESP32 璁惧 WebSocket 缃戝叧
 *
 * 澶勭悊 ESP32 纭欢缃戝叧鐨?WebSocket 杩炴帴
 * - 璁惧娉ㄥ唽
 * - 蹇冭烦鐩戞帶
 * - 鏁版嵁鎺ユ敹
 * - 鍛戒护涓嬪彂
 *
 * SECURITY FIX CVE-2026-032/033: Added CORS restrictions and API key validation
 */

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import crypto from 'crypto';
import logger from '../utils/logger';
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

/**
 * SECURITY FIX CVE-2026-033: Constant-time API key comparison
 */
function secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
        crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
        return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export class DeviceGateway {
    private io: Server;
    private deviceSockets: Map<string, DeviceSocket> = new Map();
    private dashboardBroadcaster: ((event: string, data: any) => void) | null = null;

    constructor(httpServer: HttpServer) {
        // SECURITY FIX CVE-2026-032: Restrict CORS to allowed origins
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
        logger.info('[DeviceGateway] Initialized on /ws/device with restricted CORS');
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

            // 璁惧娉ㄥ唽
            socket.on('register', (data: any) => {
                this.handleRegister(socket, data);
            });

            // 蹇冭烦
            socket.on('heartbeat', (data: any) => {
                this.handleHeartbeat(socket, data);
            });

            // 鏁版嵁涓婃姤
            socket.on('data', (data: any) => {
                this.handleData(socket, data);
            });

            // 鍛婅
            socket.on('alert', (data: any) => {
                this.handleAlert(socket, data);
            });

            // 鏈煡閿欒涓婃姤
            socket.on('unknown_error', (data: any) => {
                this.handleUnknownError(socket, data);
            });

            // 瀵嗙爜鏈悓姝ヨ姹?
            socket.on('codebook_sync', () => {
                this.handleCodebookSync(socket);
            });

            // 鏂紑杩炴帴
            socket.on('disconnect', (reason: string) => {
                this.handleDisconnect(socket, reason);
            });
        });
    }

    // ============================================
    // 浜嬩欢澶勭悊鍣?
    // ============================================

    private handleRegister(socket: DeviceSocket, data: any) {
        const {
            device_id,
            version,
            chip_model,
            flash_size,
            free_heap,
            sdk_version,
            api_key,
        } = data;

        // SECURITY FIX CVE-2026-033: Proper API key validation against configured keys
        const validApiKeys = process.env.DEVICE_API_KEYS?.split(',').filter(k => k.trim()) || [];

        if (validApiKeys.length === 0) {
            logger.error('[DeviceGateway] No DEVICE_API_KEYS configured');
            socket.emit('register_error', { error: 'Server configuration error' });
            socket.disconnect();
            return;
        }

        if (!api_key) {
            logger.warn('[DeviceGateway] Device connection without API key', { device_id });
            socket.emit('register_error', { error: 'API key required' });
            socket.disconnect();
            return;
        }

        // SECURITY FIX CVE-2026-033: Use constant-time comparison
        const isValidKey = validApiKeys.some(validKey => secureCompare(api_key, validKey.trim()));
        if (!isValidKey) {
            logger.warn('[DeviceGateway] Invalid API key from device', { device_id });
            socket.emit('register_error', { error: 'Invalid API key' });
            socket.disconnect();
            return;
        }

        socket.deviceId = device_id;
        this.deviceSockets.set(device_id, socket);

        // 娉ㄥ唽鍒拌澶囩鐞?
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

        // 鍙戦€佹敞鍐屾垚鍔?+ 瀵嗙爜鏈?
        socket.emit('register_success', {
            message: 'Device registered successfully',
            codebook: getCodebook(),
        });

        // 骞挎挱鍒?Dashboard
        this.emitToDashboard('device:online', {
            deviceId: device_id,
            version,
            timestamp: new Date().toISOString(),
        });

        logger.info('[DeviceGateway] Device registered', { deviceId: device_id, version });
    }

    private handleHeartbeat(socket: DeviceSocket, data: any) {
        if (!socket.deviceId) return;

        const { uptime, free_heap, wifi_rssi } = data;

        updateDeviceStatus(socket.deviceId, {
            cpuUsage: data.cpu_usage || 0,
            memoryUsage: 100 - (free_heap / (4 * 1024 * 1024) * 100), // 鍋囪 4MB 鎬诲唴瀛?
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

    private handleData(socket: DeviceSocket, data: any) {
        if (!socket.deviceId) return;

        const { payload, timestamp } = data;

        // 瑙ｅ帇瀵嗙爜鏈紪鐮?(濡傛灉鏈?
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
                // 淇濇寔鍘熸牱
            }
        }

        // 璁板綍鏃ュ織
        logger.info('[DeviceGateway] Data received', {
            deviceId: socket.deviceId,
            timestamp,
            dataSize: JSON.stringify(decodedPayload).length,
        });

        // 骞挎挱鍒?Dashboard
        addDeviceEvent(socket.deviceId, 'data', { payload: decodedPayload });
        this.emitToDashboard('device:data', {
            deviceId: socket.deviceId,
            data: decodedPayload,
            timestamp: new Date().toISOString(),
        });
    }

    private handleAlert(socket: DeviceSocket, data: any) {
        if (!socket.deviceId) return;

        const { alert_type, message, timestamp } = data;

        logger.warn('[DeviceGateway] Alert from device', {
            deviceId: socket.deviceId,
            alertType: alert_type,
            message,
        });

        // 骞挎挱鍒?Dashboard
        addDeviceEvent(socket.deviceId, 'alert', { alertType: alert_type, message });
        this.emitToDashboard('device:alert', {
            deviceId: socket.deviceId,
            alertType: alert_type,
            message,
            timestamp: timestamp || new Date().toISOString(),
        });
    }

    private handleUnknownError(socket: DeviceSocket, data: any) {
        if (!socket.deviceId) return;

        const { message, timestamp } = data;

        logger.error('[DeviceGateway] Unknown error from device', {
            deviceId: socket.deviceId,
            message,
        });

        // 璁板綍鍒板璁℃棩蹇?
        // TODO: 淇濆瓨鍒版暟鎹簱锛岀敤浜庡悗缁垎鏋愬拰娣诲姞鍒板瘑鐮佹湰

        // 骞挎挱鍒?Dashboard
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

    private handleDisconnect(socket: DeviceSocket, reason: string) {
        if (socket.deviceId) {
            this.deviceSockets.delete(socket.deviceId);
            setDeviceOffline(socket.deviceId);

            // 骞挎挱鍒?Dashboard
            addDeviceEvent(socket.deviceId, 'disconnect', { reason });
            this.emitToDashboard('device:offline', {
                deviceId: socket.deviceId,
                reason,
                timestamp: new Date().toISOString(),
            });

            logger.info('[DeviceGateway] Device disconnected', {
                deviceId: socket.deviceId,
                reason,
            });
        }
    }

    // ============================================
    // 鍛戒护涓嬪彂
    // ============================================

    /**
     * 鍙戦€佸懡浠ゅ埌鎸囧畾璁惧
     */
    public sendCommand(deviceId: string, command: string, params?: any): boolean {
        const socket = this.deviceSockets.get(deviceId);

        if (!socket || !socket.connected) {
            logger.warn('[DeviceGateway] Cannot send command, device offline', { deviceId });
            return false;
        }

        socket.emit('command', { cmd: command, params, timestamp: Date.now() });
        addDeviceEvent(deviceId, 'command', { command, params });

        logger.info('[DeviceGateway] Command sent', {
            deviceId,
            command,
            params,
        });

        return true;
    }

    /**
     * 骞挎挱鍛戒护鍒版墍鏈夊湪绾胯澶?
     */
    public broadcastCommand(command: string, params?: any): number {
        let count = 0;

        this.deviceSockets.forEach((socket, deviceId) => {
            if (socket.connected) {
                socket.emit('command', { cmd: command, params, timestamp: Date.now() });
                addDeviceEvent(deviceId, 'command', { command, params });
                count++;
            }
        });

        logger.info('[DeviceGateway] Broadcast command', {
            command,
            deviceCount: count,
        });

        return count;
    }

    /**
     * 鑾峰彇鍦ㄧ嚎璁惧鏁伴噺
     */
    public getOnlineCount(): number {
        let count = 0;
        this.deviceSockets.forEach((socket) => {
            if (socket.connected) count++;
        });
        return count;
    }

    /**
     * 鍏抽棴缃戝叧
     */
    public close() {
        this.io.close();
        logger.info('[DeviceGateway] Closed');
    }
}

export default DeviceGateway;


