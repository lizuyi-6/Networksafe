import chalk from 'chalk';
import axios from 'axios';
import { CryptoService } from './CryptoService';

export interface AuditEntry {
    timestamp: string;
    action: string;
    user: string;
    details: any;
    status: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'SKIPPED';
}

export class AuditService {
    private apiUrl = 'https://api.your-security-console.com/audit'; // Mock URL

    /**
     * 记录操作并尝试同步到云端（加密传输）
     */
    async log(action: string, details: any, status: AuditEntry['status'] = 'SUCCESS') {
        const entry: AuditEntry = {
            timestamp: new Date().toISOString(),
            action,
            user: process.env.USER || 'system',
            details,
            status
        };

        // 1. 本地日志
        console.log(chalk.gray(`[AUDIT] ${action} - ${status}`));

        // 2. 加密后同步到云端
        await this.syncToCloud(entry);
    }

    private async syncToCloud(entry: AuditEntry) {
        try {
            // 加密日志内容
            const plaintext = JSON.stringify(entry);
            const encryptedPayload = CryptoService.encrypt(plaintext);

            // 模拟 API 调用
            // await axios.post(this.apiUrl, { data: encryptedPayload });
            console.log(chalk.bgGray.white(` [CLOUD SYNC] 已加密上传: ${entry.action} `));
            console.log(chalk.dim(`   加密数据预览: ${encryptedPayload.substring(0, 50)}...`));
        } catch (error) {
            console.error(chalk.red('[AUDIT FAIL] 无法连接控制服务器。'));
        }
    }
}
