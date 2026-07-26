/**
 * Regression: the hardware authorization chain (hardware_gates /
 * command_intents / hardware_confirmation_sessions / hardware_grants) must be
 * part of the Postgres shadow schema. hardware_gates carries the anti-replay
 * high-water mark (last_monotonic_counter); before this coverage existed the
 * DB_MODE=postgres production path kept it only in the SQLite base store.
 */

describe('postgres shadow store hardware table coverage', () => {
    let queries: string[];

    beforeEach(() => {
        jest.resetModules();
        queries = [];
        process.env.SHADOW_DATABASE_URL = 'postgres://user:pw@localhost:5432/shadow_test';
        jest.doMock('pg', () => ({
            Pool: jest.fn().mockImplementation(() => ({
                query: jest.fn(async (sql: string) => {
                    queries.push(String(sql));
                    return { rows: [], rowCount: 1 };
                }),
                end: jest.fn(async () => undefined)
            }))
        }));
    });

    afterEach(() => {
        delete process.env.SHADOW_DATABASE_URL;
        jest.dontMock('pg');
    });

    it('creates all four hardware tables in the shadow schema and upserts gates on gate_id', async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { postgresShadowStoreService } = require('../../services/postgres-shadow-store.service');

        await postgresShadowStoreService.upsert('hardware_gates', {
            gate_id: 'gate-shadow-1',
            tenant_id: 'tenant-test',
            display_name: 'Main gate',
            public_key_pem: 'pem',
            algorithm: 'ECDSA_P256_SHA256',
            status: 'online',
            last_monotonic_counter: 7,
            metadata_json: '{}',
            created_at: '2026-07-04T00:00:00.000Z',
            updated_at: '2026-07-04T00:00:00.000Z',
            last_seen_at: null
        });

        const ddl = queries.filter((q) => q.includes('CREATE TABLE'));
        expect(ddl.some((q) => q.includes('hardware_gates'))).toBe(true);
        expect(ddl.some((q) => q.includes('command_intents'))).toBe(true);
        expect(ddl.some((q) => q.includes('hardware_confirmation_sessions'))).toBe(true);
        expect(ddl.some((q) => q.includes('hardware_grants'))).toBe(true);
        // The counter column must exist in the shadow DDL, not just SQLite.
        expect(ddl.find((q) => q.includes('hardware_gates'))).toContain('last_monotonic_counter');

        const upsert = queries.find((q) => q.includes('INSERT INTO "hardware_gates"'));
        expect(upsert).toBeDefined();
        expect(upsert).toContain('ON CONFLICT ("gate_id")');
        expect(upsert).toContain('"last_monotonic_counter" = EXCLUDED."last_monotonic_counter"');
    });

    it('upserts grants on grant_id (replay evidence rows survive base-store loss)', async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { postgresShadowStoreService } = require('../../services/postgres-shadow-store.service');

        await postgresShadowStoreService.upsert('hardware_grants', {
            grant_id: 'grant-shadow-1',
            session_id: 's',
            action_id: 'a',
            tenant_id: 'tenant-test',
            gate_id: 'gate-shadow-1',
            payload_hash: 'h',
            issued_at: '2026-07-04T00:00:00.000Z',
            expires_at: '2026-07-04T00:02:00.000Z',
            monotonic_counter: 7,
            signature: 'sig',
            grant_json: '{}',
            created_at: '2026-07-04T00:00:00.000Z'
        });

        const upsert = queries.find((q) => q.includes('INSERT INTO "hardware_grants"'));
        expect(upsert).toBeDefined();
        expect(upsert).toContain('ON CONFLICT ("grant_id")');
    });
});
