/**
 * Tests for canonicalizeForSigning — deterministic JSON serialization with
 * sorted keys and cycle handling. Used for HMAC signing boundaries.
 */

import { canonicalizeForSigning } from '../../utils/canonical-json';

describe('canonicalizeForSigning', () => {
    it('sorts top-level keys alphabetically', () => {
        const result = canonicalizeForSigning({ b: 1, a: 2, c: 3 });
        expect(result).toBe('{"a":2,"b":1,"c":3}');
    });

    it('sorts nested object keys recursively', () => {
        const result = canonicalizeForSigning({ outer: { z: 1, a: 2 } });
        expect(result).toBe('{"outer":{"a":2,"z":1}}');
    });

    it('produces identical output for key-reordered equivalent input', () => {
        const a = canonicalizeForSigning({ x: { b: 2, a: 1 }, y: 3 });
        const b = canonicalizeForSigning({ y: 3, x: { a: 1, b: 2 } });
        expect(a).toBe(b);
    });

    it('preserves array element order (does not sort arrays)', () => {
        const result = canonicalizeForSigning({ list: [3, 1, 2] });
        expect(result).toBe('{"list":[3,1,2]}');
    });

    it('handles primitives inside objects', () => {
        const result = canonicalizeForSigning({ str: 'hello', num: 42, bool: true, nil: null });
        expect(result).toBe('{"bool":true,"nil":null,"num":42,"str":"hello"}');
    });

    it('handles empty object', () => {
        expect(canonicalizeForSigning({})).toBe('{}');
    });

    it('handles nested arrays containing objects', () => {
        const result = canonicalizeForSigning({ items: [{ b: 1, a: 2 }] });
        expect(result).toBe('{"items":[{"a":2,"b":1}]}');
    });

    it('breaks cycles by replacing repeated references with null', () => {
        const obj: any = { a: 1 };
        obj.self = obj;
        const result = canonicalizeForSigning(obj);
        // self-reference should be replaced with null, not throw.
        expect(result).toContain('"self":null');
    });
});
