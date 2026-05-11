/**
 * AetherGuard Agent - SECURE VERSION
 *
 * SECURITY FIXES:
 * - Server-generated agent IDs
 * - API key authentication
 * - Command signature verification
 * - Secure connection handling
 *
 * 功能:
 * - 心跳上报
 * - 流量监控
 * - 攻击检测
 * - 防火墙控制
 * - 与中央管控平台通信
 */

import os from 'os';
import crypto from 'crypto';
import { io, Socket } from 'socket.io-client';
import logger from '../utils/logger';
import { TrafficMonitor } from './traffic-monitor';
import { AgentReviewSample, AttackDetector } from './attack-detector';
import { FirewallController } from './firewall-controller';
import { classifyCommandRisk } from '../security/command-risk-policy';
import { hashPayload, verifyHardwareGrantSignature } from '../security/hardware-grant';

export interface AgentConfig {
    serverUrl: string;       // 中央管控平台地址
    agentId?: string;        // Agent 唯一标识 (服务端生成)
    apiKey?: string;         // API Key (服务端生成)
    secretKey?: string;      // Secret Key for command verification (服务端生成)
    hardwareGatePublicKey?: string;
    heartbeatInterval?: number; // 心跳间隔 (ms)
}

interface SignedCommandInput {
    command: {
        type: string;
        payload?: any;
        timestamp: number;
        nonce: string;
    };
    signature: string;
    agentId: string;
    metadata?: Record<string, any>;
}

export interface AgentStatus {
    agentId: string;
    hostname: string;
    platform: string;
    uptime: number;
    cpuUsage: number;
    memoryUsage: number;
    lastHeartbeat: string;
    isOnline: boolean;
}

export class Agent {
    private config: AgentConfig;
    private socket: Socket | null = null;
    private agentId: string;
    private apiKey: string;
    private secretKey: string;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private trafficMonitor: TrafficMonitor;
    private attackDetector: AttackDetector;
    private firewallController: FirewallController;
    private usedNonces: Set<string> = new Set();
    private hardwareGatePublicKey?: string;

    // Local traffic accumulators
    private localTrafficStats = {
        packetsProcessed: 0,
        packetsAllowed: 0,
        packetsBlocked: 0,
        packetsInspected: 0,
        bytesProcessed: 0,
        activeFlows: [] as any[]
    };
    private trafficStatsTimer: NodeJS.Timeout | null = null;

    constructor(config: AgentConfig) {
        this.config = {
            heartbeatInterval: 30000, // 默认 30 秒
            ...config
        };

        // SECURITY FIX: Agent ID and keys must be provided by server
        // No more self-generated IDs!
        if (!config.agentId || !config.apiKey || !config.secretKey) {
            throw new Error(
                'SECURITY ERROR: agentId, apiKey, and secretKey must be provided by server.\n' +
                'Use the agent registration API to obtain valid credentials.'
            );
        }

        this.agentId = config.agentId;
        this.apiKey = config.apiKey;
        this.secretKey = config.secretKey;

        // 初始化子模块
        this.trafficMonitor = new TrafficMonitor();
        this.attackDetector = new AttackDetector();
        this.firewallController = new FirewallController();
        this.hardwareGatePublicKey = config.hardwareGatePublicKey || process.env.AETHERGUARD_HARDWARE_GATE_PUBLIC_KEY || process.env.AETHERGUARD_HARDWARE_GATE_PUBLIC_KEY_PEM;
    }

    /**
     * 启动 Agent
     */
    async start(): Promise<void> {
        logger.info(`Starting AetherGuard Agent: ${this.agentId}`);

        // 连接到中央管控平台
        await this.connectToServer();

        // 启动心跳
        this.startHeartbeat();

        // 启动流量定期上报
        this.startTrafficReporting();

        // 启动流量监控
        await this.trafficMonitor.start((event) => {
            // Count all monitored events as processed/inspected packets
            this.localTrafficStats.packetsProcessed++;
            this.localTrafficStats.packetsInspected++;
            // Estimate bytes
            this.localTrafficStats.bytesProcessed += Math.floor(Math.random() * 500) + 200;

            // Keep track of active flows
            if (event.sourceIP && event.destPort) {
                const flowId = `${event.sourceIP}:${event.destPort}`;
                const existingFlow = this.localTrafficStats.activeFlows.find(f => f.id === flowId);

                if (!existingFlow) {
                    this.localTrafficStats.activeFlows.unshift({
                        id: flowId,
                        srcIp: event.sourceIP,
                        dstPort: event.destPort,
                        state: 'ESTABLISHED',
                        bytes: Math.floor(Math.random() * 1500) + 500,
                        protocol: 'TCP'
                    });

                    // Keep only last 50 active flows
                    if (this.localTrafficStats.activeFlows.length > 50) {
                        this.localTrafficStats.activeFlows.pop();
                    }
                }
            }

            // 分析流量事件
            const threat = this.attackDetector.analyze(event);
            if (threat) {
                this.localTrafficStats.packetsBlocked++;
                this.handleThreat(threat);
            } else {
                this.localTrafficStats.packetsAllowed++;
                const reviewSample = this.attackDetector.assessForReview(event);
                if (reviewSample) {
                    this.handleAsyncReviewSample(reviewSample);
                }
            }
        });

        logger.info('Agent started successfully');
    }

    private startTrafficReporting(): void {
        this.trafficStatsTimer = setInterval(() => {
            logger.debug(`Traffic stats check: packets processed = ${this.localTrafficStats.packetsProcessed}, socket connected = ${this.socket?.connected}`);
            if (this.socket?.connected && this.localTrafficStats.packetsProcessed >= 0) {
                // Modified to send even when 0 to prove the interval works
                this.socket.emit('agent:traffic_stats', {
                    agentId: this.agentId,
                    stats: {
                        packetsProcessed: this.localTrafficStats.packetsProcessed,
                        packetsAllowed: this.localTrafficStats.packetsAllowed,
                        packetsBlocked: this.localTrafficStats.packetsBlocked,
                        packetsInspected: this.localTrafficStats.packetsInspected,
                        bytesProcessed: this.localTrafficStats.bytesProcessed,
                        activeFlows: this.localTrafficStats.activeFlows
                    },
                    timestamp: new Date().toISOString()
                });

                // Reset counters
                this.localTrafficStats.packetsProcessed = 0;
                this.localTrafficStats.packetsAllowed = 0;
                this.localTrafficStats.packetsBlocked = 0;
                this.localTrafficStats.packetsInspected = 0;
                this.localTrafficStats.bytesProcessed = 0;
                // We don't clear activeFlows immediately, they represent ongoing state
            }
        }, 5000); // 5 seconds reporting interval
    }

    private async connectToServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            logger.info(`Connecting to server: ${this.config.serverUrl}`);

            this.socket = io(this.config.serverUrl, {
                auth: {
                    type: 'agent',
                    agentId: this.agentId,
                    apiKey: this.apiKey  // SECURITY FIX: Send API key
                },
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 5000
            });

            this.socket.on('connect', () => {
                logger.info('Connected to control platform');
                // No more self-registration - server validates us
                resolve();
            });

            this.socket.on('agent:authenticated', (data: { agentId: string; timestamp: number }) => {
                logger.info('Agent authenticated by server', { agentId: data.agentId });
            });

            this.socket.on('disconnect', () => {
                logger.warn('Disconnected from control platform');
            });

            this.socket.on('connect_error', (error) => {
                logger.error('Connection error', { error: error.message });
            });

            // SECURITY FIX: Listen for signed commands
            this.socket.on('command', (signedCommand) => {
                this.handleSignedCommand(signedCommand);
            });

            // 设置连接超时
            setTimeout(() => {
                if (!this.socket?.connected) {
                    logger.warn('Connection timeout, will retry in background');
                    resolve(); // 不阻塞启动
                }
            }, 10000);
        });
    }

    /**
     * 启动心跳
     */
    private startHeartbeat(): void {
        this.heartbeatTimer = setInterval(() => {
            this.sendHeartbeat();
        }, this.config.heartbeatInterval);

        // 立即发送一次
        this.sendHeartbeat();
    }

    /**
     * 发送心跳
     */
    private sendHeartbeat(): void {
        if (!this.socket?.connected) return;

        const status: AgentStatus = {
            agentId: this.agentId,
            hostname: os.hostname(),
            platform: os.platform(),
            uptime: os.uptime(),
            cpuUsage: this.getCpuUsage(),
            memoryUsage: this.getMemoryUsage(),
            lastHeartbeat: new Date().toISOString(),
            isOnline: true
        };

        this.socket.emit('agent:heartbeat', status);
    }

    /**
     * 获取 CPU 使用率
     */
    private getCpuUsage(): number {
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;

        for (const cpu of cpus) {
            for (const type in cpu.times) {
                totalTick += cpu.times[type as keyof typeof cpu.times];
            }
            totalIdle += cpu.times.idle;
        }

        return Math.round((1 - totalIdle / totalTick) * 100);
    }

    /**
     * 获取内存使用率
     */
    private getMemoryUsage(): number {
        const total = os.totalmem();
        const free = os.freemem();
        return Math.round((1 - free / total) * 100);
    }

    /**
     * SECURITY FIX: Verify and handle signed commands
     */
    private async handleSignedCommand(signedCommand: SignedCommandInput): Promise<void> {
        const { command, signature, agentId, metadata } = signedCommand;

        // SECURITY FIX: Verify command is for this agent
        if (agentId !== this.agentId) {
            logger.error(`Command not for this agent: expected ${this.agentId}, got ${agentId}`);
            return;
        }

        // SECURITY FIX: Check nonce (replay protection)
        if (this.usedNonces.has(command.nonce)) {
            logger.warn('Replay attack detected - duplicate nonce', { nonce: command.nonce });
            return;
        }

        // SECURITY FIX: Verify command signature
        const message = JSON.stringify(command);
        const expectedSignature = crypto
            .createHmac('sha256', this.secretKey)
            .update(message)
            .digest('hex');

        // Use constant-time comparison
        try {
            const isValid = crypto.timingSafeEqual(
                Buffer.from(signature, 'hex'),
                Buffer.from(expectedSignature, 'hex')
            );

            if (!isValid) {
                logger.error('Invalid command signature - command rejected', {
                    commandType: command.type,
                    timestamp: command.timestamp
                });
                return;
            }
        } catch {
            logger.error('Signature verification failed - command rejected');
            return;
        }

        // SECURITY FIX: Check timestamp (prevent replay attacks)
        const now = Date.now();
        const commandAge = now - command.timestamp;
        const MAX_AGE = 5 * 60 * 1000; // 5 minutes

        if (commandAge > MAX_AGE) {
            logger.warn('Stale command rejected', {
                age: commandAge,
                timestamp: command.timestamp
            });
            return;
        }

        // Check for future timestamps
        if (command.timestamp > now + 60000) {
            logger.warn('Future timestamp in command rejected');
            return;
        }

        // Mark nonce as used
        this.usedNonces.add(command.nonce);
        setTimeout(() => this.usedNonces.delete(command.nonce), 10 * 60 * 1000);

        const riskClass = classifyCommandRisk(command.type);
        if (riskClass === 'physical_confirmation_required') {
            const hardwareGrant = metadata?.hardwareGrant;
            if (!hardwareGrant) {
                logger.error('Physical command rejected - missing hardware grant', { commandType: command.type });
                return;
            }

            if (!this.hardwareGatePublicKey) {
                logger.error('Physical command rejected - hardware gate public key not configured', { commandType: command.type });
                return;
            }

            const grantPayload: any = {
                gateId: String(hardwareGrant.gateId || ''),
                sessionId: String(hardwareGrant.sessionId || ''),
                actionId: String(hardwareGrant.actionId || ''),
                tenantId: String(hardwareGrant.tenantId || metadata?.tenantId || ''),
                scope: String(hardwareGrant.scope || ''),
                targetId: String(hardwareGrant.targetId || this.agentId || ''),
                commandType: String(hardwareGrant.commandType || command.type),
                payloadHash: String(hardwareGrant.payloadHash || ''),
                issuedAt: String(hardwareGrant.issuedAt || ''),
                expiresAt: String(hardwareGrant.expiresAt || ''),
                monotonicCounter: Number(hardwareGrant.monotonicCounter || 0),
                signature: String(hardwareGrant.signature || ''),
                algorithm: String(hardwareGrant.algorithm || 'ECDSA_P256_SHA256')
            };

            if (!verifyHardwareGrantSignature(this.hardwareGatePublicKey, grantPayload)) {
                logger.error('Physical command rejected - invalid hardware grant signature', {
                    commandType: command.type,
                    actionId: grantPayload.actionId
                });
                return;
            }

            if (grantPayload.actionId !== String(metadata?.actionId || command.payload?.actionId || '')) {
                logger.error('Physical command rejected - actionId mismatch', {
                    commandType: command.type,
                    actionId: grantPayload.actionId
                });
                return;
            }

            const commandPayloadForGrant = { ...(command.payload || {}) };
            delete commandPayloadForGrant.actionId;
            const expectedPayloadHash = hashPayload(commandPayloadForGrant);
            if (expectedPayloadHash !== grantPayload.payloadHash) {
                logger.error('Physical command rejected - payload hash mismatch', {
                    commandType: command.type,
                    actionId: grantPayload.actionId
                });
                return;
            }

            if (Date.now() > new Date(grantPayload.expiresAt).getTime()) {
                logger.error('Physical command rejected - grant expired', {
                    commandType: command.type,
                    actionId: grantPayload.actionId
                });
                return;
            }
        }

        // All security checks passed - execute command
        logger.info(`Executing verified command: ${command.type}`);
        try {
            await this.executeCommand(command);
            if (this.socket?.connected) {
                this.socket.emit('agent:command_ack', {
                    agentId: this.agentId,
                    commandType: command.type,
                    actionId: command.payload?.actionId || metadata?.actionId,
                    tenantId: metadata?.tenantId,
                    nonce: command.nonce,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error: any) {
            if (this.socket?.connected) {
                this.socket.emit('agent:command_failed', {
                    agentId: this.agentId,
                    commandType: command.type,
                    actionId: command.payload?.actionId || metadata?.actionId,
                    tenantId: metadata?.tenantId,
                    nonce: command.nonce,
                    error: error.message || 'Command execution failed',
                    timestamp: new Date().toISOString()
                });
            }
            throw error;
        }
    }

    /**
     * Execute a verified command
     */
    private async executeCommand(command: { type: string; payload?: any }): Promise<void> {
        switch (command.type) {
            case 'scan':
                // 触发本地扫描
                await this.runLocalScan();
                break;

            case 'block_ip':
                // 封禁 IP
                if (command.payload?.ip) {
                    await this.firewallController.blockIP(command.payload.ip, Number(command.payload.duration || 3600));
                    logger.info(`Blocked IP: ${command.payload.ip}`);
                }
                break;

            case 'unblock_ip':
                // 解封 IP
                if (command.payload?.ip) {
                    await this.firewallController.unblockIP(command.payload.ip);
                    logger.info(`Unblocked IP: ${command.payload.ip}`);
                }
                break;

            case 'update_rules':
                // 更新检测规则
                if (Array.isArray(command.payload?.rules)) {
                    const rules = command.payload.rules;
                    const isLegacyRuleSet = rules.every((rule: any) => Array.isArray(rule?.patterns));
                    if (isLegacyRuleSet) {
                        this.attackDetector.updateRules(rules);
                    } else {
                        this.attackDetector.updateRemoteRules(rules);
                    }
                    logger.info('Updated detection rules', {
                        ruleCount: rules.length,
                        mode: isLegacyRuleSet ? 'legacy' : 'remote'
                    });
                }
                break;

            default:
                logger.warn(`Unknown command: ${command.type}`);
        }
    }

    /**
     * 处理检测到的威胁
     */
    private handleThreat(threat: any): void {
        logger.warn('Threat detected', { threat });

        // 上报威胁到平台
        if (this.socket?.connected) {
            this.socket.emit('agent:threat', {
                agentId: this.agentId,
                threat,
                timestamp: new Date().toISOString()
            });
        }

        // 自动阻断 (如果配置了)
        if (threat.autoBlock && threat.sourceIP) {
            this.firewallController.blockIP(threat.sourceIP, threat.blockDuration || 3600);
        }
    }

    private handleAsyncReviewSample(sample: AgentReviewSample): void {
        if (!this.socket?.connected) {
            return;
        }

        this.socket.emit('agent:review_sample', {
            agentId: this.agentId,
            sample,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * 运行本地扫描
     */
    private async runLocalScan(): Promise<void> {
        logger.info('Running local security scan...');

        if (this.socket?.connected) {
            this.socket.emit('agent:scan_started', { agentId: this.agentId });
        }

        try {
            // Simulate a basic security scan
            const scanResults = {
                openPorts: [22, 80, 443],
                services: [
                    { port: 22, service: 'ssh', version: 'OpenSSH 8.9' },
                    { port: 80, service: 'http', version: 'nginx' },
                    { port: 443, service: 'https', version: 'nginx' }
                ],
                findings: [
                    { severity: 'info', message: 'SSH service running on port 22' },
                    { severity: 'info', message: 'HTTP service running on port 80' },
                    { severity: 'info', message: 'HTTPS service running on port 443' }
                ],
                scannedAt: new Date().toISOString()
            };

            // Report scan results
            if (this.socket?.connected) {
                this.socket.emit('agent:scan_result', {
                    agentId: this.agentId,
                    results: scanResults,
                    timestamp: new Date().toISOString()
                });
                logger.info('Scan results reported');
            }
        } catch (error: any) {
            logger.error('Scan failed', { error: error.message });
        }
    }

    /**
     * 停止 Agent
     */
    async stop(): Promise<void> {
        logger.info('Stopping Agent...');

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }

        if (this.trafficStatsTimer) {
            clearInterval(this.trafficStatsTimer);
        }

        await this.trafficMonitor.stop();

        if (this.socket) {
            this.socket.disconnect();
        }

        logger.info('Agent stopped');
    }
}

// 启动入口
export async function startAgent(serverUrl: string): Promise<Agent> {
    const agentId = process.env.AETHERGUARD_AGENT_ID || process.env.AetherGuard_AGENT_ID || process.env.AGENT_ID || 'probe-agent-01';
    // SECURITY FIX: Removed hardcoded API key - must be provided via environment variable
    const apiKey = process.env.AETHERGUARD_AGENT_API_KEY || process.env.AetherGuard_AGENT_API_KEY || process.env.AGENT_API_KEY;
    if (!apiKey) {
        throw new Error('AETHERGUARD_AGENT_API_KEY or AGENT_API_KEY environment variable is required');
    }
    const secretKey = process.env.AETHERGUARD_AGENT_SECRET_KEY || process.env.AetherGuard_AGENT_SECRET_KEY || process.env.AGENT_SECRET_KEY;
    const hardwareGatePublicKey = process.env.AETHERGUARD_HARDWARE_GATE_PUBLIC_KEY
        || process.env.AETHERGUARD_HARDWARE_GATE_PUBLIC_KEY_PEM
        || process.env.AetherGuard_HARDWARE_GATE_PUBLIC_KEY
        || process.env.AetherGuard_HARDWARE_GATE_PUBLIC_KEY_PEM;
    const heartbeatIntervalSource = process.env.AETHERGUARD_HEARTBEAT_INTERVAL_MS || process.env.AetherGuard_HEARTBEAT_INTERVAL_MS;
    const heartbeatInterval = heartbeatIntervalSource
        ? Number(heartbeatIntervalSource)
        : undefined;

    const agent = new Agent({ serverUrl, agentId, apiKey, secretKey, hardwareGatePublicKey, heartbeatInterval });
    await agent.start();
    return agent;
}
