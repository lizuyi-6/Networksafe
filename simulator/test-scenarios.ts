#!/usr/bin/env ts-node
/**
 * Fail-closed scenario runner for the Gateway Appliance simulator.
 *
 * Each invocation drives ONE fail-closed trigger through the real M1
 * GatewayDaemon + mocked M2/M3/M4 and asserts the observable outcome:
 * the bridge must end isolated and the expected fail-closed reason must
 * have been emitted. Exit code 0 = behaved fail-closed, 1 = violation.
 *
 *   npm run test:invalid-sig       (grant_signature_invalid)
 *   npm run test:counter-rollback  (monotonic_counter_rollback)
 *   npm run test:heartbeat-stale   (controller_heartbeat_stale)
 *   npm run test:estop             (controller_alert + release latch)
 */

import { GatewayDaemon, DaemonFrame } from '../backend/src/companion/gateway-daemon';
import { MockSecureElement } from './m3-secure-element/mock-se';
import { MockController } from './m2-controller/mock-controller';
import { MockInterlock } from './m4-interlock/mock-interlock';
import type { HardwareGrantEnvelope } from '../backend/src/security/hardware-grant';

const trigger = (process.argv.find((a) => a.startsWith('--trigger=')) || '').split('=')[1] || '';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildSignedGrant(
  se: MockSecureElement,
  counter: number,
  overrides: Partial<HardwareGrantEnvelope> = {}
): HardwareGrantEnvelope {
  const grant: Omit<HardwareGrantEnvelope, 'signature'> = {
    gateId: 'gate-scn',
    sessionId: 'sess-' + Date.now() + '-' + counter,
    actionId: 'act-' + Date.now() + '-' + counter,
    tenantId: 'tenant-scn',
    scope: 'device',
    targetId: 'gw-scn-001',
    commandType: 'interlock_release',
    payloadHash: '0'.repeat(64),
    policyDigest: 'policy-digest-baseline-v1',
    challenge: 'challenge-' + Date.now() + '-' + counter + '-' + Math.floor(Math.random() * 1e6),
    breakerTarget: 'server-lan-bridge',
    interlockAction: 'release',
    issuedAt: String(Math.floor(Date.now() / 1000)),
    expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
    monotonicCounter: counter,
    ...overrides
  };
  const signature = se.signGrant(grant);
  return { ...grant, signature, ...(overrides.signature ? { signature: overrides.signature } : {}) };
}

interface Harness {
  se: MockSecureElement;
  interlock: MockInterlock;
  controller: MockController;
  daemon: GatewayDaemon;
  reasons: string[];
  shutdown: () => void;
}

function buildHarness(opts: { heartbeatStaleMs?: number; controllerHeartbeatMs?: number } = {}): Harness {
  const se = new MockSecureElement({ deviceId: 'gw-scn-001' });
  const interlock = new MockInterlock();
  const controller = new MockController(se, interlock, opts.controllerHeartbeatMs ?? 1000);
  const reasons: string[] = [];
  const daemon = new GatewayDaemon({
    gatewayId: 'gw-scn-001',
    secureElementPublicKeyPem: se.getPublicKeyPem(),
    breakerTarget: 'server-lan-bridge',
    heartbeatStaleMs: opts.heartbeatStaleMs ?? 45_000,
    releaseTtlMs: 30_000,
    onFrame: (frame: DaemonFrame) => {
      if (frame.reason) reasons.push(String(frame.reason));
    }
  });
  controller.on('frame', (frame) => daemon.handleControllerFrame(frame));
  return {
    se,
    interlock,
    controller,
    daemon,
    reasons,
    shutdown: () => {
      daemon.shutdown();
      controller.shutdown();
    }
  };
}

function report(name: string, checks: Array<[string, boolean]>): boolean {
  console.log(`\n=== Scenario: ${name} ===`);
  let ok = true;
  for (const [label, passed] of checks) {
    console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${label}`);
    if (!passed) ok = false;
  }
  console.log(`=== ${name}: ${ok ? 'FAIL-CLOSED VERIFIED' : 'VIOLATION'} ===\n`);
  return ok;
}

async function scenarioInvalidSignature(): Promise<boolean> {
  const h = buildHarness();
  const counter = h.se.incrementMonotonicCounter();
  const grant = buildSignedGrant(h.se, counter);
  const tampered: HardwareGrantEnvelope = { ...grant, signature: Buffer.from('bogus-signature').toString('base64') };

  const accepted = h.daemon.requestRelease(tampered);
  const checks: Array<[string, boolean]> = [
    ['daemon rejects the tampered grant', accepted === false],
    ['bridge stays isolated', h.daemon.getBridgeState() === 'isolated' && !h.daemon.isReleased()],
    ['fail-closed reason grant_signature_invalid emitted', h.reasons.includes('grant_signature_invalid')]
  ];
  h.shutdown();
  return report('invalid-signature', checks);
}

async function scenarioCounterRollback(): Promise<boolean> {
  const h = buildHarness();
  const counter = h.se.incrementMonotonicCounter();
  const first = buildSignedGrant(h.se, counter);
  const firstResult = h.controller.handleReleaseRequest(first);
  const firstDaemon = firstResult === 'released' ? h.daemon.requestRelease(first) : false;

  // Same counter again (replay / rollback), fresh challenge + valid signature.
  const rollback = buildSignedGrant(h.se, counter);
  const controllerVerdict = h.controller.handleReleaseRequest(rollback);
  const daemonVerdict = h.daemon.requestRelease(rollback);

  const checks: Array<[string, boolean]> = [
    ['baseline release succeeds', firstResult === 'released' && firstDaemon === true],
    ['M2 controller denies rolled-back counter', controllerVerdict === 'denied'],
    ['M1 daemon denies rolled-back counter', daemonVerdict === false],
    ['fail-closed reason monotonic_counter_rollback emitted', h.reasons.includes('monotonic_counter_rollback')],
    ['bridge ends isolated', h.daemon.getBridgeState() === 'isolated' && !h.daemon.isReleased()]
  ];
  h.shutdown();
  return report('counter-rollback', checks);
}

async function scenarioHeartbeatStale(): Promise<boolean> {
  // Controller heartbeats every 60s, daemon tolerates 1s: watchdog must trip.
  const h = buildHarness({ heartbeatStaleMs: 1_000, controllerHeartbeatMs: 60_000 });
  h.daemon.handleControllerFrame({ type: 'heartbeat', secureElementPresent: true, ts: Date.now() });
  await sleep(3_200);

  const checks: Array<[string, boolean]> = [
    ['fail-closed reason controller_heartbeat_stale emitted', h.reasons.includes('controller_heartbeat_stale')],
    ['bridge ends isolated', h.daemon.getBridgeState() === 'isolated' && !h.daemon.isReleased()]
  ];
  h.shutdown();
  return report('heartbeat-stale', checks);
}

async function scenarioEstop(): Promise<boolean> {
  const h = buildHarness();
  const counter = h.se.incrementMonotonicCounter();
  const grant = buildSignedGrant(h.se, counter);
  const released = h.controller.handleReleaseRequest(grant) === 'released' && h.daemon.requestRelease(grant);

  h.controller.handleEstop();

  // A fully valid fresh grant must be denied while the e-stop latch holds.
  const duringLatch = buildSignedGrant(h.se, h.se.incrementMonotonicCounter());
  const latchVerdict = h.controller.handleReleaseRequest(duringLatch);

  // Explicit reset returns to isolated; only a fresh grant may release again.
  h.controller.clearEstop();
  const afterClear = buildSignedGrant(h.se, h.se.incrementMonotonicCounter());
  const afterClearVerdict = h.controller.handleReleaseRequest(afterClear);

  const checks: Array<[string, boolean]> = [
    ['baseline release succeeds', released === true],
    ['daemon fail-closed on controller alert', h.reasons.includes('controller_alert')],
    ['bridge isolated after e-stop', h.daemon.getBridgeState() === 'isolated' && !h.daemon.isReleased()],
    ['valid grant DENIED while e-stop latched', latchVerdict === 'denied'],
    ['fresh grant releases after explicit e-stop clear', afterClearVerdict === 'released']
  ];
  h.shutdown();
  return report('estop', checks);
}

async function main(): Promise<void> {
  const scenarios: Record<string, () => Promise<boolean>> = {
    'invalid-signature': scenarioInvalidSignature,
    'counter-rollback': scenarioCounterRollback,
    'heartbeat-stale': scenarioHeartbeatStale,
    estop: scenarioEstop
  };

  const run = scenarios[trigger];
  if (!run) {
    console.error(`Unknown --trigger=${trigger}. Valid: ${Object.keys(scenarios).join(', ')}`);
    process.exit(2);
  }

  const ok = await run();
  process.exit(ok ? 0 : 1);
}

void main();
