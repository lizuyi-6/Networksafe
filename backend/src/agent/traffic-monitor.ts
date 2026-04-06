/**
 * 流量监控模块
 * 
 * 监控服务器入站流量，分析请求模式
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import readline from 'readline';
import logger from '../utils/logger';

const execAsync = promisify(exec);

export interface TrafficEvent {
    timestamp: Date;
    sourceIP: string;
    destPort: number;
    method?: string;
    path?: string;
    queryParams?: Record<string, string | number | boolean>;
    userAgent?: string;
    requestBody?: string;
    rawLog?: string;
}

export type TrafficCallback = (event: TrafficEvent) => void;

/**
 * Data source type for traffic monitoring
 */
export type TrafficDataSource = 'log_file' | 'netstat' | 'none';

/**
 * Traffic monitor status
 */
export interface TrafficMonitorStatus {
    isRunning: boolean;
    dataSource: TrafficDataSource;
    logPath: string | null;
    lastActivity: Date | null;
    stats: {
        eventsProcessed: number;
        errors: number;
        startTime: Date | null;
    };
}

export class TrafficMonitor {
    private isRunning = false;
    private callback: TrafficCallback | null = null;
    private logWatcher: fs.FSWatcher | null = null;
    private logStream: readline.Interface | null = null;
    private lastLogPosition = 0;

    // Data source tracking
    private dataSource: TrafficDataSource = 'none';
    private currentLogPath: string | null = null;

    // Statistics
    private eventsProcessed = 0;
    private errors = 0;
    private startTime: Date | null = null;
    private lastActivity: Date | null = null;

    // Status reporting
    private statusReportInterval: NodeJS.Timeout | null = null;

    // 常见日志路径
    private readonly LOG_PATHS = {
        nginx: ['/var/log/nginx/access.log', '/var/log/nginx/error.log'],
        apache: ['/var/log/apache2/access.log', '/var/log/httpd/access_log'],
        custom: process.env.ACCESS_LOG_PATH
    };

    /**
     * 启动流量监控
     */
    async start(callback: TrafficCallback): Promise<void> {
        if (this.isRunning) {
            logger.warn('Traffic monitor already running');
            return;
        }

        this.callback = callback;
        this.isRunning = true;
        this.startTime = new Date();

        // 尝试找到可用的日志文件
        const logPath = await this.findAccessLog();

        if (logPath) {
            this.dataSource = 'log_file';
            this.currentLogPath = logPath;
            await this.watchLogFile(logPath);
            logger.info(`Traffic monitoring started using log file: ${logPath}`);
        } else {
            this.dataSource = 'netstat';
            this.currentLogPath = null;
            logger.warn('No access log found, using netstat monitoring');
            await this.fallbackToNetstat();
        }

        // Start status reporting
        this.startStatusReporting();

        logger.info('Traffic monitoring started', {
            dataSource: this.dataSource,
            logPath: this.currentLogPath
        });
    }

    /**
     * 查找可用的访问日志
     */
    private async findAccessLog(): Promise<string | null> {
        // 优先使用自定义路径
        if (this.LOG_PATHS.custom && fs.existsSync(this.LOG_PATHS.custom)) {
            return this.LOG_PATHS.custom;
        }

        // 检查 Nginx 日志
        for (const path of this.LOG_PATHS.nginx) {
            if (fs.existsSync(path)) {
                logger.info(`Found Nginx log: ${path}`);
                return path;
            }
        }

        // 检查 Apache 日志
        for (const path of this.LOG_PATHS.apache) {
            if (fs.existsSync(path)) {
                logger.info(`Found Apache log: ${path}`);
                return path;
            }
        }

        return null;
    }

    /**
     * 监控日志文件
     */
    private async watchLogFile(logPath: string): Promise<void> {
        logger.info(`Watching log file: ${logPath}`);

        // 获取当前文件位置 (只读取新内容)
        const stats = fs.statSync(logPath);
        this.lastLogPosition = stats.size;

        // 使用 fs.watch 监控文件变化
        this.logWatcher = fs.watch(logPath, (eventType) => {
            if (eventType === 'change') {
                this.readNewLogEntries(logPath);
            }
        });
    }

    /**
     * 读取新的日志条目
     */
    private readNewLogEntries(logPath: string): void {
        const stats = fs.statSync(logPath);

        if (stats.size < this.lastLogPosition) {
            // 日志被轮转，从头开始
            this.lastLogPosition = 0;
        }

        if (stats.size === this.lastLogPosition) {
            return; // 无新内容
        }

        const stream = fs.createReadStream(logPath, {
            start: this.lastLogPosition,
            end: stats.size
        });

        const rl = readline.createInterface({ input: stream });

        rl.on('line', (line) => {
            const event = this.parseLogLine(line);
            if (event && this.callback) {
                this.callback(event);
                this.eventsProcessed++;
                this.lastActivity = new Date();
            }
        });

        this.lastLogPosition = stats.size;
    }

    /**
     * 解析日志行
     */
    private parseLogLine(line: string): TrafficEvent | null {
        // 尝试解析 Nginx/Apache Combined Log Format
        // 格式: IP - - [timestamp] "METHOD PATH HTTP/1.1" status size "referer" "user-agent"
        const combinedLogRegex = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) \S+" (\d+) \S+ "[^"]*" "([^"]*)"/;

        const match = line.match(combinedLogRegex);
        if (match) {
            return {
                timestamp: new Date(),
                sourceIP: match[1],
                destPort: 80, // 从日志无法直接获取端口
                method: match[3],
                path: match[4],
                userAgent: match[6],
                rawLog: line
            };
        }

        // 尝试解析其他格式
        // TODO: 支持更多日志格式

        return null;
    }

    /**
     * 备用方案：使用 netstat 监控
     */
    private async fallbackToNetstat(): Promise<void> {
        // 定期执行 netstat 获取连接信息
        const checkConnections = async () => {
            if (!this.isRunning) return;

            try {
                const { stdout } = await execAsync('netstat -tn 2>/dev/null || ss -tn');
                const connections = this.parseNetstatOutput(stdout);

                for (const conn of connections) {
                    if (this.callback) {
                        this.callback(conn);
                        this.eventsProcessed++;
                        this.lastActivity = new Date();
                    }
                }
            } catch (error) {
                this.errors++;
                // 静默处理错误
            }

            // 每 5 秒检查一次
            if (this.isRunning) {
                setTimeout(checkConnections, 5000);
            }
        };

        checkConnections();
    }

    /**
     * 解析 netstat 输出
     */
    private parseNetstatOutput(output: string): TrafficEvent[] {
        const events: TrafficEvent[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            // 匹配 ESTABLISHED 连接
            const match = line.match(/(\d+\.\d+\.\d+\.\d+):(\d+)\s+(\d+\.\d+\.\d+\.\d+):(\d+)/);
            if (match) {
                events.push({
                    timestamp: new Date(),
                    sourceIP: match[1],
                    destPort: parseInt(match[4])
                });
            }
        }

        return events;
    }

    /**
     * 停止监控
     */
    async stop(): Promise<void> {
        this.isRunning = false;
        this.dataSource = 'none';

        if (this.statusReportInterval) {
            clearInterval(this.statusReportInterval);
            this.statusReportInterval = null;
        }

        if (this.logWatcher) {
            this.logWatcher.close();
            this.logWatcher = null;
        }

        if (this.logStream) {
            this.logStream.close();
            this.logStream = null;
        }

        logger.info('Traffic monitoring stopped', {
            eventsProcessed: this.eventsProcessed,
            errors: this.errors,
            duration: this.startTime ? Date.now() - this.startTime.getTime() : 0
        });
    }

    /**
     * Get current status
     */
    getStatus(): TrafficMonitorStatus {
        return {
            isRunning: this.isRunning,
            dataSource: this.dataSource,
            logPath: this.currentLogPath,
            lastActivity: this.lastActivity,
            stats: {
                eventsProcessed: this.eventsProcessed,
                errors: this.errors,
                startTime: this.startTime
            }
        };
    }

    /**
     * Get current data source
     */
    getDataSource(): TrafficDataSource {
        return this.dataSource;
    }

    /**
     * Start periodic status reporting
     */
    private startStatusReporting(): void {
        // Report status every 60 seconds
        this.statusReportInterval = setInterval(() => {
            if (!this.isRunning) return;

            const status = this.getStatus();
            logger.info('Traffic monitor status report', {
                dataSource: status.dataSource,
                eventsProcessed: status.stats.eventsProcessed,
                errors: status.stats.errors,
                lastActivity: status.lastActivity?.toISOString()
            });
        }, 60000);
    }
}
