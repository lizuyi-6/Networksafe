/**
 * Integration tests for the auth-user repository — the credential store behind
 * login/password-reset. Security-relevant: password hashes must be stored and
 * updated correctly, and lookups must return the hash for verification.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { initDatabase, closeDatabase, getDatabase } from '../../config/database';
import {
    createAuthUser,
    findAuthUserByEmail,
    findAuthUserById,
    touchAuthUserLastLogin,
    updateAuthUserPassword,
    recordLoginHistory,
    type AuthUserRow
} from '../../modules/auth/auth-user.repository';

const testDataDir = path.join(os.tmpdir(), 'aetherguard-auth-user-repo-test-data');

function makeUser(overrides: Partial<AuthUserRow> = {}): AuthUserRow {
    const suffix = Math.random().toString(36).slice(2, 8);
    return {
        id: `user-${suffix}`,
        email: `user-${suffix}@example.com`,
        username: `user-${suffix}`,
        password_hash: '$2a$10$originalhashvalue',
        role: 'platform_admin',
        tenant_id: 'tenant-a',
        ...overrides
    };
}

describe('auth-user repository', () => {
    beforeAll(async () => {
        fs.rmSync(testDataDir, { recursive: true, force: true });
        process.env.DATA_DIR = testDataDir;
        await initDatabase();
    });

    afterAll(() => {
        closeDatabase();
        fs.rmSync(testDataDir, { recursive: true, force: true });
    });

    it('createAuthUser applies plan/status defaults and stores the password hash', async () => {
        const user = makeUser({ id: 'user-defaults' });
        await createAuthUser(user);
        const fetched = await findAuthUserById('user-defaults');
        expect(fetched).toBeTruthy();
        expect(fetched?.email).toBe(user.email);
        expect(fetched?.password_hash).toBe('$2a$10$originalhashvalue');
        expect(fetched?.plan).toBe('starter');  // default
        expect(fetched?.status).toBe('active'); // default
    });

    it('createAuthUser honors explicit plan/status', async () => {
        await createAuthUser(makeUser({ id: 'user-pro', plan: 'ultra', status: 'suspended' }));
        const fetched = await findAuthUserById('user-pro');
        expect(fetched?.plan).toBe('ultra');
        expect(fetched?.status).toBe('suspended');
    });

    it('findAuthUserByEmail returns the row with the password hash for verification', async () => {
        await createAuthUser(makeUser({ id: 'user-email', email: 'findme@example.com', password_hash: '$2a$10$secret' }));
        const byEmail = await findAuthUserByEmail('findme@example.com');
        expect(byEmail).toBeTruthy();
        expect(byEmail?.id).toBe('user-email');
        expect(byEmail?.password_hash).toBe('$2a$10$secret');
    });

    it('findAuthUserByEmail is case-sensitive (does not find differently-cased email)', async () => {
        await createAuthUser(makeUser({ id: 'user-case', email: 'CaseSensitive@example.com' }));
        expect(await findAuthUserByEmail('casesensitive@example.com')).toBeFalsy();
    });

    it('findAuthUserById returns null for a missing id', async () => {
        expect(await findAuthUserById('does-not-exist')).toBeFalsy();
    });

    it('updateAuthUserPassword replaces only the hash (other fields intact)', async () => {
        await createAuthUser(makeUser({ id: 'user-pw', email: 'pw@example.com', password_hash: '$2a$10$old' }));
        await updateAuthUserPassword('user-pw', '$2a$10$new');
        const fetched = await findAuthUserById('user-pw');
        expect(fetched?.password_hash).toBe('$2a$10$new');
        // Other identifying fields unchanged.
        expect(fetched?.email).toBe('pw@example.com');
        expect(fetched?.role).toBe('platform_admin');
    });

    it('touchAuthUserLastLogin sets last_login', async () => {
        await createAuthUser(makeUser({ id: 'user-login' }));
        await touchAuthUserLastLogin('user-login', '2026-06-13T12:00:00Z');
        const fetched = await findAuthUserById('user-login');
        expect(fetched?.last_login).toBe('2026-06-13T12:00:00Z');
    });

    it('recordLoginHistory inserts a login_history row', async () => {
        await createAuthUser(makeUser({ id: 'user-hist' }));
        await recordLoginHistory({
            id: 'hist-1', userId: 'user-hist', ipAddress: '10.0.0.1',
            userAgent: 'test-agent', status: 'success'
        });
        const rows = getDatabase().prepare('SELECT * FROM login_history WHERE user_id = ?').all('user-hist');
        expect(rows).toHaveLength(1);
        expect((rows[0] as any).status).toBe('success');
        expect((rows[0] as any).ip_address).toBe('10.0.0.1');
    });
});
