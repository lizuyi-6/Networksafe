/**
 * Regression: the sql.js-style statement wrapper returned by
 * DatabaseManager.prepare() / DatabaseManager.getDb().prepare() must advance
 * its cursor on every step() call and return false once the result set is
 * exhausted.
 *
 * The previous implementation cached the first step() result and returned it
 * forever, so `while (stmt.step())` (used by e.g.
 * services/investigation.service.ts getInvestigationHistory and
 * testing/test-context.ts) span forever on any non-empty result set.
 */
import { initDatabase, closeDatabase, getDatabase } from '../../config/database';

const TABLE = 'stmt_iteration_probe';

describe('DatabaseManager statement wrapper iteration semantics', () => {
    beforeAll(async () => {
        await initDatabase();
        const db = getDatabase();
        db.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (id INTEGER PRIMARY KEY, label TEXT)`);
        db.run(`DELETE FROM ${TABLE}`);
        db.prepare(`INSERT INTO ${TABLE} (id, label) VALUES (?, ?)`).run(1, 'a');
        db.prepare(`INSERT INTO ${TABLE} (id, label) VALUES (?, ?)`).run(2, 'b');
        db.prepare(`INSERT INTO ${TABLE} (id, label) VALUES (?, ?)`).run(3, 'c');
    });

    afterAll(() => {
        try {
            getDatabase().run(`DROP TABLE IF EXISTS ${TABLE}`);
        } catch {
            /* table cleanup is best-effort */
        }
        closeDatabase();
    });

    it('while(step()) yields every row exactly once and terminates (DatabaseManager.prepare)', () => {
        const stmt = getDatabase().prepare(`SELECT id, label FROM ${TABLE} ORDER BY id`);
        stmt.bind([]);
        const rows: any[] = [];
        let guard = 0;
        // Guard keeps the test falsifiable instead of hanging if step() regresses
        while (stmt.step() && ++guard <= 10) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();
        expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
        expect(rows.map((r) => r.label)).toEqual(['a', 'b', 'c']);
    });

    it('while(step()) yields every row exactly once and terminates (getDb().prepare)', () => {
        const stmt = getDatabase().getDb().prepare(`SELECT id, label FROM ${TABLE} ORDER BY id`);
        stmt.bind([]);
        const rows: any[] = [];
        let guard = 0;
        while (stmt.step() && ++guard <= 10) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();
        expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
    });

    it('single-row bind/step/getAsObject pattern still works', () => {
        const stmt = getDatabase().prepare(`SELECT label FROM ${TABLE} WHERE id = ?`);
        stmt.bind([2]);
        expect(stmt.step()).toBe(true);
        expect(stmt.getAsObject().label).toBe('b');
        expect(stmt.step()).toBe(false);
        stmt.free();
    });

    it('step() returns false immediately on an empty result set', () => {
        const stmt = getDatabase().prepare(`SELECT label FROM ${TABLE} WHERE id = ?`);
        stmt.bind([999]);
        expect(stmt.step()).toBe(false);
        stmt.free();
    });

    it('re-bind resets the cursor for a fresh iteration', () => {
        const stmt = getDatabase().prepare(`SELECT id FROM ${TABLE} WHERE id >= ? ORDER BY id`);
        stmt.bind([2]);
        const first: number[] = [];
        let guard = 0;
        while (stmt.step() && ++guard <= 10) {
            first.push(stmt.getAsObject().id);
        }
        expect(first).toEqual([2, 3]);

        stmt.bind([1]);
        const second: number[] = [];
        guard = 0;
        while (stmt.step() && ++guard <= 10) {
            second.push(stmt.getAsObject().id);
        }
        stmt.free();
        expect(second).toEqual([1, 2, 3]);
    });

    it('direct get()/all() helpers keep their behavior', () => {
        const db = getDatabase();
        const row = db.prepare(`SELECT label FROM ${TABLE} WHERE id = ?`).get(3);
        expect(row.label).toBe('c');
        const all = db.prepare(`SELECT id FROM ${TABLE} ORDER BY id`).all();
        expect(all.map((r: any) => r.id)).toEqual([1, 2, 3]);
        expect(db.prepare(`SELECT label FROM ${TABLE} WHERE id = ?`).get(999)).toBeUndefined();
    });
});
