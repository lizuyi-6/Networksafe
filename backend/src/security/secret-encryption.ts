/**
 * SECURITY (audit 2026-08, AUD-07-5): at-rest envelope encryption for
 * service secrets (AI endpoint API keys today; SMTP/webhook credentials can
 * adopt the same helpers).
 *
 * Sealed format: `enc1:<iv b64url>:<authTag b64url>:<ciphertext b64url>`
 * AES-256-GCM with a key derived via scrypt from the mandatory
 * ENCRYPTION_KEY/ENCRYPTION_SALT pair and a purpose-specific label, so the
 * derived key is never shared with other consumers of the same env pair.
 *
 * Legacy rows stored before this module are plaintext; `sealApiKey` is
 * applied on every write, and reads transparently open sealed values while
 * passing legacy plaintext through until rotation rewrites them.
 */

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc1:';

let cachedKey: Buffer | null = null;

function derivedKey(): Buffer {
    if (cachedKey) {
        return cachedKey;
    }
    const passphrase = String(process.env.ENCRYPTION_KEY || '');
    const salt = String(process.env.ENCRYPTION_SALT || '');
    if (!passphrase || !salt) {
        throw new Error('backend.secret_encryption_key_missing');
    }
    cachedKey = crypto.scryptSync(passphrase, `aetherguard:secret-encryption:v1:${salt}`, 32);
    return cachedKey;
}

export function isSealedSecret(value: string): boolean {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, derivedKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

/** Returns null when the value is not a sealed envelope. */
export function decryptSecret(sealed: string): string | null {
    if (!isSealedSecret(sealed)) {
        return null;
    }
    const [, ivPart, tagPart, dataPart] = sealed.split(':');
    if (!ivPart || !tagPart || !dataPart) {
        return null;
    }
    try {
        const decipher = crypto.createDecipheriv(ALGO, derivedKey(), Buffer.from(ivPart, 'base64url'));
        decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
        return null;
    }
}
