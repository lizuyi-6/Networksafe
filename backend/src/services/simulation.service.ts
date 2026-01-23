import { defaultConfig as config } from '../../../src/config';

interface TrafficStats {
    totalRequests: number;
    blockedRequests: number;
    activeConnections: number;
    successRate: number;
    currentRPS: number;
    history: { time: string; requests: number; blocked: number }[];
    threats: { name: string; value: number; color: string }[];
}

class SimulationService {
    private stats: TrafficStats = {
        totalRequests: 1250000,
        blockedRequests: 4200,
        activeConnections: 25,
        successRate: 99.5,
        currentRPS: 50,
        history: [],
        threats: [
            { name: 'Bot Attacks', value: 65, color: '#ef4444' }, // red-500
            { name: 'SQL Injection', value: 15, color: '#f97316' }, // orange-500
            { name: 'DDoS Attempts', value: 10, color: '#eab308' }, // yellow-500
            { name: 'Rate Limit', value: 10, color: '#3b82f6' }, // blue-500
        ]
    };

    private interval: NodeJS.Timeout | null = null;

    constructor() {
        // Initialize history with 20 points
        const now = new Date();
        for (let i = 19; i >= 0; i--) {
            const time = new Date(now.getTime() - i * 1000 * 5); // every 5 seconds
            this.stats.history.push({
                time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                requests: 50 + Math.floor(Math.random() * 20),
                blocked: Math.floor(Math.random() * 5)
            });
        }
        this.start();
    }

    public start() {
        if (this.interval) return;

        this.interval = setInterval(() => {
            this.updateStats();
        }, 2000); // Update every 2 seconds
    }

    private updateStats() {
        // Simulate RPS fluctuation (sine wave + noise)
        const time = Date.now() / 10000;
        const baseRPS = 80;
        const fluctuation = Math.sin(time) * 30; // +/- 30
        const noise = Math.random() * 10 - 5;

        this.stats.currentRPS = Math.max(10, Math.floor(baseRPS + fluctuation + noise));

        // Update totals
        const newRequests = this.stats.currentRPS * 2; // for 2 seconds
        this.stats.totalRequests += newRequests;

        // Simulate blocks (approx 2% of traffic)
        const newBlocks = Math.floor(newRequests * (0.01 + Math.random() * 0.02));
        this.stats.blockedRequests += newBlocks;

        // Update Success Rate
        const total = this.stats.totalRequests;
        const blocked = this.stats.blockedRequests;
        this.stats.successRate = Number(((1 - blocked / total) * 100).toFixed(2));

        // Update Active Connections
        this.stats.activeConnections = Math.floor(this.stats.currentRPS * 0.5) + Math.floor(Math.random() * 10);

        // Update History
        const now = new Date();
        const newPoint = {
            time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            requests: this.stats.currentRPS,
            blocked: Math.max(0, Math.floor(this.stats.currentRPS * (Math.random() * 0.1))) // 0-10% blocked in chart
        };

        this.stats.history.push(newPoint);
        if (this.stats.history.length > 20) {
            this.stats.history.shift();
        }
    }

    public getStats() {
        return this.stats;
    }
}

export default new SimulationService();
