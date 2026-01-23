/**
 * 前端加密工具 - AES-256-GCM
 * 符合 OWASP 加密指南和 Web Crypto API 最佳实践
 * 
 * 注意: 
 * 1. 此实现使用 Web Crypto API，需要 HTTPS 环境
 * 2. 生产环境密钥应从服务器安全获取，不应硬编码
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 100000;  // OWASP 2023 建议更高，此处为性能折中

/**
 * 将字符串转换为 ArrayBuffer
 */
function stringToArrayBuffer(str: string): ArrayBuffer {
    const encoder = new TextEncoder();
    return encoder.encode(str).buffer;
}

/**
 * 将 ArrayBuffer 转换为 Base64 字符串
 */
function arrayBufferToBase64(buffer: any): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * 将 Base64 字符串转换为 ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}



/**
 * 使用 PBKDF2 从密码派生密钥
 * @param password 用户密码
 * @param salt 盐值 (16 字节)
 * @returns 派生的 CryptoKey
 */
export async function deriveKeyFromPassword(
    password: string,
    salt: Uint8Array
): Promise<CryptoKey> {
    const passwordBuffer = stringToArrayBuffer(password);

    const baseKey = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as any,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        baseKey,
        { name: ALGORITHM, length: KEY_LENGTH },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * 生成随机盐值
 */
export function generateSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * 使用密钥加密数据
 * @param plaintext 明文
 * @param key CryptoKey 对象
 * @returns Base64 编码的加密数据 (格式: iv:ciphertext)
 */
export async function encryptWithKey(plaintext: string, key: CryptoKey): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const data = stringToArrayBuffer(plaintext);

    const encrypted = await crypto.subtle.encrypt(
        { name: ALGORITHM, iv },
        key,
        data
    );

    const ivBase64 = arrayBufferToBase64(iv.buffer);
    const ciphertextBase64 = arrayBufferToBase64(encrypted);

    return `${ivBase64}:${ciphertextBase64}`;
}

/**
 * 使用密钥解密数据
 * @param encryptedData Base64 编码的加密数据
 * @param key CryptoKey 对象
 * @returns 解密后的明文
 */
export async function decryptWithKey(encryptedData: string, key: CryptoKey): Promise<string> {
    const [ivBase64, ciphertextBase64] = encryptedData.split(':');

    if (!ivBase64 || !ciphertextBase64) {
        throw new Error('无效的加密数据格式');
    }

    const iv = new Uint8Array(base64ToArrayBuffer(ivBase64));

    if (iv.length !== IV_LENGTH) {
        throw new Error(`无效的 IV 长度: 期望 ${IV_LENGTH}，实际 ${iv.length}`);
    }

    const ciphertext = base64ToArrayBuffer(ciphertextBase64);

    const decrypted = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv },
        key,
        ciphertext as any
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
}

/**
 * 使用密码加密 (自动派生密钥)
 * @param plaintext 明文
 * @param password 密码
 * @returns Base64 编码的加密数据 (格式: salt:iv:ciphertext)
 */
export async function encryptWithPassword(plaintext: string, password: string): Promise<string> {
    const salt = generateSalt();
    const key = await deriveKeyFromPassword(password, salt);
    const encrypted = await encryptWithKey(plaintext, key);

    const saltBase64 = arrayBufferToBase64(salt.buffer);
    return `${saltBase64}:${encrypted}`;
}

/**
 * 使用密码解密
 * @param encryptedData 加密数据 (格式: salt:iv:ciphertext)
 * @param password 密码
 * @returns 解密后的明文
 */
export async function decryptWithPassword(encryptedData: string, password: string): Promise<string> {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
        throw new Error('无效的加密数据格式');
    }

    const [saltBase64, ivBase64, ciphertextBase64] = parts;
    const salt = new Uint8Array(base64ToArrayBuffer(saltBase64));
    const key = await deriveKeyFromPassword(password, salt);

    return decryptWithKey(`${ivBase64}:${ciphertextBase64}`, key);
}

/**
 * 检查浏览器是否支持 Web Crypto API
 */
export function isCryptoSupported(): boolean {
    return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}

/**
 * 加密敏感配置对象中的指定字段
 * @param obj 配置对象
 * @param sensitiveKeys 需要加密的字段名
 * @param password 加密密码
 */
export async function encryptSensitiveFields<T extends Record<string, any>>(
    obj: T,
    sensitiveKeys: (keyof T)[],
    password: string
): Promise<T> {
    if (!isCryptoSupported()) {
        throw new Error('浏览器不支持 Web Crypto API，请使用 HTTPS');
    }

    const result = { ...obj };

    for (const key of sensitiveKeys) {
        if (result[key] && typeof result[key] === 'string') {
            result[key] = await encryptWithPassword(result[key] as string, password) as any;
        }
    }

    return result;
}
