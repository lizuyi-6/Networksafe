/**
 * Tests for log-state.service — pure in-memory log ring buffer.
 * Verifies ID monotonicity, the 500-entry cap, and insertion order.
 */

import { addLog, getRecentLogs, getLogCounter, type LogItem } from '../../services/log-state.service';

function makeLog(overrides: Partial<Omit<LogItem, 'id' | 'time'>> = {}): Omit<LogItem, 'id' | 'time'> {
    return {
        type: 'security',
        level: 'INFO',
        message: 'unit-test log',
        ip: '10.0.0.1',
        ...overrides
    };
}

describe('log-state service', () => {
    it('assigns monotonically increasing ids and timestamps on add', () => {
        const startCounter = getLogCounter();
        const a = addLog(makeLog({ message: 'first' }));
        const b = addLog(makeLog({ message: 'second' }));
        expect(a.id).toBe(startCounter + 1);
        expect(b.id).toBe(startCounter + 2);
        expect(a.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('keeps the most recent entries first (LIFO)', () => {
        addLog(makeLog({ message: 'older' }));
        addLog(makeLog({ message: 'newer' }));
        const logs = getRecentLogs();
        expect(logs[0].message).toBe('newer');
    });

    it('caps the buffer at 500 entries', () => {
        // Fill well past the cap from the current position.
        for (let i = 0; i < 520; i++) {
            addLog(makeLog({ message: `fill-${i}` }));
        }
        const logs = getRecentLogs();
        expect(logs.length).toBeLessThanOrEqual(500);
    });

    it('preserves all provided fields on the stored log', () => {
        // log-state is a shared singleton across tests, so assert on the stored
        // object's fields rather than on buffer length deltas.
        const stored = addLog({
            type: 'sql_injection',
            level: 'CRITICAL',
            message: 'UNION SELECT blocked',
            ip: '203.0.113.7',
            status: 403,
            method: 'POST',
            path: '/api/login'
        });
        expect(stored.type).toBe('sql_injection');
        expect(stored.level).toBe('CRITICAL');
        expect(stored.status).toBe(403);
        expect(stored.method).toBe('POST');
        expect(stored.path).toBe('/api/login');
        expect(stored.id).toBeGreaterThan(0);
        // It is present at the head of the buffer.
        expect(getRecentLogs()[0].id).toBe(stored.id);
    });
});
