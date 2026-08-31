/**
 * SECURITY (audit 2026-08, AUD-03-4): shared inbound message envelope.
 *
 * Every HIGH/CRITICAL inbound Agent/Device WebSocket event carries an
 * envelope that binds the event to its identity, content, and time:
 *
 *   eventType     — must equal the handler's expected event
 *   payloadDigest — sha256 hex over the CANONICAL JSON of the payload
 *   timestamp     — client ms, must be within the freshness window
 *   nonce         — single-use (nonceManager: Redis + memory fallback)
 *   sessionId     — server-issued socket id (ownership binding)
 *   bootId        — optional device boot/session discriminator
 *   signature     — HMAC-SHA256 hex over the canonical envelope message
 *
 * The verifier in this module is THE production verification path: the
 * gateway handlers call it at entry. There is deliberately no second,
 * test-only implementation to mirror (that mirror was the fake coverage
 * called out by the audit).
 */

import crypto from 'crypto';
import nonceManager from './nonce-manager.service';

export const DEFAULT_ENVELOPE_MAX_SKEW_MS = 120_000;
/**
 * Deterministic secret used ONLY under the test runtime (isTestRuntime)
 * where per-agent DB rows do not exist. Production resolves the real
 * per-identity secret (agent secretKey / device key) at handler entry.
 */
export const INBOUND_ENVELOPE_TEST_SECRET = 'inbound-envelope-test-secret-32-chars!';
export const DEFAULT_ENVELOPE_NONCE_TTL_SECONDS = 300;

export interface InboundEnvelope {
    eventType: string;
    payloadDigest: string;
    timestamp: number;
    nonce: string;
    sessionId: string;
    bootId?: string;
    signature: string;
}

export interface InboundEnvelopeVerifyOptions {
    secret: string | null;
    expectedEventType: string;
    expectedSessionId: string;
    maxSkewMs?: number;
    nonceTtlSeconds?: number;
    nonceScope?: string;
}

export type InboundEnvelopeVerification =
    | { ok: true; payloadDigest: string }
    | { ok: false; reason: InboundEnvelopeFailureReason };

export type InboundEnvelopeFailureReason =
    | 'no_secret'
    | 'malformed_envelope'
    | 'event_type_mismatch'
    | 'session_mismatch'
    | 'timestamp_out_of_window'
    | 'payload_digest_mismatch'
    | 'invalid_signature'
    | 'nonce_replay';

/** Deterministic JSON: object keys sorted recursively, arrays in order. */
export function canonicalize(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value ?? null);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalize(item)).join(',')}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(',')}}`;
}

export function digestPayload(payload: unknown): string {
    return crypto.createHash('sha256').update(canonicalize(payload)).digest('hex');
}

function envelopeMessage(parts: {
    eventType: string;
    payloadDigest: string;
    timestamp: number;
    nonce: string;
    sessionId: string;
    bootId?: string;
}): string {
    // Field-separator form keeps the message unambiguous without
    // requiring clients to reproduce object key order.
    return [
        parts.eventType,
        parts.payloadDigest,
        String(parts.timestamp),
        parts.nonce,
        parts.sessionId,
        parts.bootId ?? ''
    ].join('\n');
}

export function buildEnvelopeSignature(
    secret: string,
    parts: {
        eventType: string;
        payloadDigest: string;
        timestamp: number;
        nonce: string;
        sessionId: string;
        bootId?: string;
    }
): string {
    return crypto.createHmac('sha256', secret).update(envelopeMessage(parts)).digest('hex');
}

function isHex64(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/**
 * Verify an inbound envelope against an event's payload. Fail-closed at
 * every step; the nonce is only consumed AFTER the signature has been
 * proven, so an attacker cannot burn a legitimate sender's nonces with
 * forged envelopes.
 */
export async function verifyInboundEnvelope(
    payload: unknown,
    envelope: unknown,
    options: InboundEnvelopeVerifyOptions
): Promise<InboundEnvelopeVerification> {
    if (!options.secret) {
        return { ok: false, reason: 'no_secret' };
    }
    if (!envelope || typeof envelope !== 'object') {
        return { ok: false, reason: 'malformed_envelope' };
    }
    const candidate = envelope as Partial<InboundEnvelope>;
    if (typeof candidate.eventType !== 'string'
        || !isHex64(candidate.payloadDigest)
        || typeof candidate.timestamp !== 'number'
        || typeof candidate.nonce !== 'string'
        || candidate.nonce.length < 8
        || typeof candidate.sessionId !== 'string'
        || !candidate.sessionId
        || !isHex64(candidate.signature)) {
        return { ok: false, reason: 'malformed_envelope' };
    }
    if (candidate.eventType !== options.expectedEventType) {
        return { ok: false, reason: 'event_type_mismatch' };
    }
    // Ownership binding: an envelope (even a correctly signed one) is only
    // valid on the session it was issued for — never on another socket.
    if (candidate.sessionId !== options.expectedSessionId) {
        return { ok: false, reason: 'session_mismatch' };
    }
    const maxSkew = options.maxSkewMs ?? DEFAULT_ENVELOPE_MAX_SKEW_MS;
    if (!Number.isFinite(candidate.timestamp)
        || Math.abs(Date.now() - candidate.timestamp) > maxSkew) {
        return { ok: false, reason: 'timestamp_out_of_window' };
    }
    const expectedDigest = digestPayload(payload);
    if (candidate.payloadDigest !== expectedDigest) {
        return { ok: false, reason: 'payload_digest_mismatch' };
    }
    const expectedSignature = buildEnvelopeSignature(options.secret, {
        eventType: candidate.eventType,
        payloadDigest: candidate.payloadDigest,
        timestamp: candidate.timestamp,
        nonce: candidate.nonce,
        sessionId: candidate.sessionId,
        bootId: candidate.bootId
    });
    const presented = candidate.signature;
    const signatureValid = presented.length === expectedSignature.length
        && crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(presented));
    if (!signatureValid) {
        return { ok: false, reason: 'invalid_signature' };
    }
    // Replay protection LAST: consume the nonce only for a proven-authentic
    // envelope. Scope includes the socket so identical nonces across
    // different connections are not cross-collisions.
    const fresh = await nonceManager.checkAndUseNonce(
        `${options.nonceScope ?? 'inbound'}:${options.expectedSessionId}:${candidate.nonce}`,
        options.nonceTtlSeconds ?? DEFAULT_ENVELOPE_NONCE_TTL_SECONDS
    );
    if (!fresh) {
        return { ok: false, reason: 'nonce_replay' };
    }
    return { ok: true, payloadDigest: expectedDigest };
}

/**
 * Helper for senders (tests, SDKs): wrap a payload with a correctly signed
 * envelope for a given secret and session id.
 */
export function buildSignedEnvelope(
    secret: string,
    payload: unknown,
    parts: {
        eventType: string;
        sessionId: string;
        nonce?: string;
        timestamp?: number;
        bootId?: string;
    }
): { envelope: InboundEnvelope; payload: unknown } {
    const payloadDigest = digestPayload(payload);
    const resolved = {
        eventType: parts.eventType,
        payloadDigest,
        timestamp: parts.timestamp ?? Date.now(),
        nonce: parts.nonce ?? crypto.randomBytes(16).toString('hex'),
        sessionId: parts.sessionId,
        bootId: parts.bootId
    };
    const signature = buildEnvelopeSignature(secret, resolved);
    return {
        payload,
        envelope: { ...resolved, signature }
    };
}
