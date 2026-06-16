/**
 * REDTEAM SECURITY TEST — HMAC canonicalization (D7 Task 1)
 * =========================================================
 *
 * Bug: verifyAgentStatSignature() used JSON.stringify(rest) to build
 * the HMAC message.  Different JavaScript engines (or object construction
 * order) can serialize {a:1, b:2} and {b:2, a:1} to different strings,
 * causing valid signatures to be rejected.
 *
 * Fix: canonicalizeForSigning() sorts object keys recursively before
 * serialising, producing a stable string regardless of key order.
 *
 * Red-team test:
 *   - Sign a payload {a:1, b:2} using canonical JSON HMAC
 *   - Verify the same payload constructed as {b:2, a:1} passes verification
 *   - Assert that plain JSON.stringify would FAIL the same test
 */

import { canonicalizeForSigning } from '../../utils/canonical-json';
import crypto from 'crypto';

const SECRET = 'test-hmac-secret-32-chars-abcdef';

function signWithCanonical(payload: Record<string, unknown>): string {
    return crypto.createHmac('sha256', SECRET)
        .update(canonicalizeForSigning(payload))
        .digest('hex');
}

function signWithNaiveStringify(payload: Record<string, unknown>): string {
    // This is the buggy pattern that was in agent-gateway.ts
    return crypto.createHmac('sha256', SECRET)
        .update(JSON.stringify(payload))
        .digest('hex');
}

describe('REDTEAM HMAC canonicalization', () => {
    describe('canonicalizeForSigning', () => {
        it('produces identical strings for {a:1,b:2} and {b:2,a:1}', () => {
            const p1 = { a: 1, b: 2 };
            const p2 = { b: 2, a: 1 };

            const canon1 = canonicalizeForSigning(p1);
            const canon2 = canonicalizeForSigning(p2);

            expect(canon1).toBe(canon2);
        });

        it('produces identical strings for nested objects regardless of key order', () => {
            const p1 = { outer: { x: 10, y: 20 }, z: 3 };
            const p2 = { z: 3, outer: { y: 20, x: 10 } };

            expect(canonicalizeForSigning(p1)).toBe(canonicalizeForSigning(p2));
        });

        it('sorts keys inside each array element but preserves array order', () => {
            // Arrays maintain their element order; only object keys inside are sorted.
            const p1 = { items: [{ a: 1, b: 2 }, { c: 3, d: 4 }] };
            const p2 = { items: [{ b: 2, a: 1 }, { d: 4, c: 3 }] };

            // Both should canonicalize to the same string because each element's
            // keys are sorted independently of array position.
            expect(canonicalizeForSigning(p1)).toBe(canonicalizeForSigning(p2));
        });

        it('handles circular references gracefully', () => {
            const circular: Record<string, unknown> = { a: 1 };
            circular['self'] = circular;

            // Should not throw and should return a string
            const result = canonicalizeForSigning(circular);
            expect(typeof result).toBe('string');
        });
    });

    describe('HMAC signature equality with canonical order', () => {
        it('signatures match when payload is {a:1,b:2} vs {b:2,a:1}', () => {
            const p1 = { a: 1, b: 2 };
            const p2 = { b: 2, a: 1 };

            const sig1 = signWithCanonical(p1);
            const sig2 = signWithCanonical(p2);

            expect(sig1).toBe(sig2);
        });

        it('signatures match for deeply nested objects with permuted keys', () => {
            const p1 = {
                agentId: 'agent-001',
                stats: { cpu: 45.2, mem: 2048 },
                timestamp: '2026-01-01T00:00:00.000Z'
            };
            const p2 = {
                timestamp: '2026-01-01T00:00:00.000Z',
                stats: { mem: 2048, cpu: 45.2 },
                agentId: 'agent-001'
            };

            expect(signWithCanonical(p1)).toBe(signWithCanonical(p2));
        });
    });

    describe('regression: plain JSON.stringify would FAIL key-order test', () => {
        it('plain JSON.stringify produces different strings for {a:1,b:2} vs {b:2,a:1}', () => {
            const p1 = { a: 1, b: 2 };
            const p2 = { b: 2, a: 1 };

            // This proves the original bug existed: the two serialisations differ
            expect(JSON.stringify(p1)).not.toBe(JSON.stringify(p2));
        });

        it('plain JSON.stringify signatures differ even when logical payload is identical', () => {
            const p1 = { a: 1, b: 2 };
            const p2 = { b: 2, a: 1 };

            const sig1 = signWithNaiveStringify(p1);
            const sig2 = signWithNaiveStringify(p2);

            // This confirms the original vulnerability: the signatures don't match
            expect(sig1).not.toBe(sig2);
        });

        it('canonical signature from p1 verifies against canonical signature from p2', () => {
            const p1 = { a: 1, b: 2 };
            const p2 = { b: 2, a: 1 };

            const sig1 = signWithCanonical(p1);

            // Re-compute the expected value using p2's canonical form
            const expectedFromP2 = signWithCanonical(p2);

            // The signature created from p1's canonical form should equal the
            // signature computed from p2's canonical form
            expect(sig1).toBe(expectedFromP2);
        });
    });
});
