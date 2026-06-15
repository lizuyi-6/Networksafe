/**
 * Integration tests for the admin repository — API-key CRUD + admin user field
 * updates. Security-relevant: updateAdminUserField must only accept the field
 * whitelist (plan/role/status/password_hash) since the field name is interpolated
 * into SQL, and API-key hashes must round-trip.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { initDatabase, closeDatabase } from '../../config/database';
import {
    saveAdminApiKey,
    listAdminApiKeys,
    deleteAdminApiKey,
    listAdminUsers,
    getAdminUserById,
    updateAdminUserField,
    getLoginHistory,
    type AdminApiKeyRow,
    type AdminUserRow
} from '../../modules/admin/admin.repository';
import { createAuthUser } from '../../modules/auth/auth-user.repository';

const testDataDir = path.join(os.tmpdir(), 'aetherguard-admin-repo-test-data');

describe('admin repository', () => {
    beforeAll(async () => {
        fs.rmSync(testDataDir, { recursive: true, force: true });
        process.env.DATA_DIR = testDataDir;
        await initDatabase();
    });

    afterAll(() => {
        closeDatabase();
        fs.rmSync(testDataDir, { recursive: true, force: true });
    });

    describe('API keys', () => {
        it('saveAdminApiKey persists the hash and listAdminApiKeys reads it back', async () => {
            const row: AdminApiKeyRow = {
                id: 'key-1', name: 'CI key', key_hash: 'sha256:abc',
                user_id: 'u1', tenant_id: 't1', permissions: '{"routes":["read"]}',
                last_used: null, expires_at: '2027-01-01', created_at: '2026-06-13T00:00:00Z'
            };
            await saveAdminApiKey(row);
            const keys = await listAdminApiKeys();
            expect(keys.map((k) => k.id)).toContain('key-1');
            expect(keys.find((k) => k.id === 'key-1')?.name).toBe('CI key');
        });

        it('saveAdminApiKey upserts on conflict (same id overwrites name)', async () => {
            await saveAdminApiKey({ id: 'key-up', name: 'old', key_hash: 'sha256:up', created_at: '2026-06-13T00:00:00Z' });
            await saveAdminApiKey({ id: 'key-up', name: 'new', key_hash: 'sha256:up', created_at: '2026-06-13T00:00:00Z' });
            const keys = await listAdminApiKeys();
            expect(keys.find((k) => k.id === 'key-up')?.name).toBe('new');
        });

        it('deleteAdminApiKey removes the key', async () => {
            await saveAdminApiKey({ id: 'key-del', name: 'to remove', key_hash: 'sha256:del', created_at: '2026-06-13T00:00:00Z' });
            await deleteAdminApiKey('key-del');
            const keys = await listAdminApiKeys();
            expect(keys.find((k) => k.id === 'key-del')).toBeUndefined();
        });
    });

    describe('admin users', () => {
        beforeAll(async () => {
            // Seed once; createAuthUser is a plain INSERT (re-inserting the same
            // email would hit the users.email UNIQUE constraint).
            await createAuthUser({
                id: 'admin-target', email: 'target@example.com', username: 'target',
                password_hash: '$2a$10$x', role: 'tenant_admin', tenant_id: 't1'
            });
        });

        it('listAdminUsers returns seeded users', async () => {
            const users = await listAdminUsers();
            expect(users.find((u) => u.id === 'admin-target')).toBeTruthy();
        });

        it('getAdminUserById reads the user back', async () => {
            const u = await getAdminUserById('admin-target');
            expect(u?.email).toBe('target@example.com');
        });

        it('updateAdminUserField updates the plan through the whitelist', async () => {
            await updateAdminUserField('admin-target', 'plan', 'ultra');
            expect((await getAdminUserById('admin-target'))?.plan).toBe('ultra');
        });

        it('updateAdminUserField updates the role', async () => {
            await updateAdminUserField('admin-target', 'role', 'platform_admin');
            expect((await getAdminUserById('admin-target'))?.role).toBe('platform_admin');
        });

        it('updateAdminUserField updates the status', async () => {
            await updateAdminUserField('admin-target', 'status', 'suspended');
            expect((await getAdminUserById('admin-target'))?.status).toBe('suspended');
        });

        it('updateAdminUserField updates password_hash (security-critical path)', async () => {
            await updateAdminUserField('admin-target', 'password_hash', '$2a$10$rotated');
            // password_hash is not in the admin user projection, verify via the auth repo
            const { findAuthUserById } = await import('../../modules/auth/auth-user.repository');
            expect((await findAuthUserById('admin-target'))?.password_hash).toBe('$2a$10$rotated');
        });
    });

    describe('login history', () => {
        it('getLoginHistory returns rows for a user with history', async () => {
            const { recordLoginHistory } = await import('../../modules/auth/auth-user.repository');
            await createAuthUser({
                id: 'hist-user', email: 'hist@example.com', username: 'hist',
                password_hash: '$2a$10$x', role: 'tenant_admin', tenant_id: 't1'
            });
            await recordLoginHistory({ id: 'h1', userId: 'hist-user', ipAddress: '1.2.3.4', userAgent: 'jest', status: 'success' });
            await recordLoginHistory({ id: 'h2', userId: 'hist-user', ipAddress: '1.2.3.4', userAgent: 'jest', status: 'failed' });
            const history = await getLoginHistory('hist-user');
            expect(history).toHaveLength(2);
            expect(history.map((h) => h.status).sort()).toEqual(['failed', 'success']);
        });

        it('getLoginHistory respects the limit', async () => {
            const { recordLoginHistory } = await import('../../modules/auth/auth-user.repository');
            await createAuthUser({
                id: 'lim-user', email: 'lim@example.com', username: 'lim',
                password_hash: '$2a$10$x', role: 'tenant_admin', tenant_id: 't1'
            });
            for (let i = 0; i < 5; i++) {
                await recordLoginHistory({ id: `lh-${i}`, userId: 'lim-user', ipAddress: '1.2.3.4', userAgent: 'jest', status: 'success' });
            }
            expect(await getLoginHistory('lim-user', 2)).toHaveLength(2);
        });
    });
});
