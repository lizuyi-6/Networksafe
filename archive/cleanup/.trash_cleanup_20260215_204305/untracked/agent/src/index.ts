/**
 * FluxGuard Probe Agent
 * 
 * Collects real system metrics from the host environment
 * and sends them to the FluxGuard Backend via WebSocket
 */

import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

interface SystemMetrics {
    cpu: {
        usage: number;
        loadAverage: number[];
        cores: number;
        model: string;
    };
    memory: {
        total: number;
        used: number;
        free: number;
        usagePercent: number;
    };
    disk: {
        total: number;
        used: number;
        free: number;
        usagePercent: number;
    };
    network: {
        interfaces: string[];
        hostname: string;
        platform: string;
        arch: string;
        uptime: number;
    };
    process: {
        pid: number;
        memoryUsage: NodeJS.MemoryUsage;
        uptime: number;
    };
}

interface AgentConfig {
    agentId: string;
    serverUrl: string;
    hostname: string;
    heartbeatInterval: number;
    metricsInterval: number;
}

class ProbeAgent {
    private config: AgentConfig;
    private socket: Socket;
    private connected: boolean = false;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private metricsTimer: NodeJS.Timeout | null = null;
    private lastCpuInfo: { idle: number; total: number } | null = null;

    constructor() {
        const agentId = process.env.AGENT_ID || `probe-${uuidv4().substring(0, 8)}`;
        const serverUrl = process.env.BACKEND_URL || 'http://backend:3005';
        const hostname = process.env.HOSTNAME || os.hostname();
        const apiKey = process.env.AGENT_API_KEY;
        if (!apiKey) {
            throw new Error('AGENT_API_KEY is required. Refusing to start agent with default/demo credentials.');
        }

        this.config = {
            agentId,
            serverUrl,
            hostname,
            heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10),
            metricsInterval: parseInt(process.env.METRICS_INTERVAL || '10000', 10)
        };

        console.log('═══════════════════════════════════════════════');
        console.log('       FluxGuard Probe Agent');
        console.log('═══════════════════════════════════════════════');
        console.log(`Agent ID: ${this.config.agentId}`);
        console.log(`Server:   ${this.config.serverUrl}`);
        console.log(`Hostname: ${this.config.hostname}`);
        console.log('═══════════════════════════════════════════════\n');

        this.socket = io(this.config.serverUrl, {
            transports: ['websocket'],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            auth: {
                type: 'agent',
                agentId: this.config.agentId,
                apiKey: apiKey
            }
        });

        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.socket.on('connect', () => {
            console.log('✅ Connected to FluxGuard Backend');
            this.connected = true;
            this.register();
            this.startHeartbeat();
            this.startMetricsCollection();
        });

        this.socket.on('disconnect', (reason) => {
            console.log(`❌ Disconnected: ${reason}`);
            this.connected = false;
            this.stopHeartbeat();
            this.stopMetricsCollection();
        });

        this.socket.on('connect_error', (error) => {
            console.log(`⚠️ Connection error: ${error.message}`);
        });

        this.socket.on('command', (cmd: any) => {
            console.log(`📥 Received command: ${cmd.type}`);
            this.handleCommand(cmd);
        });

        this.socket.on('agent:registered', (data: any) => {
            console.log('📝 Agent registration confirmed:', data);
        });
    }

    private register(): void {
        const registration = {
            agentId: this.config.agentId,
            hostname: this.config.hostname,
            platform: os.platform(),
            arch: os.arch(),
            version: '1.0.0',
            cpus: os.cpus().length,
            totalMemory: os.totalmem(),
            uptime: os.uptime()
        };

        this.socket.emit('agent:register', registration);
        console.log('📝 Sent registration request');
    }

    private startHeartbeat(): void {
        this.heartbeatTimer = setInterval(() => {
            if (this.connected) {
                this.sendHeartbeat();
            }
        }, this.config.heartbeatInterval);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private startMetricsCollection(): void {
        this.metricsTimer = setInterval(() => {
            if (this.connected) {
                this.collectAndSendMetrics();
            }
        }, this.config.metricsInterval);
    }

    private stopMetricsCollection(): void {
        if (this.metricsTimer) {
            clearInterval(this.metricsTimer);
            this.metricsTimer = null;
        }
    }

    private sendHeartbeat(): void {
        const metrics = this.collectMetrics();
        
        const heartbeat = {
            agentId: this.config.agentId,
            hostname: this.config.hostname,
            platform: os.platform(),
            uptime: os.uptime(),
            cpuUsage: metrics.cpu.usage,
            memoryUsage: metrics.memory.usagePercent,
            lastHeartbeat: new Date().toISOString(),
            isOnline: true,
            metrics: {
                cpu: metrics.cpu,
                memory: metrics.memory,
                disk: metrics.disk,
                network: metrics.network
            }
        };

        this.socket.emit('agent:heartbeat', heartbeat);
        console.log(`💓 Heartbeat sent: CPU ${metrics.cpu.usage.toFixed(1)}% | Memory ${metrics.memory.usagePercent.toFixed(1)}%`);
    }

    private collectAndSendMetrics(): void {
        const metrics = this.collectMetrics();
        
        this.socket.emit('agent:metrics', {
            agentId: this.config.agentId,
            timestamp: new Date().toISOString(),
            metrics
        });
    }

    private collectMetrics(): SystemMetrics {
        return {
            cpu: this.getCpuMetrics(),
            memory: this.getMemoryMetrics(),
            disk: this.getDiskMetrics(),
            network: this.getNetworkMetrics(),
            process: this.getProcessMetrics()
        };
    }

    private getCpuMetrics(): SystemMetrics['cpu'] {
        const cpus = os.cpus();
        const loadAvg = os.loadavg();
        
        let cpuUsage = 0;
        if (this.lastCpuInfo) {
            const currentCpu = this.getCpuTimes();
            const idleDiff = currentCpu.idle - this.lastCpuInfo.idle;
            const totalDiff = currentCpu.total - this.lastCpuInfo.total;
            cpuUsage = totalDiff > 0 ? (1 - idleDiff / totalDiff) * 100 : 0;
            this.lastCpuInfo = currentCpu;
        } else {
            this.lastCpuInfo = this.getCpuTimes();
        }

        return {
            usage: Math.max(0, Math.min(100, cpuUsage)),
            loadAverage: loadAvg,
            cores: cpus.length,
            model: cpus[0]?.model || 'Unknown'
        };
    }

    private getCpuTimes(): { idle: number; total: number } {
        const cpus = os.cpus();
        let idle = 0;
        let total = 0;

        for (const cpu of cpus) {
            for (const type in cpu.times) {
                total += (cpu.times as any)[type];
            }
            idle += cpu.times.idle;
        }

        return { idle, total };
    }

    private getMemoryMetrics(): SystemMetrics['memory'] {
        const total = os.totalmem();
        const free = os.freemem();
        const used = total - free;

        return {
            total,
            used,
            free,
            usagePercent: (used / total) * 100
        };
    }

    private getDiskMetrics(): SystemMetrics['disk'] {
        try {
            const stats = fs.statfsSync('/');
            const total = stats.blocks * stats.bsize;
            const free = stats.bfree * stats.bsize;
            const used = total - free;

            return {
                total,
                used,
                free,
                usagePercent: (used / total) * 100
            };
        } catch {
            return {
                total: 0,
                used: 0,
                free: 0,
                usagePercent: 0
            };
        }
    }

    private getNetworkMetrics(): SystemMetrics['network'] {
        const interfaces = Object.keys(os.networkInterfaces());
        
        return {
            interfaces,
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            uptime: os.uptime()
        };
    }

    private getProcessMetrics(): SystemMetrics['process'] {
        return {
            pid: process.pid,
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime()
        };
    }

    private handleCommand(cmd: any): void {
        switch (cmd.type) {
            case 'collect_metrics':
                this.collectAndSendMetrics();
                break;
            case 'restart':
                console.log('🔄 Restart command received');
                break;
            case 'shutdown':
                console.log('🛑 Shutdown command received');
                this.shutdown();
                break;
            default:
                console.log(`Unknown command: ${cmd.type}`);
        }
    }

    public start(): void {
        console.log('🚀 Starting Probe Agent...');
        this.socket.connect();
    }

    public shutdown(): void {
        console.log('🛑 Shutting down Probe Agent...');
        this.stopHeartbeat();
        this.stopMetricsCollection();
        this.socket.disconnect();
        process.exit(0);
    }
}

const agent = new ProbeAgent();

process.on('SIGINT', () => {
    agent.shutdown();
});

process.on('SIGTERM', () => {
    agent.shutdown();
});

agent.start();
