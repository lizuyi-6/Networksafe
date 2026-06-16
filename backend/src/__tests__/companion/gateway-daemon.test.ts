import { createSign, generateKeyPairSync } from 'crypto';
import { buildHardwareGrantMessage, type HardwareGrantEnvelope } from '../../security/hardware-grant';
import { GatewayDaemon } from '../../companion/gateway-daemon';

// Deterministic injected clock so watchdog/staleness tests don't depend on real time.
function makeClock() {
  let t = 1_700_000_000_000;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
    set: (ms: number) => { t = ms; }
  };
}

function keyPair() {
  return generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
}

function signGrant(privateKeyPem: string, grant: Partial<HardwareGrantEnvelope> & { monotonicCounter: number }): HardwareGrantEnvelope {
  const base: HardwareGrantEnvelope = {
    gateId: 'gate-1',
    sessionId: 'sess-1',
    actionId: 'act-1',
    tenantId: 'tenant-1',
    scope: 'device',
    targetId: 'gateway-1',
    commandType: 'interlock_release',
    payloadHash: '0'.repeat(64),
    policyDigest: 'digest-a',
    challenge: 'challenge-a',
    breakerTarget: 'server-lan-bridge',
    interlockAction: 'release',
    issuedAt: '1700000000',
    expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
    ...grant
  };
  const sig = createSign('SHA256').update(buildHardwareGrantMessage(base)).end().sign(privateKeyPem, 'base64');
  return { ...base, signature: sig };
}

describe('GatewayDaemon fail-closed bridge enforcement', () => {
  it('boots in isolated (deny-forward) and applies the isolated ruleset', () => {
    const clock = makeClock();
    const frames: any[] = [];
    const { publicKey } = keyPair();
    const daemon = new GatewayDaemon({
      gatewayId: 'gw-1',
      secureElementPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      breakerTarget: 'server-lan-bridge',
      now: clock.now,
      onFrame: (f) => frames.push(f)
    });
    try {
      expect(daemon.getBridgeState()).toBe('isolated');
      expect(frames[0]).toMatchObject({ type: 'apply_ruleset', ruleset: 'isolated_ruleset', reason: 'boot_default_isolated' });
      expect(daemon.isReleased()).toBe(false);
    } finally {
      daemon.shutdown();
    }
  });

  it('releases the bridge only on a grant signed by the provisioned SE key + controller feedback', () => {
    const clock = makeClock();
    const frames: any[] = [];
    const { publicKey, privateKey } = keyPair();
    const daemon = new GatewayDaemon({
      gatewayId: 'gw-1',
      secureElementPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      breakerTarget: 'server-lan-bridge',
      now: clock.now,
      onFrame: (f) => frames.push(f)
    });
    try {
      const grant = signGrant(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), { monotonicCounter: 1 });
      expect(daemon.requestRelease(grant)).toBe(true);
      expect(daemon.isReleased()).toBe(true);
      expect(daemon.getBridgeState()).toBe('released');
      expect(frames.some(f => f.ruleset === 'released_ruleset')).toBe(true);

      // Controller confirms released with healthy feedback -> stays released.
      daemon.handleControllerFrame({ type: 'interlock_result', interlockState: 'released', feedbackOk: true });
      expect(daemon.isReleased()).toBe(true);
    } finally {
      daemon.shutdown();
    }
  });

  it('rejects a release signed by a different key and re-asserts isolated (PRD #1)', () => {
    const clock = makeClock();
    const { publicKey } = keyPair();
    const attacker = keyPair();
    const daemon = new GatewayDaemon({
      gatewayId: 'gw-1',
      secureElementPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      breakerTarget: 'server-lan-bridge',
      now: clock.now
    });
    try {
      const forged = signGrant(attacker.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), { monotonicCounter: 1 });
      expect(daemon.requestRelease(forged)).toBe(false);
      expect(daemon.isReleased()).toBe(false);
      expect(daemon.getBridgeState()).toBe('isolated');
    } finally {
      daemon.shutdown();
    }
  });

  it('rejects a monotonic counter rollback and re-asserts isolated (PRD #2)', () => {
    const clock = makeClock();
    const { publicKey, privateKey } = keyPair();
    const daemon = new GatewayDaemon({
      gatewayId: 'gw-1',
      secureElementPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      breakerTarget: 'server-lan-bridge',
      now: clock.now
    });
    try {
      const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      expect(daemon.requestRelease(signGrant(priv, { monotonicCounter: 5 }))).toBe(true);
      // A replay/rollback at counter 3 must fail even though the signature is otherwise valid.
      expect(daemon.requestRelease(signGrant(priv, { monotonicCounter: 3 }))).toBe(false);
      expect(daemon.getBridgeState()).toBe('isolated');
    } finally {
      daemon.shutdown();
    }
  });

  it('fail-closes when the controller heartbeat goes stale past the PRD 45s threshold (PRD #7)', () => {
    const clock = makeClock();
    const { publicKey, privateKey } = keyPair();
    const daemon = new GatewayDaemon({
      gatewayId: 'gw-1',
      secureElementPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      breakerTarget: 'server-lan-bridge',
      heartbeatStaleMs: 45_000,
      now: clock.now
    });
    try {
      const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      daemon.requestRelease(signGrant(priv, { monotonicCounter: 1 }));
      expect(daemon.isReleased()).toBe(true);
      daemon.handleControllerFrame({ type: 'heartbeat' });
      // Advance just past 45s without another heartbeat.
      clock.advance(46_000);
      // The watchdog polls every min(staleMs, 5s); step it.
      daemon['checkWatchdog']();
      expect(daemon.isReleased()).toBe(false);
      expect(daemon.getBridgeState()).toBe('isolated');
    } finally {
      daemon.shutdown();
    }
  });

  it('fail-closes on daemon/controller state divergence: released here but controller reports isolated (PRD #9)', () => {
    const clock = makeClock();
    const { publicKey, privateKey } = keyPair();
    const daemon = new GatewayDaemon({
      gatewayId: 'gw-1',
      secureElementPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      breakerTarget: 'server-lan-bridge',
      now: clock.now
    });
    try {
      const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      daemon.requestRelease(signGrant(priv, { monotonicCounter: 1 }));
      expect(daemon.isReleased()).toBe(true);
      daemon.handleControllerFrame({ type: 'state', interlockState: 'isolated', feedbackOk: true });
      expect(daemon.isReleased()).toBe(false);
      expect(daemon.getBridgeState()).toBe('isolated');
    } finally {
      daemon.shutdown();
    }
  });

  it('fail-closes when feedback readback disagrees with expected released state (PRD #6)', () => {
    const clock = makeClock();
    const { publicKey, privateKey } = keyPair();
    const daemon = new GatewayDaemon({
      gatewayId: 'gw-1',
      secureElementPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      breakerTarget: 'server-lan-bridge',
      now: clock.now
    });
    try {
      const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      daemon.requestRelease(signGrant(priv, { monotonicCounter: 1 }));
      daemon.handleControllerFrame({ type: 'interlock_result', interlockState: 'released', feedbackOk: false });
      expect(daemon.isReleased()).toBe(false);
      expect(daemon.getBridgeState()).toBe('isolated');
    } finally {
      daemon.shutdown();
    }
  });

  it('fail-closes when the Secure Element reports unavailable (PRD #5)', () => {
    const clock = makeClock();
    const { publicKey, privateKey } = keyPair();
    const daemon = new GatewayDaemon({
      gatewayId: 'gw-1',
      secureElementPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      breakerTarget: 'server-lan-bridge',
      now: clock.now
    });
    try {
      const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      daemon.requestRelease(signGrant(priv, { monotonicCounter: 1 }));
      daemon.handleControllerFrame({ type: 'state', interlockState: 'released', secureElementPresent: false, feedbackOk: true });
      expect(daemon.isReleased()).toBe(false);
      expect(daemon.getBridgeState()).toBe('isolated');
      // A subsequent release request must be rejected outright (SE unavailable).
      expect(daemon.requestRelease(signGrant(priv, { monotonicCounter: 2 }))).toBe(false);
    } finally {
      daemon.shutdown();
    }
  });

  it('auto-reasserts isolated when the release window expires (PRD §4.4 window expiry)', (done) => {
    const clock = makeClock();
    const { publicKey, privateKey } = keyPair();
    const daemon = new GatewayDaemon({
      gatewayId: 'gw-1',
      secureElementPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      breakerTarget: 'server-lan-bridge',
      releaseTtlMs: 50,
      now: clock.now
    });
    try {
      const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      daemon.requestRelease(signGrant(priv, { monotonicCounter: 1 }));
      expect(daemon.isReleased()).toBe(true);
      // After the (short, real-time) TTL elapses the daemon must re-assert isolated.
      setTimeout(() => {
        try {
          expect(daemon.isReleased()).toBe(false);
          expect(daemon.getBridgeState()).toBe('isolated');
          done();
        } catch (e) {
          done(e);
        }
      }, 120);
    } finally {
      // shutdown() in finally would cancel the timer before it fires; defer it.
      setTimeout(() => daemon.shutdown(), 200);
    }
  });
});
