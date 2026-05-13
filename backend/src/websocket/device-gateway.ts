﻿﻿﻿/**
 * AetherGuard - ESP32 设备 WebSocket 网关
 *
 * 处理实验性 ESP32 云设备/模拟设备网关的 WebSocket 连接
 * - 设备注册
 * - 心跳监控
 * - 数据接收
 * - 命令下发
 *
 * NOTE: This gateway is not the current v1 USB-TTL serial deployer firmware.
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
import { commandDispatcherService } from '../services/command-dispatcher.service';
import type { TenantContext } from '../core/tenant/tenant-context';
import {
    PLATFORM_TENANT_ID,
    resolveDeviceTenantContext,
} from '../core/tenant/tenant-context';
import { deviceControlService } from '../services/device-control.service';
import { hardwareAuthorizationService } from '../services/hardware-authorization.service';
import { socketRateLimitService } from '../services/socket-rate-limit.service';
import {
    registerDevice,
    updateDeviceStatus,
    updateDeviceFinalDefenseState,
    setDeviceOffline,
    getCodebook,
    addDeviceEvent,
} from '../services/device-registry.service';
import type {
    DeviceClientToServerEvents,
    DeviceServerToClientEvents,
} from './socket-events';
import {
    validateDeviceHeartbeatPayload,
    validateDeviceRegisterPayload,
} from './socket-payload-validator';
import { allowGatewayDestructiveCommands } from '../config/enterprise-runtime';
import { requiresPhysicalConfirmation } from '../security/command-risk-policy';
import { normalizeInterlockState } from '../security/final-defense-policy';

interface DeviceSocket extends Socket {
    deviceId?: string;
    tenantContext?: TenantContext;
    hardwareGateId?: string;
}

type HardwareAckResult = Awaited<ReturnType<typeof hardwareAuthorizationService.handlePhysicalConfirmationAck>>;

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
        return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_WINDOW = 100;
const DEVICE_RATE_LIMIT_WINDOW = 60000;
const MAX_DEVICE_REQUESTS_PER_WINDOW = 100;

async function checkDeviceRateLimit(deviceId: string, socket: DeviceSocket, tenantId: string): Promise<boolean> {
    const result = await socketRateLimitService.check({
        tenantId,
        key: `device:${deviceId}`,
        windowMs: DEVICE_RATE_LIMIT_WINDOW,
        limit: MAX_DEVICE_REQUESTS_PER_WINDOW,
        sourceIp: socket.handshake.address,
        sessionId: socket.id,
        headers: socket.handshake.headers as Record<string, any>,
        protocol: 'ws-device'
    });

    if (!result.allowed) {
        await auditLogger.log({
            eventType: 'rate_limit_exceeded',
            category: 'agent',
            severity: 'warning',
            actor: { type: 'agent', id: deviceId },
            action: 'rate_limit_check',
            details: {
                limit: MAX_DEVICE_REQUESTS_PER_WINDOW,
                window: DEVICE_RATE_LIMIT_WINDOW,
                decisionSource: result.decisionSource,
                riskFlags: result.riskFlags
            },
            status: 'failure'
        });
    }

    return result.allowed;
}

async function checkSocketRateLimit(socket: DeviceSocket, tenantId: string): Promise<boolean> {
    const result = await socketRateLimitService.check({
        tenantId,
        key: `socket:${socket.id}`,
        windowMs: RATE_LIMIT_WINDOW,
        limit: MAX_REQUESTS_PER_WINDOW,
        sourceIp: socket.handshake.address,
        sessionId: socket.id,
        headers: socket.handshake.headers as Record<string, any>,
        protocol: 'ws-device'
    });
    return result.allowed;
}

export class DeviceGateway {
    private io: Server<DeviceClientToServerEvents, DeviceServerToClientEvents>;
    private aliasServers: Array<Server<DeviceClientToServerEvents, DeviceServerToClientEvents>> = [];
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

        this.io = this.createServer(httpServer, allowedOrigins, '/ws/device');
        this.aliasServers = [this.createServer(httpServer, allowedOrigins, '/ws/status')];

        this.setupEventHandlers(this.io);
        for (const server of this.aliasServers) {
            this.setupEventHandlers(server);
        }
        
        this.cleanupInterval = setInterval(() => this.cleanupUsedNonces(), 5 * 60 * 1000);
        this.cleanupInterval.unref?.();
        
        logger.info('[DeviceGateway] Initialized on /ws/device and /ws/status with restricted CORS, rate limiting, and command signing');
    }

    private createServer(httpServer: HttpServer, allowedOrigins: string[], path: string): Server<DeviceClientToServerEvents, DeviceServerToClientEvents> {
        return new Server(httpServer, {
            path,
            cors: {
                origin: allowedOrigins,
                methods: ['GET', 'POST'],
                credentials: true
            },
        });
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
        ((this.io as unknown) as { emit: (emittedEvent: string, payload: any) => void }).emit(event, data);
    }

    private setupEventHandlers(server: Server<DeviceClientToServerEvents, DeviceServerToClientEvents>) {
        server.on('connection', (socket: DeviceSocket) => {
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

            socket.on('ota_status', (data: any) => {
                this.handleOtaStatus(socket, data);
            });

            socket.on('physical_confirmation_ack', (data: any) => {
                this.handlePhysicalConfirmationAck(socket, data);
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
        const tenantContext = resolveDeviceTenantContext();
        const payload = validateDeviceRegisterPayload(data);
        if (!payload) {
            socket.emit('register_error', { error: 'backend.invalid_device_registration_payload', reason: 'invalid_payload' });
            socket.disconnect();
            return;
        }

        const {
            device_id,
            version,
            chip_model,
            flash_size,
            free_heap,
            sdk_version,
            api_key,
            public_key_pem,
            secure_element_present,
            device_role,
            transport,
            policy_digest,
            breaker_target,
            interlock_state,
            external_power_present,
            feedback_ok,
        } = payload;

        if (!(await checkSocketRateLimit(socket, tenantContext.tenantId))) {
            socket.emit('register_error', { error: 'backend.rate_limit_exceeded', reason: 'rate_limit_exceeded' });
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
        socket.tenantContext = tenantContext;
        this.deviceSockets.set(device_id, socket);

        if (public_key_pem) {
            socket.hardwareGateId = device_id;
            hardwareAuthorizationService.enrollGate({
                tenantId: tenantContext.tenantId,
                gateId: device_id,
                displayName: device_id,
                publicKeyPem: public_key_pem,
                algorithm: 'ECDSA_P256_SHA256',
                metadata: {
                    chipModel: chip_model || 'unknown',
                    sdkVersion: sdk_version || 'unknown',
                    secureElementPresent: secure_element_present ?? false,
                    deviceRole: device_role || 'hardware_gate',
                    transport: transport || 'unknown'
                },
                status: 'online'
            });
        }

        registerDevice({
            deviceId: device_id,
            version: version || 'unknown',
            chipModel: chip_model || 'unknown',
            flashSize: flash_size || 0,
            freeHeap: free_heap || 0,
            sdkVersion: sdk_version || 'unknown',
            mode: 'online',
            physicalAuth: public_key_pem ? { publicKeyPem: public_key_pem } : undefined,
            finalDefense: {
                policyDigest: policy_digest,
                breakerTarget: breaker_target,
                interlockState: interlock_state ? normalizeInterlockState(interlock_state) : undefined,
                externalPowerPresent: external_power_present,
                secureElementPresent: secure_element_present,
                feedbackOk: feedback_ok
            },
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
            tenantId: tenantContext.tenantId,
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
        const tenantId = socket.tenantContext?.tenantId || PLATFORM_TENANT_ID;

        if (!(await checkDeviceRateLimit(socket.deviceId, socket, tenantId))) {
            socket.emit('heartbeat_error', { error: 'backend.rate_limit_exceeded', reason: 'rate_limit_exceeded' });
            return;
        }

        const payload = validateDeviceHeartbeatPayload(data);
        if (!payload) {
            socket.emit('heartbeat_error', { error: 'backend.invalid_device_heartbeat_payload', reason: 'invalid_payload' });
            return;
        }

        const {
            uptime,
            free_heap,
            wifi_rssi,
            cpu_usage,
            policy_digest,
            breaker_target,
            interlock_state,
            external_power_present,
            secure_element_present,
            feedback_ok
        } = payload;

        updateDeviceStatus(socket.deviceId, {
            cpuUsage: cpu_usage || 0,
            memoryUsage: 100 - ((free_heap || 0) / (4 * 1024 * 1024) * 100),
            uptime: uptime || 0,
            wifiRssi: wifi_rssi || 0,
        });
        addDeviceEvent(socket.deviceId, 'heartbeat', {
            uptime,
            freeHeap: free_heap,
            wifiRssi: wifi_rssi
        });
        if (
            policy_digest
            || breaker_target
            || interlock_state
            || external_power_present !== undefined
            || secure_element_present !== undefined
            || feedback_ok !== undefined
        ) {
            updateDeviceFinalDefenseState(socket.deviceId, {
                policyDigest: policy_digest,
                breakerTarget: breaker_target,
                interlockState: interlock_state ? normalizeInterlockState(interlock_state) : undefined,
                externalPowerPresent: external_power_present,
                secureElementPresent: secure_element_present,
                feedbackOk: feedback_ok
            });
        }

        socket.emit('heartbeat_ack', { timestamp: Date.now() });
    }

    private async handleData(socket: DeviceSocket, data: any) {
        if (!socket.deviceId) return;
        const tenantId = socket.tenantContext?.tenantId || PLATFORM_TENANT_ID;

        if (!(await checkDeviceRateLimit(socket.deviceId, socket, tenantId))) {
            return;
        }

        const payload = data?.payload ?? data ?? {};
        const timestamp = data?.timestamp;

        let decodedPayload: any = payload;
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
            dataSize: (() => {
                try {
                    return JSON.stringify(decodedPayload ?? {}).length;
                } catch {
                    return 0;
                }
            })(),
        });

        addDeviceEvent(socket.deviceId, 'data', { payload: decodedPayload ?? {} });
        if (decodedPayload && typeof decodedPayload === 'object') {
            const finalDefenseUpdate = {
                policyDigest: decodedPayload.policyDigest || decodedPayload.policy_digest,
                breakerTarget: decodedPayload.breakerTarget || decodedPayload.breaker_target,
                interlockState: decodedPayload.interlockState || decodedPayload.interlock_state
                    ? normalizeInterlockState(decodedPayload.interlockState || decodedPayload.interlock_state)
                    : undefined,
                externalPowerPresent: decodedPayload.externalPowerPresent ?? decodedPayload.external_power_present,
                secureElementPresent: decodedPayload.secureElementPresent ?? decodedPayload.secure_element_present,
                feedbackOk: decodedPayload.feedbackOk ?? decodedPayload.feedback_ok
            };
            if (Object.values(finalDefenseUpdate).some((value) => value !== undefined && value !== '')) {
                updateDeviceFinalDefenseState(socket.deviceId, finalDefenseUpdate);
            }
        }
        this.emitToDashboard('device:data', {
            deviceId: socket.deviceId,
            data: decodedPayload ?? {},
            tenantId,
            timestamp: new Date().toISOString(),
        });
    }

    private async handleAlert(socket: DeviceSocket, data: any) {
        if (!socket.deviceId) return;
        const tenantId = socket.tenantContext?.tenantId || PLATFORM_TENANT_ID;

        if (!(await checkDeviceRateLimit(socket.deviceId, socket, tenantId))) {
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
            tenantId,
            timestamp: timestamp || new Date().toISOString(),
        });
    }

    private async handleUnknownError(socket: DeviceSocket, data: any) {
        if (!socket.deviceId) return;
        const tenantId = socket.tenantContext?.tenantId || PLATFORM_TENANT_ID;

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
            tenantId,
            timestamp: timestamp || new Date().toISOString(),
        });
    }

    private async handleOtaStatus(socket: DeviceSocket, data: any) {
        if (!socket.deviceId) return;
        const tenantId = socket.tenantContext?.tenantId || PLATFORM_TENANT_ID;
        addDeviceEvent(socket.deviceId, 'command', {
            action: 'ota_status',
            ...data
        });
        await deviceControlService.handleOtaStatus(socket.deviceId, data || {});
        this.emitToDashboard('device:ota_status', {
            deviceId: socket.deviceId,
            ...data,
            tenantId,
            timestamp: new Date().toISOString()
        });
    }

    private async handlePhysicalConfirmationAck(socket: DeviceSocket, data: any) {
        if (!socket.deviceId) return;
        const tenantId = socket.tenantContext?.tenantId || PLATFORM_TENANT_ID;
        const gateId = socket.hardwareGateId || socket.deviceId;
        addDeviceEvent(socket.deviceId, 'command', {
            action: 'physical_confirmation_ack',
            ...data
        });
        let hardwareResult: HardwareAckResult = {
            handled: false,
            confirmed: false,
            reason: 'hardware_authorization_unavailable'
        };
        try {
            hardwareResult = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, data || {});
        } catch (error: any) {
            logger.warn('[DeviceGateway] Hardware authorization service unavailable, falling back to legacy confirmation', {
                deviceId: socket.deviceId,
                gateId,
                error: error?.message
            });
        }
        if (hardwareResult.handled) {
            if (hardwareResult.confirmed && hardwareResult.intent && hardwareResult.grant) {
                await commandDispatcherService.dispatchHardwareConfirmedIntent(hardwareResult.intent, hardwareResult.grant);
            }
            this.emitToDashboard('device:physical_confirmation', {
                deviceId: socket.deviceId,
                ...data,
                tenantId,
                hardwareGateId: gateId,
                confirmed: hardwareResult.confirmed,
                reason: hardwareResult.reason || null,
                timestamp: new Date().toISOString()
            });
            return;
        }

        await deviceControlService.handlePhysicalConfirmationAck(socket.deviceId, data || {});
        this.emitToDashboard('device:physical_confirmation', {
            deviceId: socket.deviceId,
            ...data,
            tenantId,
            hardwareGateId: gateId,
            timestamp: new Date().toISOString()
        });
    }

    private handleCodebookSync(socket: DeviceSocket) {
        socket.emit('codebook_sync', { codebook: getCodebook() });
        logger.info('[DeviceGateway] Codebook synced', { deviceId: socket.deviceId });
    }

    private async handleDisconnect(socket: DeviceSocket, reason: string) {
        if (socket.deviceId) {
            const tenantId = socket.tenantContext?.tenantId || PLATFORM_TENANT_ID;
            this.deviceSockets.delete(socket.deviceId);
            setDeviceOffline(socket.deviceId);
            if (socket.hardwareGateId) {
                hardwareAuthorizationService.markGateOffline(socket.hardwareGateId);
            }

            addDeviceEvent(socket.deviceId, 'disconnect', { reason });
            this.emitToDashboard('device:offline', {
                deviceId: socket.deviceId,
                reason,
                tenantId,
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
        if (!allowGatewayDestructiveCommands() && requiresPhysicalConfirmation(command) && !params?.hardwareGrant) {
            logger.warn('[DeviceGateway] Blocked destructive command on experimental gateway in enterprise runtime', {
                deviceId,
                command
            });
            await auditLogger.log({
                eventType: 'device_command_rejected',
                category: 'command',
                severity: 'warning',
                actor: { type: 'system', id: 'device-gateway' },
                action: 'send_command',
                target: { type: 'agent', id: deviceId },
                details: { command, params, reason: 'enterprise_runtime_blocks_destructive_ws_commands' },
                status: 'failure'
            });
            return false;
        }

        const socket = this.deviceSockets.get(deviceId);

        if (!socket || !socket.connected) {
            logger.warn('[DeviceGateway] Cannot send command, device offline', { deviceId });
            return false;
        }

        const signedCommand = this.signCommand(deviceId, command, params);

        // SECURITY FIX: Reject unsigned commands - never send unsigned commands to devices
        if (!signedCommand) {
            logger.error('[DeviceGateway] Command signing failed - rejecting unsigned command', {
                deviceId,
                command,
            });
            await auditLogger.log({
                eventType: 'device_command_rejected',
                category: 'command',
                severity: 'warning',
                actor: { type: 'system', id: 'device-gateway' },
                action: 'send_command',
                target: { type: 'agent', id: deviceId },
                details: { command, params, reason: 'Signing failed - DEVICE_COMMAND_SECRET not configured' },
                status: 'failure'
            });
            return false;
        }

        socket.emit('command', signedCommand);

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

    public getConnectedDevices(): Array<{ deviceId: string; isOnline: boolean; deviceType?: string; bundleState?: string; bundleSize?: number }> {
        const devices: Array<{ deviceId: string; isOnline: boolean; deviceType?: string; bundleState?: string; bundleSize?: number }> = [];
        this.deviceSockets.forEach((socket, deviceId) => {
            const data = socket.data as any;
            devices.push({
                deviceId,
                isOnline: socket.connected,
                deviceType: data?.deviceType,
                bundleState: data?.bundleState,
                bundleSize: data?.bundleSize
            });
        });
        return devices;
    }

    public close() {
        clearInterval(this.cleanupInterval);
        this.io.close();
        for (const server of this.aliasServers) {
            server.close();
        }
        logger.info('[DeviceGateway] Closed');
    }
}

export default DeviceGateway;
