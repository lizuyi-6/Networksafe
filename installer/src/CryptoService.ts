import crypto from 'crypto';

/**
 * AES-256-GCM 加密服务
 * 符合 NIST SP 800-38D 和 OWASP 加密指南
 */
export class CryptoService {
    private static readonly ALGORITHM = 'aes-256-gcm';
    private static readonly IV_LENGTH = 12;          // GCM 推荐 96-bit
    private static readonly AUTH_TAG_LENGTH = 16;    // 128-bit 认证标签
    private static readonly KEY_LENGTH = 32;         // 256-bit 密钥
    private static readonly SALT_LENGTH = 16;        // 用于密钥派生

    /**
     * 获取加密密钥
     * 生产环境应从 KMS/HashiCorp Vault 等安全存储获取
     */
    private static getKey(): Buffer {
        const key = process.env.ENCRYPTION_KEY;

        if (!key) {
            throw new Error('[安全错误] 未设置 ENCRYPTION_KEY 环境变量');
        }

        const keyBuffer = Buffer.from(key, 'base64');

        if (keyBuffer.length !== this.KEY_LENGTH) {
            throw new Error(`[安全错误] 密钥长度必须为 ${this.KEY_LENGTH} 字节 (256-bit)`);
        }

        return keyBuffer;
    }

    /**
     * 使用 PBKDF2 从密码派生密钥 (用于用户密码加密场景)
     * @param password 用户密码
     * @param salt 盐值 (如果未提供则生成新盐)
     * @returns { key, salt } 派生密钥和盐值
     */
    static deriveKey(password: string, salt?: Buffer): { key: Buffer; salt: Buffer } {
        const usedSalt = salt || crypto.randomBytes(this.SALT_LENGTH);
        const key = crypto.pbkdf2Sync(
            password,
            usedSalt,
            100000,              // 迭代次数 (OWASP 2023 建议 >= 600,000，此处为性能折中)
            this.KEY_LENGTH,
            'sha256'
        );
        return { key, salt: usedSalt };
    }

    /**
     * 加密数据
     * @param plaintext 明文数据
     * @returns Base64 编码的加密数据 (格式: iv:authTag:ciphertext)
     */
    static encrypt(plaintext: string): string {
        const key = this.getKey();
        const iv = crypto.randomBytes(this.IV_LENGTH);

        const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv, {
            authTagLength: this.AUTH_TAG_LENGTH,
        });

        let encrypted = cipher.update(plaintext, 'utf8', 'base64');
        encrypted += cipher.final('base64');

        const authTag = cipher.getAuthTag();

        // 格式: iv:authTag:ciphertext (全部 Base64 编码)
        return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
    }

    /**
     * 使用指定密钥加密 (用于派生密钥场景)
     */
    static encryptWithKey(plaintext: string, key: Buffer): string {
        if (key.length !== this.KEY_LENGTH) {
            throw new Error(`密钥长度必须为 ${this.KEY_LENGTH} 字节`);
        }

        const iv = crypto.randomBytes(this.IV_LENGTH);
        const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv, {
            authTagLength: this.AUTH_TAG_LENGTH,
        });

        let encrypted = cipher.update(plaintext, 'utf8', 'base64');
        encrypted += cipher.final('base64');

        const authTag = cipher.getAuthTag();
        return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
    }

    /**
     * 解密数据
     * @param encryptedData Base64 编码的加密数据
     * @returns 解密后的明文
     */
    static decrypt(encryptedData: string): string {
        const key = this.getKey();
        return this.decryptWithKey(encryptedData, key);
    }

    /**
     * 使用指定密钥解密
     */
    static decryptWithKey(encryptedData: string, key: Buffer): string {
        const parts = encryptedData.split(':');
        if (parts.length !== 3) {
            throw new Error('无效的加密数据格式');
        }

        const [ivB64, authTagB64, ciphertext] = parts;
        const iv = Buffer.from(ivB64, 'base64');
        const authTag = Buffer.from(authTagB64, 'base64');

        // 验证 IV 和 AuthTag 长度
        if (iv.length !== this.IV_LENGTH) {
            throw new Error('无效的 IV 长度');
        }
        if (authTag.length !== this.AUTH_TAG_LENGTH) {
            throw new Error('无效的认证标签长度');
        }

        const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv, {
            authTagLength: this.AUTH_TAG_LENGTH,
        });
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    /**
     * 生成随机密钥 (用于初始化或密钥轮换)
     * @returns Base64 编码的 256-bit 随机密钥
     */
    static generateKey(): string {
        return crypto.randomBytes(this.KEY_LENGTH).toString('base64');
    }

    /**
     * 安全比较两个字符串 (防止时序攻击)
     */
    static secureCompare(a: string, b: string): boolean {
        const bufA = Buffer.from(a);
        const bufB = Buffer.from(b);

        if (bufA.length !== bufB.length) {
            return false;
        }

        return crypto.timingSafeEqual(bufA, bufB);
    }
}
