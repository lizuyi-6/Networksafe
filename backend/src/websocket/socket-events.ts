export interface AgentRegisterPayload {
  agentId?: string;
  hostname?: string;
  platform?: string;
  arch?: string;
  version?: string;
}

export interface AgentHeartbeatPayload {
  agentId?: string;
  hostname?: string;
  platform?: string;
  uptime?: number;
  cpuUsage?: number;
  memoryUsage?: number;
  lastHeartbeat?: string;
  isOnline?: boolean;
}

export interface DashboardAgentCommandPayload {
  agentId: string;
}

export interface DashboardIpCommandPayload extends DashboardAgentCommandPayload {
  ip: string;
}

export interface DeviceRegisterPayload {
  device_id: string;
  version?: string;
  chip_model?: string;
  flash_size?: number;
  free_heap?: number;
  sdk_version?: string;
  api_key?: string;
  public_key_pem?: string;
  secure_element_present?: boolean;
  device_role?: string;
  transport?: string;
  policy_digest?: string;
  breaker_target?: string;
  interlock_state?: string;
  external_power_present?: boolean;
  feedback_ok?: boolean;
}

export interface DeviceHeartbeatPayload {
  uptime?: number;
  free_heap?: number;
  wifi_rssi?: number;
  cpu_usage?: number;
  policy_digest?: string;
  breaker_target?: string;
  interlock_state?: string;
  external_power_present?: boolean;
  secure_element_present?: boolean;
  feedback_ok?: boolean;
}

export interface AgentClientToServerEvents {
  'agent:register': (payload: AgentRegisterPayload) => void;
  'agent:heartbeat': (payload: AgentHeartbeatPayload) => void;
  'agent:traffic_stats': (payload: { agentId?: string; stats?: Record<string, any>; timestamp?: string }) => void;
  'agent:threat': (payload: { threat?: Record<string, any> }) => void;
  'agent:review_sample': (payload: { agentId?: string; sample?: Record<string, any>; timestamp?: string }) => void;
  'agent:scan_result': (payload: Record<string, any>) => void;
  'agent:log': (payload: Record<string, any>) => void;
  'agent:command_ack': (payload: Record<string, any>) => void;
  'agent:command_failed': (payload: Record<string, any>) => void;
  'request:scan': (payload: DashboardAgentCommandPayload) => void;
  'request:block_ip': (payload: DashboardIpCommandPayload) => void;
  'request:unblock_ip': (payload: DashboardIpCommandPayload) => void;
}

export interface AgentServerToClientEvents {
  'agent:authenticated': (payload: { agentId: string; timestamp: number }) => void;
  'agents:list': (payload: any[]) => void;
  'agent:online': (payload: Record<string, any>) => void;
  'agent:offline': (payload: Record<string, any>) => void;
  'agent:registered': (payload: Record<string, any>) => void;
  'agent:status': (payload: Record<string, any>) => void;
  'traffic:updated': (payload: Record<string, any>) => void;
  'threat:detected': (payload: Record<string, any>) => void;
  'scan:result': (payload: Record<string, any>) => void;
  'agent:log': (payload: Record<string, any>) => void;
  'agent:command:ack': (payload: Record<string, any>) => void;
  'agent:command:failed': (payload: Record<string, any>) => void;
  'command': (payload: Record<string, any>) => void;
  'error': (payload: { message: string; reason?: string }) => void;
}

export interface DeviceClientToServerEvents {
  register: (payload: DeviceRegisterPayload) => void;
  heartbeat: (payload: DeviceHeartbeatPayload) => void;
  data: (payload: Record<string, any>) => void;
  alert: (payload: Record<string, any>) => void;
  unknown_error: (payload: Record<string, any>) => void;
  ota_status: (payload: Record<string, any>) => void;
  physical_confirmation_ack: (payload: Record<string, any>) => void;
  codebook_sync: () => void;
}

export interface DeviceServerToClientEvents {
  register_error: (payload: { error: string; reason?: string }) => void;
  register_success: (payload: Record<string, any>) => void;
  heartbeat_error: (payload: { error: string; reason?: string }) => void;
  heartbeat_ack: (payload: { timestamp: number }) => void;
  codebook_sync: (payload: { codebook: Record<string, string> }) => void;
  command: (payload: Record<string, any>) => void;
}
