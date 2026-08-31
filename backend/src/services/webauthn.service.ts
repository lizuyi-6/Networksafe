/**
 * WebAuthn credential store (service-owned table).
 *
 * Persists Passkey public keys for step-up re-authentication. Schema is
 * prepared at bootstrap via bootstrapPersistence() (see bootstrap/persistence.ts),
 * mirroring hardware-authorization.service's prepare()/assertPrepared() pattern:
 * in NODE_ENV=test the schema lazily prepares so Jest tests do not need
 * bootstrap wiring.
 */

import { getDatabase } from '../config/database';
import logger from '../utils/logger';

export interface WebAuthnCredentialRecord {
    id: string; // base64url credential ID (primary key)
    user_id: string;
    name: string | null;
    public_key: string; // base64url-encoded COSE public key
    counter: number;
    transports: string | null; // JSON string[] | null
    backed_up: number; // 0/1
    device_type: string | null;
    created_at: string;
    last_used_at: string | null;
}

export interface SaveWebAuthnCredentialInput {
    id: string;
    userId: string;
    name?: string;
    publicKey: string; // base64url
    counter: number;
    transports?: string[];
    backedUp?: boolean;
    deviceType?: string;
}

class WebAuthnService {
    private schemaReady = false;

    prepare(): void {
        if (this.schemaReady) {
            return;
        }

        const db = getDatabase();
        db.exec(`
            CREATE TABLE IF NOT EXISTS webauthn_credentials (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT,
                public_key TEXT NOT NULL,
                counter INTEGER NOT NULL DEFAULT 0,
                transports TEXT,
                backed_up INTEGER NOT NULL DEFAULT 0,
                device_type TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_used_at DATETIME
            );
            CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id);
        `);

        this.schemaReady = true;
    }

    private assertPrepared(): void {
        if (this.schemaReady) {
            return;
        }
        if (process.env.NODE_ENV === 'test') {
            this.prepare();
            return;
        }
        throw new Error('WebAuthn schema not initialized. Call webauthnService.prepare() during bootstrap.');
    }

    listByUser(userId: string): WebAuthnCredentialRecord[] {
        this.assertPrepared();
        return getDatabase()
            .prepare('SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at ASC')
            .all(userId) as unknown as WebAuthnCredentialRecord[];
    }

    getCredential(credentialId: string): WebAuthnCredentialRecord | null {
        this.assertPrepared();
        return (getDatabase()
            .prepare('SELECT * FROM webauthn_credentials WHERE id = ?')
            .get(credentialId) as unknown as WebAuthnCredentialRecord | undefined) || null;
    }

    countByUser(userId: string): number {
        this.assertPrepared();
        const row = getDatabase()
            .prepare('SELECT COUNT(*) AS n FROM webauthn_credentials WHERE user_id = ?')
            .get(userId) as unknown as { n: number } | undefined;
        return row?.n || 0;
    }

    saveCredential(input: SaveWebAuthnCredentialInput): void {
        this.assertPrepared();
        getDatabase()
            .prepare(`
                INSERT INTO webauthn_credentials
                    (id, user_id, name, public_key, counter, transports, backed_up, device_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    user_id = excluded.user_id,
                    name = excluded.name,
                    public_key = excluded.public_key,
                    counter = excluded.counter,
                    transports = excluded.transports,
                    backed_up = excluded.backed_up,
                    device_type = excluded.device_type
            `)
            .run(
                input.id,
                input.userId,
                input.name || null,
                input.publicKey,
                Number.isInteger(input.counter) ? input.counter : 0,
                input.transports && input.transports.length > 0 ? JSON.stringify(input.transports) : null,
                input.backedUp ? 1 : 0,
                input.deviceType || null
            );
        logger.info('WebAuthn credential stored', { userId: input.userId, credentialId: input.id.slice(0, 12) });
    }

    deleteCredential(userId: string, credentialId: string): boolean {
        this.assertPrepared();
        // The unified run() wrapper returns no change count, so existence is
        // checked first (also enforces ownership).
        const existing = this.getCredential(credentialId);
        if (!existing || existing.user_id !== userId) {
            return false;
        }
        getDatabase()
            .prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?')
            .run(credentialId, userId);
        return true;
    }

    updateCounter(credentialId: string, counter: number): void {
        this.assertPrepared();
        // SECURITY (audit 2026-08, AUD-07-3): CAS — the counter only moves
        // forward. A concurrent assertion that lost the race cannot rewind
        // the stored counter (the db wrapper exposes no affected-row count,
        // so verify by reading back).
        getDatabase()
            .prepare('UPDATE webauthn_credentials SET counter = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ? AND counter < ?')
            .run(counter, credentialId, counter);
        const row = getDatabase()
            .prepare('SELECT counter FROM webauthn_credentials WHERE id = ?')
            .get(credentialId) as { counter?: number | string } | undefined;
        if (!row || Number(row.counter) !== counter) {
            throw new Error('backend.webauthn_counter_advance_conflict');
        }
    }

    markUsed(credentialId: string): void {
        this.assertPrepared();
        getDatabase()
            .prepare('UPDATE webauthn_credentials SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(credentialId);
    }
}

export const webauthnService = new WebAuthnService();
