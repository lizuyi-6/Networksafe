const path = require('path');

// Backend-only smoke for the experimental cloud-device gateway.
// This does not represent the current v1 USB-TTL serial deployer firmware.

const socketIoClient = require(path.resolve(__dirname, '../../backend/node_modules/socket.io-client'));
const { io } = socketIoClient;

const BASE_URL = process.env.DEVICE_SMOKE_BASE_URL || 'http://localhost:3005';
const SOCKET_PATH = process.env.DEVICE_SMOKE_PATH || '/ws/status';
const DEVICE_ID = process.env.DEVICE_SMOKE_ID || 'esp32-smoke';
const DEVICE_VERSION = process.env.DEVICE_SMOKE_VERSION || 'v2026.03.08-smoke';
const API_KEY = process.env.DEVICE_SMOKE_API_KEY || 'dev-device-key-2026';
const AUTOCONFIRM = (process.env.DEVICE_SMOKE_AUTOCONFIRM || 'true').toLowerCase() !== 'false';
const DURATION_MS = Number(process.env.DEVICE_SMOKE_DURATION_MS || 120000);

let currentVersion = DEVICE_VERSION;
let heartbeatTimer = null;

function log(message, details) {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  process.stdout.write(`[device-smoke] ${message}${suffix}\n`);
}

function emitHeartbeat(socket) {
  socket.emit('heartbeat', {
    cpu_usage: 12,
    memory_usage: 36,
    uptime: Math.floor(process.uptime()),
    wifi_rssi: -52,
    free_heap: 196608
  });
}

function startHeartbeat(socket) {
  emitHeartbeat(socket);
  heartbeatTimer = setInterval(() => emitHeartbeat(socket), 5000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function getCommandPayload(payload) {
  if (payload && payload.command && typeof payload.command === 'object') {
    return payload.command;
  }
  return payload || {};
}

function handleOta(socket, payload) {
  const command = getCommandPayload(payload);
  const params = command.params || {};
  const otaJobId = params.otaJobId;
  const version = params.version || currentVersion;

  log('received ota command', { otaJobId, version });

  socket.emit('ota_status', {
    otaJobId,
    status: 'downloading',
    version
  });

  setTimeout(() => {
    socket.emit('ota_status', {
      otaJobId,
      status: 'installing',
      version
    });
  }, 300);

  setTimeout(() => {
    currentVersion = version;
    socket.emit('ota_status', {
      otaJobId,
      status: 'installed',
      version
    });
    emitHeartbeat(socket);
  }, 700);
}

function handlePhysicalConfirmation(socket, payload) {
  const command = getCommandPayload(payload);
  const params = command.params || {};
  const confirmationSessionId = params.confirmationSessionId;

  log('received physical confirmation request', {
    confirmationSessionId,
    commandType: params.commandType
  });

  if (!AUTOCONFIRM) {
    return;
  }

  setTimeout(() => {
    socket.emit('physical_confirmation_ack', {
      confirmationSessionId,
      confirmed: true,
      button: 'GPIO15',
      deviceVersion: currentVersion
    });
  }, 500);
}

function main() {
  const socket = io(BASE_URL, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    reconnection: false,
    timeout: 10000
  });

  socket.on('connect', () => {
    log('connected', { socketId: socket.id, path: SOCKET_PATH });
    socket.emit('register', {
      device_id: DEVICE_ID,
      version: currentVersion,
      chip_model: 'ESP32-WROOM-32',
      flash_size: 4194304,
      free_heap: 196608,
      sdk_version: 'arduino-esp32-smoke',
      api_key: API_KEY
    });
  });

  socket.on('register_success', (data) => {
    log('register_success', data);
    startHeartbeat(socket);
    socket.emit('data', {
      timestamp: new Date().toISOString(),
      payload: {
        free_heap: 196608,
        ip_address: '192.168.4.20',
        wifi_mode: 'station',
        firmware_channel: 'stable'
      }
    });
  });

  socket.on('register_error', (data) => {
    log('register_error', data);
    process.exitCode = 1;
    socket.close();
  });

  socket.on('command', (payload) => {
    const command = getCommandPayload(payload);
    log('command', command);
    switch (command.cmd) {
      case 'ota_update':
        handleOta(socket, payload);
        break;
      case 'physical_confirmation_required':
        handlePhysicalConfirmation(socket, payload);
        break;
      default:
        setTimeout(() => emitHeartbeat(socket), 200);
        break;
    }
  });

  socket.on('disconnect', (reason) => {
    log('disconnect', { reason });
    stopHeartbeat();
  });

  socket.on('connect_error', (error) => {
    log('connect_error', { message: error.message });
    process.exitCode = 1;
  });

  setTimeout(() => {
    log('timeout reached, closing');
    stopHeartbeat();
    socket.close();
  }, DURATION_MS);
}

main();
