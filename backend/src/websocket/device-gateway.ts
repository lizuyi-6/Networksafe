/**
 * FluxGuard - ESP32 设备 WebSocket 网关
 * 
 * 处理 ESP32 硬件网关的 WebSocket 连接
 * - 设备注册
 * - 心跳监控
 * - 数据接收
 * - 命令下发
 */

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import logger from '../utils/logger';
import {
    registerDevice,
    updateDeviceStatus,
    setDeviceOffline,
    getCodebook,
} from '../api/routes/devices.routes';

interface DeviceSocket extends Socket {
    deviceId?: string;
}

export class DeviceGateway {
    private io: Server;
    private deviceSockets: Map<string, DeviceSocket> = new Map();

    constructor(httpServer: HttpServer) {
        this.io = new Server(httpServer, {
            path: '/ws/device',
            cors: {
                origin: '*',
                methods: ['GET', 'POST'],
            },
        });

        this.setupEventHandlers();
        logger.info('[DeviceGateway] Initialized on /ws/device');
    }

    private setupEventHandlers() {
        this.io.on('connection', (socket: DeviceSocket) => {
            logger.info('[DeviceGateway] New device connection', { socketId: socket.id });

            // 设备注册
            socket.on('register', (data: any) => {
                this.handleRegister(socket, data);
            });

            // 心跳
            socket.on('heartbeat', (data: any) => {
                this.handleHeartbeat(socket, data);
            });

            // 数据上报
            socket.on('data', (data: any) => {
                this.handleData(socket, data);
            });

            // 告警
            socket.on('alert', (data: any) => {
                this.handleAlert(socket, data);
            });

            // 未知错误上报
            socket.on('unknown_error', (data: any) => {
                this.handleUnknownError(socket, data);
            });

            // 密码本同步请求
            socket.on('codebook_sync', () => {
                this.handleCodebookSync(socket);
            });

            // 断开连接
            socket.on('disconnect', (reason: string) => {
                this.handleDisconnect(socket, reason);
            });
        });
    }

    // ============================================
    // 事件处理器
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

        // 验证 API Key (简化版，实际应查数据库)
        if (!api_key) {
            socket.emit('register_error', { error: 'Invalid API key' });
            socket.disconnect();
            return;
        }

        socket.deviceId = device_id;
        this.deviceSockets.set(device_id, socket);

        // 注册到设备管理
        registerDevice({
            deviceId: device_id,
            version,
            chipModel: chip_model,
            flashSize: flash_size,
            freeHeap: free_heap,
            sdkVersion: sdk_version,
            mode: 'online',
        });

        // 发送注册成功 + 密码本
        socket.emit('register_success', {
            message: 'Device registered successfully',
            codebook: getCodebook(),
        });

        // 广播到 Dashboard
        this.io.emit('device:online', {
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
            memoryUsage: 100 - (free_heap / (4 * 1024 * 1024) * 100), // 假设 4MB 总内存
            uptime,
            wifiRssi: wifi_rssi,
        });

        socket.emit('heartbeat_ack', { timestamp: Date.now() });
    }

    private handleData(socket: DeviceSocket, data: any) {
        if (!socket.deviceId) return;

        const { payload, timestamp } = data;

        // 解压密码本编码 (如果有)
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
                // 保持原样
            }
        }

        // 记录日志
        logger.info('[DeviceGateway] Data received', {
            deviceId: socket.deviceId,
            timestamp,
            dataSize: JSON.stringify(decodedPayload).length,
        });

        // 广播到 Dashboard
        this.io.emit('device:data', {
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

        // 广播到 Dashboard
        this.io.emit('device:alert', {
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

        // 记录到审计日志
        // TODO: 保存到数据库，用于后续分析和添加到密码本

        // 广播到 Dashboard
        this.io.emit('device:unknown_error', {
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

            // 广播到 Dashboard
            this.io.emit('device:offline', {
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
    // 命令下发
    // ============================================

    /**
     * 发送命令到指定设备
     */
    public sendCommand(deviceId: string, command: string, params?: any): boolean {
        const socket = this.deviceSockets.get(deviceId);

        if (!socket || !socket.connected) {
            logger.warn('[DeviceGateway] Cannot send command, device offline', { deviceId });
            return false;
        }

        socket.emit('command', { cmd: command, params, timestamp: Date.now() });

        logger.info('[DeviceGateway] Command sent', {
            deviceId,
            command,
            params,
        });

        return true;
    }

    /**
     * 广播命令到所有在线设备
     */
    public broadcastCommand(command: string, params?: any): number {
        let count = 0;

        this.deviceSockets.forEach((socket, deviceId) => {
            if (socket.connected) {
                socket.emit('command', { cmd: command, params, timestamp: Date.now() });
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
     * 获取在线设备数量
     */
    public getOnlineCount(): number {
        let count = 0;
        this.deviceSockets.forEach((socket) => {
            if (socket.connected) count++;
        });
        return count;
    }

    /**
     * 关闭网关
     */
    public close() {
        this.io.close();
        logger.info('[DeviceGateway] Closed');
    }
}

export default DeviceGateway;
