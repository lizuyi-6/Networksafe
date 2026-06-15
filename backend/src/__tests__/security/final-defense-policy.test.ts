/**
 * Tests for final-defense-policy — the signed local policy that gates every
 * dangerous action in Final Defense Mode. Covers state normalization, the
 * policy-digest canonicalization, and HMAC sign/verify (timing-safe).
 */

import {
    normalizeInterlockState,
    normalizeBridgeState,
    normalizeGatewayProtectionMode,
    normalizeGatewayMgmtPath,
    policyDigestInput,
    computeFinalDefensePolicyDigest,
    signFinalDefensePolicy,
    verifyFinalDefensePolicySignature
} from '../../security/final-defense-policy';

const SECRET = 'final-defense-test-secret-min-32-chars-long!!';

const basePolicy = {
    policyId: 'pol-1',
    tenantId: 't1',
    companionId: 'comp-1',
    gateId: 'gate-1',
    allowedActions: [
        { commandType: 'host_remove', scriptPath: '/opt/remove.sh', maxExecutionMs: 30000, requiresInterlockRelease: true }
    ],
    breakerTarget: 'server-nic',
    releaseTtlMs: 60000,
    createdAt: '2026-06-13T00:00:00Z',
    status: 'active' as const
};

describe('final-defense-policy normalization', () => {
    it('normalizeInterlockState maps legacy "asserted" to "isolated"', () => {
        expect(normalizeInterlockState('asserted')).toBe('isolated');
    });
    it('normalizeInterlockState accepts canonical states and lowercases', () => {
        expect(normalizeInterlockState('RELEASED')).toBe('released');
        expect(normalizeInterlockState('Armed')).toBe('armed');
        expect(normalizeInterlockState('fault')).toBe('fault');
        expect(normalizeInterlockState('disabled')).toBe('disabled');
        expect(normalizeInterlockState('isolated')).toBe('isolated');
        expect(normalizeInterlockState('unknown')).toBe('unknown');
    });
    it('normalizeInterlockState returns "unknown" for garbage/empty', () => {
        expect(normalizeInterlockState('bogus')).toBe('unknown');
        expect(normalizeInterlockState('')).toBe('unknown');
        expect(normalizeInterlockState(null)).toBe('unknown');
        expect(normalizeInterlockState(undefined)).toBe('unknown');
    });
    it('normalizeBridgeState aliases normalizeInterlockState', () => {
        expect(normalizeBridgeState('asserted')).toBe('isolated');
        expect(normalizeBridgeState('released')).toBe('released');
        expect(normalizeBridgeState('garbage')).toBe('unknown');
    });
    it('normalizeGatewayProtectionMode only accepts the external gateway variant', () => {
        expect(normalizeGatewayProtectionMode('external_network_gateway')).toBe('external_network_gateway');
        expect(normalizeGatewayProtectionMode('host_companion_gate')).toBe('host_companion_gate');
        expect(normalizeGatewayProtectionMode('whatever')).toBe('host_companion_gate');
        expect(normalizeGatewayProtectionMode('')).toBe('host_companion_gate');
    });
    it('normalizeGatewayMgmtPath accepts known paths and maps unknown to unknown', () => {
        expect(normalizeGatewayMgmtPath('dedicated-mgmt')).toBe('dedicated_mgmt');
        expect(normalizeGatewayMgmtPath('cellular')).toBe('cellular');
        expect(normalizeGatewayMgmtPath('shared')).toBe('shared');
        expect(normalizeGatewayMgmtPath('bogus')).toBe('unknown');
        expect(normalizeGatewayMgmtPath('')).toBe('unknown');
    });
});

describe('final-defense-policy digest + signature', () => {
    it('policyDigestInput canonicalizes the policy (defaults, coercion, trim)', () => {
        const input = policyDigestInput({
            ...basePolicy,
            allowedActions: [
                { commandType: '  REBOOT  ', maxExecutionMs: 'not-a-number', requiresInterlockRelease: undefined as any }
            ],
            releaseTtlMs: 'oops' as any,
            status: undefined
        });
        expect(input.allowedActions[0].commandType).toBe('REBOOT'); // trimmed
        expect(input.allowedActions[0].maxExecutionMs).toBeUndefined(); // non-finite -> undefined
        expect(input.allowedActions[0].requiresInterlockRelease).toBe(false); // coerced
        expect(input.releaseTtlMs).toBe(0); // non-finite -> 0
        expect(input.status).toBe('staged'); // default
    });

    it('computeFinalDefensePolicyDigest is deterministic and order-independent for object keys', () => {
        const d1 = computeFinalDefensePolicyDigest(basePolicy);
        // Reconstruct with keys in a different order; digest must match (stableStringify).
        const reordered = {
            createdAt: basePolicy.createdAt,
            status: basePolicy.status,
            breakerTarget: basePolicy.breakerTarget,
            releaseTtlMs: basePolicy.releaseTtlMs,
            allowedActions: basePolicy.allowedActions,
            gateId: basePolicy.gateId,
            companionId: basePolicy.companionId,
            tenantId: basePolicy.tenantId,
            policyId: basePolicy.policyId
        };
        const d2 = computeFinalDefensePolicyDigest(reordered);
        expect(d2).toBe(d1);
    });

    it('digest changes when policy content changes', () => {
        const d1 = computeFinalDefensePolicyDigest(basePolicy);
        const d2 = computeFinalDefensePolicyDigest({ ...basePolicy, releaseTtlMs: 99999 });
        expect(d2).not.toBe(d1);
    });

    it('sign + verify round-trips for a valid policy', () => {
        const signature = signFinalDefensePolicy(basePolicy, SECRET);
        expect(verifyFinalDefensePolicySignature(basePolicy, signature, SECRET)).toBe(true);
    });

    it('verify rejects a tampered policy', () => {
        const signature = signFinalDefensePolicy(basePolicy, SECRET);
        expect(verifyFinalDefensePolicySignature({ ...basePolicy, gateId: 'gate-EVIL' }, signature, SECRET)).toBe(false);
    });

    it('verify rejects a wrong secret', () => {
        const signature = signFinalDefensePolicy(basePolicy, SECRET);
        expect(verifyFinalDefensePolicySignature(basePolicy, signature, 'wrong-secret-also-min-32-chars-long')).toBe(false);
    });

    it('verify returns false when signature or secret is missing', () => {
        expect(verifyFinalDefensePolicySignature(basePolicy, undefined, SECRET)).toBe(false);
        expect(verifyFinalDefensePolicySignature(basePolicy, 'sig', undefined)).toBe(false);
    });
});
