/**
 * Regression: deleteSiteForUser in postgres mode WITH sqlite fallback must
 * mirror the delete into SQLite even though getSiteForUser() reads from
 * Postgres (which was just deleted from).
 *
 * The prior implementation, after a successful Postgres DELETE, fell through
 * to `getSiteForUser()` — which reads Postgres — got null (row already gone),
 * and returned 0 *before* running the SQLite fallback delete. Result: the
 * fallback DB kept the deleted site. This test mocks postgres + fallback-on so
 * only the SQLite side is exercised, and asserts the SQLite row is cleared.
 *
 * DB isolation mirrors site.repository.test.ts: a private DATA_DIR, removed
 * before init and after the suite, with closeDatabase() in afterAll — so this
 * never touches the shared test-data/newsecurity.db.
 */

jest.mock('../../config/platform-runtime', () => ({
    ...jest.requireActual('../../config/platform-runtime'),
    getDatabaseMode: jest.fn(() => 'postgres'),
    isSqliteFallbackEnabled: jest.fn(() => true)
}));

jest.mock('../../services/postgres-shadow-store.service', () => ({
    postgresShadowStoreService: {
        canServeReads: jest.fn(() => true),
        queryAll: jest.fn(async () => []), // Postgres reads return nothing (row deleted)
        queryOne: jest.fn(async () => null),
        execute: jest.fn(async () => 1)
    }
}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDatabase, closeDatabase, getDatabase } from '../../config/database';
import { createSite, deleteSiteForUser } from '../../modules/sites/site.repository';

const testDataDir = path.join(os.tmpdir(), 'aetherguard-sites-pg-fallback-test-data');

describe('deleteSiteForUser postgres + sqlite-fallback stale-row regression', () => {
    beforeAll(async () => {
        fs.rmSync(testDataDir, { recursive: true, force: true });
        process.env.DATA_DIR = testDataDir;
        await initDatabase();
    });

    afterAll(() => {
        closeDatabase();
        fs.rmSync(testDataDir, { recursive: true, force: true });
    });

    it('clears the SQLite fallback row even when the Postgres read returns nothing', async () => {
        // Seed a row directly into the isolated SQLite DB.
        const id = await createSite({
            domain: 'pg-fallback-stale.example.com',
            target: '10.0.0.1',
            tenant_id: 'tenant-a',
            sslEnabled: true
        } as any) as unknown as string;

        const db = getDatabase();
        const before = db.prepare('SELECT id FROM sites WHERE id = ?').get(String(id));
        expect(before).toBeDefined();

        // getSiteForUser() hits the mocked Postgres (returns null) — exactly the
        // bug condition where the prior code skipped the SQLite delete.
        const deleted = await deleteSiteForUser(String(id), 'admin');

        expect(deleted).toBe(1); // Postgres execute() returned 1
        const after = db.prepare('SELECT id FROM sites WHERE id = ?').get(String(id));
        // CRITICAL: the SQLite fallback row must be gone (the prior bug left it).
        expect(after).toBeUndefined();
    });
});

// Regression: createSite in postgres + fallback mode must return the Postgres
// RETURNING id (source of truth) AND write that same id into the SQLite fallback
// row. The prior implementation overwrote the Postgres id with the SQLite
// AUTOINCREMENT id, so a GET/PUT/DELETE by the returned id could 404 when the
// two sequences diverged.
describe('createSite postgres + sqlite-fallback id-alignment regression', () => {
    const postgresShadowStoreService = require('../../services/postgres-shadow-store.service').postgresShadowStoreService;
    const POSTGRES_ID = 7777; // deliberately distinct from any SQLite AUTOINCREMENT value

    beforeAll(async () => {
        fs.rmSync(testDataDir, { recursive: true, force: true });
        process.env.DATA_DIR = testDataDir;
        await initDatabase();
        // queryOne is the INSERT ... RETURNING id path; return our chosen id.
        (postgresShadowStoreService.queryOne as jest.Mock).mockResolvedValue({ id: POSTGRES_ID });
    });

    afterAll(() => {
        closeDatabase();
        fs.rmSync(testDataDir, { recursive: true, force: true });
    });

    it('returns the Postgres id and writes the same id into the SQLite fallback row', async () => {
        const returnedId = await createSite({
            domain: 'pg-fallback-idalign.example.com',
            target: '10.0.0.1',
            tenant_id: 'tenant-a',
            sslEnabled: true
        } as any);

        // Returned id MUST be the Postgres id (source of truth), not a SQLite one.
        expect(returnedId).toBe(POSTGRES_ID);

        // The SQLite fallback row must carry the SAME id — proving the two stores
        // agree (the prior bug left SQLite with its own AUTOINCREMENT id).
        const db = getDatabase();
        const sqliteRow = db.prepare('SELECT id FROM sites WHERE domain = ?')
            .get('pg-fallback-idalign.example.com') as { id: number } | undefined;
        expect(sqliteRow).toBeDefined();
        expect(sqliteRow!.id).toBe(POSTGRES_ID);
    });
});
