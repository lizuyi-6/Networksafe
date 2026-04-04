import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { io } from 'socket.io-client';
import {
  DEFAULT_DEVICE_GATEWAY_PATH,
  DEFAULT_TEST_COMMAND_SECRET,
  DEFAULT_TEST_DEVICE_API_KEY
} from '../../contracts/device-types.js';
import { signPhysicalConfirmation, verifyDeviceCommand } from '../../contracts/crypto-helpers.js';

const currentFile = fileURLToPath(import.meta.url);
const root = resolve(dirname(currentFile), '..', '..');
const deviceId = process.env.MOCK_DEVICE_ID || 'nev-demo-001';
const baseUrl = process.env.MOCK_CONTROL_PLANE_URL || 'http://127.0.0.1:3405';
const path = process.env.MOCK_DEVICE_GATEWAY_PATH || DEFAULT_DEVICE_GATEWAY_PATH;
const deviceApiKey = process.env.MOCK_DEVICE_API_KEY || DEFAULT_TEST_DEVICE_API_KEY;
const commandSecret = process.env.MOCK_DEVICE_COMMAND_SECRET || DEFAULT_TEST_COMMAND_SECRET;
const privateKeyPem = readFileSync(process.env.PHYSICAL_CONFIRMATION_PRIVATE_KEY_FILE || resolve(root, 'contracts', 'test-keys', 'physical-confirmation-private.pem'), 'utf8');
const publicKeyPem = readFileSync(process.env.PHYSICAL_CONFIRMATION_PUBLIC_KEY_FILE || resolve(root, 'contracts', 'test-keys', 'physical-confirmation-public.pem'), 'utf8');
const autoConfirm = new Set(String(process.env.MOCK_AUTO_CONFIRM_COMMANDS || 'host_remove').split(',').map((v) => v.trim()).filter(Boolean));

const state = {
  version: 'v1-nev-alpha',
  chipModel: 'NEV-MCU-01',
  flashSize: 8 * 1024 * 1024,
  freeHeap: 196608,
  sdkVersion: 'vendor-reference-sdk',
  cpuUsage: 6,
  memoryUsage: 22,
  uptime: 0,
  transport: 'usb_serial',
  externalPowerPresent: true,
  secureElementPresent: true,
  pendingPhysicalApproval: false,
  interlockState: 'armed',
  hostActionState: 'idle',
  monotonicCounter: 0,
  systemInfo: { hostname: hostname(), os: 'linux', kernel: 'mock-kernel', arch: process.arch }
};

const socket = io(baseUrl, { path, transports: ['websocket'] });
let heartbeatTimer = null;
const asObj = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const log = (message, payload = undefined) => process.stderr.write(`[reference-companion] ${message}${payload ? ` ${JSON.stringify(payload)}` : ''}\n`);
const emitSerial = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);
const emitRegister = () => {
  socket.emit('register', {
    device_id: deviceId,
    version: state.version,
    chip_model: state.chipModel,
    flash_size: state.flashSize,
    free_heap: state.freeHeap,
    sdk_version: state.sdkVersion,
    api_key: deviceApiKey
  });
};
const emitHeartbeat = () => {
  state.uptime += 3;
  socket.emit('heartbeat', { cpu_usage: state.cpuUsage, memory_usage: state.memoryUsage, uptime: state.uptime, wifi_rssi: -42, free_heap: state.freeHeap });
};
const emitData = (payload) => socket.emit('data', { timestamp: new Date().toISOString(), payload });
const emitSnapshot = () => emitData({
  transport: state.transport,
  externalPowerPresent: state.externalPowerPresent,
  secureElementPresent: state.secureElementPresent,
  pendingPhysicalApproval: state.pendingPhysicalApproval,
  interlockState: state.interlockState,
  hostActionState: state.hostActionState,
  freeHeap: state.freeHeap,
  systemInfo: state.systemInfo,
  physicalAuth: { publicKeyPem, monotonicCounter: state.monotonicCounter, lastConfirmedAt: null }
});
const emitAlert = (alertType, message) => socket.emit('alert', { alert_type: alertType, message, timestamp: new Date().toISOString() });
const scheduleHeartbeat = () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => emitHeartbeat(), 3000);
};
const handleOta = (params) => {
  const otaJobId = String(params.otaJobId || '');
  const version = String(params.version || state.version);
  state.hostActionState = 'running';
  emitSnapshot();
  emitSerial({ op: 'command', deviceId, command: 'ota_update', params });
  socket.emit('ota_status', { otaJobId, status: 'queued', version });
  setTimeout(() => socket.emit('ota_status', { otaJobId, status: 'running', version }), 300);
  setTimeout(() => {
    state.hostActionState = 'completed';
    emitSnapshot();
    socket.emit('ota_status', { otaJobId, status: 'installed', version });
  }, 900);
};
const handleHostAction = (commandType, params) => {
  state.hostActionState = 'running';
  emitSnapshot();
  emitSerial({ op: 'command', deviceId, command: commandType, params: params || {} });
  setTimeout(() => {
    state.hostActionState = 'completed';
    emitData({ hostActionState: state.hostActionState, lastHostAction: { commandType, completedAt: new Date().toISOString() } });
  }, 250);
};
const sendAck = (params) => {
  const confirmationSessionId = String(params.confirmationSessionId || '');
  const commandType = String(params.commandType || 'unknown');
  const payloadHash = String(params.payloadHash || '');
  const timestamp = Date.now();
  const monotonicCounter = state.monotonicCounter + 1;
  const signature = signPhysicalConfirmation({ privateKeyPem, deviceId, confirmationSessionId, commandType, payloadHash, monotonicCounter, timestamp });
  state.monotonicCounter = monotonicCounter;
  state.pendingPhysicalApproval = false;
  state.hostActionState = 'completed';
  socket.emit('physical_confirmation_ack', { confirmationSessionId, confirmed: true, button: 'confirm', timestamp, monotonicCounter, signature });
  emitSnapshot();
};
const handlePhysicalConfirmation = (params) => {
  const commandType = String(params.commandType || 'unknown');
  state.pendingPhysicalApproval = true;
  state.hostActionState = 'awaiting_confirmation';
  emitSnapshot();
  emitSerial({ op: 'command', deviceId, command: 'physical_confirmation_required', params });
  if (autoConfirm.has(commandType)) setTimeout(() => sendAck(params), 500);
};
const handleCommand = (envelope) => {
  const verification = verifyDeviceCommand({ envelope, secret: commandSecret });
  if (!verification.ok) return emitAlert('bad_command_signature', verification.reason || 'invalid_command');
  if (envelope.deviceId !== deviceId) return emitAlert('wrong_device', 'command targeted a different device id');
  const params = asObj(envelope.command.params);
  switch (envelope.command.cmd) {
    case 'collect':
      emitData({ telemetry: { chargeState: 'ready', packVoltage: 412.5, insulationStatus: 'nominal' } });
      break;
    case 'sync-config':
      emitData({ configSyncAt: new Date().toISOString() });
      break;
    case 'ota_update':
      handleOta(params);
      break;
    case 'physical_confirmation_required':
      handlePhysicalConfirmation(params);
      break;
    default:
      handleHostAction(envelope.command.cmd, params);
      break;
  }
};
const handleBoardFrame = (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed) return;
  let parsed = null;
  try { parsed = asObj(JSON.parse(trimmed)); } catch { return emitAlert('invalid_board_json', 'failed to parse stdin JSON frame'); }
  const op = String(parsed.op || '');
  if (op === 'state') {
    state.externalPowerPresent = Boolean(parsed.externalPowerPresent ?? state.externalPowerPresent);
    state.secureElementPresent = Boolean(parsed.secureElementPresent ?? state.secureElementPresent);
    state.interlockState = String(parsed.interlockState || state.interlockState);
    state.hostActionState = String(parsed.hostActionState || state.hostActionState);
    state.freeHeap = Number(parsed.freeHeap || state.freeHeap);
    return emitSnapshot();
  }
  if (op === 'telemetry') return emitData(asObj(parsed.payload));
  if (op === 'alert') return emitAlert(String(parsed.alertType || 'board_alert'), String(parsed.message || 'board alert'));
  if (op === 'ota_status') return socket.emit('ota_status', { otaJobId: String(parsed.otaJobId || ''), status: String(parsed.status || 'unknown'), version: String(parsed.version || state.version) });
  if (op === 'physical_confirmation_ack') return socket.emit('physical_confirmation_ack', parsed);
  return emitAlert('unknown_board_op', `unsupported board op: ${op}`);
};

socket.on('connect', () => {
  log('connected', { baseUrl, path, deviceId });
  emitRegister();
  emitSnapshot();
  emitHeartbeat();
  scheduleHeartbeat();
});
socket.on('register_success', (payload) => log('register_success', payload));
socket.on('register_error', (payload) => log('register_error', payload));
socket.on('heartbeat_ack', (payload) => log('heartbeat_ack', payload));
socket.on('command', (payload) => handleCommand(payload));
socket.on('disconnect', () => {
  log('disconnected');
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
});
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => handleBoardFrame(line));

