/**
 * Log State Service
 *
 * Pure state container for in-memory log storage.
 * Extracted from logs.routes.ts – no Express/Router dependency.
 */

import logger from '../utils/logger';
import { isDemoMode } from '../config/app-mode';

export interface LogItem {
    id: number;
    time: string;
    type: string;
    level: string;
    message: string;
    ip: string;
    status?: number;
    method?: string;
    path?: string;
}

let logCounter = 0;
const recentLogs: LogItem[] = [];

export function addLog(log: Omit<LogItem, 'id' | 'time'>): LogItem {
    const newLog: LogItem = {
        ...log,
        id: ++logCounter,
        time: new Date().toISOString()
    };
    recentLogs.unshift(newLog);
    if (recentLogs.length > 500) {
        recentLogs.pop();
    }
    return newLog;
}

export function getRecentLogs(): LogItem[] {
    return recentLogs;
}

export function getLogCounter(): number {
    return logCounter;
}

// Seed some initial log entries from the attack dataset
function seedLogs(): void {
    const seeds: Omit<LogItem, 'id' | 'time'>[] = [
        { type: 'sql_injection', level: 'CRITICAL', message: 'UNION SELECT injection blocked', ip: '55.31.193.78', status: 403, method: 'POST', path: '/api/login' },
        { type: 'sql_injection', level: 'HIGH', message: 'OR-based authentication bypass attempt', ip: '182.19.207.223', status: 403, method: 'POST', path: '/api/login' },
        { type: 'sql_injection', level: 'CRITICAL', message: 'BENCHMARK-based blind injection detected', ip: '3.117.221.109', status: 403, method: 'POST', path: '/api/search' },
        { type: 'xss', level: 'HIGH', message: 'Reflected XSS attempt via script tag', ip: '100.221.205.11', status: 403, method: 'GET', path: '/api/search' },
        { type: 'xss', level: 'MEDIUM', message: 'DOM-based XSS via event handler', ip: '71.28.115.144', status: 403, method: 'POST', path: '/api/comments' },
        { type: 'command_injection', level: 'CRITICAL', message: 'OS command injection attempt: whoami', ip: '94.1.104.252', status: 403, method: 'POST', path: '/api/exec' },
        { type: 'command_injection', level: 'CRITICAL', message: 'Reverse shell injection detected', ip: '189.253.57.132', status: 403, method: 'POST', path: '/api/upload' },
        { type: 'path_traversal', level: 'HIGH', message: 'Directory traversal attempt: ../../../etc/passwd', ip: '203.0.113.45', status: 403, method: 'GET', path: '/api/files' },
        { type: 'path_traversal', level: 'HIGH', message: 'Path traversal via encoding bypass', ip: '50.233.44.112', status: 403, method: 'GET', path: '/api/download' },
        { type: 'brute_force', level: 'MEDIUM', message: 'Brute force login attempt (10th failure)', ip: '57.77.133.206', status: 429, method: 'POST', path: '/api/login' },
        { type: 'brute_force', level: 'HIGH', message: 'Credential stuffing attack detected', ip: '156.188.252.23', status: 429, method: 'POST', path: '/api/login' },
        { type: 'ddos', level: 'CRITICAL', message: 'Volumetric DDoS attack detected (500+ req/s)', ip: '207.5.186.188', status: 429, method: 'GET', path: '/api/health' },
        { type: 'port_scan', level: 'HIGH', message: 'Port scan detected: sequential probe on 100+ ports', ip: '16.215.142.246', status: 403, method: 'GET', path: '/api/scan' },
        { type: 'security', level: 'INFO', message: 'Rate limiter triggered for IP range 57.77.133.0/24', ip: '57.77.133.206', status: 429, method: 'POST', path: '/api/login' },
        { type: 'security', level: 'INFO', message: 'IP reputation check: malicious IP blocked', ip: '94.1.104.252', status: 403, method: 'GET', path: '/api/data' },
        { type: 'authentication', level: 'WARN', message: 'Suspicious login pattern: multiple failures from single IP', ip: '182.19.207.223', status: 401, method: 'POST', path: '/api/login' },
    ];

    for (const s of seeds) {
        addLog(s);
    }
}

// Only seed logs in demo mode - production starts clean
if (isDemoMode()) {
    seedLogs();
}
