import {
  AgentHeartbeatPayload,
  AgentRegisterPayload,
  DashboardAgentCommandPayload,
  DashboardIpCommandPayload,
  DeviceHeartbeatPayload,
  DeviceRegisterPayload
} from './socket-events';

function asRecord(input: unknown): Record<string, any> | null {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, any>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function validateAgentRegisterPayload(input: unknown): AgentRegisterPayload | null {
  const payload = asRecord(input);
  if (!payload) {
    return null;
  }

  return {
    agentId: nonEmptyString(payload.agentId) || undefined,
    hostname: nonEmptyString(payload.hostname) || undefined,
    platform: nonEmptyString(payload.platform) || undefined,
    arch: nonEmptyString(payload.arch) || undefined,
    version: nonEmptyString(payload.version) || undefined
  };
}

export function validateAgentHeartbeatPayload(input: unknown): AgentHeartbeatPayload | null {
  const payload = asRecord(input);
  if (!payload) {
    return null;
  }

  return {
    agentId: nonEmptyString(payload.agentId) || undefined,
    hostname: nonEmptyString(payload.hostname) || undefined,
    platform: nonEmptyString(payload.platform) || undefined,
    uptime: optionalFiniteNumber(payload.uptime),
    cpuUsage: optionalFiniteNumber(payload.cpuUsage),
    memoryUsage: optionalFiniteNumber(payload.memoryUsage),
    lastHeartbeat: nonEmptyString(payload.lastHeartbeat) || undefined,
    isOnline: typeof payload.isOnline === 'boolean' ? payload.isOnline : undefined
  };
}

export function validateDashboardAgentCommandPayload(input: unknown): DashboardAgentCommandPayload | null {
  const payload = asRecord(input);
  const agentId = nonEmptyString(payload?.agentId);
  if (!agentId) {
    return null;
  }

  return { agentId };
}

export function validateDashboardIpCommandPayload(input: unknown): DashboardIpCommandPayload | null {
  const payload = validateDashboardAgentCommandPayload(input);
  const record = asRecord(input);
  const ip = nonEmptyString(record?.ip);
  if (!payload || !ip) {
    return null;
  }

  return {
    ...payload,
    ip
  };
}

export function validateDeviceRegisterPayload(input: unknown): DeviceRegisterPayload | null {
  const payload = asRecord(input);
  const deviceId = nonEmptyString(payload?.device_id);
  const apiKey = nonEmptyString(payload?.api_key);
  if (!payload || !deviceId || !apiKey) {
    return null;
  }

  return {
    device_id: deviceId,
    api_key: apiKey,
    version: nonEmptyString(payload.version) || undefined,
    chip_model: nonEmptyString(payload.chip_model) || undefined,
    flash_size: optionalFiniteNumber(payload.flash_size),
    free_heap: optionalFiniteNumber(payload.free_heap),
    sdk_version: nonEmptyString(payload.sdk_version) || undefined,
    public_key_pem: nonEmptyString(payload.public_key_pem) || undefined,
    secure_element_present: typeof payload.secure_element_present === 'boolean' ? payload.secure_element_present : undefined,
    device_role: nonEmptyString(payload.device_role) || undefined,
    transport: nonEmptyString(payload.transport) || undefined,
    policy_digest: nonEmptyString(payload.policy_digest) || undefined,
    breaker_target: nonEmptyString(payload.breaker_target) || undefined,
    interlock_state: nonEmptyString(payload.interlock_state) || undefined,
    external_power_present: typeof payload.external_power_present === 'boolean' ? payload.external_power_present : undefined,
    feedback_ok: typeof payload.feedback_ok === 'boolean' ? payload.feedback_ok : undefined
  };
}

export function validateDeviceHeartbeatPayload(input: unknown): DeviceHeartbeatPayload | null {
  const payload = asRecord(input);
  if (!payload) {
    return null;
  }

  return {
    uptime: optionalFiniteNumber(payload.uptime),
    free_heap: optionalFiniteNumber(payload.free_heap),
    wifi_rssi: optionalFiniteNumber(payload.wifi_rssi),
    cpu_usage: optionalFiniteNumber(payload.cpu_usage),
    policy_digest: nonEmptyString(payload.policy_digest) || undefined,
    breaker_target: nonEmptyString(payload.breaker_target) || undefined,
    interlock_state: nonEmptyString(payload.interlock_state) || undefined,
    external_power_present: typeof payload.external_power_present === 'boolean' ? payload.external_power_present : undefined,
    secure_element_present: typeof payload.secure_element_present === 'boolean' ? payload.secure_element_present : undefined,
    feedback_ok: typeof payload.feedback_ok === 'boolean' ? payload.feedback_ok : undefined
  };
}
