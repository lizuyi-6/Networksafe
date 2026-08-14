import { EventEmitter } from 'events';
import { createHmac, timingSafeEqual } from 'crypto';
import { verifyHardwareGrantSignature, type HardwareGrantEnvelope } from '../security/hardware-grant';
import { normalizeInterlockState, type InterlockState } from '../security/final-defense-policy';
import logger from '../utils/logger';

/**
 * Gateway Daemon (appliance-side, M1 per PRD §4.1).
 *
 * Owns the SERVER <-> LAN/WAN transparent L2 bridge and enforces the
 * fail-closed control loop the Root-Resistant Gateway Appliance depends on.
 * This is the control-plane reference implementation: the appliance port
 * reuses the same frame shapes this class emits, but drives real nftables /
 * bridge rules and GPIO relay feedback on-device.
 *
 * Invariants (PRD §4.4, §7, §10):
 *  - DEFAULT ISOLATED. On boot and on any fail-closed trigger the bridge is
 *    asserted `isolated`, which means SERVER <-> LAN/WAN has no forwarding.
 *  - RELEASE ONLY ON VERIFIED GRANT + FEEDBACK. The `released` ruleset is
 *    installed only when an `interlock_release` grant signature verifies
 *    against the provisioned Secure Element public key AND the relay
 *    feedback auxiliary-contact readback reports `released`.
 *  - FAIL-CLOSED TRIGGERS (#5, #7, #9). Secure-Element unreachable,
 *    controller heartbeat stale beyond the PRD threshold, or a daemon-state
 *    vs controller-state divergence all force `isolated`.
 */

export type BridgeRuleset = 'isolated_ruleset' | 'released_ruleset';

/** A controller heartbeat / state frame received over the serial JSON path. */
export interface ControllerFrame {
  type: 'state' | 'heartbeat' | 'interlock_result' | 'alert';
  interlockState?: InterlockState;
  feedbackOk?: boolean;
  secureElementPresent?: boolean;
  externalPowerPresent?: boolean;
  ts?: number;
}

/** Frame the daemon emits to drive the appliance bridge / relay / audit bus. */
export interface DaemonFrame {
  type: 'apply_ruleset' | 'command';
  ruleset?: BridgeRuleset;
  command?: 'interlock_assert' | 'interlock_release' | 'hello';
  breakerTarget?: string;
  reason?: string;
  ts: number;
  /**
   * SECURITY FIX (audit 2026-08, FW-001): grant context for the M1 -> M2
   * serial hop, authenticated with a channel MAC. The M2 firmware
   * (controller_tasks.c) refuses any interlock_release whose HMAC-SHA256
   * over this canonical message does not verify — a UART attacker cannot
   * forge a frame without the provisioned channel key.
   */
  grant?: SerialChannelGrantContext;
}

/**
 * MAC-authenticated grant context serialized onto the M1 -> M2 serial line.
 * `signature` is HMAC-SHA256 (hex) over `challenge|policyDigest|monotonicCounter|expiresAtEpochS`.
 */
export interface SerialChannelGrantContext {
  challenge: string;
  policyDigest: string;
  monotonicCounter: number;
  expiresAtEpochS: number;
  signature: string;
}

/**
 * Canonical M1<->M2 channel MAC construction. MUST stay byte-identical with
 * the firmware implementation (Core/Src/grant_auth.c, grant_auth_build_message).
 * Exported so the M2 simulator mock and tests verify with the same code path.
 */
export function buildSerialChannelMac(
  channelKeyHex: string,
  challenge: string,
  policyDigest: string,
  monotonicCounter: number,
  expiresAtEpochS: number
): string {
  const key = Buffer.from(channelKeyHex, 'hex');
  const message = `${challenge}|${policyDigest}|${monotonicCounter}|${expiresAtEpochS}`;
  return createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

/** Validate a channel MAC in constant time. */
export function verifySerialChannelMac(
  channelKeyHex: string,
  context: { challenge: string; policyDigest: string; monotonicCounter: number; expiresAtEpochS: number; signature: string }
): boolean {
  const expected = Buffer.from(buildSerialChannelMac(
    channelKeyHex,
    context.challenge,
    context.policyDigest,
    context.monotonicCounter,
    context.expiresAtEpochS
  ), 'hex');
  const presented = Buffer.from(context.signature || '', 'hex');
  if (presented.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(expected, presented);
}

export interface GatewayDaemonOptions {
  gatewayId: string;
  /** Provisioned Secure Element public key (PEM). Grant signatures verify against it. */
  secureElementPublicKeyPem: string;
  breakerTarget: string;
  policyDigest?: string;
  /** PRD §4.4 trigger #7: heartbeat stale threshold (ms). Defaults to 45_000. */
  heartbeatStaleMs?: number;
  /** Release-window TTL after which the bridge auto-reasserts isolated. */
  releaseTtlMs?: number;
  /** Injected clock for deterministic tests; defaults to Date.now. */
  now?: () => number;
  /**
   * SECURITY FIX (audit 2026-08, FW-001): M1<->M2 serial channel MAC key
   * (64-char hex, 32 bytes). Required for requestRelease — without a
   * provisioned key the daemon refuses to arm (fail-closed), because the M2
   * firmware would reject an unauthenticated frame anyway.
   */
  serialChannelKey?: string;
  /** Receives every frame the daemon emits (ruleset / command). Tests assert on this. */
  onFrame?: (frame: DaemonFrame) => void;
}

const DEFAULT_HEARTBEAT_STALE_MS = 45_000;
const DEFAULT_RELEASE_TTL_MS = 30_000;
const MIN_RELEASE_TTL_MS = 5_000;
const MAX_RELEASE_TTL_MS = 15 * 60_000;

function normalizeReleaseTtlMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_RELEASE_TTL_MS;
  }
  return Math.min(Math.max(value, MIN_RELEASE_TTL_MS), MAX_RELEASE_TTL_MS);
}

export class GatewayDaemon extends EventEmitter {
  readonly gatewayId: string;
  private readonly secureElementPublicKeyPem: string;
  private readonly breakerTarget: string;
  private readonly policyDigest: string;
  private readonly heartbeatStaleMs: number;
  private readonly releaseTtlMs: number;
  private readonly now: () => number;
  private readonly serialChannelKey: string;
  private readonly emitFrame: (frame: DaemonFrame) => void;

  private bridgeState: InterlockState = 'isolated';
  private controllerState: InterlockState | null = null;
  private lastControllerHeartbeatAt: number | null = null;
  private lastFeedbackOk = false;
  private secureElementPresent = true;
  private monotonicHighWater = 0;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private released = false;
  private releasePending = false;
  private lastFailClosedReason: string | null = null;

  constructor(opts: GatewayDaemonOptions) {
    super();
    if (!opts.secureElementPublicKeyPem) {
      throw new Error('GatewayDaemon requires a provisioned Secure Element public key');
    }
    this.gatewayId = opts.gatewayId;
    this.secureElementPublicKeyPem = opts.secureElementPublicKeyPem;
    this.breakerTarget = opts.breakerTarget;
    this.policyDigest = String(opts.policyDigest || '');
    this.heartbeatStaleMs = opts.heartbeatStaleMs ?? DEFAULT_HEARTBEAT_STALE_MS;
    this.releaseTtlMs = normalizeReleaseTtlMs(opts.releaseTtlMs);
    this.now = opts.now ?? Date.now;
    this.serialChannelKey = String(opts.serialChannelKey || '');
    this.emitFrame = opts.onFrame ?? ((f) => this.emit('frame', f));
    // Boot is fail-closed: assert isolated before anything else.
    this.assertIsolated('boot_default_isolated');
    this.startWatchdog();
  }

  getBridgeState(): InterlockState {
    return this.bridgeState;
  }

  isReleased(): boolean {
    return this.released;
  }

  /** Last fail-closed reason (test/telemetry accessor). */
  getLastFailClosedReason(): string | null {
    return this.lastFailClosedReason;
  }

  /**
   * Request a release. The released ruleset is applied ONLY when the grant
   * signature verifies against the SE public key, the grant is unexpired, the
   * monotonic counter advanced, and the controller reports feedback consistent
   * with released. Any failure re-asserts isolated and returns false.
   */
  requestRelease(grant: HardwareGrantEnvelope): boolean {
    // PRD §4.4 trigger #5: SE unavailable -> fail-closed.
    if (!this.secureElementPresent) {
      this.failClosed('secure_element_unavailable');
      return false;
    }
    if (!verifyHardwareGrantSignature(this.secureElementPublicKeyPem, grant)) {
      this.failClosed('grant_signature_invalid');
      return false;
    }
    // Expiry (PRD §4.4 #4).
    if (grant.gateId !== this.gatewayId) {
      this.failClosed('gateway_context_mismatch');
      return false;
    }
    if (grant.breakerTarget !== this.breakerTarget) {
      this.failClosed('breaker_target_mismatch');
      return false;
    }
    if (grant.commandType !== 'interlock_release' || grant.interlockAction !== 'release') {
      this.failClosed('interlock_action_mismatch');
      return false;
    }
    if (!this.policyDigest || grant.policyDigest !== this.policyDigest) {
      this.failClosed('policy_digest_mismatch');
      return false;
    }
    const nowSec = Math.floor(this.now() / 1000);
    const expiresAt = Number(grant.expiresAt);
    if (!Number.isFinite(expiresAt) || nowSec >= expiresAt) {
      this.failClosed('grant_expired');
      return false;
    }
    // Monotonic counter must strictly advance (PRD §4.4 #2).
    if (!Number.isInteger(grant.monotonicCounter) || grant.monotonicCounter <= this.monotonicHighWater) {
      this.failClosed('monotonic_counter_rollback');
      return false;
    }
    this.monotonicHighWater = grant.monotonicCounter;

    // SECURITY FIX (audit 2026-08, FW-001): the M1 -> M2 serial hop must be
    // authenticated. Without a provisioned channel key the daemon refuses to
    // arm — the M2 firmware would reject the frame fail-closed anyway, and
    // emitting an unauthenticated release command would be a wire-format
    // downgrade. MAC covers exactly the fields M2 re-validates.
    if (!this.serialChannelKey || !/^[0-9a-fA-F]{64}$/.test(this.serialChannelKey)) {
      this.failClosed('serial_channel_key_missing');
      return false;
    }
    const macContext: SerialChannelGrantContext = {
      challenge: String(grant.challenge || ''),
      policyDigest: String(grant.policyDigest || ''),
      monotonicCounter: grant.monotonicCounter,
      expiresAtEpochS: expiresAt,
      signature: buildSerialChannelMac(
        this.serialChannelKey,
        String(grant.challenge || ''),
        String(grant.policyDigest || ''),
        grant.monotonicCounter,
        expiresAt
      )
    };

    // Arm: signature verified, await controller + feedback confirmation.
    this.bridgeState = 'armed';
    this.releasePending = true;
    this.emitFrame({
      type: 'command',
      command: 'interlock_release',
      breakerTarget: this.breakerTarget,
      reason: 'grant_verified_awaiting_feedback',
      ts: this.now(),
      grant: macContext
    });
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    const feedbackTimeoutMs = Math.min(this.releaseTtlMs, this.heartbeatStaleMs);
    this.feedbackTimer = setTimeout(() => this.reassertIsolated('controller_release_feedback_timeout'), feedbackTimeoutMs);
    this.feedbackTimer.unref?.();
    // Commit happens in handleControllerFrame() after released + feedbackOk.

    // Auto-reassert after the release window (PRD §4.4 window expiry).
    return true;
  }

  /**
   * Consume a controller frame (state/heartbeat/interlock_result/alert).
   * Drives the fail-closed triggers #5 (SE unavailable), #7 (heartbeat stale),
   * and #9 (daemon vs controller state divergence).
   */
  handleControllerFrame(frame: ControllerFrame): void {
    if (frame.type === 'heartbeat' || frame.type === 'state' || frame.type === 'interlock_result') {
      this.lastControllerHeartbeatAt = this.now();
      if (frame.secureElementPresent !== undefined) this.secureElementPresent = frame.secureElementPresent;
      if (frame.feedbackOk !== undefined) this.lastFeedbackOk = frame.feedbackOk;
    }
    if (frame.type === 'state' || frame.type === 'interlock_result') {
      const incoming = normalizeInterlockState(frame.interlockState);
      this.controllerState = incoming;
      // Trigger #5: SE dropped away. This must run before committing a release.
      if (frame.secureElementPresent === false) {
        this.failClosed('secure_element_unavailable');
        return;
      }
      if (this.releasePending) {
        if (incoming === 'released' && frame.feedbackOk === true) {
          this.commitReleased();
          return;
        }
        if (incoming !== 'released' || frame.feedbackOk === false) {
          this.failClosed('release_feedback_mismatch');
          return;
        }
      }
      // Trigger #9: daemon believes released while controller believes otherwise.
      if (this.released && incoming !== 'released') {
        this.failClosed('daemon_controller_state_conflict');
        return;
      }
      // Feedback must match expected state (PRD §4.4 #6).
      if (this.released && frame.feedbackOk === false) {
        this.failClosed('feedback_not_verified');
        return;
      }
    }
    if (frame.type === 'alert') {
      this.failClosed('controller_alert');
    }
  }

  /** Watchdog loop: trigger #7 (controller heartbeat stale -> isolated). */
  private startWatchdog(): void {
    this.watchdogTimer = setInterval(() => this.checkWatchdog(), Math.min(this.heartbeatStaleMs, 5_000));
    this.watchdogTimer.unref?.();
  }

  private checkWatchdog(): void {
    if (this.lastControllerHeartbeatAt === null) {
      return; // No controller has spoken yet; bridge stays at boot-isolated.
    }
    const age = this.now() - this.lastControllerHeartbeatAt;
    if (age > this.heartbeatStaleMs) {
      this.failClosed('controller_heartbeat_stale');
    }
  }

  private applyRuleset(ruleset: BridgeRuleset, reason: string): void {
    this.emitFrame({ type: 'apply_ruleset', ruleset, reason, ts: this.now() });
  }

  private commitReleased(): void {
    if (this.feedbackTimer) {
      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = null;
    }
    this.releasePending = false;
    this.applyRuleset('released_ruleset', 'controller_feedback_released');
    this.released = true;
    this.bridgeState = 'released';
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => this.reassertIsolated('release_window_expired'), this.releaseTtlMs);
    this.releaseTimer.unref?.();
  }

  private assertIsolated(reason: string): void {
    this.released = false;
    this.releasePending = false;
    this.bridgeState = 'isolated';
    this.controllerState = null;
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    if (this.feedbackTimer) {
      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = null;
    }
    this.applyRuleset('isolated_ruleset', reason);
  }

  private failClosed(reason: string): void {
    logger.warn('GatewayDaemon fail-closed', { gatewayId: this.gatewayId, reason });
    this.lastFailClosedReason = reason;
    this.reassertIsolated(reason);
  }

  private reassertIsolated(reason: string): void {
    this.assertIsolated(reason);
    this.emitFrame({ type: 'command', command: 'interlock_assert', breakerTarget: this.breakerTarget, reason, ts: this.now() });
  }

  /** Stop timers. Used by tests and graceful shutdown. */
  shutdown(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.watchdogTimer = null;
    this.releaseTimer = null;
    this.feedbackTimer = null;
    this.assertIsolated('shutdown');
  }
}
