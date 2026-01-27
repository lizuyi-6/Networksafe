/**
 * Nuclei 漏洞扫描器集成
 * 
 * 集成 ProjectDiscovery Nuclei 进行漏洞扫描
 * https://github.com/projectdiscovery/nuclei
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import logger from '../utils/logger';

const execAsync = promisify(exec);

export interface VulnerabilityResult {
    templateId: string;
    name: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    host: string;
    matched: string;
    timestamp: Date;
    description?: string;
    reference?: string[];
    tags?: string[];
}

export interface ScanProgress {
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress: number; // 0-100
    templatesTotal: number;
    templatesCompleted: number;
    vulnerabilitiesFound: number;
    startTime: Date;
    endTime?: Date;
    error?: string;
}

export class NucleiScanner {
    private nucleiPath: string = 'nuclei'; // 默认使用 PATH 中的 nuclei
    private templatesPath: string = '';
    private outputDir: string = '';
    private isAvailable: boolean = false;

    constructor(options?: { nucleiPath?: string; templatesPath?: string; outputDir?: string }) {
        if (options?.nucleiPath) this.nucleiPath = options.nucleiPath;
        if (options?.templatesPath) this.templatesPath = options.templatesPath;
        this.outputDir = options?.outputDir || path.join(process.cwd(), 'scan-results');
    }

    /**
     * 检查 Nuclei 是否已安装
     */
    async checkAvailability(): Promise<boolean> {
        try {
            const { stdout } = await execAsync(`${this.nucleiPath} -version`);
            logger.info(`Nuclei available: ${stdout.trim()}`);
            this.isAvailable = true;
            return true;
        } catch (error) {
            logger.warn('Nuclei not found. Install from: https://github.com/projectdiscovery/nuclei');
            this.isAvailable = false;
            return false;
        }
    }

    /**
     * 更新 Nuclei 模板
     */
    async updateTemplates(): Promise<boolean> {
        try {
            logger.info('Updating Nuclei templates...');
            const { stdout } = await execAsync(`${this.nucleiPath} -update-templates`);
            logger.info(`Templates updated: ${stdout.trim()}`);
            return true;
        } catch (error: any) {
            logger.error('Failed to update templates', { error: error.message });
            return false;
        }
    }

    /**
     * 运行漏洞扫描
     * @param target 目标 URL 或 IP
     * @param options 扫描选项
     */
    async scan(
        target: string,
        options?: {
            severity?: ('critical' | 'high' | 'medium' | 'low' | 'info')[];
            tags?: string[];
            templates?: string[];
            timeout?: number; // 分钟
            rateLimit?: number; // 请求/秒
            onProgress?: (progress: ScanProgress) => void;
        }
    ): Promise<VulnerabilityResult[]> {
        if (!this.isAvailable) {
            await this.checkAvailability();
            if (!this.isAvailable) {
                throw new Error('Nuclei is not installed');
            }
        }

        const results: VulnerabilityResult[] = [];
        const scanId = `scan-${Date.now()}`;
        const outputFile = path.join(this.outputDir, `${scanId}.json`);

        // 确保输出目录存在
        await fs.mkdir(this.outputDir, { recursive: true });

        // 构建命令参数
        const args: string[] = [
            '-target', target,
            '-json',
            '-output', outputFile,
            '-silent'
        ];

        // 严重性过滤
        if (options?.severity && options.severity.length > 0) {
            args.push('-severity', options.severity.join(','));
        }

        // 标签过滤
        if (options?.tags && options.tags.length > 0) {
            args.push('-tags', options.tags.join(','));
        }

        // 指定模板
        if (options?.templates && options.templates.length > 0) {
            for (const template of options.templates) {
                args.push('-t', template);
            }
        }

        // 速率限制
        if (options?.rateLimit) {
            args.push('-rate-limit', options.rateLimit.toString());
        }

        // 超时
        if (options?.timeout) {
            args.push('-timeout', (options.timeout * 60).toString());
        }

        // 自定义模板路径
        if (this.templatesPath) {
            args.push('-t', this.templatesPath);
        }

        logger.info(`Starting Nuclei scan: ${target}`, { args });

        const progress: ScanProgress = {
            status: 'running',
            progress: 0,
            templatesTotal: 0,
            templatesCompleted: 0,
            vulnerabilitiesFound: 0,
            startTime: new Date()
        };

        options?.onProgress?.(progress);

        return new Promise((resolve, reject) => {
            const nucleiProcess = spawn(this.nucleiPath, args, {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stderrData = '';

            nucleiProcess.stdout.on('data', (data: Buffer) => {
                const lines = data.toString().split('\n').filter(line => line.trim());

                for (const line of lines) {
                    try {
                        const result = JSON.parse(line);
                        if (result.info) {
                            const vuln: VulnerabilityResult = {
                                templateId: result['template-id'] || result.templateID,
                                name: result.info.name,
                                severity: result.info.severity || 'info',
                                host: result.host,
                                matched: result.matched || result['matched-at'],
                                timestamp: new Date(result.timestamp || Date.now()),
                                description: result.info.description,
                                reference: result.info.reference,
                                tags: result.info.tags
                            };
                            results.push(vuln);
                            progress.vulnerabilitiesFound = results.length;
                            options?.onProgress?.(progress);
                        }
                    } catch {
                        // 非 JSON 输出，忽略
                    }
                }
            });

            nucleiProcess.stderr.on('data', (data: Buffer) => {
                stderrData += data.toString();

                // 尝试解析进度信息
                const progressMatch = stderrData.match(/Templates: (\d+)\/(\d+)/);
                if (progressMatch) {
                    progress.templatesCompleted = parseInt(progressMatch[1]);
                    progress.templatesTotal = parseInt(progressMatch[2]);
                    progress.progress = Math.round((progress.templatesCompleted / progress.templatesTotal) * 100);
                    options?.onProgress?.(progress);
                }
            });

            nucleiProcess.on('close', async (code) => {
                progress.endTime = new Date();

                if (code === 0) {
                    progress.status = 'completed';
                    progress.progress = 100;
                    logger.info(`Nuclei scan completed: ${results.length} vulnerabilities found`);

                    // 尝试读取输出文件获取完整结果
                    try {
                        const fileContent = await fs.readFile(outputFile, 'utf-8');
                        const fileResults = fileContent
                            .split('\n')
                            .filter(line => line.trim())
                            .map(line => {
                                try {
                                    return JSON.parse(line);
                                } catch {
                                    return null;
                                }
                            })
                            .filter(Boolean);

                        // 合并结果
                        for (const result of fileResults) {
                            if (!results.find(r => r.templateId === result['template-id'] && r.host === result.host)) {
                                results.push({
                                    templateId: result['template-id'],
                                    name: result.info?.name || 'Unknown',
                                    severity: result.info?.severity || 'info',
                                    host: result.host,
                                    matched: result.matched || result['matched-at'],
                                    timestamp: new Date(result.timestamp || Date.now()),
                                    description: result.info?.description,
                                    reference: result.info?.reference,
                                    tags: result.info?.tags
                                });
                            }
                        }
                    } catch {
                        // 文件不存在或读取失败
                    }

                    options?.onProgress?.(progress);
                    resolve(results);
                } else {
                    progress.status = 'failed';
                    progress.error = stderrData || `Exit code: ${code}`;
                    logger.error(`Nuclei scan failed`, { code, stderr: stderrData });
                    options?.onProgress?.(progress);
                    reject(new Error(progress.error));
                }
            });

            nucleiProcess.on('error', (error) => {
                progress.status = 'failed';
                progress.error = error.message;
                progress.endTime = new Date();
                options?.onProgress?.(progress);
                reject(error);
            });
        });
    }

    /**
     * 快速扫描 - 仅高危和严重漏洞
     */
    async quickScan(target: string, onProgress?: (progress: ScanProgress) => void): Promise<VulnerabilityResult[]> {
        return this.scan(target, {
            severity: ['critical', 'high'],
            rateLimit: 100,
            timeout: 10,
            onProgress
        });
    }

    /**
     * 完整扫描 - 所有级别
     */
    async fullScan(target: string, onProgress?: (progress: ScanProgress) => void): Promise<VulnerabilityResult[]> {
        return this.scan(target, {
            severity: ['critical', 'high', 'medium', 'low'],
            rateLimit: 50,
            timeout: 60,
            onProgress
        });
    }

    /**
     * Web 应用扫描 - 专注于 Web 漏洞
     */
    async webAppScan(target: string, onProgress?: (progress: ScanProgress) => void): Promise<VulnerabilityResult[]> {
        return this.scan(target, {
            tags: ['xss', 'sqli', 'ssrf', 'lfi', 'rfi', 'rce', 'injection'],
            severity: ['critical', 'high', 'medium'],
            rateLimit: 30,
            timeout: 30,
            onProgress
        });
    }

    /**
     * CVE 扫描 - 已知漏洞检测
     */
    async cveScan(target: string, onProgress?: (progress: ScanProgress) => void): Promise<VulnerabilityResult[]> {
        return this.scan(target, {
            tags: ['cve'],
            severity: ['critical', 'high'],
            rateLimit: 50,
            timeout: 30,
            onProgress
        });
    }

    /**
     * 获取扫描结果摘要
     */
    getSummary(results: VulnerabilityResult[]): {
        total: number;
        bySeverity: Record<string, number>;
        byType: Record<string, number>;
    } {
        const bySeverity: Record<string, number> = {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            info: 0
        };

        const byType: Record<string, number> = {};

        for (const result of results) {
            bySeverity[result.severity] = (bySeverity[result.severity] || 0) + 1;

            const type = result.tags?.[0] || 'other';
            byType[type] = (byType[type] || 0) + 1;
        }

        return {
            total: results.length,
            bySeverity,
            byType
        };
    }

    /**
     * 检查是否可用
     */
    getIsAvailable(): boolean {
        return this.isAvailable;
    }
}

// 导出单例
export const nucleiScanner = new NucleiScanner();
