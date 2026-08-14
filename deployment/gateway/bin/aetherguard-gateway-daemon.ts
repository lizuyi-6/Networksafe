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
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { GatewayDaemon } from '../../backend/src/companion/gateway-daemon';
import type { ControllerFrame } from '../../backend/src/companion/gateway-daemon';
import { spawn } from 'child_process';
import axios from 'axios';

interface GatewayConfig {
  gatewayId: string;
  backendUrl: string;
  tenantId: string;
  sePublicKeyPath: string;
  breakerTarget: string;
  serialPort: string;
  serialBaud: number;
  heartbeatStaleMs: number;
  releaseTtlMs: number;
  statusReportIntervalMs: number;
}

const CONFIG_PATH = process.env.CONFIG_PATH || '/etc/aetherguard/gateway.conf';
const ISOLATED_RULESET = '/etc/aetherguard/nftables/isolated_ruleset.nft';
const RELEASED_RULESET = '/etc/aetherguard/nftables/released_ruleset.nft';

// Load configuration
const config: GatewayConfig & { serialChannelKeyHex?: string } = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
const sePublicKeyPem = readFileSync(config.sePublicKeyPath, 'utf-8');

console.log(`[Gateway Daemon] Starting: ${config.gatewayId}`);
console.log(`[Gateway Daemon] Backend: ${config.backendUrl}`);
console.log(`[Gateway Daemon] Serial: ${config.serialPort} @ ${config.serialBaud}`);

// Apply nftables ruleset
function applyRuleset(ruleset: 'isolated_ruleset' | 'released_ruleset'): void {
  const path = ruleset === 'isolated_ruleset' ? ISOLATED_RULESET : RELEASED_RULESET;
  console.log(`[Gateway Daemon] Applying nftables: ${path}`);
  const proc = spawn('/usr/sbin/nft', ['-f', path]);
  proc.on('error', (err) => console.error(`[Gateway Daemon] nftables error: ${err.message}`));
  proc.on('exit', (code) => {
    if (code !== 0) console.error(`[Gateway Daemon] nftables exit ${code}`);
  });
}

// FW-001: M1<->M2 serial channel MAC key (64-char hex). Provisioned at
// manufacturing/pairing time; the M2 firmware refuses unauthenticated
// interlock_release frames fail-closed.
const serialChannelKey = process.env.SERIAL_CHANNEL_KEY_HEX || config.serialChannelKeyHex || '';
if (!serialChannelKey) {
  console.error('[Gateway Daemon] FATAL: SERIAL_CHANNEL_KEY_HEX (or serialChannelKeyHex in gateway.conf) is not set — the daemon cannot authenticate release frames to M2 (fail-closed).');
  process.exit(1);
}

// Initialize daemon
const daemon = new GatewayDaemon({
  gatewayId: config.gatewayId,
  secureElementPublicKeyPem: sePublicKeyPem,
  breakerTarget: config.breakerTarget,
  heartbeatStaleMs: config.heartbeatStaleMs,
  releaseTtlMs: config.releaseTtlMs,
  serialChannelKey,
  onFrame: (frame) => {
    if (frame.type === 'apply_ruleset') {
      applyRuleset(frame.ruleset!);
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
      port.write(msg + '\n');
    }
  }
});

// Serial port to M2 controller
const port = new SerialPort({ path: config.serialPort, baudRate: config.serialBaud });
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

// Periodic status reporting to backend
setInterval(async () => {
  try {
    await axios.post(`${config.backendUrl}/api/final-defense/gateways/status/report`, {
      gatewayId: config.gatewayId,
      tenantId: config.tenantId,
      bridgeState: daemon.getBridgeState(),
      isReleased: daemon.isReleased(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error(`[Gateway Daemon] Status report failed: ${err}`);
  }
}, config.statusReportIntervalMs);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Gateway Daemon] SIGTERM received, shutting down...');
  daemon.shutdown();
  port.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[Gateway Daemon] SIGINT received, shutting down...');
  daemon.shutdown();
  port.close(() => process.exit(0));
});

console.log('[Gateway Daemon] Initialized, waiting for controller frames...');
