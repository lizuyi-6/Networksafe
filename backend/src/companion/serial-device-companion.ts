import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import { timingSafeEqual } from 'crypto';
import { io, Socket } from 'socket.io-client';
import {
  computeFinalDefensePolicyDigest,
  normalizeInterlockState,
  verifyFinalDefensePolicySignature,
  type InterlockState,
  type SignedFinalDefensePolicyDocument
} from '../security/final-defense-policy';
import { hashPayload, verifyHardwareGrantSignature, type HardwareGrantEnvelope } from '../security/hardware-grant';

export type BoardFrame = Record<string, any>;
type BoardWriter = (frame: BoardFrame) => void;

export interface CompanionPolicyAction {
  commandType: string;
  scriptPath?: string;
  maxExecutionMs?: number;
  requiresInterlockRelease?: boolean;
}

export interface LocalPolicy extends SignedFinalDefensePolicyDocument {
  allowedActions: CompanionPolicyAction[];
}

export interface CompanionState {
  interlockState: InterlockState;
  externalPowerPresent: boolean;
  secureElementPresent: boolean;
  feedbackOk: boolean;
  lastHeartbeatAt?: string;
  lastError?: string;
}

export function loadLocalPolicy(policyPath: string, signatureSecret?: string): LocalPolicy {
  const raw = fs.readFileSync(policyPath, 'utf8');
  const policy = JSON.parse(raw) as LocalPolicy;
  const digest = computeFinalDefensePolicyDigest(policy);
  if (policy.policyDigest) {
    const suppliedDigest = Buffer.from(policy.policyDigest, 'utf8');
    const computedDigest = Buffer.from(digest, 'utf8');
    if (suppliedDigest.length !== computedDigest.length || !timingSafeEqual(suppliedDigest, computedDigest)) {
      throw new Error('final defense policy digest mismatch');
    }
  }
  policy.policyDigest = digest;
  if (signatureSecret && !verifyFinalDefensePolicySignature(policy, policy.signature, signatureSecret)) {
    throw new Error('final defense policy signature invalid');
  }
  return policy;
}

export function findAllowedPolicyAction(policy: LocalPolicy, commandType: string): CompanionPolicyAction | null {
  return policy.allowedActions.find((action) => action.commandType === commandType) || null;
}

/**
 * Strict boolean coercion for board-reported safety flags (feedbackOk,
 * secureElementPresent, externalPowerPresent). Safe default is false: a value
 * is true ONLY if it is the boolean true, the number 1, or the string "true"
 * (case-insensitive). Unlike Boolean(), this treats "false" / "0" / "no" as
 * false — Boolean("false") is true, a fail-open on a fail-closed path.
 */
export function coerceBoardBool(value: unknown): boolean {
  if (value === true || value === 1) {
    return true;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  return false;
}

/**
 * Board-heartbeat watchdog state. A missing timestamp is 'missing'; an
 * unparseable or too-old timestamp is 'lost' — both must fail closed. An
 * un-guarded `now - NaN > 45s` is false, which would silently keep the bridge
 * released while the board is unreachable, so a non-finite timestamp is 'lost'.
 */
export function boardHeartbeatState(
  lastHeartbeatAt: string | undefined,
  nowMs: number,
  staleMs = 45_000
): 'ok' | 'missing' | 'lost' {
  if (!lastHeartbeatAt) {
    return 'missing';
  }
  const lastMs = new Date(lastHeartbeatAt).getTime();
  if (!Number.isFinite(lastMs) || nowMs - lastMs > staleMs) {
    return 'lost';
  }
  return 'ok';
}

export function validateLocalPolicyGrant(input: {
  policy: LocalPolicy;
  commandType: string;
  payload: Record<string, any>;
  grant?: HardwareGrantEnvelope;
  publicKeyPem?: string;
  lastCounter: number;
  now?: number;
}): { ok: true; nextCounter: number; action: CompanionPolicyAction } | { ok: false; reason: string } {
  if (input.commandType === 'interlock_assert') {
    return {
      ok: true,
      nextCounter: input.lastCounter,
      action: { commandType: 'interlock_assert', requiresInterlockRelease: false }
    };
  }
  const action = findAllowedPolicyAction(input.policy, input.commandType);
  if (!action) {
    return { ok: false, reason: 'policy_action_not_allowed' };
  }
  if (!input.grant) {
    return { ok: false, reason: 'hardware_grant_missing' };
  }
  if (!input.publicKeyPem) {
    return { ok: false, reason: 'hardware_public_key_missing' };
  }
  if (input.grant.policyDigest !== input.policy.policyDigest) {
    return { ok: false, reason: 'policy_digest_mismatch' };
  }
  if (input.grant.breakerTarget !== input.policy.breakerTarget) {
    return { ok: false, reason: 'breaker_target_mismatch' };
  }
  if (input.grant.commandType !== input.commandType) {
    return { ok: false, reason: 'command_type_mismatch' };
  }
  if (input.grant.gateId !== input.policy.gateId) {
    return { ok: false, reason: 'gate_id_mismatch' };
  }
  if (input.grant.targetId !== input.policy.companionId) {
    return { ok: false, reason: 'companion_id_mismatch' };
  }
  if (!Number.isFinite(input.grant.monotonicCounter) || input.grant.monotonicCounter <= input.lastCounter) {
    return { ok: false, reason: 'counter_replay_or_rollback' };
  }
  const expiresAtMs = new Date(input.grant.expiresAt).getTime();
  // Fail closed on an unparseable/missing expiry: `now > NaN` is false, so an
  // un-guarded comparison would treat a malformed expiresAt as "not expired"
  // and release the interlock. Aligns with gateway-daemon's Number.isFinite
  // guard.
  if (!Number.isFinite(expiresAtMs) || (input.now || Date.now()) > expiresAtMs) {
    return { ok: false, reason: 'hardware_grant_expired' };
  }
  if (input.grant.payloadHash !== hashPayload(input.payload || {})) {
    return { ok: false, reason: 'payload_hash_mismatch' };
  }
  if (!verifyHardwareGrantSignature(input.publicKeyPem, input.grant)) {
    return { ok: false, reason: 'hardware_grant_signature_invalid' };
  }
  return { ok: true, nextCounter: input.grant.monotonicCounter, action };
}

export class SerialDeviceCompanion {
  private socket: Socket | null = null;
  private lastCounter = 0;
  private releaseTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reportTimer: NodeJS.Timeout | null = null;
  private boardWatchdogTimer: NodeJS.Timeout | null = null;
  private state: CompanionState = {
    interlockState: 'unknown',
    externalPowerPresent: false,
    secureElementPresent: false,
    feedbackOk: false
  };

  constructor(
    private readonly policy: LocalPolicy,
    private readonly boardWrite: BoardWriter,
    private readonly controlPlaneUrl: string,
    private readonly helperSecret: string,
    private readonly publicKeyPem?: string
  ) {}

  start(): void {
    this.socket = io(this.controlPlaneUrl, {
      path: '/ws/device',
      auth: {
        type: 'device',
        deviceId: this.policy.companionId,
        apiKey: process.env.DEVICE_API_KEY || process.env.AETHERGUARD_DEVICE_API_KEY
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 3000
    });

    this.socket.on('connect', () => {
      this.socket?.emit('register', {
        device_id: this.policy.companionId,
        api_key: process.env.DEVICE_API_KEY || process.env.AETHERGUARD_DEVICE_API_KEY,
        version: process.env.AETHERGUARD_COMPANION_VERSION || 'final-defense-companion-1',
        chip_model: 'AetherGuard-Control-Board-v1',
        sdk_version: 'companion',
        public_key_pem: this.publicKeyPem,
        secure_element_present: this.state.secureElementPresent,
        device_role: 'final_defense_companion',
        transport: 'usb_serial',
        policy_digest: this.policy.policyDigest,
        breaker_target: this.policy.breakerTarget,
        interlock_state: this.state.interlockState,
        external_power_present: this.state.externalPowerPresent,
        feedback_ok: this.state.feedbackOk
      });
    });

    this.socket.on('command', (signedCommand: any) => {
      void this.handleControlCommand(signedCommand?.command?.cmd || signedCommand?.cmd, signedCommand?.command?.params || signedCommand?.params || {});
    });

    this.heartbeatTimer = setInterval(() => {
      this.socket?.emit('heartbeat', {
        uptime: os.uptime(),
        free_heap: Math.max(0, Math.round(os.freemem() / 1024)),
        wifi_rssi: 0,
        cpu_usage: 0,
        policy_digest: this.policy.policyDigest,
        breaker_target: this.policy.breakerTarget,
        interlock_state: this.state.interlockState,
        external_power_present: this.state.externalPowerPresent,
        secure_element_present: this.state.secureElementPresent,
        feedback_ok: this.state.feedbackOk
      });
    }, 30_000);
    this.heartbeatTimer.unref?.();

    this.reportTimer = setInterval(() => {
      void this.reportStatus();
    }, 15_000);
    this.reportTimer.unref?.();
    this.boardWatchdogTimer = setInterval(() => {
      const heartbeatState = boardHeartbeatState(this.state.lastHeartbeatAt, Date.now());
      if (heartbeatState === 'missing') {
        this.failClosed('board_heartbeat_missing');
      } else if (heartbeatState === 'lost') {
        this.failClosed('board_heartbeat_lost');
      }
    }, 10_000);
    this.boardWatchdogTimer.unref?.();
    void this.reportStatus();
  }

  stop(): void {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reportTimer) clearInterval(this.reportTimer);
    if (this.boardWatchdogTimer) clearInterval(this.boardWatchdogTimer);
    this.socket?.disconnect();
  }

  handleBoardFrame(frame: BoardFrame): void {
    const type = String(frame.type || frame.event || '').trim();
    if (type === 'state' || type === 'heartbeat' || type === 'interlock_result') {
      this.state = {
        ...this.state,
        interlockState: normalizeInterlockState(frame.interlockState || frame.interlock_state || frame.state),
        externalPowerPresent: coerceBoardBool(frame.externalPowerPresent ?? frame.external_power_present ?? this.state.externalPowerPresent),
        secureElementPresent: coerceBoardBool(frame.secureElementPresent ?? frame.secure_element_present ?? this.state.secureElementPresent),
        feedbackOk: coerceBoardBool(frame.feedbackOk ?? frame.feedback_ok ?? this.state.feedbackOk),
        lastHeartbeatAt: new Date().toISOString(),
        lastError: frame.error ? String(frame.error) : undefined
      };
      if (this.state.interlockState === 'fault' || !this.state.externalPowerPresent || !this.state.feedbackOk) {
        this.failClosed(this.state.lastError || 'board_feedback_fault');
      }
      void this.reportStatus();
    }
  }

  private async handleControlCommand(commandType: string, params: Record<string, any>): Promise<void> {
    if (!commandType) return;

    if (commandType === 'interlock_assert') {
      this.assertInterlock('control_command');
      return;
    }

    const payload = params?.payload && typeof params.payload === 'object' ? params.payload : { ...params };
    delete payload.hardwareGrant;
    delete payload.grant;
    const grant = params?.hardwareGrant || params?.grant;
    const validated = validateLocalPolicyGrant({
      policy: this.policy,
      commandType,
      payload,
      grant,
      publicKeyPem: this.publicKeyPem,
      lastCounter: this.lastCounter
    });
    if (!validated.ok) {
      this.failClosed(validated.reason);
      return;
    }

    this.lastCounter = validated.nextCounter;
    if (validated.action.requiresInterlockRelease || commandType === 'interlock_release') {
      this.releaseInterlock(grant);
    }
    await this.runAllowedAction(validated.action, payload);
  }

  private releaseInterlock(grant: HardwareGrantEnvelope): void {
    this.boardWrite({
      type: 'command',
      command: 'interlock_release',
      policyDigest: this.policy.policyDigest,
      challenge: grant.challenge,
      breakerTarget: this.policy.breakerTarget,
      ttlMs: this.policy.releaseTtlMs
    });
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => this.assertInterlock('release_ttl_expired'), this.policy.releaseTtlMs);
    this.releaseTimer.unref?.();
  }

  private assertInterlock(reason: string): void {
    this.boardWrite({
      type: 'command',
      command: 'interlock_assert',
      breakerTarget: this.policy.breakerTarget,
      reason
    });
    this.state.interlockState = 'isolated';
    void this.reportStatus();
  }

  private failClosed(reason: string): void {
    this.state.lastError = reason;
    this.assertInterlock(reason);
  }

  private async runAllowedAction(action: CompanionPolicyAction, payload: Record<string, any>): Promise<void> {
    if (!action.scriptPath) {
      return;
    }
    const resolved = path.resolve(action.scriptPath);
    const roots = (process.env.FINAL_DEFENSE_SCRIPT_ROOTS || '/opt/aetherguard/final-defense')
      .split(path.delimiter)
      .map((item) => path.resolve(item.trim()))
      .filter(Boolean);
    const withinAllowedRoot = roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
    if (resolved !== action.scriptPath || !withinAllowedRoot || !fs.existsSync(resolved)) {
      this.failClosed('policy_script_unavailable');
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(resolved, [], {
        stdio: ['pipe', 'ignore', 'pipe'],
        env: {
          ...process.env,
          AETHERGUARD_FINAL_DEFENSE_PAYLOAD: JSON.stringify(payload),
          AETHERGUARD_FINAL_DEFENSE_POLICY_DIGEST: this.policy.policyDigest || ''
        }
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('policy_script_timeout'));
      }, action.maxExecutionMs || 30_000);
      timer.unref?.();
      child.on('exit', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`policy_script_failed_${code}`));
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdin.end(JSON.stringify(payload));
    }).catch((error: any) => {
      this.failClosed(error?.message || 'policy_script_failed');
    });
  }

  private async reportStatus(): Promise<void> {
    if (!this.controlPlaneUrl || !this.helperSecret) {
      return;
    }
    try {
      await fetch(`${this.controlPlaneUrl.replace(/\/$/, '')}/api/final-defense/status/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AetherGuard-Helper-Secret': this.helperSecret
        },
        body: JSON.stringify({
          tenantId: this.policy.tenantId,
          companionId: this.policy.companionId,
          gateId: this.policy.gateId,
          policyId: this.policy.policyId,
          policyDigest: this.policy.policyDigest,
          breakerTarget: this.policy.breakerTarget,
          interlockState: this.state.interlockState,
          externalPowerPresent: this.state.externalPowerPresent,
          secureElementPresent: this.state.secureElementPresent,
          feedbackOk: this.state.feedbackOk,
          lastError: this.state.lastError
        })
      });
    } catch {
      // Reporting is best-effort; local interlock state remains fail-closed.
    }
  }
}

function openLineSerial(serialPath: string, onFrame: (frame: BoardFrame) => void): BoardWriter {
  const readStream = fs.createReadStream(serialPath, { encoding: 'utf8' });
  const writeStream = fs.createWriteStream(serialPath, { flags: 'a' });
  const rl = readline.createInterface({ input: readStream });
  rl.on('line', (line) => {
    try {
      onFrame(JSON.parse(line));
    } catch {
      // Ignore malformed board frames.
    }
  });
  return (frame) => writeStream.write(`${JSON.stringify(frame)}\n`);
}

export async function startSerialDeviceCompanion(): Promise<SerialDeviceCompanion> {
  const policyPath = process.env.FINAL_DEFENSE_POLICY_FILE || '/etc/aetherguard/final-defense-policy.json';
  const policy = loadLocalPolicy(policyPath, process.env.FINAL_DEFENSE_POLICY_SIGNING_SECRET);
  const serialPath = process.env.FINAL_DEFENSE_SERIAL_PORT || process.env.SERIAL_PORT || '/dev/ttyACM0';
  const controlPlaneUrl = process.env.AETHERGUARD_CONTROL_PLANE_URL || process.env.CONTROL_PLANE_URL || 'http://localhost:3005';
  const helperSecret = process.env.SERIAL_HELPER_SHARED_SECRET || process.env.DEVICE_COMMAND_SECRET || '';
  const publicKeyPem = process.env.AETHERGUARD_HARDWARE_GATE_PUBLIC_KEY_PEM || process.env.AETHERGUARD_HARDWARE_GATE_PUBLIC_KEY;

  let companion: SerialDeviceCompanion | null = null;
  let bufferedFrames: BoardFrame[] = [];
  const writer = openLineSerial(serialPath, (frame) => {
    if (companion) {
      companion.handleBoardFrame(frame);
      return;
    }
    bufferedFrames.push(frame);
  });
  const startedCompanion = new SerialDeviceCompanion(policy, writer, controlPlaneUrl, helperSecret, publicKeyPem);
  companion = startedCompanion;
  startedCompanion.start();
  for (const frame of bufferedFrames) {
    startedCompanion.handleBoardFrame(frame);
  }
  bufferedFrames = [];
  return startedCompanion;
}

if (require.main === module) {
  startSerialDeviceCompanion().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error?.message || error);
    process.exit(1);
  });
}
