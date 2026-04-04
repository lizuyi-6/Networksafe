import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPhysicalConfirmationMessage, signPhysicalConfirmation } from '../contracts/crypto-helpers.js';

const currentFile = fileURLToPath(import.meta.url);
const root = resolve(dirname(currentFile), '..');
const tsxCli = resolve(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const port = 3410;
const baseUrl = `http://127.0.0.1:${port}`;
const deviceId = 'nev-demo-001';
const publicKeyPath = resolve(root, 'contracts', 'test-keys', 'physical-confirmation-public.pem');
const privateKeyPath = resolve(root, 'contracts', 'test-keys', 'physical-confirmation-private.pem');
const privateKeyPem = readFileSync(privateKeyPath, 'utf8');

const start = (name, entry, env) => {
  const child = spawn(process.execPath, [tsxCli, entry], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  return child;
};
const waitFor = async (label, fn, timeoutMs = 10000, intervalMs = 200) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== null) return value;
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
};
const fetchJson = async (path, init = undefined) => {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  return { status: response.status, body: await response.json() };
};
const main = async () => {
  const mock = start('mock', 'mock-control-plane/server.ts', { MOCK_CONTROL_PLANE_PORT: String(port), MOCK_DEVICE_API_KEY: 'vendor-test-device-key', MOCK_DEVICE_COMMAND_SECRET: 'vendor-test-command-secret' });
  const companion = start('companion', 'reference-companion/src/index.ts', {
    MOCK_CONTROL_PLANE_URL: baseUrl,
    MOCK_DEVICE_GATEWAY_PATH: '/ws/device',
    MOCK_DEVICE_ID: deviceId,
    MOCK_DEVICE_API_KEY: 'vendor-test-device-key',
    MOCK_DEVICE_COMMAND_SECRET: 'vendor-test-command-secret',
    MOCK_AUTO_CONFIRM_COMMANDS: 'host_remove',
    PHYSICAL_CONFIRMATION_PRIVATE_KEY_FILE: privateKeyPath,
    PHYSICAL_CONFIRMATION_PUBLIC_KEY_FILE: publicKeyPath
  });

  try {
    await waitFor('mock control plane health', async () => {
      try {
        const response = await fetchJson('/health');
        return response.status === 200 ? response.body : null;
      } catch {
        return null;
      }
    });

    const deviceState = await waitFor('device registration', async () => {
      const response = await fetchJson(`/api/devices/${deviceId}/state`);
      const device = response.body?.device;
      if (response.status !== 200 || !device?.online || !device?.lastHeartbeatAt || !device?.runtime?.physicalAuth?.publicKeyPem) return null;
      return response.body;
    }, 15000);
    assert.equal(deviceState.device.registerPayload.device_id, deviceId);

    const otaResponse = await fetchJson(`/api/devices/${deviceId}/ota`, {
      method: 'POST',
      body: JSON.stringify({ firmwareId: 'fw-alpha-1', version: 'v1.0.4', channel: 'stable', artifactRef: 'mock://firmware/fw-alpha-1', fileName: 'fw-v1.0.4.bin' })
    });
    assert.equal(otaResponse.status, 200);
    const otaJobId = String(otaResponse.body.job.id);
    const otaJob = await waitFor('ota installed state', async () => {
      const response = await fetchJson(`/api/ota-jobs/${otaJobId}`);
      return response.status === 200 && response.body.job.status === 'installed' ? response.body.job : null;
    }, 15000);
    assert.equal(otaJob.status, 'installed');

    const autoConfirmResponse = await fetchJson(`/api/devices/${deviceId}/confirm-required-action`, {
      method: 'POST',
      body: JSON.stringify({ commandType: 'host_remove', payload: { reason: 'bench validation' } })
    });
    assert.equal(autoConfirmResponse.status, 200);
    const autoSessionId = String(autoConfirmResponse.body.session.id);
    const autoSession = await waitFor('auto confirmation complete', async () => {
      const response = await fetchJson(`/api/confirmation-sessions/${autoSessionId}`);
      return response.status === 200 && response.body.session.status === 'confirmed' ? response.body.session : null;
    }, 15000);
    assert.equal(autoSession.status, 'confirmed');
    const manualResponse = await fetchJson(`/api/devices/${deviceId}/confirm-required-action`, {
      method: 'POST',
      body: JSON.stringify({ commandType: 'diagnostic_unlock', payload: { scope: 'bench-only' } })
    });
    assert.equal(manualResponse.status, 200);
    const manualSession = manualResponse.body.session;
    const refreshedState = await fetchJson(`/api/devices/${deviceId}/state`);
    const currentCounter = Number(refreshedState.body.device.runtime?.physicalAuth?.monotonicCounter || 0);

    const staleTimestamp = 1;
    const staleSignature = signPhysicalConfirmation({ privateKeyPem, deviceId, confirmationSessionId: manualSession.id, commandType: manualSession.commandType, payloadHash: manualSession.payloadHash, monotonicCounter: currentCounter + 1, timestamp: staleTimestamp });
    const staleResponse = await fetchJson(`/api/test/devices/${deviceId}/physical-confirmation-ack`, {
      method: 'POST',
      body: JSON.stringify({ confirmationSessionId: manualSession.id, confirmed: true, button: 'confirm', timestamp: staleTimestamp, monotonicCounter: currentCounter + 1, signature: staleSignature })
    });
    assert.equal(staleResponse.status, 400);
    assert.equal(staleResponse.body.error, 'stale_timestamp');

    const rollbackTimestamp = Date.now();
    const rollbackSignature = signPhysicalConfirmation({ privateKeyPem, deviceId, confirmationSessionId: manualSession.id, commandType: manualSession.commandType, payloadHash: manualSession.payloadHash, monotonicCounter: currentCounter, timestamp: rollbackTimestamp });
    const rollbackResponse = await fetchJson(`/api/test/devices/${deviceId}/physical-confirmation-ack`, {
      method: 'POST',
      body: JSON.stringify({ confirmationSessionId: manualSession.id, confirmed: true, button: 'confirm', timestamp: rollbackTimestamp, monotonicCounter: currentCounter, signature: rollbackSignature })
    });
    assert.equal(rollbackResponse.status, 400);
    assert.equal(rollbackResponse.body.error, 'non_increasing_monotonic_counter');
    const validTimestamp = Date.now();
    const validCounter = currentCounter + 1;
    const validSignature = signPhysicalConfirmation({ privateKeyPem, deviceId, confirmationSessionId: manualSession.id, commandType: manualSession.commandType, payloadHash: manualSession.payloadHash, monotonicCounter: validCounter, timestamp: validTimestamp });
    const validMessage = buildPhysicalConfirmationMessage({ deviceId, confirmationSessionId: manualSession.id, commandType: manualSession.commandType, payloadHash: manualSession.payloadHash, monotonicCounter: validCounter, timestamp: validTimestamp });
    assert.ok(validMessage.includes(manualSession.commandType));
    const validResponse = await fetchJson(`/api/test/devices/${deviceId}/physical-confirmation-ack`, {
      method: 'POST',
      body: JSON.stringify({ confirmationSessionId: manualSession.id, confirmed: true, button: 'confirm', timestamp: validTimestamp, monotonicCounter: validCounter, signature: validSignature })
    });
    assert.equal(validResponse.status, 200);
    const duplicateResponse = await fetchJson(`/api/test/devices/${deviceId}/physical-confirmation-ack`, {
      method: 'POST',
      body: JSON.stringify({ confirmationSessionId: manualSession.id, confirmed: true, button: 'confirm', timestamp: validTimestamp, monotonicCounter: validCounter, signature: validSignature })
    });
    assert.equal(duplicateResponse.status, 409);
    const dashboardResponse = await fetchJson('/api/dashboard/events');
    assert.equal(dashboardResponse.status, 200);
    assert.ok(Array.isArray(dashboardResponse.body.events));
    assert.ok(dashboardResponse.body.events.length > 0);

    companion.kill('SIGTERM');
    await waitFor('device offline after companion exit', async () => {
      const response = await fetchJson(`/api/devices/${deviceId}/state`);
      return response.status === 200 && response.body.device.online === false ? response.body : null;
    }, 10000);
    const offlineResponse = await fetchJson(`/api/devices/${deviceId}/ota`, {
      method: 'POST',
      body: JSON.stringify({ firmwareId: 'fw-alpha-2', version: 'v1.0.5', channel: 'stable', artifactRef: 'mock://firmware/fw-alpha-2', fileName: 'fw-v1.0.5.bin' })
    });
    assert.equal(offlineResponse.status, 409);
  } finally {
    if (!companion.killed) companion.kill('SIGTERM');
    if (!mock.killed) mock.kill('SIGTERM');
  }
};

main().then(() => {
  process.stdout.write('acceptance-tests: ok\n');
}).catch((error) => {
  process.stderr.write(`acceptance-tests: failed ${String(error.stack || error)}\n`);
  process.exitCode = 1;
});

