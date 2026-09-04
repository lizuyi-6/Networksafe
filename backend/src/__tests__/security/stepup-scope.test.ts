/**
 * SECURITY tests (audit 2026-08, AUD-07-3): step-up tokens may be bound to
 * an action/target scope. A scoped token must validate only for the exact
 * scope it was issued for — no cross-operation reuse within its TTL.
 */

import { initDatabase } from '../../config/database';
import stepUpService from '../../security/step-up.service';

jest.mock('../../utils/logger', () => ({
    __esModule: true,
    default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

// Real in-memory store so issued tokens can be read back.
const mockStore = new Map<string, string>();
jest.mock('../../security/redis.service', () => ({
    __esModule: true,
    default: {
        setStrict: jest.fn(async (k: string, v: string) => { mockStore.set(k, v); return 'OK'; }),
        getStrict: jest.fn(async (k: string) => mockStore.get(k) ?? null),
        setIfAbsentStrict: jest.fn(async (k: string) => {
            if (mockStore.has(k)) return 0;
            mockStore.set(k, '1');
            return 1;
        }),
    }
}));

describe('step-up token action/target scope binding (AUD-07-3)', () => {
    const userId = 'scope-user-1';
    const sessionId = `sess-${Date.now()}`;

    beforeAll(async () => {
        await initDatabase();
    });

    it('validates an unscoped token when no scope is expected', async () => {
        const token = await stepUpService.issueToken(userId, sessionId);
        const ok = await stepUpService.validateToken(token, userId, sessionId);
        expect(ok).toBe(true);
    });

    it('validates a scoped token for the exact action+target', async () => {
        const token = await stepUpService.issueToken(userId, sessionId, undefined, {
            action: 'firmware_upload',
            target: 'device-42'
        });
        const ok = await stepUpService.validateToken(token, userId, sessionId, undefined, {
            action: 'firmware_upload',
            target: 'device-42'
        });
        expect(ok).toBe(true);
    });

    it('rejects a scoped token for a DIFFERENT action', async () => {
        const token = await stepUpService.issueToken(userId, sessionId, undefined, {
            action: 'firmware_upload',
            target: 'device-42'
        });
        const ok = await stepUpService.validateToken(token, userId, sessionId, undefined, {
            action: 'ai_endpoint_create'
        });
        expect(ok).toBe(false);
    });

    it('rejects a scoped token for a DIFFERENT target', async () => {
        const token = await stepUpService.issueToken(userId, sessionId, undefined, {
            action: 'firmware_upload',
            target: 'device-42'
        });
        const ok = await stepUpService.validateToken(token, userId, sessionId, undefined, {
            action: 'firmware_upload',
            target: 'device-43'
        });
        expect(ok).toBe(false);
    });

    it('rejects an unscoped token when the route demands a scope', async () => {
        const token = await stepUpService.issueToken(userId, sessionId);
        const ok = await stepUpService.validateToken(token, userId, sessionId, undefined, {
            action: 'firmware_upload'
        });
        expect(ok).toBe(false);
    });
});
