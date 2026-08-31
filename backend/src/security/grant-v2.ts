/**
 * Grant V2 — canonical hardware grant message (AUD-06-1, host side).
 *
 * Plan-canonical field set (PRD + 2026-08 audit batch 6):
 *
 *   protocolVersion, direction, bindingId, tenantId, scope, targetId,
 *   gateId, sessionId, actionId, commandType, payloadDigest,
 *   policyDigest, breakerTarget, interlockAction, challenge,
 *   controllerBootNonce, monotonicCounter, issuedAt, expiresAt
 *
 * Every consumer (control plane, agent/device, M1, M2 host tests) rebuilds
 * the expected fields from REAL context and compares field-by-field with
 * this module's strict verifier — timing-safe for sensitive digests.
 *
 * NO LEGACY FALLBACK: a Grant V2 envelope missing any canonical field, or
 * carrying unexpected extra fields, is invalid. The V1 envelope
 * (hardware-grant.ts) keeps its own legacy path, but the moment a Grant V2
 * `protocolVersion` is declared the V2 rules apply exclusively.
 */

import { createHash, createSign, createVerify, timingSafeEqual } from 'crypto';
import {
    SUPPORTED_HARDWARE_GRANT_ALGORITHM,
    validateHardwareGrantPublicKey
} from './hardware-grant';

export const GRANT_V2_PROTOCOL_VERSION = 2;

export type GrantV2Direction =
    | 'control_plane_to_gate'
    | 'gate_to_controller'
    | 'controller_feedback';

export type GrantV2Scope = 'agent' | 'device' | 'deployment';

export interface GrantV2Fields {
    protocolVersion: typeof GRANT_V2_PROTOCOL_VERSION;
    direction: GrantV2Direction;
    bindingId: string;
    tenantId: string;
    scope: GrantV2Scope;
    targetId: string;
    gateId: string;
    sessionId: string;
    actionId: string;
    commandType: string;
    payloadDigest: string;
    policyDigest: string;
    breakerTarget: string;
    interlockAction: string;
    challenge: string;
    controllerBootNonce: string;
    monotonicCounter: number;
    issuedAt: string;
    expiresAt: string;
}

export interface GrantV2Envelope extends GrantV2Fields {
    signature: string;
    algorithm?: string;
}

/** Canonical field order — the wire message layout shared with M2. */
export const GRANT_V2_FIELD_ORDER: Array<keyof GrantV2Fields> = [
    'protocolVersion',
    'direction',
    'bindingId',
    'tenantId',
    'scope',
    'targetId',
    'gateId',
    'sessionId',
    'actionId',
    'commandType',
    'payloadDigest',
    'policyDigest',
    'breakerTarget',
    'interlockAction',
    'challenge',
    'controllerBootNonce',
    'monotonicCounter',
    'issuedAt',
    'expiresAt'
];

const CANONICAL_FIELD_SET = new Set<string>(GRANT_V2_FIELD_ORDER);

const SENSITIVE_FIELDS = new Set<string>([
    'payloadDigest',
    'policyDigest',
    'challenge',
    'controllerBootNonce',
    'breakerTarget',
    'interlockAction'
]);

function stringifyField(fields: GrantV2Fields, field: keyof GrantV2Fields): string {
    const value = fields[field];
    return String(value);
}

/** Fixed-order newline-joined canonical message (M2 flat parser friendly). */
export function buildGrantV2Message(fields: GrantV2Fields): string {
    return GRANT_V2_FIELD_ORDER
        .map((field) => stringifyField(fields, field))
        .join('\n');
}

export function payloadDigestOf(payload: unknown): string {
    // Canonical JSON digest (sorted keys) — same construction as V1
    // hashPayload so payload digests remain comparable across layers.
    const sorted = JSON.stringify(sortValue(payload ?? {}));
    return createHash('sha256').update(sorted).digest('hex');
}

function sortValue(value: any): any {
    if (Array.isArray(value)) {
        return value.map(sortValue);
    }
    if (value && typeof value === 'object') {
        const sorted: Record<string, any> = {};
        for (const key of Object.keys(value).sort()) {
            sorted[key] = sortValue(value[key]);
        }
        return sorted;
    }
    return value;
}

function fieldsEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
        return false;
    }
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Structural validation: every canonical field present with the right type,
 * nothing extra. Returns the list of violations (empty when clean).
 */
export function validateGrantV2Structure(candidate: unknown): string[] {
    const violations: string[] = [];
    if (!candidate || typeof candidate !== 'object') {
        return ['envelope_not_an_object'];
    }
    const received = candidate as Record<string, unknown>;
    for (const field of GRANT_V2_FIELD_ORDER) {
        if (!(field in received) || received[field] === undefined) {
            violations.push(`missing:${field}`);
        }
    }
    for (const key of Object.keys(received)) {
        if (!CANONICAL_FIELD_SET.has(key) && key !== 'signature' && key !== 'algorithm') {
            violations.push(`unexpected:${key}`);
        }
    }
    const version = received.protocolVersion;
    if (version !== GRANT_V2_PROTOCOL_VERSION) {
        violations.push('protocol_version_mismatch');
    }
    if (typeof received.monotonicCounter !== 'number'
        || !Number.isInteger(received.monotonicCounter)
        || (received.monotonicCounter as number) < 0) {
        violations.push('monotonic_counter_not_nonnegative_integer');
    }
    return violations;
}

/**
 * Sign a Grant V2 envelope. `privateKeyPem` is the gate's ECDSA P-256 key;
 * signature is SHA256 over the canonical fixed-order message.
 */
export function signGrantV2(privateKeyPem: string, fields: GrantV2Fields): GrantV2Envelope {
    const violations = validateGrantV2Structure({ ...fields, signature: 'x' });
    if (violations.length > 0) {
        throw new Error(`grant_v2_structure_invalid: ${violations.join(',')}`);
    }
    const signature = createSign('SHA256')
        .update(buildGrantV2Message(fields))
        .end()
        .sign(privateKeyPem, 'base64');
    return { ...fields, signature };
}

export type GrantV2StrictResult =
    | { valid: true }
    | { valid: false; reason: 'signature_invalid'; mismatchedFields: string[] }
    | { valid: false; reason: string; mismatchedFields: string[] };

/**
 * Full verification for a Grant V2 envelope against the EXPECTED field set
 * rebuilt from real context:
 *   1. structure (canonical fields only, protocolVersion === 2);
 *   2. signature over the canonical message (gate public key);
 *   3. field-by-field comparison against expectations — timing-safe for
 *      sensitive digests.
 * There is deliberately NO legacy fallback at this layer.
 */
export function verifyGrantV2Strict(
    expected: GrantV2Fields,
    received: GrantV2Envelope,
    publicKeyPem: string,
    expectedAlgorithm: string = SUPPORTED_HARDWARE_GRANT_ALGORITHM
): GrantV2StrictResult {
    const structural = validateGrantV2Structure(received);
    if (structural.length > 0) {
        return { valid: false, reason: 'structure_invalid', mismatchedFields: structural };
    }
    if (!publicKeyPem || !received.signature || !validateHardwareGrantPublicKey(publicKeyPem)) {
        return { valid: false, reason: 'key_invalid', mismatchedFields: [] };
    }
    if ((received.algorithm || SUPPORTED_HARDWARE_GRANT_ALGORITHM) !== expectedAlgorithm) {
        return { valid: false, reason: 'algorithm_mismatch', mismatchedFields: [] };
    }

    let signatureValid = false;
    try {
        signatureValid = createVerify('SHA256')
            .update(buildGrantV2Message(received))
            .end()
            .verify(publicKeyPem, received.signature, 'base64');
    } catch {
        signatureValid = false;
    }
    if (!signatureValid) {
        return { valid: false, reason: 'signature_invalid', mismatchedFields: [] };
    }

    const mismatched: string[] = [];
    for (const field of GRANT_V2_FIELD_ORDER) {
        const expectedValue = stringifyField(expected, field);
        const receivedValue = stringifyField(received as GrantV2Fields, field);
        const equal = SENSITIVE_FIELDS.has(String(field))
            ? fieldsEqual(receivedValue, expectedValue)
            : receivedValue === expectedValue;
        if (!equal) {
            mismatched.push(String(field));
        }
    }
    if (mismatched.length > 0) {
        return { valid: false, reason: 'field_mismatch', mismatchedFields: mismatched };
    }
    return { valid: true };
}
