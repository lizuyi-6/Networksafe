/**
 * REDTEAM SECURITY TEST — Inbound envelope authentication (AUD-03-4)
 * =============================================================================
 *
 * The previous version of this file MIRRORED the verification logic in the
 * test and asserted against the mirror while the real handlers never called
 * any verifier — the exact "fake coverage" the 2026-08 audit flagged. That
 * mirror is deleted.
 *
 * This version imports THE production verifier
 * (`backend/src/security/inbound-envelope.ts`) that the real Agent/Device
 * WebSocket handlers now call at entry (agent-gateway: agent:scan_result,
 * agent:review_sample; device-gateway: data, alert, unknown_error,
 * ota_status) and attacks it: unsigned, forged, replayed, cross-bound,
 * stale, and digest-tampered envelopes must all fail with the expected
 * reason.
 */

import crypto from 'crypto';
import {
    verifyInboundEnvelope,
    buildSignedEnvelope,
    digestPayload,
    INBOUND_ENVELOPE_TEST_SECRET,
} from '../../security/inbound-envelope';

jest.mock('../../utils/logger', () => ({
    __esModule: true,
    default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

jest.mock('../../security/redis.service', () => ({
    __esModule: true,
    default: {
        exists: jest.fn().mockResolvedValue(false),
        set: jest.fn().mockResolvedValue('OK'),
    }
}));

const SECRET = INBOUND_ENVELOPE_TEST_SECRET;
const SESSION = 'attacker-socket-1';

async function verifyWith(payload: unknown, envelope: unknown, overrides: Record<string, any> = {}) {
    return verifyInboundEnvelope(payload, envelope, {
        secret: SECRET,
        expectedEventType: 'data',
        expectedSessionId: SESSION,
        ...overrides,
    });
}

describe('REDTEAM inbound envelope auth — real production verifier (AUD-03-4)', () => {
    it('accepts a correctly signed envelope', async () => {
        const payload = { sensor: 'temp', value: 23.5 };
        const { envelope, payload: body } = buildSignedEnvelope(SECRET, payload, {
            eventType: 'data',
            sessionId: SESSION,
        });
        const result = await verifyWith(body, envelope);
        expect(result).toEqual({ ok: true, payloadDigest: digestPayload(payload) });
    });

    it('rejects a missing envelope and a malformed envelope', async () => {
        expect((await verifyWith({ a: 1 }, undefined)).ok).toBe(false);
        const malformed = await verifyWith({ a: 1 }, { eventType: 'data' });
        expect(malformed).toEqual({ ok: false, reason: 'malformed_envelope' });
    });

    it('fails closed when no secret is available', async () => {
        const { envelope, payload } = buildSignedEnvelope(SECRET, { a: 1 }, {
            eventType: 'data', sessionId: SESSION,
        });
        const result = await verifyWith(payload, envelope, { secret: null });
        expect(result).toEqual({ ok: false, reason: 'no_secret' });
    });

    it('rejects an UNSIGNED payload (no envelope at all)', async () => {
        // The pre-audit failure mode: a bare payload with no envelope field.
        const result = await verifyWith({ alert_type: 'intrusion' }, undefined);
        expect(result.ok).toBe(false);
    });

    it('rejects a WRONG-KEY signature', async () => {
        const attackerSigned = buildSignedEnvelope('attacker-key-not-the-secret!!', { a: 1 }, {
            eventType: 'data', sessionId: SESSION,
        });
        const result = await verifyWith(attackerSigned.payload, attackerSigned.envelope);
        expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
    });

    it('rejects a TAMPERED payload (digest mismatch)', async () => {
        const { envelope, payload } = buildSignedEnvelope(SECRET, { a: 1, role: 'guest' }, {
            eventType: 'data', sessionId: SESSION,
        });
        const tampered = { a: 1, role: 'admin' };
        const result = await verifyWith(tampered, envelope);
        expect(result).toEqual({ ok: false, reason: 'payload_digest_mismatch' });
    });

    it('rejects a TAMPERED signature', async () => {
        const { envelope, payload } = buildSignedEnvelope(SECRET, { a: 1 }, {
            eventType: 'data', sessionId: SESSION,
        });
        const forged = {
            ...envelope,
            signature: crypto.createHash('sha256').update('forged').digest('hex'),
        };
        const result = await verifyWith(payload, forged);
        expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
    });

    it('rejects a STALE timestamp outside the freshness window', async () => {
        const { envelope, payload } = buildSignedEnvelope(SECRET, { a: 1 }, {
            eventType: 'data',
            sessionId: SESSION,
            timestamp: Date.now() - 10 * 60_000,
        });
        const result = await verifyWith(payload, envelope);
        expect(result).toEqual({ ok: false, reason: 'timestamp_out_of_window' });
    });

    it('rejects an envelope bound to a DIFFERENT session (socket takeover)', async () => {
        // An envelope captured from socket A must not verify on socket B.
        const victimSession = 'victim-socket-2';
        const { envelope, payload } = buildSignedEnvelope(SECRET, { a: 1 }, {
            eventType: 'data',
            sessionId: victimSession,
        });
        const result = await verifyWith(payload, envelope);
        expect(result).toEqual({ ok: false, reason: 'session_mismatch' });
    });

    it('rejects an event-type mismatch', async () => {
        const { envelope, payload } = buildSignedEnvelope(SECRET, { a: 1 }, {
            eventType: 'heartbeat',
            sessionId: SESSION,
        });
        const result = await verifyWith(payload, envelope);
        expect(result).toEqual({ ok: false, reason: 'event_type_mismatch' });
    });

    it('rejects a REPLAYED envelope (nonce single-use)', async () => {
        const { envelope, payload } = buildSignedEnvelope(SECRET, { cmd: 'unlock' }, {
            eventType: 'data',
            sessionId: SESSION,
            nonce: `replay-test-${Date.now()}-aaaa`,
        });
        const first = await verifyWith(payload, envelope);
        expect(first.ok).toBe(true);
        const second = await verifyWith(payload, envelope);
        expect(second).toEqual({ ok: false, reason: 'nonce_replay' });
    });

    it('digest is canonical: key order does not change validity', async () => {
        const { envelope, payload } = buildSignedEnvelope(SECRET, { b: 2, a: 1 }, {
            eventType: 'data', sessionId: SESSION,
        });
        const reordered = { a: 1, b: 2 };
        const result = await verifyWith(reordered, envelope);
        expect(result.ok).toBe(true);
    });
});
