/**
 * 输入验证工具
 * 用于防止命令注入、SQL注入等安全漏洞
 */

import logger from './logger';

/**
 * 验证IPv4地址格式
 * 严格验证每个八位字节范围 (0-255)
 */
export function validateIPv4(ip: string): boolean {
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipv4Regex.test(ip);
}

/**
 * 验证IPv6地址格式
 */
export function validateIPv6(ip: string): boolean {
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$/;
    return ipv6Regex.test(ip);
}

/**
 * 验证IP地址 (IPv4 或 IPv6)
 * 包含额外的安全检查防止命令注入
 */
export function validateIP(ip: string): boolean {
    // 基础长度检查
    if (!ip || typeof ip !== 'string') {
        return false;
    }

    // 长度限制
    if (ip.length > 45) { // IPv6最大长度
        logger.warn(`IP address too long: ${ip.length} chars`);
        return false;
    }

    // 安全检查: 拒绝包含shell特殊字符的输入
    const shellSpecialChars = /[;&|`$(){}[\]<>\\'"!#%^*?\n\r\t\x00-\x1f\x7f-\xff]/;
    if (shellSpecialChars.test(ip)) {
        logger.warn(`Blocked IP with shell special characters: ${ip}`);
        return false;
    }

    // 验证IP格式
    return validateIPv4(ip) || validateIPv6(ip);
}

/**
 * 验证端口范围
 */
export function validatePort(port: number): boolean {
    return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * 净化字符串输入 (移除危险字符)
 */
export function sanitizeString(input: string, maxLength: number = 255): string {
    if (!input || typeof input !== 'string') {
        return '';
    }

    // 截断长度
    let sanitized = input.slice(0, maxLength);

    // 移除控制字符和危险字符
    sanitized = sanitized.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

    return sanitized;
}

/**
 * 验证CIDR格式 (如 192.168.1.0/24)
 */
export function validateCIDR(cidr: string): boolean {
    if (!cidr || typeof cidr !== 'string') {
        return false;
    }

    const parts = cidr.split('/');
    if (parts.length !== 2) {
        return false;
    }

    const [ip, mask] = parts;
    const maskNum = parseInt(mask, 10);

    return validateIPv4(ip) && maskNum >= 0 && maskNum <= 32;
}

/**
 * 验证域名格式
 */
export function validateDomain(domain: string): boolean {
    if (!domain || typeof domain !== 'string') {
        return false;
    }

    // 域名长度限制
    if (domain.length > 253) {
        return false;
    }

    // 域名格式验证
    const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    return domainRegex.test(domain);
}

/**
 * 白名单验证 - 只允许指定字符
 */
export function whitelistValidate(input: string, allowedChars: RegExp): boolean {
    if (!input || typeof input !== 'string') {
        return false;
    }
    return allowedChars.test(input);
}

/**
 * 验证UUID格式
 */
export function validateUUID(uuid: string): boolean {
    if (!uuid || typeof uuid !== 'string') {
        return false;
    }
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
    return uuidRegex.test(uuid);
}

export default {
    validateIP,
    validateIPv4,
    validateIPv6,
    validatePort,
    sanitizeString,
    validateCIDR,
    validateDomain,
    whitelistValidate,
    validateUUID
};
