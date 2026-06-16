/**
 * Integration tests for the deployment-profile repository — the per-site/per-server
 * generated config store. Covers schema bootstrap, save/get round-trip, tenant +
 * site filtering, version auto-increment, and upsert (INSERT OR REPLACE).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { initDatabase, closeDatabase } from '../../config/database';
import {
    ensureDeploymentProfileSchema,
    saveDeploymentProfile,
    getDeploymentProfile,
    listDeploymentProfiles,
    getNextDeploymentProfileVersion,
    type DeploymentProfileRow
} from '../../modules/deployments/deployment-profile.repository';

const testDataDir = path.join(os.tmpdir(), 'aetherguard-deploy-profile-test-data');
const tenantA = 'tenant-a';
const tenantB = 'tenant-b';

function makeRow(overrides: Partial<DeploymentProfileRow> = {}): DeploymentProfileRow {
    const suffix = Math.random().toString(36).slice(2, 8);
    return {
        id: `prof-${suffix}`,
        tenant_id: tenantA,
        site_id: 'site-1',
        server_type: 'nginx',
        name: 'edge profile',
        profile_json: JSON.stringify({ rateLimit: 100 }),
        config_text: 'server { listen 80; }',
        env_snippet: 'AETHERGUARD_UPSTREAM=http://backend',
        checksum: `sha256:${suffix}`,
        version: 1,
        created_by: 'admin-1',
        created_at: new Date().toISOString(),
        ...overrides
    };
}

describe('deployment-profile repository', () => {
    beforeAll(async () => {
        fs.rmSync(testDataDir, { recursive: true, force: true });
        process.env.DATA_DIR = testDataDir;
        await initDatabase();
        ensureDeploymentProfileSchema();
    });

    afterAll(() => {
        closeDatabase();
        fs.rmSync(testDataDir, { recursive: true, force: true });
    });

    it('ensureDeploymentProfileSchema is idempotent', () => {
        expect(() => ensureDeploymentProfileSchema()).not.toThrow();
        expect(() => ensureDeploymentProfileSchema()).not.toThrow();
    });

    it('saveDeploymentProfile persists and getDeploymentProfile reads it back', async () => {
        const row = makeRow({ id: 'prof-roundtrip', tenant_id: tenantA });
        await saveDeploymentProfile(row);
        const fetched = await getDeploymentProfile('prof-roundtrip', tenantA);
        expect(fetched).toBeTruthy();
        expect(fetched?.server_type).toBe('nginx');
        expect(fetched?.config_text).toBe('server { listen 80; }');
        expect(fetched?.checksum).toBe(row.checksum);
    });

    it('getDeploymentProfile is tenant-scoped (foreign tenant sees nothing)', async () => {
        await saveDeploymentProfile(makeRow({ id: 'prof-iso', tenant_id: tenantA }));
        expect(await getDeploymentProfile('prof-iso', tenantB)).toBeFalsy();
        expect(await getDeploymentProfile('prof-iso', tenantA)).toBeTruthy();
    });

    it('saveDeploymentProfile upserts on conflict (same id overwrites)', async () => {
        await saveDeploymentProfile(makeRow({ id: 'prof-up', name: 'old', version: 1, config_text: 'v1' }));
        await saveDeploymentProfile(makeRow({ id: 'prof-up', name: 'new', version: 2, config_text: 'v2' }));
        const fetched = await getDeploymentProfile('prof-up', tenantA);
        expect(fetched?.name).toBe('new');
        expect(fetched?.version).toBe(2);
        expect(fetched?.config_text).toBe('v2');
    });

    it('listDeploymentProfiles filters by tenant and respects the limit', async () => {
        // Distinct ids + ascending created_at so ordering is deterministic.
        const base = Date.now();
        for (let i = 0; i < 3; i++) {
            await saveDeploymentProfile(makeRow({
                id: `prof-list-a${i}`,
                tenant_id: tenantA,
                site_id: 'site-1',
                created_at: new Date(base + i * 1000).toISOString()
            }));
        }
        await saveDeploymentProfile(makeRow({ id: 'prof-list-b0', tenant_id: tenantB, site_id: 'site-1' }));

        // listDeploymentProfiles returns summary columns (no tenant_id); assert isolation by id set.
        const inA = await listDeploymentProfiles(tenantA, null, 100);
        const idsA = inA.map((r) => r.id);
        expect(idsA).not.toContain('prof-list-b0'); // tenant B's profile excluded

        const limited = await listDeploymentProfiles(tenantA, null, 2);
        expect(limited).toHaveLength(2);
    });

    it('listDeploymentProfiles filters by site within a tenant', async () => {
        await saveDeploymentProfile(makeRow({ id: 'prof-s1', tenant_id: tenantA, site_id: 'site-1' }));
        await saveDeploymentProfile(makeRow({ id: 'prof-s2', tenant_id: tenantA, site_id: 'site-2' }));
        const s1 = await listDeploymentProfiles(tenantA, 'site-1', 100);
        const s2 = await listDeploymentProfiles(tenantA, 'site-2', 100);
        expect(s1.map((r) => r.id)).toContain('prof-s1');
        expect(s1.map((r) => r.id)).not.toContain('prof-s2');
        expect(s2.map((r) => r.id)).toContain('prof-s2');
    });

    it('getNextDeploymentProfileVersion starts at 1 and increments per (tenant, serverType, site)', async () => {
        const first = await getNextDeploymentProfileVersion(tenantA, 'apache', 'site-v');
        expect(first).toBe(1);
        await saveDeploymentProfile(makeRow({ id: 'prof-v1', tenant_id: tenantA, site_id: 'site-v', server_type: 'apache', version: first }));
        const second = await getNextDeploymentProfileVersion(tenantA, 'apache', 'site-v');
        expect(second).toBe(2);
    });

    it('getNextDeploymentProfileVersion is independent across server types', async () => {
        await saveDeploymentProfile(makeRow({ id: 'prof-nginx', tenant_id: tenantA, site_id: 'site-ind', server_type: 'nginx', version: 5 }));
        // apache on the same site starts fresh (no apache rows yet)
        const apacheNext = await getNextDeploymentProfileVersion(tenantA, 'apache', 'site-ind');
        expect(apacheNext).toBe(1);
    });
});
