/**
 * FluxGuard Agent - 轻量级安全防护代理
 * 
 * 功能:
 * - 心跳上报
 * - 流量监控
 * - 攻击检测
 * - 防火墙控制
 * - 与中央管控平台通信
 */

import os from 'os';
import { io, Socket } from 'socket.io-client';
import logger from '../utils/logger';
import { TrafficMonitor } from './traffic-monitor';
import { AttackDetector } from './attack-detector';
import { FirewallController } from './firewall-controller';

export interface AgentConfig {
    serverUrl: string;       // 中央管控平台地址
    agentId?: string;        // Agent 唯一标识 (自动生成)
    heartbeatInterval?: number; // 心跳间隔 (ms)
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
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private trafficMonitor: TrafficMonitor;
    private attackDetector: AttackDetector;
    private firewallController: FirewallController;

    constructor(config: AgentConfig) {
        this.config = {
            heartbeatInterval: 30000, // 默认 30 秒
            ...config
        };

        // 生成唯一 Agent ID (基于主机名 + MAC 地址)
        this.agentId = config.agentId || this.generateAgentId();

        // 初始化子模块
        this.trafficMonitor = new TrafficMonitor();
        this.attackDetector = new AttackDetector();
        this.firewallController = new FirewallController();
    }

    /**
     * 生成唯一 Agent ID
     */
    private generateAgentId(): string {
        const hostname = os.hostname();
        const interfaces = os.networkInterfaces();
        let mac = 'unknown';

        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name] || []) {
                if (!iface.internal && iface.mac !== '00:00:00:00:00:00') {
                    mac = iface.mac.replace(/:/g, '');
                    break;
                }
            }
        }

        return `agent-${hostname}-${mac.substring(0, 8)}`;
    }

    /**
     * 启动 Agent
     */
    async start(): Promise<void> {
        logger.info(`Starting FluxGuard Agent: ${this.agentId}`);

        // 连接到中央管控平台
        await this.connectToServer();

        // 启动心跳
        this.startHeartbeat();

        // 启动流量监控
        await this.trafficMonitor.start((event) => {
            // 分析流量事件
            const threat = this.attackDetector.analyze(event);
            if (threat) {
                this.handleThreat(threat);
            }
        });

        logger.info('Agent started successfully');
    }

    /**
     * 连接到中央管控平台
     */
    private async connectToServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            logger.info(`Connecting to server: ${this.config.serverUrl}`);

            this.socket = io(this.config.serverUrl, {
                auth: { agentId: this.agentId },
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 5000
            });

            this.socket.on('connect', () => {
                logger.info('Connected to control platform');
                this.registerAgent();
                resolve();
            });

            this.socket.on('disconnect', () => {
                logger.warn('Disconnected from control platform');
            });

            this.socket.on('connect_error', (error) => {
                logger.error('Connection error', { error: error.message });
            });

            // 监听来自平台的指令
            this.socket.on('command', (command) => {
                this.handleCommand(command);
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
     * 向平台注册 Agent
     */
    private registerAgent(): void {
        if (!this.socket) return;

        const registration = {
            agentId: this.agentId,
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            cpus: os.cpus().length,
            totalMemory: os.totalmem(),
            version: '1.0.0'
        };

        this.socket.emit('agent:register', registration);
        logger.info('Agent registered with platform');
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
     * 处理来自平台的指令
     */
    private async handleCommand(command: { type: string; payload?: any }): Promise<void> {
        logger.info(`Received command: ${command.type}`);

        switch (command.type) {
            case 'scan':
                // 触发本地扫描
                await this.runLocalScan();
                break;

            case 'block_ip':
                // 封禁 IP
                if (command.payload?.ip) {
                    await this.firewallController.blockIP(command.payload.ip);
                }
                break;

            case 'unblock_ip':
                // 解封 IP
                if (command.payload?.ip) {
                    await this.firewallController.unblockIP(command.payload.ip);
                }
                break;

            case 'update_rules':
                // 更新检测规则
                if (command.payload?.rules) {
                    this.attackDetector.updateRules(command.payload.rules);
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

    /**
     * 运行本地扫描
     */
    private async runLocalScan(): Promise<void> {
        logger.info('Running local security scan...');

        // 这里可以调用现有的 Scanner 模块
        // 结果通过 WebSocket 上报

        if (this.socket?.connected) {
            this.socket.emit('agent:scan_started', { agentId: this.agentId });
        }

        // TODO: 集成现有 Scanner
    }

    /**
     * 停止 Agent
     */
    async stop(): Promise<void> {
        logger.info('Stopping Agent...');

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
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
    const agent = new Agent({ serverUrl });
    await agent.start();
    return agent;
}
