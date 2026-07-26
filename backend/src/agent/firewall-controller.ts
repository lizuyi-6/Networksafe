/**
 * 防火墙控制器
 * 
 * 调用系统防火墙工具封禁/解封 IP:
 * - Linux: iptables / firewalld / ufw
 * - Windows: netsh
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import logger from '../utils/logger';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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
    private readonly backendReady: Promise<void>;

    constructor() {
        this.backendReady = this.detectBackend();
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
        await this.backendReady;

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
        await this.backendReady;

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

    // === iptables 实现 - SECURITY FIX: 使用 execFile 防止命令注入 ===

    private async blockWithIptables(ip: string): Promise<boolean> {
        try {
            // 使用 execFile 代替 exec，防止命令注入
            // 参数作为数组传递，不进行 shell 解析
            const args = ['-A', 'INPUT', '-s', ip, '-j', 'DROP'];
            await execFileAsync('iptables', args);
            logger.info(`iptables: Blocked IP ${ip}`);
            return true;
        } catch (error: any) {
            logger.error(`iptables block failed: ${error.message}`);
            return false;
        }
    }

    private async unblockWithIptables(ip: string): Promise<boolean> {
        try {
            const args = ['-D', 'INPUT', '-s', ip, '-j', 'DROP'];
            await execFileAsync('iptables', args);
            logger.info(`iptables: Unblocked IP ${ip}`);
            return true;
        } catch (error: any) {
            logger.error(`iptables unblock failed: ${error.message}`);
            return false;
        }
    }

    // === firewalld 实现 - SECURITY FIX: 使用 execFile 防止命令注入 ===

    private async blockWithFirewalld(ip: string): Promise<boolean> {
        try {
            // 使用参数化命令执行
            const args = [
                '--add-rich-rule',
                `rule family="ipv4" source address="${ip}" reject`
            ];
            await execFileAsync('firewall-cmd', args);
            logger.info(`firewalld: Blocked IP ${ip}`);
            return true;
        } catch (error: any) {
            logger.error(`firewalld block failed: ${error.message}`);
            return false;
        }
    }

    private async unblockWithFirewalld(ip: string): Promise<boolean> {
        try {
            const args = [
                '--remove-rich-rule',
                `rule family="ipv4" source address="${ip}" reject`
            ];
            await execFileAsync('firewall-cmd', args);
            logger.info(`firewalld: Unblocked IP ${ip}`);
            return true;
        } catch (error: any) {
            logger.error(`firewalld unblock failed: ${error.message}`);
            return false;
        }
    }

    // === ufw 实现 - SECURITY FIX: 使用 execFile 防止命令注入 ===

    private async blockWithUfw(ip: string): Promise<boolean> {
        try {
            // 使用参数化命令执行
            const args = ['deny', 'from', ip];
            await execFileAsync('ufw', args);
            logger.info(`ufw: Blocked IP ${ip}`);
            return true;
        } catch (error: any) {
            logger.error(`ufw block failed: ${error.message}`);
            return false;
        }
    }

    private async unblockWithUfw(ip: string): Promise<boolean> {
        try {
            const args = ['delete', 'deny', 'from', ip];
            await execFileAsync('ufw', args);
            logger.info(`ufw: Unblocked IP ${ip}`);
            return true;
        } catch (error: any) {
            logger.error(`ufw unblock failed: ${error.message}`);
            return false;
        }
    }

    // === Windows netsh 实现 - SECURITY FIX: 使用 execFile 防止命令注入 ===

    private async blockWithNetsh(ip: string): Promise<boolean> {
        try {
            // 生成安全的规则名称
            const ruleName = `AetherGuard_Block_${ip.replace(/\./g, '_')}`;

            // 使用参数化命令执行
            const args = [
                'advfirewall',
                'firewall',
                'add',
                'rule',
                `name=${ruleName}`,
                'dir=in',
                'action=block',
                `remoteip=${ip}`
            ];
            await execFileAsync('netsh', args);
            logger.info(`netsh: Blocked IP ${ip}`);
            return true;
        } catch (error: any) {
            logger.error(`netsh block failed: ${error.message}`);
            return false;
        }
    }

    private async unblockWithNetsh(ip: string): Promise<boolean> {
        try {
            const ruleName = `AetherGuard_Block_${ip.replace(/\./g, '_')}`;

            const args = [
                'advfirewall',
                'firewall',
                'delete',
                'rule',
                `name=${ruleName}`
            ];
            await execFileAsync('netsh', args);
            logger.info(`netsh: Unblocked IP ${ip}`);
            return true;
        } catch (error: any) {
            logger.error(`netsh unblock failed: ${error.message}`);
            return false;
        }
    }

    // === 辅助方法 ===

    /**
     * 验证 IP 格式 - SECURITY FIX: 严格验证防止命令注入
     */
    private isValidIP(ip: string): boolean {
        // 严格IPv4验证: 每个八位字节必须是0-255
        const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        // 严格IPv6验证
        const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$/;

        // 额外安全检查: 确保没有shell特殊字符
        const shellChars = /[;&|`$(){}[\]<>\\'"!#%^*?\n\r\t]/;
        if (shellChars.test(ip)) {
            logger.warn(`Blocked IP with shell characters: ${ip}`);
            return false;
        }

        return ipv4Regex.test(ip) || ipv6Regex.test(ip);
    }

    /**
     * 检查是否为本地 IP
     * SECURITY FIX CVE-2026-022: Complete private IP range detection
     */
    private isLocalIP(ip: string): boolean {
        // IPv4 loopback
        if (ip === '127.0.0.1' || ip.startsWith('127.')) {
            return true;
        }

        // IPv6 loopback
        if (ip === '::1') {
            return true;
        }

        // Private ranges (RFC 1918)
        if (ip.startsWith('10.')) {
            return true;
        }

        if (ip.startsWith('192.168.')) {
            return true;
        }

        // SECURITY FIX CVE-2026-022: Check full 172.16.0.0/12 range (172.16.0.0 - 172.31.255.255)
        const parts = ip.split('.');
        if (parts[0] === '172') {
            const secondOctet = parseInt(parts[1], 10);
            if (secondOctet >= 16 && secondOctet <= 31) {
                return true;
            }
        }

        // Link-local (APIPA)
        if (ip.startsWith('169.254.')) {
            return true;
        }

        // IPv6 link-local
        if (ip.toLowerCase().startsWith('fe80:')) {
            return true;
        }

        // IPv6 unique local addresses
        if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) {
            return true;
        }

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
        await this.backendReady;

        for (const ip of this.blockedIPs.keys()) {
            await this.unblockIP(ip);
        }
    }
}
