import { createSign, generateKeyPairSync } from 'crypto';
import { initDatabase, getDatabase } from '../../config/database';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';
import { buildHardwareGrantMessage, hashPayload } from '../../security/hardware-grant';
import auditLogger from '../../security/audit-logger.service';

const defaultHardwareContext = {
  policyDigest: 'policy-a',
  challenge: 'challenge-a',
  breakerTarget: 'mgmt-uplink-a',
  interlockAction: 'interlock_release'
};

type TestHardwareContext = Partial<typeof defaultHardwareContext>;

async function createHardwareRequest(options: {
  gatePrefix: string;
  devicePrefix: string;
  commandType?: string;
  payload?: Record<string, any>;
  hardwareContext?: TestHardwareContext;
}) {
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const gateId = `${options.gatePrefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const deviceId = `${options.devicePrefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const payload = options.payload || { path: '/opt/aetherguard' };
  const commandType = options.commandType || 'host_remove';
  const hardwareContext = options.hardwareContext || defaultHardwareContext;

  hardwareAuthorizationService.enrollGate({
    tenantId: 'tenant-test',
    gateId,
    publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    status: 'online'
  });

  const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
    tenantId: 'tenant-test',
    scope: 'device',
    targetId: deviceId,
    commandType,
    payload,
    hardwareContext,
    actorId: 'tester'
  });

  return { keyPair, gateId, deviceId, payload, commandType, hardwareContext, request };
}

function signAck(input: {
  keyPair: ReturnType<typeof generateKeyPairSync>;
  gateId: string;
  deviceId: string;
  request: Awaited<ReturnType<typeof createHardwareRequest>>['request'];
  payload: Record<string, any>;
  commandType: string;
  hardwareContext: TestHardwareContext;
  monotonicCounter?: number;
  issuedAt?: string;
}) {
  const issuedAt = input.issuedAt || new Date().toISOString();
  const expiresAt = input.request.session!.expiresAt;
  const monotonicCounter = input.monotonicCounter ?? 1;
  const signature = createSign('SHA256')
    .update(buildHardwareGrantMessage({
      gateId: input.gateId,
      sessionId: input.request.session!.sessionId,
      actionId: input.request.intent.actionId,
      tenantId: 'tenant-test',
      scope: 'device',
      targetId: input.deviceId,
      commandType: input.commandType,
      payloadHash: hashPayload(input.payload),
      policyDigest: input.hardwareContext.policyDigest,
      challenge: input.hardwareContext.challenge,
      breakerTarget: input.hardwareContext.breakerTarget,
      interlockAction: input.hardwareContext.interlockAction,
      issuedAt,
      expiresAt,
      monotonicCounter
    }))
    .end()
    .sign(input.keyPair.privateKey, 'base64');

  return {
    confirmationSessionId: input.request.session!.sessionId,
    confirmed: true,
    ...input.hardwareContext,
    issuedAt,
    expiresAt,
    monotonicCounter,
    signature
  };
}

describe('hardwareAuthorizationService', () => {
  beforeAll(async () => {
    await initDatabase();
    hardwareAuthorizationService.prepare();
  });

  beforeEach(() => {
    hardwareAuthorizationService.setGatewayEmitter(() => true);
    commandDispatcherService.setDeviceAdapter({
      getDevice: () => ({ isOnline: true }),
      executeCommand: jest.fn().mockResolvedValue({
        success: true,
        record: { ok: true },
        message: 'executed'
      })
    });
  });

  it('verifies a hardware grant and dispatches the confirmed command', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const gateId = `gate-${Date.now()}`;
    const deviceId = `device-${Date.now()}`;
    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-test',
      gateId,
      displayName: 'Main gate',
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-test',
      scope: 'device',
      targetId: deviceId,
      commandType: 'reboot',
      payload: { delay: 5 },
      hardwareContext: {
        policyDigest: 'policy-digest-test',
        challenge: 'challenge-test',
        breakerTarget: 'mgmt-uplink-a',
        interlockAction: 'interlock_release'
      },
      actorId: 'tester'
    });

    expect(request.success).toBe(true);
    expect(request.session?.gateId).toBe(gateId);

    const issuedAt = new Date().toISOString();
    const expiresAt = request.session!.expiresAt;
    const monotonicCounter = 1;
    const signature = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: request.session!.sessionId,
        actionId: request.intent.actionId,
        tenantId: 'tenant-test',
        scope: 'device',
        targetId: deviceId,
        commandType: 'reboot',
        payloadHash: hashPayload({ delay: 5 }),
        policyDigest: 'policy-digest-test',
        challenge: 'challenge-test',
        breakerTarget: 'mgmt-uplink-a',
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: request.session!.sessionId,
      confirmed: true,
      policyDigest: 'policy-digest-test',
      challenge: 'challenge-test',
      breakerTarget: 'mgmt-uplink-a',
      interlockAction: 'interlock_release',
      issuedAt,
      expiresAt,
      monotonicCounter,
      signature
    });

    expect(ack.confirmed).toBe(true);
    expect(ack.grant?.gateId).toBe(gateId);

    const dispatch = await commandDispatcherService.dispatchHardwareConfirmedIntent(
      ack.intent!,
      ack.grant!
    );

    expect(dispatch.success).toBe(true);
    expect(dispatch.status).toBe('completed');
  });

  // SECURITY (audit 2026-08, batch 3): a consumed session/counter can never
  // produce a second grant — replay of the same ACK must fail closed.
  it('rejects a replayed ack and never creates a second grant', async () => {
    const context = await createHardwareRequest({ gatePrefix: 'gate-replay', devicePrefix: 'device-replay' });
    expect(context.request.success).toBe(true);

    const ackPayload = signAck({ ...context, payload: context.payload });
    const first = await hardwareAuthorizationService.handlePhysicalConfirmationAck(context.gateId, ackPayload);
    expect(first.confirmed).toBe(true);

    const replay = await hardwareAuthorizationService.handlePhysicalConfirmationAck(context.gateId, ackPayload);
    expect(replay.confirmed).toBe(false);
    expect(replay.reason).toBe('session_already_consumed');

    const grants = getDatabase().prepare(
      `SELECT COUNT(*) AS count FROM hardware_grants WHERE gate_id = ? AND monotonic_counter = ?`
    ).get(context.gateId, 1) as { count: number };
    expect(Number(grants.count)).toBe(1);
  });

  it('keeps exactly one grant when two acks race on the same session', async () => {
    const context = await createHardwareRequest({ gatePrefix: 'gate-race', devicePrefix: 'device-race' });
    expect(context.request.success).toBe(true);

    const ackPayload = signAck({ ...context, payload: context.payload });
    const [a, b] = await Promise.all([
      hardwareAuthorizationService.handlePhysicalConfirmationAck(context.gateId, ackPayload),
      hardwareAuthorizationService.handlePhysicalConfirmationAck(context.gateId, ackPayload)
    ]);

    const confirmedResults = [a, b].filter((result) => result.confirmed);
    const rejectedResults = [a, b].filter((result) => !result.confirmed);
    expect(confirmedResults).toHaveLength(1);
    expect(rejectedResults).toHaveLength(1);
    expect(['session_already_consumed', 'monotonic_counter_replay']).toContain(rejectedResults[0].reason);

    const grants = getDatabase().prepare(
      `SELECT COUNT(*) AS count FROM hardware_grants WHERE gate_id = ? AND monotonic_counter = ?`
    ).get(context.gateId, 1) as { count: number };
    expect(Number(grants.count)).toBe(1);

    // The high-water mark must reflect exactly one advancing ack.
    const gate = hardwareAuthorizationService.getGate(context.gateId);
    expect(gate?.lastMonotonicCounter).toBe(1);
  });

  it('flushes the database synchronously after a confirmed ack advances the monotonic counter', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const gateId = `gate-flush-${Date.now()}`;
    const deviceId = `device-flush-${Date.now()}`;
    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-test',
      gateId,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-test',
      scope: 'device',
      targetId: deviceId,
      commandType: 'reboot',
      payload: { delay: 5 },
      hardwareContext: {
        policyDigest: 'policy-digest-flush',
        challenge: 'challenge-flush',
        breakerTarget: 'mgmt-uplink-a',
        interlockAction: 'interlock_release'
      },
      actorId: 'tester'
    });
    expect(request.success).toBe(true);

    const issuedAt = new Date().toISOString();
    const expiresAt = request.session!.expiresAt;
    const monotonicCounter = 1;
    const signature = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: request.session!.sessionId,
        actionId: request.intent.actionId,
        tenantId: 'tenant-test',
        scope: 'device',
        targetId: deviceId,
        commandType: 'reboot',
        payloadHash: hashPayload({ delay: 5 }),
        policyDigest: 'policy-digest-flush',
        challenge: 'challenge-flush',
        breakerTarget: 'mgmt-uplink-a',
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const saveSpy = jest.spyOn(getDatabase(), 'save');
    try {
      const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
        confirmationSessionId: request.session!.sessionId,
        confirmed: true,
        policyDigest: 'policy-digest-flush',
        challenge: 'challenge-flush',
        breakerTarget: 'mgmt-uplink-a',
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter,
        signature
      });

      expect(ack.confirmed).toBe(true);
      // The anti-replay high-water mark must hit disk before the ack returns;
      // otherwise a crash inside the periodic-save window rolls the counter
      // back and re-opens the replay window.
      expect(saveSpy).toHaveBeenCalled();
    } finally {
      saveSpy.mockRestore();
    }
  });

  it('rejects a hardware grant when signed final-defense context is tampered', async () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const gateId = `gate-tamper-${Date.now()}`;
    const deviceId = `device-tamper-${Date.now()}`;
    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-test',
      gateId,
      publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'online'
    });

    const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
      tenantId: 'tenant-test',
      scope: 'device',
      targetId: deviceId,
      commandType: 'host_remove',
      payload: { path: '/opt/aetherguard' },
      hardwareContext: {
        policyDigest: 'expected-policy-digest',
        challenge: 'challenge-a',
        breakerTarget: 'mgmt-uplink-a',
        interlockAction: 'interlock_release'
      },
      actorId: 'tester'
    });

    const issuedAt = new Date().toISOString();
    const expiresAt = request.session!.expiresAt;
    const monotonicCounter = 1;
    const signature = createSign('SHA256')
      .update(buildHardwareGrantMessage({
        gateId,
        sessionId: request.session!.sessionId,
        actionId: request.intent.actionId,
        tenantId: 'tenant-test',
        scope: 'device',
        targetId: deviceId,
        commandType: 'host_remove',
        payloadHash: hashPayload({ path: '/opt/aetherguard' }),
        policyDigest: 'expected-policy-digest',
        challenge: 'challenge-a',
        breakerTarget: 'mgmt-uplink-a',
        interlockAction: 'interlock_release',
        issuedAt,
        expiresAt,
        monotonicCounter
      }))
      .end()
      .sign(keyPair.privateKey, 'base64');

    const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
      confirmationSessionId: request.session!.sessionId,
      confirmed: true,
      policyDigest: 'tampered-policy-digest',
      challenge: 'challenge-a',
      breakerTarget: 'mgmt-uplink-a',
      interlockAction: 'interlock_release',
      issuedAt,
      expiresAt,
      monotonicCounter,
      signature
    });

    expect(ack.confirmed).toBe(false);
    expect(ack.reason).toBe('policyDigest_mismatch');
  });

  it.each([
    ['false string', 'false'],
    ['number one', 1],
    ['undefined', undefined]
  ])('rejects non-boolean confirmed payloads: %s', async (_label, confirmedValue) => {
    const auditSpy = jest.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    try {
      const requestContext = await createHardwareRequest({
        gatePrefix: 'gate-confirmed',
        devicePrefix: 'device-confirmed'
      });
      const ackPayload = signAck({
        ...requestContext,
        monotonicCounter: 1
      });
      const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(
        requestContext.gateId,
        { ...ackPayload, confirmed: confirmedValue }
      );

      expect(ack.confirmed).toBe(false);
      expect(ack.reason).toBe('operator_rejected');
      const session = hardwareAuthorizationService.getConfirmationSession(requestContext.request.session!.sessionId);
      expect(session?.status).toBe('rejected');
    } finally {
      auditSpy.mockRestore();
    }
  });

  it('audits a non-increasing counter rejection as critical', async () => {
    const auditSpy = jest.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    try {
      const requestContext = await createHardwareRequest({
        gatePrefix: 'gate-counter',
        devicePrefix: 'device-counter'
      });
      const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(
        requestContext.gateId,
        signAck({ ...requestContext, monotonicCounter: 0 })
      );

      expect(ack.confirmed).toBe(false);
      expect(ack.reason).toBe('non_increasing_monotonic_counter');
      const rejectionAudit = auditSpy.mock.calls.find(
        (c: any[]) => c[0]?.eventType === 'hardware_confirmation_rejected'
      );
      expect(rejectionAudit?.[0].severity).toBe('critical');
      expect(rejectionAudit?.[0].details.reason).toBe('non_increasing_monotonic_counter');
    } finally {
      auditSpy.mockRestore();
    }
  });

  it.each([
    ['policyDigest', 'policyDigest_mismatch'],
    ['challenge', 'challenge_mismatch'],
    ['breakerTarget', 'breakerTarget_mismatch'],
    ['interlockAction', 'interlockAction_mismatch']
  ] as const)('audits %s mismatch as critical', async (field, reason) => {
    const auditSpy = jest.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    try {
      const requestContext = await createHardwareRequest({
        gatePrefix: `gate-${field}`,
        devicePrefix: `device-${field}`
      });
      const ackPayload = signAck({ ...requestContext, monotonicCounter: 1 });
      const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(
        requestContext.gateId,
        { ...ackPayload, [field]: `${ackPayload[field]}-tampered` }
      );

      expect(ack.confirmed).toBe(false);
      expect(ack.reason).toBe(reason);
      const rejectionAudit = auditSpy.mock.calls.find(
        (c: any[]) => c[0]?.eventType === 'hardware_confirmation_rejected'
      );
      expect(rejectionAudit?.[0].severity).toBe('critical');
      expect(rejectionAudit?.[0].details.reason).toBe(reason);
    } finally {
      auditSpy.mockRestore();
    }
  });

  it('rejects a final-defense session that is missing a required binding field before signature verification', async () => {
    const auditSpy = jest.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    try {
      const requestContext = await createHardwareRequest({
        gatePrefix: 'gate-missing-binding',
        devicePrefix: 'device-missing-binding',
        hardwareContext: {
          policyDigest: 'policy-missing',
          challenge: 'challenge-missing',
          breakerTarget: 'mgmt-uplink-a'
        }
      });
      const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(
        requestContext.gateId,
        signAck({
          ...requestContext,
          hardwareContext: {
            policyDigest: 'policy-missing',
            challenge: 'challenge-missing',
            breakerTarget: 'mgmt-uplink-a',
            interlockAction: 'interlock_release'
          },
          monotonicCounter: 1
        })
      );

      expect(ack.confirmed).toBe(false);
      expect(ack.reason).toBe('interlockAction_missing');
      const rejectionAudit = auditSpy.mock.calls.find(
        (c: any[]) => c[0]?.eventType === 'hardware_confirmation_rejected'
      );
      expect(rejectionAudit?.[0].severity).toBe('critical');
      expect(rejectionAudit?.[0].details.reason).toBe('interlockAction_missing');
    } finally {
      auditSpy.mockRestore();
    }
  });

  it('does not persist a rejected session state when rejection auditing fails', async () => {
    const requestContext = await createHardwareRequest({
      gatePrefix: 'gate-audit-fail',
      devicePrefix: 'device-audit-fail'
    });
    const auditSpy = jest.spyOn(auditLogger, 'log').mockRejectedValue(new Error('audit down'));
    try {
      await expect(hardwareAuthorizationService.handlePhysicalConfirmationAck(
        requestContext.gateId,
        signAck({
          ...requestContext,
          hardwareContext: { ...requestContext.hardwareContext, policyDigest: 'tampered-policy' },
          monotonicCounter: 1
        })
      )).rejects.toThrow('backend.hardware_rejection_audit_failed');

      const session = hardwareAuthorizationService.getConfirmationSession(requestContext.request.session!.sessionId);
      // Batch 3: the ack first atomically claims the session
      // (pending -> claiming). When rejection auditing fails, no terminal
      // state is persisted — the session stays in the transitional
      // 'claiming' state and expires; it is never marked rejected/confirmed.
      expect(session?.status).toBe('claiming');
      const intent = hardwareAuthorizationService.getIntent(requestContext.request.intent.actionId);
      expect(intent?.status).toBe('pending_hardware_confirmation');
    } finally {
      auditSpy.mockRestore();
    }
  });

  it('refuses to overwrite a provisioned gate public key (trust anchor immutability)', () => {
    const firstKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const secondKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const gateId = `gate-immutable-${Date.now()}`;
    const firstPem = firstKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const secondPem = secondKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();

    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-test',
      gateId,
      publicKeyPem: firstPem,
      status: 'online'
    });

    // A second enrollment presenting a DIFFERENT key must fail — the public
    // key is the grant verification anchor and may not be silently replaced.
    expect(() => hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-test',
      gateId,
      publicKeyPem: secondPem,
      status: 'online'
    })).toThrow('backend.hardware_gate_public_key_immutable');

    // Re-enrollment with the SAME key stays idempotent (reconnect path).
    expect(() => hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-test',
      gateId,
      publicKeyPem: firstPem,
      status: 'online'
    })).not.toThrow();

    // The stored key is unchanged.
    const gate = hardwareAuthorizationService.getGate(gateId);
    expect(gate?.publicKeyPem).toBe(firstPem);
  });

  it('N3-1: refuses to rebind an enrolled gate to a different tenant (tenant ownership immutable)', () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const gateId = `gate-tenant-immutable-${Date.now()}`;
    const pem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

    hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-owner',
      gateId,
      publicKeyPem: pem,
      status: 'online'
    });

    // Same gate id, DIFFERENT tenant: the ON CONFLICT path previously
    // silently rewrote tenant_id; now it must fail closed.
    expect(() => hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-attacker',
      gateId,
      publicKeyPem: pem,
      status: 'online'
    })).toThrow('backend.hardware_gate_tenant_immutable');

    // The original owner keeps the gate and can still re-enroll idempotently.
    expect(() => hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-owner',
      gateId,
      publicKeyPem: pem,
      status: 'online'
    })).not.toThrow();
    expect(hardwareAuthorizationService.getGate(gateId)?.tenantId).toBe('tenant-owner');
  });

  it('rejects unsupported gate algorithms and non-P-256 public keys during enrollment', () => {
    const ecKeyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const rsaKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });

    expect(() => hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-test',
      gateId: `gate-bad-algorithm-${Date.now()}`,
      publicKeyPem: ecKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      algorithm: 'RSA_SHA256',
      status: 'online'
    })).toThrow('backend.hardware_gate_algorithm_unsupported');

    expect(() => hardwareAuthorizationService.enrollGate({
      tenantId: 'tenant-test',
      gateId: `gate-bad-key-${Date.now()}`,
      publicKeyPem: rsaKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      algorithm: 'ECDSA_P256_SHA256',
      status: 'online'
    })).toThrow('backend.hardware_gate_public_key_invalid');
  });

  it('emits a tamper-evident audit event when a hardware grant is rejected (PRD §7)', async () => {
    const auditSpy = jest.spyOn(require('../../security/audit-logger.service').default, 'log').mockResolvedValue(undefined);
    try {
      const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const attacker = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const gateId = `gate-audit-${Date.now()}`;
      const deviceId = `device-audit-${Date.now()}`;
      hardwareAuthorizationService.enrollGate({
        tenantId: 'tenant-test',
        gateId,
        publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        status: 'online'
      });

      const request = await hardwareAuthorizationService.requestPhysicalConfirmation({
        tenantId: 'tenant-test',
        scope: 'device',
        targetId: deviceId,
        commandType: 'host_remove',
        payload: { path: '/opt/aetherguard' },
        hardwareContext: {
          policyDigest: 'policy-a', challenge: 'challenge-a',
          breakerTarget: 'mgmt-uplink-a', interlockAction: 'interlock_release'
        },
        actorId: 'tester-audit'
      });

      // Sign with the ATTACKER key — signature verification must fail and the
      // rejection must be audited, not just written to a DB result_json column.
      const signature = createSign('SHA256')
        .update(buildHardwareGrantMessage({
          gateId,
          sessionId: request.session!.sessionId,
          actionId: request.intent.actionId,
          tenantId: 'tenant-test', scope: 'device', targetId: deviceId,
          commandType: 'host_remove',
          payloadHash: hashPayload({ path: '/opt/aetherguard' }),
          policyDigest: 'policy-a', challenge: 'challenge-a',
          breakerTarget: 'mgmt-uplink-a', interlockAction: 'interlock_release',
          issuedAt: new Date().toISOString(),
          expiresAt: request.session!.expiresAt,
          monotonicCounter: 1
        }))
        .end()
        .sign(attacker.privateKey, 'base64');

      const ack = await hardwareAuthorizationService.handlePhysicalConfirmationAck(gateId, {
        confirmationSessionId: request.session!.sessionId,
        confirmed: true,
        policyDigest: 'policy-a', challenge: 'challenge-a',
        breakerTarget: 'mgmt-uplink-a', interlockAction: 'interlock_release',
        issuedAt: new Date().toISOString(),
        expiresAt: request.session!.expiresAt,
        monotonicCounter: 1,
        signature
      });

      expect(ack.confirmed).toBe(false);
      // Flush the async auditLogger.log promise.
      await new Promise(r => setImmediate(r));
      const rejectionAudit = auditSpy.mock.calls.find(
        (c: any[]) => c[0]?.eventType === 'hardware_confirmation_rejected'
      );
      expect(rejectionAudit).toBeDefined();
      expect(rejectionAudit[0].status).toBe('failure');
      expect(rejectionAudit[0].severity).toBe('critical');
      expect(rejectionAudit[0].details.reason).toBe('invalid_signature');
    } finally {
      auditSpy.mockRestore();
    }
  });
});
