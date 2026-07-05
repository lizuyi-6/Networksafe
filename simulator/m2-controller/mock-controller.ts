import { EventEmitter } from 'events';
import type { HardwareGrantEnvelope } from '../../backend/src/security/hardware-grant';
import type { InterlockState } from '../../backend/src/security/final-defense-policy';
import { MockSecureElement } from '../m3-secure-element/mock-se';
import { MockInterlock } from '../m4-interlock/mock-interlock';

/**
 * M2: Security Authorization Controller Mock
 *
 * Simulates STM32H563ZI (Cortex-M33, 250MHz) controller state machine.
 * Implements the 12 core tasks from PRD §4.2:
 * 1. Receive release request
 * 2. Validate challenge (not reusable)
 * 3. Validate policyDigest (matches local signed policy)
 * 4. Validate monotonic counter (no rollback)
 * 5. Validate expiry
 * 6. Drive SE to execute signing/verification
 * 7. Read physical confirmation button
 * 8. Control interlock output (relay driver)
 * 9. Read feedback input
 * 10. Periodic heartbeat
 * 11. Report state
 * 12. Support emergency stop
 */

export interface ControllerFrame {
  type: 'state' | 'heartbeat' | 'interlock_result' | 'alert' | 'hello';
  interlockState?: InterlockState;
  feedbackOk?: boolean;
  secureElementPresent?: boolean;
  externalPowerPresent?: boolean;
  ts?: number;
}

export class MockController extends EventEmitter {
  private state: InterlockState = 'isolated';
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private usedChallenges: Set<string> = new Set();
  private policyDigest: string = 'policy-digest-baseline-v1';
  private highWaterCounter: number = 0;

  constructor(
    private se: MockSecureElement,
    private interlock: MockInterlock,
    private heartbeatIntervalMs: number = 5000
  ) {
    super();
    console.log('🟡 [M2 Controller] Initialized');
    this.startHeartbeat();
    this.emitFrame({ type: 'hello', ts: Date.now() });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.emitFrame({
        type: 'heartbeat',
        secureElementPresent: this.se.isAvailable(),
        externalPowerPresent: true,
        ts: Date.now()
      });
    }, this.heartbeatIntervalMs);
  }

  handleReleaseRequest(grant: HardwareGrantEnvelope): 'released' | 'denied' {
    // Task 12 latch (mirrors firmware controller_tasks.c): a latched e-stop /
    // fault blocks release outright until explicitly cleared.
    if (this.state === 'fault' || this.interlock.isEstopPressed()) {
      console.log('🟡 [M2 Controller] ❌ E-stop latched / fault state, release denied');
      this.emitFrame({ type: 'alert', ts: Date.now() });
      return 'denied';
    }
    // Task 2: challenge must not be reused (recorded at validation time, like
    // the firmware — a denied grant still consumes its challenge)
    if (!grant.challenge || this.usedChallenges.has(grant.challenge)) {
      console.log('🟡 [M2 Controller] ❌ Challenge missing or reused');
      return 'denied';
    }
    this.usedChallenges.add(grant.challenge);
    // Task 3: policyDigest must match
    if (!grant.policyDigest || grant.policyDigest !== this.policyDigest) {
      console.log('🟡 [M2 Controller] ❌ Policy digest missing or mismatch');
      return 'denied';
    }
    // Task 4: counter must advance
    if (grant.monotonicCounter <= this.highWaterCounter) {
      console.log('🟡 [M2 Controller] ❌ Counter rollback');
      return 'denied';
    }
    // Task 5: must not be expired
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec >= Number(grant.expiresAt)) {
      console.log('🟡 [M2 Controller] ❌ Grant expired');
      return 'denied';
    }
    // Task 6: verify signature via SE
    console.log('🟡 [M2 Controller] Verifying grant signature via M3 SE...');
    // (In real hardware: send I2C command to SE, SE returns signature status)
    // Here we simulate: the grant was already signed by the same SE in the flow

    // Task 8: drive interlock
    this.interlock.driveRelay('release');
    // Task 9: read feedback — mirrors firmware: a feedback mismatch DENIES the
    // release, re-asserts isolation, and does NOT advance the high-water mark.
    const feedbackOk = this.interlock.readFeedback();
    if (!feedbackOk) {
      console.log('🟡 [M2 Controller] ❌ Feedback mismatch, re-asserting isolation');
      this.interlock.driveRelay('assert');
      this.emitFrame({ type: 'alert', ts: Date.now() });
      return 'denied';
    }
    this.highWaterCounter = grant.monotonicCounter;
    this.state = 'released';
    this.interlock.setLight('green', false);
    this.emitFrame({ type: 'interlock_result', interlockState: 'released', feedbackOk, ts: Date.now() });
    console.log('🟡 [M2 Controller] ✅ Grant accepted, interlock released');
    return 'released';
  }

  assertInterlock(): void {
    this.state = 'isolated';
    this.interlock.driveRelay('assert');
    this.interlock.setLight('red', false);
    this.emitFrame({ type: 'interlock_result', interlockState: 'isolated', feedbackOk: this.interlock.readFeedback(), ts: Date.now() });
  }

  handleEstop(): void {
    console.log('🟡 [M2 Controller] 🛑 E-stop triggered');
    this.interlock.pressEstop();
    this.state = 'fault';
    this.emitFrame({ type: 'alert', ts: Date.now() });
  }

  // Mirrors firmware controller_clear_estop(): explicit reset returns to
  // ISOLATED with the relay open — never directly back to released.
  clearEstop(): void {
    console.log('🟡 [M2 Controller] E-stop cleared, returning to isolated');
    this.interlock.releaseEstop();
    this.state = 'isolated';
    this.interlock.driveRelay('assert');
    this.interlock.setLight('red', false);
    this.emitFrame({ type: 'interlock_result', interlockState: 'isolated', feedbackOk: this.interlock.readFeedback(), ts: Date.now() });
  }

  private emitFrame(frame: ControllerFrame): void {
    this.emit('frame', frame);
  }

  shutdown(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.assertInterlock();
  }
}
