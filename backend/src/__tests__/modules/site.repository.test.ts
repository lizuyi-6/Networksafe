/**
 * Integration tests for the sites repository — CRUD + multi-tenant access control.
 *
 * The tenant-scoping in listSitesForUser / getSiteForUser / deleteSiteForUser is
 * security-relevant: a non-admin must only see/delete their own tenant's sites,
 * while admin sees all. These tests pin that contract.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { initDatabase, closeDatabase } from '../../config/database';
import {
    createSite,
    listSitesForUser,
    getSiteForUser,
    updateSite,
    deleteSiteForUser
} from '../../modules/sites/site.repository';

const testDataDir = path.join(os.tmpdir(), 'aetherguard-sites-repo-test-data');

function makeSite(overrides: Partial<{ domain: string; target: string; tenant_id: string; sslEnabled: boolean }> = {}) {
    const suffix = Math.random().toString(36).slice(2, 8);
    return {
        domain: `site-${suffix}.example.com`,
        target: '10.0.0.1',
        tenant_id: 'tenant-a' as string | undefined,
        sslEnabled: true,
        ...overrides
    };
}

describe('sites repository', () => {
    beforeAll(async () => {
        fs.rmSync(testDataDir, { recursive: true, force: true });
        process.env.DATA_DIR = testDataDir;
        await initDatabase();
    });

    afterAll(() => {
        closeDatabase();
        fs.rmSync(testDataDir, { recursive: true, force: true });
    });

    it('createSite returns an id and the row is readable', async () => {
        const id = await createSite(makeSite({ domain: 'read-back.example.com', tenant_id: 't-rb' }));
        expect(id).not.toBeNull();
        const fetched = await getSiteForUser(String(id), 'admin');
        expect(fetched?.domain).toBe('read-back.example.com');
    });

    it('createSite coerces boolean flags to 0/1 and applies defaults', async () => {
        const id = await createSite(makeSite({
            domain: 'flags.example.com', tenant_id: 't-f',
            sslEnabled: false
        }));
        const row = await getSiteForUser(String(id), 'admin');
        expect(Number(row?.sslEnabled)).toBe(0);
        expect(row?.rateLimitRequests).toBe(60); // default
        expect(row?.concurrencyMax).toBe(5);     // default
    });

    it('listSitesForUser: admin sees all sites, non-admin sees only their tenant', async () => {
        const a1 = await createSite(makeSite({ domain: 'a1.example.com', tenant_id: 'tenant-a' }));
        const a2 = await createSite(makeSite({ domain: 'a2.example.com', tenant_id: 'tenant-a' }));
        const b1 = await createSite(makeSite({ domain: 'b1.example.com', tenant_id: 'tenant-b' }));

        const adminView = await listSitesForUser('admin');
        const adminIds = adminView.map((s) => s.id);
        expect(adminIds).toEqual(expect.arrayContaining([a1, a2, b1]));

        const tenantAView = await listSitesForUser('user', 'tenant-a');
        const tenantAIds = tenantAView.map((s) => s.id);
        expect(tenantAIds).toEqual(expect.arrayContaining([a1, a2]));
        expect(tenantAIds).not.toContain(b1); // tenant isolation
    });

    it('getSiteForUser: non-admin cannot read another tenant site (returns null)', async () => {
        const id = await createSite(makeSite({ domain: 'secret.example.com', tenant_id: 'tenant-a' }));
        // tenant-b user asks for tenant-a's site
        const cross = await getSiteForUser(String(id), 'user', 'tenant-b');
        expect(cross).toBeFalsy(); // no row for foreign tenant (null or undefined)
        // same-tenant user can read it
        const own = await getSiteForUser(String(id), 'user', 'tenant-a');
        expect(own?.domain).toBe('secret.example.com');
    });

    it('updateSite applies COALESCE partial updates (null = leave unchanged)', async () => {
        const id = await createSite(makeSite({ domain: 'upd.example.com', tenant_id: 't-u', sslEnabled: true }));
        // only flip ssl off; leave domain/target intact
        await updateSite(String(id), { sslEnabled: false });
        const row = await getSiteForUser(String(id), 'admin');
        expect(Number(row?.sslEnabled)).toBe(0);
        expect(row?.domain).toBe('upd.example.com'); // unchanged
        expect(row?.target).toBe('10.0.0.1');        // unchanged
    });

    it('deleteSiteForUser: non-admin cannot delete another tenant site (0 changes)', async () => {
        const id = await createSite(makeSite({ domain: 'del.example.com', tenant_id: 'tenant-a' }));
        // tenant-b user tries to delete tenant-a's site
        const blocked = await deleteSiteForUser(id as unknown as string, 'user', 'tenant-b');
        expect(blocked).toBe(0);
        // still present
        expect(await getSiteForUser(String(id), 'admin')).toBeTruthy();
        // same-tenant user deletes it
        const ok = await deleteSiteForUser(id as unknown as string, 'user', 'tenant-a');
        expect(ok).toBe(1);
        expect(await getSiteForUser(String(id), 'admin')).toBeFalsy();
    });

    it('admin can delete any site regardless of tenant', async () => {
        const id = await createSite(makeSite({ domain: 'adm-del.example.com', tenant_id: 'tenant-x' }));
        const changes = await deleteSiteForUser(id as unknown as string, 'admin');
        expect(changes).toBe(1);
    });
});
