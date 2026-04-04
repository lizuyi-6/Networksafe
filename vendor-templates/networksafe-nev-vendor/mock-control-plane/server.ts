import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import {
  APPROVAL_REQUIRED_COMMANDS,
  AUTO_COMMANDS,
  DEFAULT_DEVICE_GATEWAY_PATH,
  DEFAULT_TEST_COMMAND_SECRET,
  DEFAULT_TEST_DEVICE_API_KEY,
  PHYSICAL_CONFIRMATION_REQUIRED_COMMANDS
} from '../contracts/device-types.js';
import { hashPayload, signDeviceCommand, verifyPhysicalConfirmation } from '../contracts/crypto-helpers.js';

const port = Number(process.env.MOCK_CONTROL_PLANE_PORT || 3405);
const path = process.env.MOCK_DEVICE_GATEWAY_PATH || DEFAULT_DEVICE_GATEWAY_PATH;
const apiKeys = new Set(String(process.env.MOCK_DEVICE_API_KEYS || process.env.MOCK_DEVICE_API_KEY || DEFAULT_TEST_DEVICE_API_KEY).split(',').map((v) => v.trim()).filter(Boolean));
const secret = process.env.MOCK_DEVICE_COMMAND_SECRET || DEFAULT_TEST_COMMAND_SECRET;
const devices = new Map();
const sockets = new Map();
const otaJobs = new Map();
const sessions = new Map();
const dashboardEvents = [];

const now = () => new Date().toISOString();
const asObj = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const asStr = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const asNum = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const commandClass = (cmd) => (AUTO_COMMANDS.includes(cmd) ? 'auto' : APPROVAL_REQUIRED_COMMANDS.includes(cmd) ? 'approval_required' : 'physical_confirmation_required');
const ensureDevice = (id) => {
  if (!devices.has(id)) devices.set(id, { deviceId: id, online: false, runtime: {}, alerts: [], events: [] });
  return devices.get(id);
};
const mergeRuntime = (id, payload) => {
  const device = ensureDevice(id);
  const next = { ...device.runtime, ...payload };
  if (payload.systemInfo) next.systemInfo = { ...(device.runtime.systemInfo || {}), ...asObj(payload.systemInfo) };
  if (payload.physicalAuth) next.physicalAuth = { ...(device.runtime.physicalAuth || {}), ...asObj(payload.physicalAuth) };
  device.runtime = next;
};
const recordEvent = (id, type, payload) => {
  const device = ensureDevice(id);
  device.events.unshift({ at: now(), type, payload });
  device.events = device.events.slice(0, 50);
};
const recordDashboard = (event, payload) => {
  dashboardEvents.unshift({ event, at: now(), payload });
  if (dashboardEvents.length > 200) dashboardEvents.length = 200;
};
const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body, null, 2));
};
const readJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? asObj(JSON.parse(raw)) : {};
};
const dispatch = (deviceId, cmd, params) => {
  const socket = sockets.get(deviceId);
  if (!socket?.connected) return false;
  socket.emit('command', signDeviceCommand({ deviceId, commandType: cmd, params, secret }));
  recordEvent(deviceId, 'command_dispatch', { commandType: cmd, params });
  recordDashboard('device:command_dispatch', { deviceId, commandType: cmd, params });
  return true;
};
const serializeDevice = (device) => ({
  deviceId: device.deviceId,
  online: device.online,
  registerPayload: device.registerPayload || null,
  lastHeartbeatAt: device.lastHeartbeatAt || null,
  runtime: device.runtime,
  alerts: device.alerts,
  recentEvents: device.events
});
const handleAck = (deviceId, payload) => {
  const sessionId = asStr(payload.confirmationSessionId);
  const session = sessions.get(sessionId);
  if (!session || session.deviceId !== deviceId) return { status: 404, body: { error: 'confirmation_session_not_found' } };
  if (session.status === 'confirmed') return { status: 409, body: { error: 'confirmation_session_already_confirmed', session } };
  const device = ensureDevice(deviceId);
  const auth = asObj(device.runtime.physicalAuth);
  const publicKeyPem = asStr(auth.publicKeyPem);
  const timestamp = asNum(payload.timestamp);
  const monotonicCounter = asNum(payload.monotonicCounter);
  const currentCounter = asNum(auth.monotonicCounter, 0);
  if (!publicKeyPem) return { status: 400, body: { error: 'device_public_key_missing' } };
  if (!payload.confirmed) return { status: 400, body: { error: 'confirmation_denied_by_device' } };
  if (Math.abs(Date.now() - timestamp) > 300000) return { status: 400, body: { error: 'stale_timestamp' } };
  if (monotonicCounter <= currentCounter) return { status: 400, body: { error: 'non_increasing_monotonic_counter', currentCounter } };
  const valid = verifyPhysicalConfirmation({
    publicKeyPem,
    deviceId,
    confirmationSessionId: session.id,
    commandType: session.commandType,
    payloadHash: session.payloadHash,
    monotonicCounter,
    timestamp,
    signature: asStr(payload.signature)
  });
  if (!valid) return { status: 400, body: { error: 'invalid_signature' } };
  session.status = 'confirmed';
  session.updatedAt = now();
  session.confirmedAt = session.updatedAt;
  session.result = { button: payload.button, timestamp, monotonicCounter };
  mergeRuntime(deviceId, { pendingPhysicalApproval: false, hostActionState: 'completed', physicalAuth: { monotonicCounter, lastConfirmedAt: session.confirmedAt } });
  recordEvent(deviceId, 'physical_confirmation_ack', payload);
  recordDashboard('device:physical_confirmation', { deviceId, confirmationSessionId: session.id, commandType: session.commandType, monotonicCounter });
  return { status: 200, body: { success: true, session } };
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { status: 'ok', devices: devices.size, onlineDevices: [...devices.values()].filter((d) => d.online).length, otaJobs: otaJobs.size, confirmationSessions: sessions.size });
  if (req.method === 'GET' && url.pathname === '/api/dashboard/events') return json(res, 200, { events: dashboardEvents });
  if (req.method === 'GET' && url.pathname === '/api/devices') return json(res, 200, { devices: [...devices.values()].map(serializeDevice) });

  let match = url.pathname.match(/^\/api\/devices\/([^/]+)\/state$/);
  if (req.method === 'GET' && match) {
    const deviceId = decodeURIComponent(match[1]);
    const device = devices.get(deviceId);
    if (!device) return json(res, 404, { error: 'device_not_found' });
    return json(res, 200, {
      device: serializeDevice(device),
      otaJobs: [...otaJobs.values()].filter((job) => job.deviceId === deviceId),
      confirmationSessions: [...sessions.values()].filter((session) => session.deviceId === deviceId)
    });
  }
  match = url.pathname.match(/^\/api\/ota-jobs\/([^/]+)$/);
  if (req.method === 'GET' && match) {
    const job = otaJobs.get(decodeURIComponent(match[1]));
    return job ? json(res, 200, { job }) : json(res, 404, { error: 'ota_job_not_found' });
  }

  match = url.pathname.match(/^\/api\/confirmation-sessions\/([^/]+)$/);
  if (req.method === 'GET' && match) {
    const session = sessions.get(decodeURIComponent(match[1]));
    return session ? json(res, 200, { session }) : json(res, 404, { error: 'confirmation_session_not_found' });
  }

  match = url.pathname.match(/^\/api\/devices\/([^/]+)\/ota$/);
  if (req.method === 'POST' && match) {
    const deviceId = decodeURIComponent(match[1]);
    const device = devices.get(deviceId);
    if (!device || !device.online) return json(res, 409, { error: 'device_offline' });
    const body = await readJson(req);
    const job = {
      id: randomUUID(),
      deviceId,
      firmwareId: asStr(body.firmwareId),
      version: asStr(body.version),
      channel: asStr(body.channel),
      artifactRef: asStr(body.artifactRef),
      fileName: asStr(body.fileName),
      status: 'queued',
      createdAt: now(),
      updatedAt: now()
    };
    if (!job.firmwareId || !job.version || !job.channel || !job.artifactRef || !job.fileName) return json(res, 400, { error: 'invalid_ota_request' });
    if (!dispatch(deviceId, 'ota_update', { otaJobId: job.id, firmwareId: job.firmwareId, version: job.version, channel: job.channel, artifactRef: job.artifactRef, fileName: job.fileName })) {
      return json(res, 409, { error: 'device_offline' });
    }
    otaJobs.set(job.id, job);
    return json(res, 200, { success: true, job });
  }

  match = url.pathname.match(/^\/api\/devices\/([^/]+)\/confirm-required-action$/);
  if (req.method === 'POST' && match) {
    const deviceId = decodeURIComponent(match[1]);
    const device = devices.get(deviceId);
    if (!device || !device.online) return json(res, 409, { error: 'device_offline' });
    const body = await readJson(req);
    const commandType = asStr(body.commandType);
    if (!PHYSICAL_CONFIRMATION_REQUIRED_COMMANDS.includes(commandType) && !APPROVAL_REQUIRED_COMMANDS.includes(commandType)) {
      return json(res, 400, { error: 'unsupported_confirmation_command' });
    }
    const payload = asObj(body.payload);
    const session = { id: randomUUID(), deviceId, commandType, commandClass: commandClass(commandType), payload, payloadHash: hashPayload(payload), status: 'pending_physical_confirmation', createdAt: now(), updatedAt: now() };
    if (!dispatch(deviceId, 'physical_confirmation_required', { confirmationSessionId: session.id, commandType: session.commandType, payload: session.payload, payloadHash: session.payloadHash, prompt: `Press confirm to authorize ${session.commandType}` })) {
      return json(res, 409, { error: 'device_offline' });
    }
    sessions.set(session.id, session);
    mergeRuntime(deviceId, { pendingPhysicalApproval: true, hostActionState: 'awaiting_confirmation' });
    return json(res, 200, { success: true, session });
  }

  match = url.pathname.match(/^\/api\/test\/devices\/([^/]+)\/physical-confirmation-ack$/);
  if (req.method === 'POST' && match) {
    const result = handleAck(decodeURIComponent(match[1]), await readJson(req));
    return json(res, result.status, result.body);
  }

  return json(res, 404, { error: 'not_found', path: url.pathname });
});
const io = new Server(server, { path, cors: { origin: '*', methods: ['GET', 'POST'] } });
io.on('connection', (socket) => {
  socket.on('register', (payload) => {
    if (!apiKeys.has(payload.api_key)) {
      socket.emit('register_error', { error: 'invalid_api_key' });
      socket.disconnect(true);
      return;
    }
    const device = ensureDevice(payload.device_id);
    device.online = true;
    device.socketId = socket.id;
    device.registerPayload = payload;
    sockets.set(payload.device_id, socket);
    socket.data.deviceId = payload.device_id;
    recordEvent(payload.device_id, 'register', payload);
    recordDashboard('device:online', { deviceId: payload.device_id, version: payload.version, chipModel: payload.chip_model });
    socket.emit('register_success', { message: 'mock_register_success', codebook: { A001: 'test alert', S001: 'test status' } });
  });

  socket.on('heartbeat', (payload) => {
    const deviceId = socket.data.deviceId;
    if (!deviceId) return;
    const device = ensureDevice(deviceId);
    device.lastHeartbeatAt = now();
    mergeRuntime(deviceId, { freeHeap: payload.free_heap, heartbeat: { cpuUsage: payload.cpu_usage, memoryUsage: payload.memory_usage, uptime: payload.uptime, wifiRssi: payload.wifi_rssi, lastSeenAt: device.lastHeartbeatAt } });
    recordEvent(deviceId, 'heartbeat', payload);
    socket.emit('heartbeat_ack', { timestamp: Date.now() });
  });

  socket.on('data', (payload) => {
    const deviceId = socket.data.deviceId;
    if (!deviceId) return;
    const normalized = asObj(payload.payload || payload);
    mergeRuntime(deviceId, normalized);
    recordEvent(deviceId, 'data', normalized);
    recordDashboard('device:data', { deviceId, payload: normalized });
  });
  socket.on('alert', (payload) => {
    const deviceId = socket.data.deviceId;
    if (!deviceId) return;
    const device = ensureDevice(deviceId);
    device.alerts.unshift({ at: now(), payload });
    device.alerts = device.alerts.slice(0, 50);
    recordEvent(deviceId, 'alert', payload);
    recordDashboard('device:alert', { deviceId, alertType: payload.alert_type, message: payload.message });
  });

  socket.on('ota_status', (payload) => {
    const deviceId = socket.data.deviceId;
    if (!deviceId) return;
    const job = otaJobs.get(asStr(payload.otaJobId));
    if (job) {
      job.status = asStr(payload.status, job.status);
      job.updatedAt = now();
    }
    recordEvent(deviceId, 'ota_status', payload);
    recordDashboard('device:ota_status', { deviceId, otaJobId: asStr(payload.otaJobId), status: asStr(payload.status) });
  });

  socket.on('physical_confirmation_ack', (payload) => {
    const deviceId = socket.data.deviceId;
    if (!deviceId) return;
    const result = handleAck(deviceId, payload);
    if (result.status >= 400) {
      socket.emit('alert', { alert_type: 'physical_confirmation_rejected', message: asStr(result.body.error, 'unknown_confirmation_error'), timestamp: now() });
    }
  });

  socket.on('disconnect', () => {
    const deviceId = socket.data.deviceId;
    if (!deviceId) return;
    const device = ensureDevice(deviceId);
    device.online = false;
    delete device.socketId;
    sockets.delete(deviceId);
    recordEvent(deviceId, 'disconnect', { reason: 'socket_disconnect' });
    recordDashboard('device:offline', { deviceId });
  });
});

server.listen(port, () => {
  process.stdout.write(`[mock-control-plane] listening on http://127.0.0.1:${port}${path}\n`);
});
