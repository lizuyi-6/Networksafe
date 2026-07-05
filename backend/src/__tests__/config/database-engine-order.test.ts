/**
 * Engine selection for the SQLite base store.
 *
 * Jest runs must stay on sql.js (per-worker in-memory snapshot = worker
 * isolation); real runtimes prefer better-sqlite3 (WAL, synchronous commits);
 * DB_ENGINE overrides both.
 */
import { resolveSqliteEngineOrder } from '../../config/database';

describe('resolveSqliteEngineOrder', () => {
    it('prefers sql.js inside a test runtime (NODE_ENV=test)', () => {
        expect(resolveSqliteEngineOrder({ NODE_ENV: 'test' })).toEqual(['sqljs', 'better-sqlite3']);
    });

    it('prefers sql.js inside a Jest worker', () => {
        expect(resolveSqliteEngineOrder({ JEST_WORKER_ID: '3' })).toEqual(['sqljs', 'better-sqlite3']);
    });

    it('prefers better-sqlite3 in non-test runtimes', () => {
        expect(resolveSqliteEngineOrder({ NODE_ENV: 'production' })).toEqual(['better-sqlite3', 'sqljs']);
        expect(resolveSqliteEngineOrder({})).toEqual(['better-sqlite3', 'sqljs']);
    });

    it('DB_ENGINE=sqljs overrides everything', () => {
        expect(resolveSqliteEngineOrder({ DB_ENGINE: 'sqljs', NODE_ENV: 'production' }))
            .toEqual(['sqljs', 'better-sqlite3']);
    });

    it('DB_ENGINE=better-sqlite3 overrides the test default', () => {
        expect(resolveSqliteEngineOrder({ DB_ENGINE: 'better-sqlite3', NODE_ENV: 'test', JEST_WORKER_ID: '1' }))
            .toEqual(['better-sqlite3', 'sqljs']);
    });
});
