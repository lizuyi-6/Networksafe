/**
 * Tests for hardware-grant — the cryptographic grant message that authorizes a
 * Final Defense release. Covers stable serialization, message assembly, and
 * public-key signature verification (including the legacy-message fallback).
 */

import { generateKeyPairSync, createSign, sign } from 'crypto';
import {
    stableStringify,
    hashPayload,
    buildHardwareGrantMessage,
    verifyHardwareGrantSignature,
    type HardwareGrantMessageInput,
    type HardwareGrantEnvelope
} from '../../security/hardware-grant';

function keyPair() {
    return generateKeyPairSync('rsa', { modulusLength: 2048 });
}

function signGrant(privPem: string, message: string): string {
    return sign('sha256', Buffer.from(message), privPem).toString('base64');
}

const baseInput: HardwareGrantMessageInput = {
    gateId: 'gate-1',
    sessionId: 'sess-1',
    actionId: 'act-1',
    tenantId: 't1',
    scope: 'agent',
    targetId: 'host-1',
    commandType: 'host_remove',
    payloadHash: 'sha256:abc',
    policyDigest: 'digest-1',
    challenge: 'chal-1',
    breakerTarget: 'nic',
    interlockAction: 'release',
    issuedAt: '2026-06-13T00:00:00Z',
    expiresAt: '2026-06-13T00:05:00Z',
    monotonicCounter: 42
};

describe('hardware-grant serialization', () => {
    it('stableStringify sorts object keys deterministically', () => {
        const a = stableStringify({ b: 1, a: 2, c: { z: 1, y: 2 } });
        const b = stableStringify({ c: { y: 2, z: 1 }, a: 2, b: 1 });
        expect(a).toBe(b);
        expect(a).toBe('{"a":2,"b":1,"c":{"y":2,"z":1}}');
    });

    it('stableStringify handles arrays, null, and nested objects', () => {
        expect(stableStringify([3, 1, 2])).toBe('[3,1,2]'); // array order preserved
        expect(stableStringify(null)).toBe('{}'); // null -> {}
        expect(stableStringify({ x: { b: 2, a: 1 } })).toBe('{"x":{"a":1,"b":2}}');
    });

    it('hashPayload is deterministic for key-reordered equivalent input', () => {
        const h1 = hashPayload({ a: 1, b: 2 });
        const h2 = hashPayload({ b: 2, a: 1 });
        expect(h2).toBe(h1);
    });

    it('buildHardwareGrantMessage joins all 15 fields newline-separated', () => {
        const msg = buildHardwareGrantMessage(baseInput);
        const parts = msg.split('\n');
        expect(parts).toHaveLength(15);
        expect(parts[0]).toBe('gate-1');
        expect(parts[7]).toBe('sha256:abc'); // payloadHash
        expect(parts[14]).toBe('42'); // monotonicCounter (stringified)
    });

    it('buildHardwareGrantMessage omits empty optional fields as blank lines (not skipped)', () => {
        const msg = buildHardwareGrantMessage({ ...baseInput, policyDigest: undefined, challenge: undefined, breakerTarget: undefined, interlockAction: undefined });
        const parts = msg.split('\n');
        expect(parts[8]).toBe(''); // policyDigest slot
        expect(parts[9]).toBe(''); // challenge slot
        expect(parts).toHaveLength(15);
    });
});

describe('hardware-grant signature verification', () => {
    it('verifies a grant signed with the matching private key', () => {
        const { privateKey, publicKey } = keyPair();
        const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
        const message = buildHardwareGrantMessage(baseInput);
        const envelope: HardwareGrantEnvelope = { ...baseInput, signature: signGrant(privPem, message) };
        expect(verifyHardwareGrantSignature(pubPem, envelope)).toBe(true);
    });

    it('rejects a grant signed by a different key', () => {
        const signer = keyPair();
        const verifier = keyPair();
        const privPem = signer.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        const pubPem = verifier.publicKey.export({ type: 'spki', format: 'pem' }).toString();
        const message = buildHardwareGrantMessage(baseInput);
        const envelope: HardwareGrantEnvelope = { ...baseInput, signature: signGrant(privPem, message) };
        expect(verifyHardwareGrantSignature(pubPem, envelope)).toBe(false);
    });

    it('rejects a tampered grant (mutated field after signing)', () => {
        const { privateKey, publicKey } = keyPair();
        const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
        const message = buildHardwareGrantMessage(baseInput);
        const envelope: HardwareGrantEnvelope = {
            ...baseInput,
            commandType: 'factory_reset', // tampered after signing
            signature: signGrant(privPem, message)
        };
        expect(verifyHardwareGrantSignature(pubPem, envelope)).toBe(false);
    });

    it('verifies a legacy (no extended fields) grant via the legacy message path', () => {
        const { privateKey, publicKey } = keyPair();
        const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
        // Legacy grant: no policyDigest/challenge/breakerTarget/interlockAction
        const legacy: HardwareGrantMessageInput = {
            gateId: 'gate-1', sessionId: 'sess-1', actionId: 'act-1', tenantId: 't1',
            scope: 'agent', targetId: 'host-1', commandType: 'host_remove', payloadHash: 'sha256:abc',
            issuedAt: '2026-06-13T00:00:00Z', expiresAt: '2026-06-13T00:05:00Z', monotonicCounter: 1
        };
        // Sign using the legacy 11-field layout directly.
        const legacyMessage = [
            legacy.gateId, legacy.sessionId, legacy.actionId, legacy.tenantId, legacy.scope,
            legacy.targetId, legacy.commandType, legacy.payloadHash,
            legacy.issuedAt, legacy.expiresAt, String(legacy.monotonicCounter)
        ].join('\n');
        const envelope: HardwareGrantEnvelope = { ...legacy, signature: signGrant(privPem, legacyMessage) };
        expect(verifyHardwareGrantSignature(pubPem, envelope)).toBe(true);
    });

    it('returns false when signature or public key is missing', () => {
        const envelope = { ...baseInput, signature: '' } as HardwareGrantEnvelope;
        expect(verifyHardwareGrantSignature('pem', envelope)).toBe(false);
        const { publicKey } = keyPair();
        const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
        expect(verifyHardwareGrantSignature(pubPem, { ...baseInput, signature: '' } as HardwareGrantEnvelope)).toBe(false);
    });

    it('returns false (does not throw) for a malformed public key', () => {
        const envelope = { ...baseInput, signature: 'dGvtbHk=' } as HardwareGrantEnvelope;
        expect(verifyHardwareGrantSignature('not-a-pem', envelope)).toBe(false);
    });
});
