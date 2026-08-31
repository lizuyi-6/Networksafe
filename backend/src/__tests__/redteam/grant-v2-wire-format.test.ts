/**
 * REDTEAM SECURITY TESTS — Grant V2 wire format (AUD-06-1, host side).
 *
 * Attacks the canonical Grant V2 message layer the way a hostile M1↔M2
 * link would: field tampering, wrong keys, structural smuggling (extra or
 * missing fields), type attacks on the monotonic counter, direction
 * confusion, and legacy-fallback pressure. The verifier under test is the
 * REAL production module (`security/grant-v2.ts`) — no test mirror.
 */

import { generateKeyPairSync } from 'crypto';
import {
    GRANT_V2_PROTOCOL_VERSION,
    buildGrantV2Message,
    signGrantV2,
    verifyGrantV2Strict,
    payloadDigestOf,
    type GrantV2Fields
} from '../../security/grant-v2';

function makeFields(overrides: Partial<GrantV2Fields> = {}): GrantV2Fields {
    return {
        protocolVersion: GRANT_V2_PROTOCOL_VERSION,
        direction: 'control_plane_to_gate',
        bindingId: 'binding-001',
        tenantId: 'tenant-A',
        scope: 'device',
        targetId: 'device-42',
        gateId: 'gate-001',
        sessionId: 'sess-001',
        actionId: 'action-001',
        commandType: 'host_remove',
        payloadDigest: payloadDigestOf({ path: '/opt/data' }),
        policyDigest: 'policy-digest-canary',
        breakerTarget: 'server-lan-transparent-bridge',
        interlockAction: 'interlock_release',
        challenge: 'challenge-canary',
        controllerBootNonce: 'boot-nonce-canary',
        monotonicCounter: 7,
        issuedAt: '2026-08-30T00:00:00.000Z',
        expiresAt: '2026-08-30T00:05:00.000Z',
        ...overrides
    };
}

function makeKeys() {
    return generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
}

describe('REDTEAM Grant V2 wire format (AUD-06-1)', () => {
    let keys: ReturnType<typeof makeKeys>;
    let fields: GrantV2Fields;

    beforeEach(() => {
        keys = makeKeys();
        fields = makeFields();
    });

    it('round-trips a correctly signed envelope', () => {
        const envelope = signGrantV2(keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), fields);
        const result = verifyGrantV2Strict(
            fields,
            envelope,
            keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
        );
        expect(result).toEqual({ valid: true });
    });

    const tamperCases: Array<[string, keyof GrantV2Fields, any]> = [
        ['tenantId', 'tenantId', 'tenant-B'],
        ['targetId', 'targetId', 'device-43'],
        ['gateId', 'gateId', 'gate-002'],
        ['sessionId', 'sessionId', 'sess-evil'],
        ['actionId', 'actionId', 'action-evil'],
        ['commandType', 'commandType', 'wipe_data'],
        ['policyDigest', 'policyDigest', 'policy-digest-swapped'],
        ['challenge', 'challenge', 'challenge-swapped'],
        ['breakerTarget', 'breakerTarget', 'other-bridge'],
        ['interlockAction', 'interlockAction', 'interlock_assert'],
        ['controllerBootNonce', 'controllerBootNonce', 'boot-nonce-replayed'],
        ['payloadDigest', 'payloadDigest', payloadDigestOf({ path: '/etc' })],
        ['direction', 'direction', 'controller_feedback'],
        ['bindingId', 'bindingId', 'binding-hijacked'],
        ['issuedAt', 'issuedAt', '2026-08-29T00:00:00.000Z'],
        ['expiresAt', 'expiresAt', '2099-08-30T00:00:00.000Z']
    ];

    for (const [name, field, value] of tamperCases) {
        it(`rejects tampering of ${name}`, () => {
            const envelope = signGrantV2(keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), fields);
            const tamperedFields = { ...fields, [field]: value };
            const tamperedEnvelope = { ...envelope, ...tamperedFields };
            const result = verifyGrantV2Strict(
                fields,
                tamperedEnvelope as typeof envelope,
                keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
            );
            expect(result.valid).toBe(false);
            if (!result.valid && result.reason === 'field_mismatch') {
                expect(result.mismatchedFields).toContain(String(field));
            }
        });
    }

    it('rejects a signature produced by a DIFFERENT key (grant forgery)', () => {
        const attacker = makeKeys();
        const envelope = signGrantV2(attacker.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), fields);
        const result = verifyGrantV2Strict(
            fields,
            envelope,
            keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
        );
        expect(result.valid).toBe(false);
    });

    it('rejects a counter type attack (string counter)', () => {
        const envelope = signGrantV2(keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), fields);
        const forged = { ...envelope, monotonicCounter: '7' } as unknown as typeof envelope;
        const result = verifyGrantV2Strict(fields, forged, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString());
        expect(result.valid).toBe(false);
    });

    it('rejects a fractional counter (INTEGER column rollback guard)', () => {
        const forged = { ...fields, monotonicCounter: 7.5 };
        expect(validateStructureHas(forged, 'monotonic_counter_not_nonnegative_integer')).toBe(true);
    });

    it('rejects a MISSING canonical field (protocol smuggling)', () => {
        const envelope = signGrantV2(keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), fields);
        const smuggled: any = { ...envelope };
        delete smuggled.controllerBootNonce;
        const result = verifyGrantV2Strict(fields, smuggled, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString());
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.reason).toBe('structure_invalid');
            expect(result.mismatchedFields).toContain('missing:controllerBootNonce');
        }
    });

    it('rejects UNEXPECTED extra fields (parser confusion)', () => {
        const envelope = signGrantV2(keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), fields);
        const smuggled: any = { ...envelope, grantAdminFlag: true };
        const result = verifyGrantV2Strict(fields, smuggled, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString());
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.reason).toBe('structure_invalid');
            expect(result.mismatchedFields).toContain('unexpected:grantAdminFlag');
        }
    });

    it('gives NO legacy fallback: a legacy V1-shaped envelope is structurally invalid at the V2 layer', () => {
        // V1 envelope (no protocolVersion/direction/bindingId/bootNonce).
        const legacy: any = {
            gateId: fields.gateId,
            sessionId: fields.sessionId,
            actionId: fields.actionId,
            tenantId: fields.tenantId,
            scope: fields.scope,
            targetId: fields.targetId,
            commandType: fields.commandType,
            payloadHash: fields.payloadDigest,
            issuedAt: fields.issuedAt,
            expiresAt: fields.expiresAt,
            monotonicCounter: fields.monotonicCounter,
            signature: 'AAAA'
        };
        const result = verifyGrantV2Strict(fields, legacy, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString());
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.reason).toBe('structure_invalid');
        }
    });

    it('builds an identical canonical message for identical fields (M2 reproducibility)', () => {
        expect(buildGrantV2Message(makeFields())).toBe(buildGrantV2Message(makeFields()));
        // Field order in the message is FIXED, not caller-dependent.
        const a = buildGrantV2Message(makeFields());
        const b = buildGrantV2Message(makeFields({ challenge: 'different' }));
        expect(a.split('\n')).toHaveLength(19);
        expect(b.split('\n')).toHaveLength(19);
        expect(a.split('\n')[14]).toBe('challenge-canary');
        expect(b.split('\n')[14]).toBe('different');
    });
});

function validateStructureHas(fields: GrantV2Fields, violation: string): boolean {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { validateGrantV2Structure } = require('../../security/grant-v2');
    return validateGrantV2Structure({ ...fields, signature: 'x' }).includes(violation);
}
