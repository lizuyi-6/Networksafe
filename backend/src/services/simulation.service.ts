import { defaultConfig as config } from '../config';
import { getAgentSystem } from '../routes/ai-system';
import os from 'os';
import { EventEmitter } from 'events';
import IPAnalyzer from '../utils/ip-analyzer';
import { isDemoMode } from '../config/app-mode';

interface TrafficStats {
    totalRequests: number;
    blockedRequests: number;
    activeConnections: number;
    successRate: number;
    currentRPS: number;
    history: { time: string; requests: number; blocked: number }[];
    threats: { name: string; value: number; color: string }[];
    systemMetrics?: {
        cpu: number;
        memory: number;
        uptime: number;
    };
    avgProcessingTime?: number;
    processingSamples?: number;
}

class SimulationService extends EventEmitter {
    private stats: TrafficStats = {
        totalRequests: 0,
        blockedRequests: 0,
        activeConnections: 0,
        successRate: 100,
        currentRPS: 0,
        history: [],
        threats: []
    };

    private interval: NodeJS.Timeout | null = null;
    private requestCount: number = 0;
    private blockedCount: number = 0;
    private avgProcessingTime = 0;
    private processingTimes: number[] = [];
    private readonly MAX_SAMPLES = 100;
    private ipAnalyzer: IPAnalyzer;

    constructor() {
        super();
        this.ipAnalyzer = new IPAnalyzer();
        const now = new Date();
        for (let i = 19; i >= 0; i--) {
            const time = new Date(now.getTime() - i * 1000 * 5);
            this.stats.history.push({
                time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                requests: 0,
                blocked: 0
            });
        }
        this.setupTimingListener();
        this.setupAttackListener();
        this.start();
    }

    private setupTimingListener(): void {
        this.on('requestTiming', (data: { duration: number; path: string }) => {
            this.processingTimes.push(data.duration);

            // Keep only the most recent 100 samples
            if (this.processingTimes.length > this.MAX_SAMPLES) {
                this.processingTimes.shift();
            }

            // Calculate average processing time
            this.avgProcessingTime =
                this.processingTimes.reduce((sum, time) => sum + time, 0) /
                this.processingTimes.length;
        });
    }

    private setupAttackListener(): void {
        this.on('attackBlocked', (data: { ip: string }) => {
            if (data.ip) {
                this.ipAnalyzer.recordAttack(data.ip);
            }
        });
    }

    public recordRequest(blocked: boolean = false) {
        this.requestCount++;
        if (blocked) {
            this.blockedCount++;
        }
    }

    public start() {
        if (this.interval) return;

        this.interval = setInterval(() => {
            this.updateStats();
        }, 2000);
    }

    private updateStats() {
        const agentSystem = getAgentSystem();
        
        this.stats.currentRPS = Math.floor(this.requestCount / 2);
        this.stats.totalRequests += this.requestCount;
        this.stats.blockedRequests += this.blockedCount;
        
        this.requestCount = 0;
        this.blockedCount = 0;

        if (this.stats.totalRequests > 0) {
            this.stats.successRate = Number(
                ((1 - this.stats.blockedRequests / this.stats.totalRequests) * 100).toFixed(2)
            );
        }

        const loadAvg = os.loadavg();
        const estimatedConnections = Math.max(0, Math.floor(loadAvg[0] * 10));
        this.stats.activeConnections = isDemoMode()
            ? estimatedConnections + Math.floor(Math.random() * 5)
            : estimatedConnections;

        const now = new Date();
        const newPoint = {
            time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            requests: this.stats.currentRPS,
            blocked: this.blockedCount
        };

        this.stats.history.push(newPoint);
        if (this.stats.history.length > 20) {
            this.stats.history.shift();
        }

        if (agentSystem && agentSystem.isInitialized()) {
            const probeReport = agentSystem.getProbeReport();
            const alerts = probeReport.alerts || [];
            
            const threatCounts: Record<string, number> = {};
            alerts.forEach(alert => {
                const type = alert.metadata?.threatType || 'Other';
                threatCounts[type] = (threatCounts[type] || 0) + 1;
            });

            const colors = ['#ef4444', '#f97316', '#eab308', '#3b82f6', '#8b5cf6'];
            this.stats.threats = Object.entries(threatCounts)
                .slice(0, 5)
                .map(([name, value], i) => ({
                    name,
                    value: Math.min(100, value * 10),
                    color: colors[i % colors.length]
                }));

            this.stats.systemMetrics = {
                cpu: probeReport.system?.cpu?.usage || 0,
                memory: probeReport.system?.memory?.usagePercent || 0,
                uptime: probeReport.uptime || 0
            };
        }

        if (this.stats.threats.length === 0 && isDemoMode()) {
            this.stats.threats = [
                { name: 'No Threats Detected', value: 100, color: '#22c55e' }
            ];
        }
    }

    public getStats() {
        const origins = this.ipAnalyzer.getAttackOrigins();
        return {
            ...this.stats,
            avgProcessingTime: Math.round(this.avgProcessingTime),
            processingSamples: this.processingTimes.length,
            attackOrigins: origins.byCountry
        };
    }

    public stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}

export default new SimulationService();
