/**
 * Probe Agent - System Monitoring & Health Check
 * Monitors system resources, agent health, and reports metrics
 */

import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import {
    AgentConfig,
    AgentMessage,
    AgentRole,
    AnalysisResult,
    TrafficContext
} from '../core/types';
import { BaseAgent } from '../core/base-agent';
import { MessageBus } from '../core/message-bus';
import logger from '../../utils/logger';
import { isDemoMode } from '../../config/app-mode';

export interface SystemMetrics {
    timestamp: Date;
    cpu: {
        usage: number;
        loadAverage: number[];
        cores: number;
    };
    memory: {
        total: number;
        used: number;
        free: number;
        usagePercent: number;
        heapUsed?: number;
        heapTotal?: number;
    };
    network: {
        connections: number;
        bytesReceived: number;
        bytesSent: number;
    };
    disk?: {
        readBytes: number;
        writeBytes: number;
    };
    process: {
        pid: number;
        uptime: number;
        memoryUsage: NodeJS.MemoryUsage;
        cpuUsage: NodeJS.CpuUsage;
    };
}

export interface AgentHeartbeat {
    agentId: string;
    role: AgentRole;
    status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
    lastSeen: Date;
    responseTime: number;
    tasksCompleted: number;
    tasksPending: number;
    errorCount: number;
    memoryUsage: number;
    cpuUsage: number;
}

export interface ProbeReport {
    id: string;
    timestamp: Date;
    system: SystemMetrics;
    agents: AgentHeartbeat[];
    messageBus: {
        queueSize: number;
        subscriptionCount: number;
        pendingRequests: number;
    };
    alerts: ProbeAlert[];
    uptime: number;
}

export interface ProbeAlert {
    id: string;
    severity: 'info' | 'warning' | 'critical';
    source: string;
    message: string;
    timestamp: Date;
    metadata?: Record<string, any>;
}

export interface ProbeConfig {
    heartbeatInterval: number;
    metricsInterval: number;
    alertThresholds: {
        cpuUsage: number;
        memoryUsage: number;
        agentResponseTime: number;
        queueSize: number;
    };
}

const DEFAULT_PROBE_CONFIG: ProbeConfig = {
    heartbeatInterval: 30000,
    metricsInterval: 10000,
    alertThresholds: {
        cpuUsage: 80,
        memoryUsage: 85,
        agentResponseTime: 5000,
        queueSize: 1000
    }
};

export class ProbeAgent extends BaseAgent {
    private probeConfig: ProbeConfig;
    private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
    private agentStates: Map<string, AgentHeartbeat> = new Map();
    private alerts: ProbeAlert[] = [];
    private metricsHistory: SystemMetrics[] = [];
    private maxHistorySize: number = 100;
    private startTime: Date;
    private intervalId: NodeJS.Timeout | null = null;
    private onReportCallback: ((report: ProbeReport) => void) | null = null;

    constructor(config: AgentConfig, messageBus: MessageBus, probeConfig: Partial<ProbeConfig> = {}) {
        super(config, messageBus);
        this.probeConfig = { ...DEFAULT_PROBE_CONFIG, ...probeConfig };
        this.startTime = new Date();
    }

    getSystemPrompt(): string {
        return `You are a Probe Agent responsible for monitoring system health and agent status.
        
Your responsibilities:
1. Monitor system resources (CPU, memory, network)
2. Track agent heartbeats and health status
3. Generate alerts when thresholds are exceeded
4. Provide real-time metrics for observability

Report any anomalies or health issues immediately.`;
    }

    async initialize(): Promise<void> {
        await super.initialize();
        this.startMetricsCollection();
        this.startAgentMonitoring();
        logger.info('Probe Agent initialized', {
            heartbeatInterval: this.probeConfig.heartbeatInterval,
            metricsInterval: this.probeConfig.metricsInterval
        });
    }

    private startMetricsCollection(): void {
        this.intervalId = setInterval(() => {
            this.collectMetrics();
        }, this.probeConfig.metricsInterval);
    }

    private startAgentMonitoring(): void {
        const roles: AgentRole[] = ['socrates', 'plato', 'aristotle', 'arbitrator'];
        
        for (const role of roles) {
            this.setupHeartbeatCheck(role);
        }
    }

    private setupHeartbeatCheck(role: AgentRole): void {
        const timer = setInterval(async () => {
            await this.checkAgentHealth(role);
        }, this.probeConfig.heartbeatInterval);

        this.heartbeatTimers.set(role, timer);
    }

    private async checkAgentHealth(role: AgentRole): Promise<void> {
        const startTime = Date.now();
        
        try {
            await this.sendMessage(role, 'heartbeat_request', {
                probeId: this.identity.id,
                timestamp: new Date()
            });

            const existingState = this.agentStates.get(role);
            if (existingState) {
                existingState.lastSeen = new Date();
                existingState.responseTime = Date.now() - startTime;
            }
        } catch (error: any) {
            this.addAlert({
                severity: 'warning',
                source: role,
                message: `Failed to reach agent: ${error.message}`
            });
        }
    }

    private collectMetrics(): void {
        const metrics = this.gatherSystemMetrics();
        this.metricsHistory.push(metrics);
        
        if (this.metricsHistory.length > this.maxHistorySize) {
            this.metricsHistory.shift();
        }

        this.checkThresholds(metrics);
        
        this.updateAgentPerformanceMetrics();

        if (this.onReportCallback) {
            const report = this.generateReport(metrics);
            this.onReportCallback(report);
        }
    }

    private updateAgentPerformanceMetrics(): void {
        if (!isDemoMode()) {
            return;
        }
        for (const [agentId, state] of this.agentStates) {
            state.lastSeen = new Date();
            state.responseTime = Math.floor(Math.random() * 50) + 10;
            state.tasksCompleted += Math.floor(Math.random() * 3);
            state.tasksPending = Math.floor(Math.random() * 5);
            state.memoryUsage = Math.floor(Math.random() * 100) + 50;
            state.cpuUsage = Math.random() * 30 + 5;
        }
    }

    private gatherSystemMetrics(): SystemMetrics {
        const cpus = os.cpus();
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemory = totalMemory - freeMemory;
        const processMemory = process.memoryUsage();

        let cpuUsage = 0;
        try {
            const cpuInfo = process.cpuUsage();
            cpuUsage = (cpuInfo.user + cpuInfo.system) / 1000000;
        } catch {
            cpuUsage = 0;
        }

        return {
            timestamp: new Date(),
            cpu: {
                usage: cpuUsage,
                loadAverage: os.loadavg(),
                cores: cpus.length
            },
            memory: {
                total: totalMemory,
                used: usedMemory,
                free: freeMemory,
                usagePercent: (usedMemory / totalMemory) * 100,
                heapUsed: processMemory.heapUsed,
                heapTotal: processMemory.heapTotal
            },
            network: {
                connections: 0,
                bytesReceived: 0,
                bytesSent: 0
            },
            process: {
                pid: process.pid,
                uptime: process.uptime(),
                memoryUsage: processMemory,
                cpuUsage: process.cpuUsage()
            }
        };
    }

    private checkThresholds(metrics: SystemMetrics): void {
        const { alertThresholds } = this.probeConfig;

        if (metrics.memory.usagePercent > alertThresholds.memoryUsage) {
            this.addAlert({
                severity: 'warning',
                source: 'system',
                message: `Memory usage high: ${metrics.memory.usagePercent.toFixed(1)}%`,
                metadata: { threshold: alertThresholds.memoryUsage }
            });
        }

        if (metrics.cpu.loadAverage[0] > alertThresholds.cpuUsage / 100 * metrics.cpu.cores) {
            this.addAlert({
                severity: 'warning',
                source: 'system',
                message: `CPU load high: ${metrics.cpu.loadAverage[0].toFixed(2)}`,
                metadata: { loadAverage: metrics.cpu.loadAverage }
            });
        }
    }

    private addAlert(alert: Omit<ProbeAlert, 'id' | 'timestamp'>): void {
        const fullAlert: ProbeAlert = {
            ...alert,
            id: uuidv4(),
            timestamp: new Date()
        };
        this.alerts.push(fullAlert);
        
        if (this.alerts.length > 100) {
            this.alerts.shift();
        }

        logger.warn(`Probe Alert [${alert.severity}]: ${alert.message}`, {
            source: alert.source
        });
    }

    generateReport(metrics?: SystemMetrics): ProbeReport {
        const currentMetrics = metrics || this.gatherSystemMetrics();
        const messageBusStats = this.messageBus.getStats();

        return {
            id: uuidv4(),
            timestamp: new Date(),
            system: currentMetrics,
            agents: Array.from(this.agentStates.values()),
            messageBus: {
                queueSize: messageBusStats.queueSize,
                subscriptionCount: messageBusStats.subscriptionCount,
                pendingRequests: messageBusStats.pendingRequests
            },
            alerts: this.alerts.slice(-10),
            uptime: Date.now() - this.startTime.getTime()
        };
    }

    onReport(callback: (report: ProbeReport) => void): void {
        this.onReportCallback = callback;
    }

    updateAgentHeartbeat(heartbeat: Partial<AgentHeartbeat> & { agentId: string }): void {
        const existing = this.agentStates.get(heartbeat.agentId);
        
        const updated: AgentHeartbeat = {
            agentId: heartbeat.agentId,
            role: heartbeat.role || existing?.role || 'socrates',
            status: heartbeat.status || existing?.status || 'unknown',
            lastSeen: heartbeat.lastSeen || new Date(),
            responseTime: heartbeat.responseTime || existing?.responseTime || 0,
            tasksCompleted: heartbeat.tasksCompleted ?? existing?.tasksCompleted ?? 0,
            tasksPending: heartbeat.tasksPending ?? existing?.tasksPending ?? 0,
            errorCount: heartbeat.errorCount ?? existing?.errorCount ?? 0,
            memoryUsage: heartbeat.memoryUsage ?? existing?.memoryUsage ?? 0,
            cpuUsage: heartbeat.cpuUsage ?? existing?.cpuUsage ?? 0
        };

        this.agentStates.set(heartbeat.agentId, updated);

        if (updated.responseTime > this.probeConfig.alertThresholds.agentResponseTime) {
            this.addAlert({
                severity: 'warning',
                source: heartbeat.agentId,
                message: `Agent response time high: ${updated.responseTime}ms`,
                metadata: { responseTime: updated.responseTime }
            });
        }
    }

    recordAgentMetric(
        agentId: string,
        metric: {
            tasksCompleted?: number;
            tasksPending?: number;
            errorCount?: number;
            memoryUsage?: number;
            cpuUsage?: number;
        }
    ): void {
        const existing = this.agentStates.get(agentId);
        if (existing) {
            this.updateAgentHeartbeat({
                agentId,
                ...metric
            });
        }
    }

    async analyze(context: TrafficContext): Promise<AnalysisResult> {
        const report = this.generateReport();
        
        return {
            agentId: this.identity.id,
            role: 'orchestrator',
            verdict: 'safe',
            confidence: 1.0,
            reasoning: `System health check completed. ${report.agents.length} agents monitored, ${report.alerts.length} active alerts.`,
            evidence: [{
                type: 'behavior',
                description: 'System metrics collected',
                severity: 'low',
                data: {
                    cpuUsage: report.system.cpu.usage,
                    memoryUsage: report.system.memory.usagePercent,
                    agentCount: report.agents.length
                },
                source: 'ProbeAgent'
            }]
        };
    }

    protected async handleAnalysisRequest(message: AgentMessage): Promise<void> {
        const report = this.generateReport();
        await this.sendMessage('orchestrator', 'analysis_result', {
            agentId: this.identity.id,
            role: 'orchestrator',
            report
        });
    }

    protected async handleDebateInvitation(message: AgentMessage): Promise<void> {
        logger.debug('Probe Agent received debate invitation - monitoring only');
    }

    protected async handleDebateArgument(message: AgentMessage): Promise<void> {
        logger.debug('Probe Agent received debate argument - monitoring only');
    }

    protected async handleToolResult(message: AgentMessage): Promise<void> {
        logger.debug('Probe Agent received tool result - monitoring only');
    }

    async shutdown(): Promise<void> {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }

        for (const timer of this.heartbeatTimers.values()) {
            clearInterval(timer);
        }
        this.heartbeatTimers.clear();

        await super.shutdown();
        logger.info('Probe Agent shutdown complete');
    }

    getMetricsHistory(): SystemMetrics[] {
        return [...this.metricsHistory];
    }

    getAgentStates(): AgentHeartbeat[] {
        return Array.from(this.agentStates.values());
    }

    getAlerts(): ProbeAlert[] {
        return [...this.alerts];
    }

    clearAlerts(): void {
        this.alerts = [];
    }

    getHealthStatus(): {
        status: 'healthy' | 'degraded' | 'unhealthy';
        details: {
            system: string;
            agents: string;
            messageBus: string;
        };
    } {
        const metrics = this.gatherSystemMetrics();
        const messageBusStats = this.messageBus.getStats();
        
        const systemHealth = metrics.memory.usagePercent < 90 && metrics.cpu.loadAverage[0] < metrics.cpu.cores
            ? 'healthy'
            : metrics.memory.usagePercent < 95
                ? 'degraded'
                : 'unhealthy';

        const agentHealth = this.agentStates.size > 0
            ? Array.from(this.agentStates.values()).every(a => a.status === 'healthy')
                ? 'healthy'
                : Array.from(this.agentStates.values()).some(a => a.status === 'healthy')
                    ? 'degraded'
                    : 'unhealthy'
            : 'unknown';

        const busHealth = messageBusStats.queueSize < this.probeConfig.alertThresholds.queueSize
            ? 'healthy'
            : messageBusStats.queueSize < this.probeConfig.alertThresholds.queueSize * 2
                ? 'degraded'
                : 'unhealthy';

        const overallStatus = [systemHealth, agentHealth, busHealth].includes('unhealthy')
            ? 'unhealthy'
            : [systemHealth, agentHealth, busHealth].includes('degraded')
                ? 'degraded'
                : 'healthy';

        return {
            status: overallStatus,
            details: {
                system: systemHealth,
                agents: agentHealth,
                messageBus: busHealth
            }
        };
    }
}

export default ProbeAgent;
