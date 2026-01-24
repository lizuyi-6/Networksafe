/**
 * 防火墙控制器
 * 
 * 调用系统防火墙工具封禁/解封 IP:
 * - Linux: iptables / firewalld / ufw
 * - Windows: netsh
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import logger from '../utils/logger';

const execAsync = promisify(exec);

interface BlockedIP {
    ip: string;
    reason: string;
    blockedAt: Date;
    expiresAt?: Date;
    timerId?: NodeJS.Timeout;
}

type FirewallBackend = 'iptables' | 'firewalld' | 'ufw' | 'netsh' | 'none';

export class FirewallController {
    private blockedIPs: Map<string, BlockedIP> = new Map();
    private backend: FirewallBackend = 'none';

    constructor() {
        this.detectBackend();
    }

    /**
     * 检测可用的防火墙后端
     */
    private async detectBackend(): Promise<void> {
        const platform = os.platform();

        if (platform === 'win32') {
            this.backend = 'netsh';
            logger.info('Firewall backend: Windows netsh');
            return;
        }

        // Linux: 按优先级检测
        try {
            await execAsync('which firewall-cmd');
            this.backend = 'firewalld';
            logger.info('Firewall backend: firewalld');
            return;
        } catch { }

        try {
            await execAsync('which ufw');
            this.backend = 'ufw';
            logger.info('Firewall backend: ufw');
            return;
        } catch { }

        try {
            await execAsync('which iptables');
            this.backend = 'iptables';
            logger.info('Firewall backend: iptables');
            return;
        } catch { }

        logger.warn('No firewall backend detected');
        this.backend = 'none';
    }

    /**
     * 封禁 IP
     * @param ip 要封禁的 IP 地址
     * @param duration 封禁时长 (秒), 0 表示永久
     * @param reason 封禁原因
     */
    async blockIP(ip: string, duration: number = 3600, reason: string = 'Threat detected'): Promise<boolean> {
        // 验证 IP 格式
        if (!this.isValidIP(ip)) {
            logger.error(`Invalid IP address: ${ip}`);
            return false;
        }

        // 跳过本地地址
        if (this.isLocalIP(ip)) {
            logger.warn(`Skipping local IP: ${ip}`);
            return false;
        }

        // 检查是否已封禁
        if (this.blockedIPs.has(ip)) {
            logger.info(`IP already blocked: ${ip}`);
            return true;
        }

        let success = false;

        try {
            switch (this.backend) {
                case 'iptables':
                    success = await this.blockWithIptables(ip);
                    break;
                case 'firewalld':
                    success = await this.blockWithFirewalld(ip);
                    break;
                case 'ufw':
                    success = await this.blockWithUfw(ip);
                    break;
                case 'netsh':
                    success = await this.blockWithNetsh(ip);
                    break;
                default:
                    logger.warn(`No firewall backend available, IP not blocked: ${ip}`);
                    // 即使没有防火墙，也记录到内存
                    success = true;
            }

            if (success) {
                const blockedIP: BlockedIP = {
                    ip,
                    reason,
                    blockedAt: new Date(),
                    expiresAt: duration > 0 ? new Date(Date.now() + duration * 1000) : undefined
                };

                // 设置自动解封计时器
                if (duration > 0) {
                    blockedIP.timerId = setTimeout(() => {
                        this.unblockIP(ip);
                    }, duration * 1000);
                }

                this.blockedIPs.set(ip, blockedIP);
                logger.info(`Blocked IP: ${ip} for ${duration}s (${reason})`);
            }

            return success;
        } catch (error: any) {
            logger.error(`Failed to block IP: ${ip}`, { error: error.message });
            return false;
        }
    }

    /**
     * 解封 IP
     */
    async unblockIP(ip: string): Promise<boolean> {
        const blocked = this.blockedIPs.get(ip);
        if (!blocked) {
            logger.info(`IP not in block list: ${ip}`);
            return true;
        }

        // 清除计时器
        if (blocked.timerId) {
            clearTimeout(blocked.timerId);
        }

        let success = false;

        try {
            switch (this.backend) {
                case 'iptables':
                    success = await this.unblockWithIptables(ip);
                    break;
                case 'firewalld':
                    success = await this.unblockWithFirewalld(ip);
                    break;
                case 'ufw':
                    success = await this.unblockWithUfw(ip);
                    break;
                case 'netsh':
                    success = await this.unblockWithNetsh(ip);
                    break;
                default:
                    success = true;
            }

            if (success) {
                this.blockedIPs.delete(ip);
                logger.info(`Unblocked IP: ${ip}`);
            }

            return success;
        } catch (error: any) {
            logger.error(`Failed to unblock IP: ${ip}`, { error: error.message });
            return false;
        }
    }

    // === iptables 实现 ===

    private async blockWithIptables(ip: string): Promise<boolean> {
        try {
            await execAsync(`iptables -A INPUT -s ${ip} -j DROP`);
            return true;
        } catch (error: any) {
            logger.error(`iptables block failed: ${error.message}`);
            return false;
        }
    }

    private async unblockWithIptables(ip: string): Promise<boolean> {
        try {
            await execAsync(`iptables -D INPUT -s ${ip} -j DROP`);
            return true;
        } catch (error: any) {
            logger.error(`iptables unblock failed: ${error.message}`);
            return false;
        }
    }

    // === firewalld 实现 ===

    private async blockWithFirewalld(ip: string): Promise<boolean> {
        try {
            await execAsync(`firewall-cmd --add-rich-rule='rule family="ipv4" source address="${ip}" reject'`);
            return true;
        } catch (error: any) {
            logger.error(`firewalld block failed: ${error.message}`);
            return false;
        }
    }

    private async unblockWithFirewalld(ip: string): Promise<boolean> {
        try {
            await execAsync(`firewall-cmd --remove-rich-rule='rule family="ipv4" source address="${ip}" reject'`);
            return true;
        } catch (error: any) {
            logger.error(`firewalld unblock failed: ${error.message}`);
            return false;
        }
    }

    // === ufw 实现 ===

    private async blockWithUfw(ip: string): Promise<boolean> {
        try {
            await execAsync(`ufw deny from ${ip}`);
            return true;
        } catch (error: any) {
            logger.error(`ufw block failed: ${error.message}`);
            return false;
        }
    }

    private async unblockWithUfw(ip: string): Promise<boolean> {
        try {
            await execAsync(`ufw delete deny from ${ip}`);
            return true;
        } catch (error: any) {
            logger.error(`ufw unblock failed: ${error.message}`);
            return false;
        }
    }

    // === Windows netsh 实现 ===

    private async blockWithNetsh(ip: string): Promise<boolean> {
        try {
            const ruleName = `FluxGuard_Block_${ip.replace(/\./g, '_')}`;
            await execAsync(`netsh advfirewall firewall add rule name="${ruleName}" dir=in action=block remoteip=${ip}`);
            return true;
        } catch (error: any) {
            logger.error(`netsh block failed: ${error.message}`);
            return false;
        }
    }

    private async unblockWithNetsh(ip: string): Promise<boolean> {
        try {
            const ruleName = `FluxGuard_Block_${ip.replace(/\./g, '_')}`;
            await execAsync(`netsh advfirewall firewall delete rule name="${ruleName}"`);
            return true;
        } catch (error: any) {
            logger.error(`netsh unblock failed: ${error.message}`);
            return false;
        }
    }

    // === 辅助方法 ===

    /**
     * 验证 IP 格式
     */
    private isValidIP(ip: string): boolean {
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
        const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
        return ipv4Regex.test(ip) || ipv6Regex.test(ip);
    }

    /**
     * 检查是否为本地 IP
     */
    private isLocalIP(ip: string): boolean {
        return ip === '127.0.0.1' ||
            ip === '::1' ||
            ip.startsWith('192.168.') ||
            ip.startsWith('10.') ||
            ip.startsWith('172.16.');
    }

    /**
     * 获取所有被封禁的 IP
     */
    getBlockedIPs(): BlockedIP[] {
        return Array.from(this.blockedIPs.values());
    }

    /**
     * 检查 IP 是否被封禁
     */
    isBlocked(ip: string): boolean {
        return this.blockedIPs.has(ip);
    }

    /**
     * 获取当前使用的防火墙后端
     */
    getBackend(): FirewallBackend {
        return this.backend;
    }

    /**
     * 清除所有封禁
     */
    async clearAll(): Promise<void> {
        for (const ip of this.blockedIPs.keys()) {
            await this.unblockIP(ip);
        }
    }
}
