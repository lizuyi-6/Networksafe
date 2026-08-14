#!/usr/bin/env ts-node
/**
 * Gateway Appliance Simulator
 *
 * End-to-end simulation of M1-M4 four-module integration.
 * Runs the real GatewayDaemon code against mocked hardware.
 */

import { GatewayDaemon, buildSerialChannelMac } from '../backend/src/companion/gateway-daemon';
import { MockSecureElement } from './m3-secure-element/mock-se';
import { MockController } from './m2-controller/mock-controller';
import { MockInterlock } from './m4-interlock/mock-interlock';
import type { HardwareGrantEnvelope } from '../backend/src/security/hardware-grant';

console.log('═══════════════════════════════════════════════════════════');
console.log('  AetherGuard Gateway Appliance Simulator');
console.log('  M1 Gateway Daemon + M2 Controller + M3 SE + M4 Interlock');
console.log('═══════════════════════════════════════════════════════════\n');

// M1<->M2 channel MAC key (sim stand-in for the manufacturing-provisioned key)
const SERIAL_CHANNEL_KEY_HEX = 'a1'.repeat(32);

// Initialize modules
const se = new MockSecureElement({ deviceId: 'gw-sim-001' });
const interlock = new MockInterlock();
const controller = new MockController(se, interlock, 5000);
controller.provisionChannelKey(SERIAL_CHANNEL_KEY_HEX);
const policyDigest = 'policy-digest-baseline-v1';
let daemonAcceptedGrant = false;
let controllerReleased = false;
let bridgeReleasedObserved = false;

const daemon = new GatewayDaemon({
  gatewayId: 'gw-sim-001',
  secureElementPublicKeyPem: se.getPublicKeyPem(),
  breakerTarget: 'server-lan-bridge',
  policyDigest,
  heartbeatStaleMs: 45_000,
  releaseTtlMs: 30_000,
  serialChannelKey: SERIAL_CHANNEL_KEY_HEX,
  onFrame: (frame) => {
    if (frame.type === 'apply_ruleset') {
      const icon = frame.ruleset === 'released_ruleset' ? '🟢' : '🔴';
      const action = frame.ruleset === 'released_ruleset' ? 'RELEASED' : 'ISOLATED';
      console.log(`${icon} [M1 Gateway] BRIDGE ${action} (${frame.reason})`);
      console.log(`         nftables: applying ${frame.ruleset}`);
    }
    if (frame.type === 'command') {
      console.log(`🔴 [M1 Gateway] → M2: ${frame.command} (${frame.reason})`);
    }
  }
});

// Wire controller → daemon
controller.on('frame', (frame) => {
  daemon.handleControllerFrame(frame);
});

console.log('\n🎬 Scenario: Backend requests temporary release\n');

// Simulate backend sending a grant request
setTimeout(() => {
  console.log('[t+2.0s] Backend → POST /api/final-defense/gateways/actions');
  console.log('         { action: "release_temporary", targetId: "server-1", ttl: 30s }\n');

  const counter = se.incrementMonotonicCounter();
  const grant: Omit<HardwareGrantEnvelope, 'signature'> = {
    gateId: 'gw-sim-001',
    sessionId: 'sess-' + Date.now(),
    actionId: 'act-' + Date.now(),
    tenantId: 'tenant-1',
    scope: 'device',
    targetId: 'gw-sim-001',
    commandType: 'interlock_release',
    payloadHash: '0'.repeat(64),
    policyDigest,
    challenge: 'challenge-' + Date.now(),
    breakerTarget: 'server-lan-bridge',
    interlockAction: 'release',
    issuedAt: String(Math.floor(Date.now() / 1000)),
    expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
    monotonicCounter: counter
  };

  const signature = se.signGrant(grant);
  const signedGrant: HardwareGrantEnvelope = { ...grant, signature };

  console.log('[t+2.1s] M1 → M2: command interlock_release (channel-MAC authenticated)\n');
  daemonAcceptedGrant = daemon.requestRelease(signedGrant);
  if (daemonAcceptedGrant) {
    // M1 computed the channel MAC over the exact wire fields; M2 verifies it.
    const serialMac = buildSerialChannelMac(
      SERIAL_CHANNEL_KEY_HEX,
      String(grant.challenge || ''),
      String(grant.policyDigest || ''),
      grant.monotonicCounter,
      Number(grant.expiresAt)
    );
    controllerReleased = controller.handleReleaseRequest(signedGrant, serialMac) === 'released';
    bridgeReleasedObserved = daemon.isReleased() && daemon.getBridgeState() === 'released';
  }
}, 2000);

// Graceful shutdown
setTimeout(() => {
  const releaseExpiredIsolated = !daemon.isReleased() && daemon.getBridgeState() === 'isolated';
  const checks: Array<[string, boolean]> = [
    ['M1 accepted the context-bound signed grant', daemonAcceptedGrant],
    ['M2 accepted the grant', controllerReleased],
    ['M1 observed released feedback and applied release', bridgeReleasedObserved],
    ['M1 re-asserted isolated after the release TTL', releaseExpiredIsolated]
  ];
  const ok = checks.every(([, passed]) => passed);

  console.log('\n[t+35.0s] Release window expired, daemon auto-reasserted isolated\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Simulation ${ok ? 'PASS' : 'FAIL'}`);
  for (const [label, passed] of checks) {
    console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${label}`);
  }
  console.log('═══════════════════════════════════════════════════════════\n');
  daemon.shutdown();
  controller.shutdown();
  process.exit(ok ? 0 : 1);
}, 37000);

console.log('🔴 [M1 Gateway] Boot: BRIDGE ISOLATED (default fail-closed)');
console.log('🟡 [M2 Controller] Heartbeat started (every 5s)');
