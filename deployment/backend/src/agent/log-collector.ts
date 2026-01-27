/**
 * 日志采集模块
 * 
 * 采集系统和应用日志，检测异常模式
 */

import fs from 'fs';
import readline from 'readline';
import { EventEmitter } from 'events';
import logger from '../utils/logger';

export interface LogEntry {
    source: string;
    timestamp: Date;
    level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
    message: string;
    raw: string;
    metadata?: Record<string, any>;
}

export interface LogPattern {
    name: string;
    pattern: RegExp;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
}

export class LogCollector extends EventEmitter {
    private watchers: Map<string, fs.FSWatcher> = new Map();
    private filePositions: Map<string, number> = new Map();
    private isRunning: boolean = false;

    // 需要检测的危险模式
    private dangerousPatterns: LogPattern[] = [
        {
            name: 'SSH Brute Force',
            pattern: /Failed password for (?:invalid user )?(\S+) from (\S+)/i,
            severity: 'high',
            description: 'SSH login failure detected'
        },
        {
            name: 'SSH Root Login',
            pattern: /Accepted password for root from/i,
            severity: 'medium',
            description: 'Root SSH login detected'
        },
        {
            name: 'Sudo Failure',
            pattern: /sudo:.*authentication failure/i,
            severity: 'high',
            description: 'Sudo authentication failure'
        },
        {
            name: 'Kernel Panic',
            pattern: /Kernel panic/i,
            severity: 'critical',
            description: 'Kernel panic detected'
        },
        {
            name: 'OOM Killer',
            pattern: /Out of memory: Kill process/i,
            severity: 'high',
            description: 'Out of memory condition'
        },
        {
            name: 'Disk Error',
            pattern: /I\/O error|sector error|disk error/i,
            severity: 'high',
            description: 'Disk I/O error detected'
        },
        {
            name: 'Service Crash',
            pattern: /segfault|core dumped|killed/i,
            severity: 'high',
            description: 'Service crash detected'
        },
        {
            name: 'PHP Error',
            pattern: /PHP Fatal error|PHP Parse error/i,
            severity: 'medium',
            description: 'PHP error in application'
        },
        {
            name: 'SQL Error',
            pattern: /SQL syntax error|mysql.*error/i,
            severity: 'medium',
            description: 'Database SQL error'
        },
        {
            name: 'Connection Refused',
            pattern: /Connection refused|ECONNREFUSED/i,
            severity: 'medium',
            description: 'Service connection refused'
        }
    ];

    // 常见日志文件路径
    private readonly LOG_SOURCES = {
        syslog: ['/var/log/syslog', '/var/log/messages'],
        auth: ['/var/log/auth.log', '/var/log/secure'],
        nginx: ['/var/log/nginx/error.log'],
        apache: ['/var/log/apache2/error.log', '/var/log/httpd/error_log'],
        mysql: ['/var/log/mysql/error.log', '/var/log/mariadb/mariadb.log'],
        postgresql: ['/var/log/postgresql/postgresql.log'],
        docker: ['/var/log/docker.log'],
    };

    /**
     * 启动日志采集
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn('Log collector already running');
            return;
        }

        this.isRunning = true;
        logger.info('Starting log collector...');

        // 查找并监控所有可用的日志文件
        for (const [source, paths] of Object.entries(this.LOG_SOURCES)) {
            for (const logPath of paths) {
                if (fs.existsSync(logPath)) {
                    await this.watchLogFile(logPath, source);
                    break; // 每个源只监控第一个找到的文件
                }
            }
        }

        // 添加自定义日志路径
        const customLogPath = process.env.CUSTOM_LOG_PATH;
        if (customLogPath && fs.existsSync(customLogPath)) {
            await this.watchLogFile(customLogPath, 'custom');
        }

        logger.info(`Log collector started, watching ${this.watchers.size} log files`);
    }

    /**
     * 监控日志文件
     */
    private async watchLogFile(logPath: string, source: string): Promise<void> {
        try {
            // 获取文件当前大小（从末尾开始读取新内容）
            const stats = fs.statSync(logPath);
            this.filePositions.set(logPath, stats.size);

            // 监控文件变化
            const watcher = fs.watch(logPath, (eventType) => {
                if (eventType === 'change') {
                    this.readNewEntries(logPath, source);
                }
            });

            this.watchers.set(logPath, watcher);
            logger.info(`Watching log file: ${logPath} (${source})`);

        } catch (error: any) {
            logger.error(`Failed to watch log file: ${logPath}`, { error: error.message });
        }
    }

    /**
     * 读取新的日志条目
     */
    private readNewEntries(logPath: string, source: string): void {
        try {
            const stats = fs.statSync(logPath);
            const currentPosition = this.filePositions.get(logPath) || 0;

            // 检测日志轮转
            if (stats.size < currentPosition) {
                this.filePositions.set(logPath, 0);
                return;
            }

            if (stats.size === currentPosition) {
                return; // 无新内容
            }

            // 读取新内容
            const stream = fs.createReadStream(logPath, {
                start: currentPosition,
                end: stats.size
            });

            const rl = readline.createInterface({ input: stream });

            rl.on('line', (line) => {
                const entry = this.parseLogLine(line, source);
                if (entry) {
                    this.processEntry(entry);
                }
            });

            this.filePositions.set(logPath, stats.size);

        } catch (error: any) {
            logger.error(`Failed to read log entries: ${logPath}`, { error: error.message });
        }
    }

    /**
     * 解析日志行
     */
    private parseLogLine(line: string, source: string): LogEntry | null {
        if (!line.trim()) return null;

        // 尝试解析时间戳
        let timestamp = new Date();
        let level: LogEntry['level'] = 'info';
        let message = line;

        // Syslog 格式: "Jan 24 10:30:45 hostname service: message"
        const syslogMatch = line.match(/^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+?):\s*(.*)$/);
        if (syslogMatch) {
            const [, timeStr, , , msg] = syslogMatch;
            timestamp = new Date(`${new Date().getFullYear()} ${timeStr}`);
            message = msg;
        }

        // 检测日志级别
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes('error') || lowerLine.includes('fail')) {
            level = 'error';
        } else if (lowerLine.includes('warn')) {
            level = 'warn';
        } else if (lowerLine.includes('critical') || lowerLine.includes('fatal') || lowerLine.includes('panic')) {
            level = 'critical';
        } else if (lowerLine.includes('debug')) {
            level = 'debug';
        }

        return {
            source,
            timestamp,
            level,
            message,
            raw: line
        };
    }

    /**
     * 处理日志条目
     */
    private processEntry(entry: LogEntry): void {
        // 发送通用日志事件
        this.emit('log', entry);

        // 检测危险模式
        for (const pattern of this.dangerousPatterns) {
            const match = entry.raw.match(pattern.pattern);
            if (match) {
                const alert = {
                    type: 'log_pattern',
                    pattern: pattern.name,
                    severity: pattern.severity,
                    description: pattern.description,
                    entry,
                    match: match[0],
                    timestamp: new Date()
                };

                logger.warn(`Dangerous pattern detected: ${pattern.name}`, {
                    source: entry.source,
                    message: entry.message.substring(0, 100)
                });

                this.emit('alert', alert);
            }
        }

        // 发送按级别分类的事件
        if (entry.level === 'error' || entry.level === 'critical') {
            this.emit('error', entry);
        }
    }

    /**
     * 添加自定义检测模式
     */
    addPattern(pattern: LogPattern): void {
        this.dangerousPatterns.push(pattern);
        logger.info(`Added log pattern: ${pattern.name}`);
    }

    /**
     * 手动添加日志文件监控
     */
    async addLogFile(logPath: string, source: string): Promise<boolean> {
        if (!fs.existsSync(logPath)) {
            logger.warn(`Log file not found: ${logPath}`);
            return false;
        }

        if (this.watchers.has(logPath)) {
            logger.warn(`Already watching: ${logPath}`);
            return false;
        }

        await this.watchLogFile(logPath, source);
        return true;
    }

    /**
     * 获取当前监控的文件列表
     */
    getWatchedFiles(): string[] {
        return Array.from(this.watchers.keys());
    }

    /**
     * 停止日志采集
     */
    stop(): void {
        this.isRunning = false;

        for (const [path, watcher] of this.watchers) {
            watcher.close();
            logger.info(`Stopped watching: ${path}`);
        }

        this.watchers.clear();
        this.filePositions.clear();

        logger.info('Log collector stopped');
    }
}

// 导出单例
export const logCollector = new LogCollector();
