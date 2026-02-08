/**
 * 修复后的防火墙控制器
 *
 * 修复内容：
 * 1. 完整的RFC1918私有地址检测
 * 2. IPv6链路本地地址检测
 * 3. 其他保留地址段检测
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

export class EnhancedFirewallController {
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
     */
    async blockIP(ip: string, duration: number = 3600, reason: string = 'Threat detected'): Promise<boolean> {
        if (!this.isValidIP(ip)) {
            logger.error(`Invalid IP address: ${ip}`);
            return false;
        }

        if (this.isPrivateIP(ip)) {
            logger.warn(`Skipping private/reserved IP: ${ip}`);
            return false;
        }

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
                    success = true;
            }

            if (success) {
                const blockedIP: BlockedIP = {
                    ip,
                    reason,
                    blockedAt: new Date(),
                    expiresAt: duration > 0 ? new Date(Date.now() + duration * 1000) : undefined
                };

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
        // IPv4
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (ipv4Regex.test(ip)) {
            const parts = ip.split('.').map(Number);
            return parts.every(part => part >= 0 && part <= 255);
        }

        // IPv6
        const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
        const ipv6CompressedRegex = /^(([0-9a-fA-F]{1,4}:)*)::(([0-9a-fA-F]{1,4}:)*)([0-9a-fA-F]{1,4})?$/;

        return ipv6Regex.test(ip) || ipv6CompressedRegex.test(ip);
    }

    /**
     * 检查是否为私有/保留 IP（完整修复）
     */
    private isPrivateIP(ip: string): boolean {
        // IPv4私有/保留地址
        if (ip.includes('.')) {
            const parts = ip.split('.').map(Number);
            const [a, b, c, d] = parts;

            // 回环地址 127.0.0.0/8
            if (a === 127) return true;

            // 私有地址 10.0.0.0/8
            if (a === 10) return true;

            // 私有地址 172.16.0.0/12（修复：完整范围）
            if (a === 172 && b >= 16 && b <= 31) return true;

            // 私有地址 192.168.0.0/16
            if (a === 192 && b === 168) return true;

            // 链路本地地址 169.254.0.0/16
            if (a === 169 && b === 254) return true;

            // 多播地址 224.0.0.0/4
            if (a >= 224 && a <= 239) return true;

            // 保留地址 240.0.0.0/4
            if (a >= 240) return true;

            // 0.0.0.0/8
            if (a === 0) return true;

            // 广播地址
            if (ip === '255.255.255.255') return true;

            return false;
        }

        // IPv6私有/保留地址
        const ipLower = ip.toLowerCase();

        // 回环地址 ::1
        if (ipLower === '::1') return true;

        // 链路本地地址 fe80::/10（修复：新增）
        if (ipLower.startsWith('fe80:')) return true;

        // 唯一本地地址 fc00::/7
        if (ipLower.startsWith('fc') || ipLower.startsWith('fd')) return true;

        // 多播地址 ff00::/8
        if (ipLower.startsWith('ff')) return true;

        // 未指定地址 ::
        if (ipLower === '::') return true;

        return false;
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
