#!/usr/bin/env node
/**
 * AetherGuard Gateway Daemon - M1 Executable Entry Point
 *
 * Wraps backend/src/companion/gateway-daemon.ts for embedded deployment.
 * Runs as a systemd service on the Protectli/industrial gateway.
 *
 * Responsibilities:
 * - Load configuration (/etc/aetherguard/gateway.conf)
 * - Initialize GatewayDaemon with provisioned SE public key
 * - Apply nftables rulesets (isolated_ruleset.nft / released_ruleset.nft)
 * - Handle serial JSON communication with M2 controller (UART/USB-CDC)
 * - Periodic status reporting to backend control plane
 * - Local audit log ring buffer + remote sync
 * - Graceful shutdown (always reverts to isolated on exit)
 */

import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { GatewayDaemon, type BridgeRuleset } from '../../../backend/src/companion/gateway-daemon';
import type { ControllerFrame } from '../../../backend/src/companion/gateway-daemon';
import { spawn } from 'child_process';
import axios from 'axios';

interface GatewayConfig {
  gatewayId: string;
  backendUrl: string;
  tenantId: string;
  sePublicKeyPath: string;
  breakerTarget: string;
  /**
   * N2-3 (audit 2026-08): provisioned Final Defense policy digest (64-char
   * SHA-256 hex, the same anchor the control plane binds into every grant).
   * REQUIRED — requestRelease() fails every grant closed on digest mismatch,
   * so an appliance without this value can never release; refusing to start
   * makes that state explicit instead of a runtime surprise. Rotate by
   * updating gateway.conf and restarting the unit.
   */
  policyDigest: string;
  serialPort: string;
  serialBaud: number;
  heartbeatStaleMs: number;
  releaseTtlMs: number;
  statusReportIntervalMs: number;
  /**
   * AUD-05-2: PER-GATEWAY enrollment credential. Provisioned on the
   * control plane as a named helper key (SERIAL_HELPER_EXTRA_SECRETS entry
   * `keyId:secret`) and issued to THIS appliance only — never a global
   * shared key. Status reports authenticate with it and are rejected
   * otherwise.
   */
  helperKeyId: string;
  helperSecret: string;
  /** Self-reported data-port link state (config-declared, audit-qualified). */
  serverPortLink?: boolean;
  lanPortLink?: boolean;
  mgmtPath?: string;
}

const CONFIG_PATH = resolveConfigPath(process.argv.slice(2)) || process.env.CONFIG_PATH || '/etc/aetherguard/gateway.conf';
const ISOLATED_RULESET = '/etc/aetherguard/nftables/isolated_ruleset.nft';
const RELEASED_RULESET = '/etc/aetherguard/nftables/released_ruleset.nft';
// NFT_BIN must be initialized BEFORE applyRulesetSyncOnBoot() runs — function
// hoisting does not cover const bindings referenced from the function body.
const NFT_BIN = '/usr/sbin/nft';

// DP-005: assert isolation BEFORE anything else can request a release.
// This call must stay BELOW the const declarations above: module evaluation
// is top-to-bottom, and calling earlier throws a TDZ ReferenceError on
// ISOLATED_RULESET/NFT_BIN that kills the unit before isolation is asserted.
applyRulesetSyncOnBoot();

// AUD-05-1: the systemd unit passes `--config /etc/aetherguard/gateway.conf`,
// which this entry point previously IGNORED (env/constant only). Parse argv
// for real so the documented interface works.
function resolveConfigPath(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config' || arg === '-c') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        console.error('[Gateway Daemon] FATAL: --config requires a file path argument');
        process.exit(2);
      }
      return value;
    }
    if (arg.startsWith('--config=')) {
      const value = arg.slice('--config='.length).trim();
      if (!value) {
        console.error('[Gateway Daemon] FATAL: --config= requires a file path');
        process.exit(2);
      }
      return value;
    }
  }
  return null;
}

// Load configuration
const config: GatewayConfig & { serialChannelKeyHex?: string } = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
const sePublicKeyPem = readFileSync(config.sePublicKeyPath, 'utf-8');

console.log(`[Gateway Daemon] Starting: ${config.gatewayId}`);
console.log(`[Gateway Daemon] Backend: ${config.backendUrl}`);
console.log(`[Gateway Daemon] Serial: ${config.serialPort} @ ${config.serialBaud}`);

// Apply nftables ruleset
//
// SECURITY FIX (audit 2026-08, DP-005): applyRuleset used to be fire-and-forget
// — a spawn error or non-zero nft exit left the PREVIOUS ruleset loaded. On a
// fail-closed trigger while released, that meant the bridge stayed
// forward-accept while the control plane believed it was isolated. Now:
//   - boot applies the isolated ruleset SYNCHRONOUSLY and refuses to start if
//     nft cannot assert isolation;
//   - a failed ISOLATION apply at runtime escalates: log + exit(1) so systemd
//     restarts the unit and ExecStartPre/ExecStopPost re-assert isolation;
//   - a failed RELEASE apply leaves the bridge isolated (the safe state) and
//     only logs.
function applyRulesetSyncOnBoot(): void {
  const { spawnSync } = require('child_process') as typeof import('child_process');
  const result = spawnSync(NFT_BIN, ['-f', ISOLATED_RULESET], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    console.error(`[Gateway Daemon] FATAL: could not assert isolated_ruleset at boot (${result.error || `nft exit ${result.status}`}) — refusing to start`);
    process.exit(1);
  }
  // N1-3: nft 1.0.9 exits 0 even when the kernel rejects the bridge-family
  // batch — read our own table back; an exit code alone is not evidence that
  // isolation is loaded.
  const readback = spawnSync(NFT_BIN, ['list', 'table', 'bridge', 'aetherguard'], { encoding: 'utf8' });
  if (readback.error || readback.status !== 0 || !/policy drop/.test(readback.stdout || '')) {
    console.error(`[Gateway Daemon] FATAL: isolated_ruleset not verifiable by readback (${readback.error || `table bridge aetherguard missing or not policy drop`}) — refusing to start`);
    process.exit(1);
  }
  console.log('[Gateway Daemon] Boot: isolated_ruleset asserted (nft exit 0 + bridge table readback policy drop)');
}

// SECURITY (audit 2026-08, AUD-04-2): single-writer serial ruleset switch
// with a monotonic generation.
//   - Every apply is CHECKED (`nft -c`) then loaded then READ BACK
//     (`nft list table bridge aetherguard` must contain our chain).
//   - Requests are serialized through one promise queue — two applys can
//     never interleave.
//   - Newest-wins generation: an apply request is SKIPPED if a newer one
//     was requested while the queue was busy, so a stale RELEASE can never
//     overwrite a newer ISOLATION (the historical cover-the-newer-isolation
//     race).
//   - A failed ISOLATION apply escalates (exit 1 -> systemd restart +
//     ExecStopPost re-assert); a failed RELEASE apply leaves the bridge in
//     the previously loaded (isolated) state.
type RulesetName = 'isolated_ruleset' | 'released_ruleset';

const RULESET_PATHS: Record<RulesetName, string> = {
  isolated_ruleset: ISOLATED_RULESET,
  released_ruleset: RELEASED_RULESET
};

let rulesetQueue: Promise<void> = Promise.resolve();
let requestedGeneration = 0;
let appliedGeneration = 0;

function runNft(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(NFT_BIN, args);
    let stderr = '';
    proc.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`nft ${args.join(' ')} exit ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

async function readbackAetherguardTables(): Promise<void> {
  const { spawnSync } = require('child_process') as typeof import('child_process');
  const result = spawnSync(NFT_BIN, ['list', 'tables'], { encoding: 'utf8' });
  const out = String(result.stdout || '');
  if (result.status !== 0 || !out.includes('table bridge aetherguard') || !out.includes('table inet aetherguard_mgmt')) {
    throw new Error('nftables readback failed: aetherguard tables absent after apply');
  }
}

function enqueueRulesetApply(ruleset: RulesetName): Promise<void> {
  const generation = ++requestedGeneration;
  rulesetQueue = rulesetQueue.then(async () => {
    // Superseded by a newer request while queued — skip (newest wins).
    if (generation <= appliedGeneration || generation < requestedGeneration) {
      appliedGeneration = Math.max(appliedGeneration, generation);
      return;
    }
    const path = RULESET_PATHS[ruleset];
    await runNft(['-c', '-f', path]);   // syntax/rule check
    await runNft(['-f', path]);         // atomic load (own tables only)
    await readbackAetherguardTables();  // verify our tables exist post-apply
    appliedGeneration = generation;
    console.log(`[Gateway Daemon] nftables applied (generation ${generation}): ${ruleset}`);
  }).catch((error: any) => {
    onRulesetApplyFailure(ruleset, error?.message || String(error));
  });
  return rulesetQueue;
}

function applyRuleset(ruleset: RulesetName): void {
  void enqueueRulesetApply(ruleset);
}

function onRulesetApplyFailure(ruleset: BridgeRuleset, reason: string): void {
  if (ruleset === 'released_ruleset') {
    // Release failed to load -> bridge stays isolated = the safe state.
    console.error(`[Gateway Daemon] released_ruleset apply FAILED (${reason}); bridge stays isolated (fail-closed)`);
    return;
  }
  // Isolation failed to load -> the previously loaded ruleset (possibly
  // released) remains active. Escalate: die so systemd restarts us and
  // ExecStartPre (preflight-check) + ExecStopPost re-assert isolation.
  console.error(`[Gateway Daemon] FATAL: isolated_ruleset apply FAILED (${reason}); exiting for systemd-supervised isolation re-assert`);
  process.exit(1);
}

// FW-001: M1<->M2 serial channel MAC key (64-char hex). Provisioned at
// manufacturing/pairing time; the M2 firmware refuses unauthenticated
// interlock_release frames fail-closed.
const serialChannelKey = process.env.SERIAL_CHANNEL_KEY_HEX || config.serialChannelKeyHex || '';
if (!serialChannelKey) {
  console.error('[Gateway Daemon] FATAL: SERIAL_CHANNEL_KEY_HEX (or serialChannelKeyHex in gateway.conf) is not set — the daemon cannot authenticate release frames to M2 (fail-closed).');
  process.exit(1);
}

// AUD-05-2: per-gateway enrollment credential is REQUIRED. Status reports
// without it are rejected by the control plane; refuse to start unenrolled.
const helperKeyId = String(process.env.GATEWAY_HELPER_KEY_ID || config.helperKeyId || '').trim();
const helperSecret = String(process.env.GATEWAY_HELPER_SECRET || config.helperSecret || '').trim();
if (!helperKeyId || helperSecret.length < 32) {
  console.error('[Gateway Daemon] FATAL: per-gateway enrollment credential missing (helperKeyId + helperSecret >= 32 chars, provisioned as a SERIAL_HELPER_EXTRA_SECRETS entry on the control plane).');
  process.exit(1);
}

// N2-3: the provisioned policy digest anchors every grant this appliance
// will accept. Without it requestRelease() can only fail closed — refuse to
// start instead of discovering that at the first release attempt.
const policyDigest = String(process.env.GATEWAY_POLICY_DIGEST || config.policyDigest || '').trim();
if (!/^[0-9a-fA-F]{64}$/.test(policyDigest)) {
  console.error('[Gateway Daemon] FATAL: policyDigest missing or not a 64-char SHA-256 hex string in gateway.conf (provision it from the control-plane Final Defense policy — releases are impossible without it, fail-closed).');
  process.exit(1);
}

// Serial port to M2 controller.
// SECURITY (audit 2026-08, batch 5): declared as a mutable binding BEFORE
// daemon construction. The daemon state machine may synchronously emit a
// time_sync frame from its constructor; referencing a `const port` declared
// below threw a TDZ ReferenceError and killed the process at startup.
// Frames emitted before the port exists are dropped: the M2 firmware fails
// expiry validation closed until it receives a time_sync, so this stays
// fail-closed rather than fail-open.
let port: SerialPort | null = null;

// Initialize daemon
const daemon = new GatewayDaemon({
  gatewayId: config.gatewayId,
  secureElementPublicKeyPem: sePublicKeyPem,
  breakerTarget: config.breakerTarget,
  policyDigest,
  heartbeatStaleMs: config.heartbeatStaleMs,
  releaseTtlMs: config.releaseTtlMs,
  serialChannelKey,
  onFrame: (frame) => {
    if (frame.type === 'apply_ruleset') {
      applyRuleset(frame.ruleset!);
    }
    if (frame.type === 'time_sync') {
      // FW-004: feed the M2 wall clock — the firmware fails expiry
      // validation closed until it has seen one of these frames.
      port?.write(JSON.stringify({ type: 'time_sync', epochS: frame.epochS }) + '\n');
    }
    if (frame.type === 'command') {
      // Send command to controller via serial. FW-001: the MAC-authenticated
      // grant context travels on the wire in the flat field layout the M2
      // firmware parser (serial_json.c) expects.
      const msg = JSON.stringify({
        type: 'command',
        command: frame.command,
        breakerTarget: frame.breakerTarget,
        ts: frame.ts,
        ...(frame.command === 'interlock_release' && frame.grant ? {
          challenge: frame.grant.challenge,
          policyDigest: frame.grant.policyDigest,
          monotonicCounter: frame.grant.monotonicCounter,
          expiresAt: frame.grant.expiresAtEpochS,
          signature: frame.grant.signature
        } : {})
      });
      port?.write(msg + '\n');
    }
  }
});

// Open the serial port only after the daemon is constructed, closing the
// mutable binding declared above. Exactly ONE SerialPort instance — a stray
// duplicate constructor opened a second handle that leaked (and on some
// kernels locked the device so the used instance failed).
port = new SerialPort({ path: config.serialPort, baudRate: config.serialBaud });
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

parser.on('data', (line: string) => {
  try {
    const frame: ControllerFrame = JSON.parse(line);
    daemon.handleControllerFrame(frame);
  } catch (err) {
    console.error(`[Gateway Daemon] Serial parse error: ${err}`);
  }
});

port.on('error', (err) => {
  console.error(`[Gateway Daemon] Serial port error: ${err.message}`);
  // PRD trigger #7: controller communication lost -> fail-closed
});

// Periodic status reporting to backend.
// AUD-05-2: payload matches the control-plane route contract exactly
// (route/schema: serverPortLink/lanPortLink/secureElementPresent are strict
// booleans; tenantId is derived server-side from the provisioned record and
// is NEVER sent or trusted). Link state is config-declared self-report —
// under AUD-00 every status stays 'reported' and can never activate
// Root-Resistant on its own.
// N2-4: every report carries a per-boot bootId and a strictly increasing
// sequence — the control plane rejects replays/regressions within a boot,
// so a captured report cannot mask a real state change or keep a dead
// appliance "online".
const BOOT_ID = randomBytes(16).toString('hex');
let reportSequence = 0;
setInterval(async () => {
  reportSequence += 1;
  try {
    await axios.post(
      `${config.backendUrl}/api/final-defense/gateways/status/report`,
      {
        gatewayId: config.gatewayId,
        bridgeState: daemon.getBridgeState(),
        serverPortLink: config.serverPortLink === true,
        lanPortLink: config.lanPortLink === true,
        mgmtPath: config.mgmtPath || 'unknown',
        secureElementPresent: true,
        lastError: daemon.isReleased() ? null : 'bridge_isolated',
        bootId: BOOT_ID,
        sequence: reportSequence
      },
      {
        headers: {
          'X-Aetherguard-Helper-Key-Id': helperKeyId,
          Authorization: `Bearer ${helperSecret}`
        },
        timeout: 10_000
      }
    );
  } catch (err) {
    console.error(`[Gateway Daemon] Status report failed: ${err}`);
  }
}, config.statusReportIntervalMs);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Gateway Daemon] SIGTERM received, shutting down...');
  daemon.shutdown();
  port?.close(() => process.exit(0));
  if (!port) {
    process.exit(0);
  }
});

process.on('SIGINT', () => {
  console.log('[Gateway Daemon] SIGINT received, shutting down...');
  daemon.shutdown();
  port?.close(() => process.exit(0));
  if (!port) {
    process.exit(0);
  }
});

console.log('[Gateway Daemon] Initialized, waiting for controller frames...');
