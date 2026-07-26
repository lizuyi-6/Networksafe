import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from './logger';

const execAsync = promisify(exec);

export class SystemStats {
    private static instance: SystemStats;
    private previousCpuTimes: { idle: number, total: number } = { idle: 0, total: 0 };

    public cpuUsage: number = 0;
    public memoryUsage: number = 0;
    public diskUsage: number = 0;
    public networkUsageMb: number = 0;

    private previousRx: number = 0;
    private previousTx: number = 0;
    private lastNetworkTime: number = Date.now();
    private readonly updateTimer: NodeJS.Timeout;

    private constructor() {
        this.updateStats();
        this.updateTimer = setInterval(() => this.updateStats(), 2000);
        this.updateTimer.unref?.();
    }

    public static getInstance(): SystemStats {
        if (!SystemStats.instance) {
            SystemStats.instance = new SystemStats();
        }
        return SystemStats.instance;
    }

    private async updateStats() {
        try {
            this.cpuUsage = this.calculateCpuUsage();
            this.memoryUsage = this.calculateMemoryUsage();
            this.diskUsage = await this.calculateDiskUsage();
            this.networkUsageMb = await this.calculateNetworkUsage();
        } catch (error: any) {
            logger.error('Failed to update system stats', { error: error.message });
        }
    }

    private calculateCpuUsage(): number {
        const cpus = os.cpus();
        let idle = 0;
        let total = 0;

        for (const cpu of cpus) {
            for (const type in cpu.times) {
                total += (cpu.times as any)[type];
            }
            idle += cpu.times.idle;
        }

        if (this.previousCpuTimes.total === 0) {
            this.previousCpuTimes = { idle, total };
            return 0;
        }

        const idleDiff = idle - this.previousCpuTimes.idle;
        const totalDiff = total - this.previousCpuTimes.total;

        this.previousCpuTimes = { idle, total };

        const usage = 100 - (100 * idleDiff / totalDiff);
        return usage > 0 ? usage : 0;
    }

    private calculateMemoryUsage(): number {
        const total = os.totalmem();
        const free = os.freemem();
        return ((total - free) / total) * 100;
    }

    private async calculateDiskUsage(): Promise<number> {
        return new Promise((resolve) => {
            if (process.platform === 'win32') {
                exec('wmic logicaldisk get size,freespace,caption', (error, stdout) => {
                    if (error) return resolve(0);
                    const lines = stdout.trim().split('\n').slice(1);
                    for (const line of lines) {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length >= 3 && parts[0].includes('C:')) {
                            const freeString = parts[1];
                            const totalString = parts[2];
                            const free = parseInt(freeString, 10);
                            const total = parseInt(totalString, 10);
                            if (total > 0) return resolve(((total - free) / total) * 100);
                        }
                    }
                    resolve(0);
                });
            } else {
                exec('df -BG /', (error, stdout) => {
                    if (error) return resolve(0);
                    const lines = stdout.trim().split('\n');
                    if (lines.length > 1) {
                        const parts = lines[1].trim().split(/\s+/);
                        const usageStr = parts[4];
                        if (usageStr) {
                            return resolve(parseInt(usageStr.replace('%', ''), 10));
                        }
                    }
                    resolve(0);
                });
            }
        });
    }

    private async calculateNetworkUsage(): Promise<number> {
        let currentRx = 0;
        let currentTx = 0;

        try {
            if (process.platform === 'win32') {
                const { stdout } = await execAsync('netstat -e');
                const lines = stdout.trim().split('\n');
                if (lines.length > 1) {
                    const bytesLine = lines[1].trim().split(/\s+/);
                    currentRx = parseInt(bytesLine[1], 10);
                    currentTx = parseInt(bytesLine[2], 10);
                }
            } else {
                const { stdout } = await execAsync('cat /proc/net/dev');
                const lines = stdout.trim().split('\n').slice(2);
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/).filter(Boolean);
                    if (parts.length >= 10 && !line.includes('lo:')) {
                        currentRx += parseInt(parts[1], 10);
                        currentTx += parseInt(parts[9], 10);
                    }
                }
            }
        } catch (err) {
            return 0;
        }

        const now = Date.now();
        const timeDiffSeconds = (now - this.lastNetworkTime) / 1000;

        let mbps = 0;
        if (this.previousRx > 0 && timeDiffSeconds > 0) {
            const bytesDiff = (currentRx - this.previousRx) + (currentTx - this.previousTx);
            // MB/s
            mbps = bytesDiff / (1024 * 1024) / timeDiffSeconds;
        }

        this.previousRx = currentRx;
        this.previousTx = currentTx;
        this.lastNetworkTime = now;

        return mbps > 0 ? mbps : 0;
    }
}
