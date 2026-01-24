/**
 * 扫描任务调度器
 * 
 * 管理扫描任务的调度、执行和结果存储
 */

import { EventEmitter } from 'events';
import logger from '../utils/logger';
import { PortScanner } from './port-scanner';
import { WebScanner } from './web-scanner';
import { SystemScanner } from './system-scanner';
import { NucleiScanner, VulnerabilityResult, ScanProgress } from './nuclei-scanner';
import { getDatabase } from '../config/database';

export interface ScanTask {
    id: string;
    agentId?: string;
    target: string;
    type: 'port' | 'web' | 'system' | 'nuclei' | 'full';
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress: number;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    results?: any;
    error?: string;
}

export class ScanScheduler extends EventEmitter {
    private tasks: Map<string, ScanTask> = new Map();
    private queue: string[] = [];
    private isProcessing: boolean = false;
    private maxConcurrent: number = 3;
    private runningCount: number = 0;

    // 扫描器实例
    private portScanner = new PortScanner();
    private webScanner = new WebScanner();
    private systemScanner = new SystemScanner();
    private nucleiScanner = new NucleiScanner();

    constructor() {
        super();
        this.initializeDatabase();
    }

    /**
     * 初始化数据库表
     */
    private initializeDatabase(): void {
        try {
            const db = getDatabase().getDb();

            db.exec(`
        CREATE TABLE IF NOT EXISTS scan_results (
          id TEXT PRIMARY KEY,
          agent_id TEXT,
          target TEXT NOT NULL,
          scan_type TEXT NOT NULL,
          status TEXT NOT NULL,
          progress INTEGER DEFAULT 0,
          results TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT
        )
      `);

            db.exec(`
        CREATE TABLE IF NOT EXISTS vulnerabilities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scan_id TEXT NOT NULL,
          template_id TEXT,
          name TEXT NOT NULL,
          severity TEXT NOT NULL,
          host TEXT,
          matched TEXT,
          description TEXT,
          timestamp TEXT NOT NULL,
          FOREIGN KEY (scan_id) REFERENCES scan_results(id)
        )
      `);

            logger.info('Scan database tables initialized');
        } catch (error: any) {
            logger.error('Failed to initialize scan database', { error: error.message });
        }
    }

    /**
     * 创建扫描任务
     */
    createTask(
        target: string,
        type: ScanTask['type'],
        agentId?: string
    ): ScanTask {
        const task: ScanTask = {
            id: `scan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            agentId,
            target,
            type,
            status: 'pending',
            progress: 0,
            createdAt: new Date()
        };

        this.tasks.set(task.id, task);
        this.queue.push(task.id);

        // 保存到数据库
        this.saveTask(task);

        logger.info(`Scan task created: ${task.id}`, { target, type });
        this.emit('task:created', task);

        // 尝试处理队列
        this.processQueue();

        return task;
    }

    /**
     * 处理任务队列
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.runningCount >= this.maxConcurrent) {
            return;
        }

        this.isProcessing = true;

        while (this.queue.length > 0 && this.runningCount < this.maxConcurrent) {
            const taskId = this.queue.shift();
            if (!taskId) continue;

            const task = this.tasks.get(taskId);
            if (!task || task.status !== 'pending') continue;

            this.runningCount++;
            this.executeTask(task).finally(() => {
                this.runningCount--;
                this.processQueue();
            });
        }

        this.isProcessing = false;
    }

    /**
     * 执行扫描任务
     */
    private async executeTask(task: ScanTask): Promise<void> {
        task.status = 'running';
        task.startedAt = new Date();
        this.updateTask(task);
        this.emit('task:started', task);

        try {
            let results: any;

            switch (task.type) {
                case 'port':
                    results = await this.runPortScan(task);
                    break;
                case 'web':
                    results = await this.runWebScan(task);
                    break;
                case 'system':
                    results = await this.runSystemScan(task);
                    break;
                case 'nuclei':
                    results = await this.runNucleiScan(task);
                    break;
                case 'full':
                    results = await this.runFullScan(task);
                    break;
            }

            task.status = 'completed';
            task.progress = 100;
            task.results = results;
            task.completedAt = new Date();

            logger.info(`Scan task completed: ${task.id}`);
            this.emit('task:completed', task);

        } catch (error: any) {
            task.status = 'failed';
            task.error = error.message;
            task.completedAt = new Date();

            logger.error(`Scan task failed: ${task.id}`, { error: error.message });
            this.emit('task:failed', task);
        }

        this.updateTask(task);
    }

    /**
     * 运行端口扫描
     */
    private async runPortScan(task: ScanTask): Promise<any> {
        task.progress = 10;
        this.updateTask(task);

        const results = await this.portScanner.scanCommonPorts();

        task.progress = 100;
        return { recommendations: results };
    }

    /**
     * 运行 Web 扫描
     */
    private async runWebScan(task: ScanTask): Promise<any> {
        task.progress = 10;
        this.updateTask(task);

        const results = await this.webScanner.scanWebServer();

        task.progress = 100;
        return results;
    }

    /**
     * 运行系统扫描
     */
    private async runSystemScan(task: ScanTask): Promise<any> {
        task.progress = 10;
        this.updateTask(task);

        const results = await this.systemScanner.scanSystem();

        task.progress = 100;
        return results;
    }

    /**
     * 运行 Nuclei 扫描
     */
    private async runNucleiScan(task: ScanTask): Promise<any> {
        const onProgress = (progress: ScanProgress) => {
            task.progress = progress.progress;
            this.updateTask(task);
            this.emit('task:progress', task, progress);
        };

        const vulnerabilities = await this.nucleiScanner.quickScan(task.target, onProgress);

        // 保存漏洞结果
        this.saveVulnerabilities(task.id, vulnerabilities);

        return {
            vulnerabilities,
            summary: this.nucleiScanner.getSummary(vulnerabilities)
        };
    }

    /**
     * 运行完整扫描
     */
    private async runFullScan(task: ScanTask): Promise<any> {
        const results: any = {
            port: null,
            web: null,
            system: null,
            nuclei: null
        };

        // 端口扫描 (0-25%)
        task.progress = 5;
        this.updateTask(task);
        results.port = await this.portScanner.scanCommonPorts();

        // Web 扫描 (25-50%)
        task.progress = 25;
        this.updateTask(task);
        results.web = await this.webScanner.scanWebServer();

        // 系统扫描 (50-75%)
        task.progress = 50;
        this.updateTask(task);
        results.system = await this.systemScanner.scanSystem();

        // Nuclei 扫描 (75-100%)
        task.progress = 75;
        this.updateTask(task);

        const onProgress = (progress: ScanProgress) => {
            task.progress = 75 + Math.round(progress.progress * 0.25);
            this.updateTask(task);
        };

        try {
            const vulnerabilities = await this.nucleiScanner.quickScan(task.target, onProgress);
            results.nuclei = {
                vulnerabilities,
                summary: this.nucleiScanner.getSummary(vulnerabilities)
            };
            this.saveVulnerabilities(task.id, vulnerabilities);
        } catch (error: any) {
            results.nuclei = { error: error.message };
        }

        return results;
    }

    /**
     * 保存任务到数据库
     */
    private saveTask(task: ScanTask): void {
        try {
            const db = getDatabase().getDb();

            db.prepare(`
        INSERT OR REPLACE INTO scan_results 
        (id, agent_id, target, scan_type, status, progress, results, error, created_at, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
                task.id,
                task.agentId || null,
                task.target,
                task.type,
                task.status,
                task.progress,
                task.results ? JSON.stringify(task.results) : null,
                task.error || null,
                task.createdAt.toISOString(),
                task.startedAt?.toISOString() || null,
                task.completedAt?.toISOString() || null
            );
        } catch (error: any) {
            logger.error('Failed to save scan task', { error: error.message });
        }
    }

    /**
     * 更新任务
     */
    private updateTask(task: ScanTask): void {
        this.tasks.set(task.id, task);
        this.saveTask(task);
        this.emit('task:updated', task);
    }

    /**
     * 保存漏洞结果
     */
    private saveVulnerabilities(scanId: string, vulnerabilities: VulnerabilityResult[]): void {
        try {
            const db = getDatabase().getDb();
            const stmt = db.prepare(`
        INSERT INTO vulnerabilities 
        (scan_id, template_id, name, severity, host, matched, description, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

            for (const vuln of vulnerabilities) {
                stmt.run(
                    scanId,
                    vuln.templateId,
                    vuln.name,
                    vuln.severity,
                    vuln.host,
                    vuln.matched,
                    vuln.description || null,
                    vuln.timestamp.toISOString()
                );
            }
        } catch (error: any) {
            logger.error('Failed to save vulnerabilities', { error: error.message });
        }
    }

    /**
     * 获取任务
     */
    getTask(taskId: string): ScanTask | undefined {
        return this.tasks.get(taskId);
    }

    /**
     * 获取所有任务
     */
    getAllTasks(): ScanTask[] {
        return Array.from(this.tasks.values());
    }

    /**
     * 获取历史扫描结果
     */
    getHistory(limit: number = 50): ScanTask[] {
        try {
            const db = getDatabase().getDb();
            const rows = db.prepare(`
        SELECT * FROM scan_results 
        ORDER BY created_at DESC 
        LIMIT ?
      `).all(limit);

            return rows.map((row: any) => ({
                id: row.id,
                agentId: row.agent_id,
                target: row.target,
                type: row.scan_type,
                status: row.status,
                progress: row.progress,
                results: row.results ? JSON.parse(row.results) : null,
                error: row.error,
                createdAt: new Date(row.created_at),
                startedAt: row.started_at ? new Date(row.started_at) : undefined,
                completedAt: row.completed_at ? new Date(row.completed_at) : undefined
            }));
        } catch (error: any) {
            logger.error('Failed to get scan history', { error: error.message });
            return [];
        }
    }

    /**
     * 取消任务
     */
    cancelTask(taskId: string): boolean {
        const task = this.tasks.get(taskId);
        if (!task || task.status !== 'pending') {
            return false;
        }

        task.status = 'failed';
        task.error = 'Cancelled by user';
        this.updateTask(task);

        // 从队列中移除
        const index = this.queue.indexOf(taskId);
        if (index > -1) {
            this.queue.splice(index, 1);
        }

        return true;
    }
}

// 导出单例
export const scanScheduler = new ScanScheduler();
