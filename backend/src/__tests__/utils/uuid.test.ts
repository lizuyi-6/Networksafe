/**
 * Tests for utils/uuid.ts — the crypto.randomUUID wrapper that replaced the
 * third-party `uuid` package.
 */

import { uuidv4, default as uuidDefault } from '../../utils/uuid';

describe('utils/uuid', () => {
    it('returns a valid RFC 4122 v4 UUID string', () => {
        const id = uuidv4();
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('generates unique values across calls', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 1000; i++) {
            ids.add(uuidv4());
        }
        expect(ids.size).toBe(1000);
    });

    it('default export is the same function', () => {
        expect(uuidDefault).toBe(uuidv4);
        expect(uuidDefault()).toMatch(/^[0-9a-f]{8}-/);
    });
});
