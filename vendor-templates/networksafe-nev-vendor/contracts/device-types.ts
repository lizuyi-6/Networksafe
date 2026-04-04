export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export const DEVICE_EVENT_NAMES = [
  'register',
  'heartbeat',
  'data',
  'alert',
  'ota_status',
  'physical_confirmation_ack'
] as const;

export type DeviceEventName = (typeof DEVICE_EVENT_NAMES)[number];
export type AutoCommand = 'collect' | 'sync-config' | 'host_backup';
export type ApprovalRequiredCommand = 'host_install';
export type PhysicalConfirmationRequiredCommand =
  | 'reboot'
  | 'host_remove'
  | 'recovery_flash'
  | 'factory_reset'
  | 'diagnostic_unlock'
  | 'vehicle_ota_flash'
  | 'cellular_breaker_assert'
  | 'cellular_breaker_release';
export type DeviceCommandType = AutoCommand | ApprovalRequiredCommand | PhysicalConfirmationRequiredCommand | 'ota_update';
export type CommandClass = 'auto' | 'approval_required' | 'physical_confirmation_required';
export type ControlPlaneCommandType = DeviceCommandType | 'physical_confirmation_required';

export const AUTO_COMMANDS: readonly string[] = ['collect', 'sync-config', 'host_backup'];
export const APPROVAL_REQUIRED_COMMANDS: readonly string[] = ['host_install'];
export const PHYSICAL_CONFIRMATION_REQUIRED_COMMANDS: readonly string[] = [
  'reboot',
  'host_remove',
  'recovery_flash',
  'factory_reset',
  'diagnostic_unlock',
  'vehicle_ota_flash',
  'cellular_breaker_assert',
  'cellular_breaker_release'
];
export const DEVICE_COMMANDS: readonly string[] = [...AUTO_COMMANDS, ...APPROVAL_REQUIRED_COMMANDS, ...PHYSICAL_CONFIRMATION_REQUIRED_COMMANDS, 'ota_update'];

export const DEFAULT_TEST_DEVICE_API_KEY = 'vendor-test-device-key';
export const DEFAULT_TEST_COMMAND_SECRET = 'vendor-test-command-secret';
export const DEFAULT_DEVICE_GATEWAY_PATH = '/ws/device';

export interface DeviceRegisterPayload {
  device_id: string;
  version: string;
  chip_model: string;
  flash_size: number;
  free_heap: number;
  sdk_version: string;
  api_key: string;
}

export interface DeviceHeartbeatPayload {
  cpu_usage: number;
  memory_usage: number;
  uptime: number;
  wifi_rssi: number;
  free_heap: number;
}

export interface DevicePhysicalAuthPayload {
  publicKeyPem?: string;
  monotonicCounter?: number;
  lastConfirmedAt?: string | null;
}

export interface DeviceSystemInfoPayload {
  hostname?: string;
  os?: string;
  kernel?: string;
  arch?: string;
}

export interface DeviceDataPayload {
  transport?: string;
  externalPowerPresent?: boolean;
  secureElementPresent?: boolean;
  pendingPhysicalApproval?: boolean;
  interlockState?: string;
  hostActionState?: string;
  freeHeap?: number;
  systemInfo?: DeviceSystemInfoPayload;
  physicalAuth?: DevicePhysicalAuthPayload;
  [key: string]: unknown;
}

export interface DeviceAlertPayload {
  alert_type: string;
  message: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface DeviceOtaStatusPayload {
  otaJobId: string;
  status: string;
  version?: string;
  [key: string]: unknown;
}

export interface PhysicalConfirmationAckPayload {
  confirmationSessionId: string;
  confirmed: boolean;
  button: string;
  timestamp: number;
  monotonicCounter: number;
  signature: string;
  [key: string]: unknown;
}

export interface DeviceCommandEnvelope {
  cmd: ControlPlaneCommandType;
  params?: JsonObject;
  timestamp: number;
  nonce: string;
}

export interface SignedDeviceCommand {
  deviceId: string;
  command: DeviceCommandEnvelope;
  signature: string;
}

export interface MockOtaRequest {
  firmwareId: string;
  version: string;
  channel: string;
  artifactRef: string;
  fileName: string;
}

export interface MockOtaJob {
  id: string;
  deviceId: string;
  firmwareId: string;
  version: string;
  channel: string;
  artifactRef: string;
  fileName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface MockConfirmationRequest {
  commandType: PhysicalConfirmationRequiredCommand | ApprovalRequiredCommand;
  payload?: JsonObject;
}

export interface MockConfirmationSession {
  id: string;
  deviceId: string;
  commandType: PhysicalConfirmationRequiredCommand | ApprovalRequiredCommand;
  commandClass: CommandClass;
  payload: JsonObject;
  payloadHash: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  result?: JsonObject;
}
