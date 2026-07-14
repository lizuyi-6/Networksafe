import { AgentStatus } from '../agent';
import { getTrafficStats } from './traffic-stats.service';
import {
  addDeviceEvent,
  getDeviceList,
  registerDevice,
  setDeviceOffline,
  updateDeviceStatus
} from './device-registry.service';
import { securityOperationsService } from './security-operations.service';
import { AgentGateway } from '../websocket/agent-gateway';
import logger from '../utils/logger';
import { getRuntimeProfile, isRuntimeEmulatorEnabled } from '../config/platform-runtime';

interface SyntheticAgentRuntime {
  agentId: string;
  hostname: string;
  platform: string;
  version: string;
  ip: string;
  region: string;
  role: string;
  startedAt: number;
  baseCpu: number;
  baseMemory: number;
  blockedIps: Set<string>;
  commandPressureUntil: number;
}

interface SyntheticDeviceRuntime {
  deviceId: string;
  version: string;
  chipModel: string;
  flashSize: number;
  freeHeap: number;
  sdkVersion: string;
  hostname: string;
  os: string;
  kernel: string;
  arch: string;
  baseCpu: number;
  baseMemory: number;
  wifiBase: number;
  online: boolean;
}

interface SyntheticFlowRuntime {
  sessionId: string;
  sourceRef: string;
  sourceType: 'agent' | 'device';
  sourceIP: string;
  destRef: string;
  destType: 'site' | 'service';
  destIP: string;
  sourcePort: number;
  destPort: number;
  protocol: string;
  packetCount: number;
  byteCount: number;
  startedAt: string;
  classification: string;
}

class RuntimeEmulatorService {
  private agentGateway: AgentGateway | null = null;
  private interval: NodeJS.Timeout | null = null;
  private started = false;
  private tickCount = 0;
  private readonly tenantId = 'global';
  private readonly agents: SyntheticAgentRuntime[] = [
    {
      agentId: 'agt-edge-sh-01',
      hostname: 'edge-shanghai-01',
      platform: 'linux-x64',
      version: '2.4.3',
      ip: '10.10.1.21',
      region: 'cn-sh',
      role: 'gateway',
      startedAt: Date.now() - 9 * 60 * 60 * 1000,
      baseCpu: 22,
      baseMemory: 46,
      blockedIps: new Set<string>(),
      commandPressureUntil: 0
    },
    {
      agentId: 'agt-edge-sz-02',
      hostname: 'edge-shenzhen-02',
      platform: 'linux-arm64',
      version: '2.4.1',
      ip: '10.10.2.18',
      region: 'cn-sz',
      role: 'inspection',
      startedAt: Date.now() - 6 * 60 * 60 * 1000,
      baseCpu: 18,
      baseMemory: 38,
      blockedIps: new Set<string>(),
      commandPressureUntil: 0
    },
    {
      agentId: 'agt-edge-hk-03',
      hostname: 'edge-hongkong-03',
      platform: 'linux-x64',
      version: '2.3.6',
      ip: '10.10.3.14',
      region: 'hk',
      role: 'egress',
      startedAt: Date.now() - 14 * 60 * 60 * 1000,
      baseCpu: 26,
      baseMemory: 42,
      blockedIps: new Set<string>(),
      commandPressureUntil: 0
    }
  ];
  private readonly devices: SyntheticDeviceRuntime[] = [
    // NOTE: The following synthetic demo devices model the legacy ESP32 hardware family (ESP32-S3 / C6).
    // ESP32 serial-deployer / control-board hardware was retired 2026-06-13 and archived out of repo;
    // active hardware is the Gateway Appliance (STM32H5/U5). These fixtures are retained as demo/synthetic
    // telemetry sources for the runtime emulator only and do not represent current production hardware.
    // Device IDs (esp32-*) are referenced by tickDevice() below; do not rename without coordinated updates.
    {
      deviceId: 'esp32-core-01',
      version: '2.4.1',
      chipModel: 'ESP32-S3',
      flashSize: 16 * 1024 * 1024,
      freeHeap: 240000,
      sdkVersion: '5.2.1',
      hostname: 'iot-core-01',
      os: 'rtos',
      kernel: 'idf',
      arch: 'xtensa',
      baseCpu: 28,
      baseMemory: 52,
      wifiBase: -61,
      online: true
    },
    {
      deviceId: 'esp32-floor-02',
      version: '2.4.1',
      chipModel: 'ESP32-C6',
      flashSize: 8 * 1024 * 1024,
      freeHeap: 216000,
      sdkVersion: '5.2.0',
      hostname: 'iot-floor-02',
      os: 'rtos',
      kernel: 'idf',
      arch: 'riscv32',
      baseCpu: 31,
      baseMemory: 48,
      wifiBase: -67,
      online: true
    },
    {
      deviceId: 'esp32-plant-03',
      version: '2.3.8',
      chipModel: 'ESP32-S3',
      flashSize: 16 * 1024 * 1024,
      freeHeap: 198000,
      sdkVersion: '5.1.4',
      hostname: 'iot-plant-03',
      os: 'rtos',
      kernel: 'idf',
      arch: 'xtensa',
      baseCpu: 24,
      baseMemory: 44,
      wifiBase: -70,
      online: true
    },
    {
      deviceId: 'esp32-yard-04',
      version: '2.2.9',
      chipModel: 'ESP32',
      flashSize: 4 * 1024 * 1024,
      freeHeap: 172000,
      sdkVersion: '5.0.7',
      hostname: 'iot-yard-04',
      os: 'rtos',
      kernel: 'idf',
      arch: 'xtensa',
      baseCpu: 19,
      baseMemory: 37,
      wifiBase: -73,
      online: true
    }
  ];
  private readonly flows: SyntheticFlowRuntime[] = [
    {
      sessionId: 'syn-flow-agent-sh-api',
      sourceRef: 'agt-edge-sh-01',
      sourceType: 'agent',
      sourceIP: '10.10.1.21',
      destRef: 'api-control-plane',
      destType: 'site',
      destIP: '172.22.0.10',
      sourcePort: 42110,
      destPort: 443,
      protocol: 'TCP',
      packetCount: 420,
      byteCount: 180000,
      startedAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
      classification: 'normal'
    },
    {
      sessionId: 'syn-flow-agent-sz-dns',
      sourceRef: 'agt-edge-sz-02',
      sourceType: 'agent',
      sourceIP: '10.10.2.18',
      destRef: 'resolver-edge',
      destType: 'service',
      destIP: '172.22.0.53',
      sourcePort: 53821,
      destPort: 53,
      protocol: 'UDP',
      packetCount: 280,
      byteCount: 64000,
      startedAt: new Date(Date.now() - 28 * 60 * 1000).toISOString(),
      classification: 'normal'
    },
    {
      sessionId: 'syn-flow-device-core-ingest',
      sourceRef: 'esp32-core-01',
      sourceType: 'device',
      sourceIP: '10.20.1.31',
      destRef: 'telemetry-ingest',
      destType: 'service',
      destIP: '172.22.0.25',
      sourcePort: 31891,
      destPort: 8883,
      protocol: 'TCP',
      packetCount: 360,
      byteCount: 92000,
      startedAt: new Date(Date.now() - 42 * 60 * 1000).toISOString(),
      classification: 'normal'
    },
    {
      sessionId: 'syn-flow-agent-hk-watch',
      sourceRef: 'agt-edge-hk-03',
      sourceType: 'agent',
      sourceIP: '10.10.3.14',
      destRef: 'watchtower-edge',
      destType: 'service',
      destIP: '198.18.0.12',
      sourcePort: 40312,
      destPort: 8443,
      protocol: 'TCP',
      packetCount: 160,
      byteCount: 54000,
      startedAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
      classification: 'security-signal'
    }
  ];

  isEnabled(): boolean {
    return isRuntimeEmulatorEnabled();
  }

  describe() {
    return {
      profile: getRuntimeProfile(),
      enabled: this.isEnabled(),
      running: this.started
    };
  }

  start(agentGateway: AgentGateway): void {
    if (this.started || !this.isEnabled()) {
      if (!this.isEnabled()) {
        logger.info('Runtime emulator disabled');
      }
      return;
    }

    this.agentGateway = agentGateway;
    this.started = true;

    this.bootstrapDevices();
    this.tick();

    this.interval = setInterval(() => this.tick(), 8000);
    this.interval.unref?.();

    logger.info('Runtime emulator started', {
      syntheticAgents: this.agents.length,
      syntheticDevices: this.devices.length
    });
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (this.agentGateway) {
      for (const agent of this.agents) {
        this.agentGateway.removeSyntheticAgent(agent.agentId);
      }
    }

    this.started = false;
  }

  private bootstrapDevices(): void {
    for (const device of this.devices) {
      registerDevice({
        deviceId: device.deviceId,
        version: device.version,
        chipModel: device.chipModel,
        flashSize: device.flashSize,
        freeHeap: device.freeHeap,
        sdkVersion: device.sdkVersion,
        mode: 'online',
        status: {
          cpuUsage: device.baseCpu,
          memoryUsage: device.baseMemory,
          uptime: 60,
          wifiRssi: device.wifiBase
        },
        systemInfo: {
          hostname: device.hostname,
          os: device.os,
          kernel: device.kernel,
          arch: device.arch
        }
      });
    }
  }

  private tick(): void {
    if (!this.agentGateway) {
      return;
    }

    this.tickCount += 1;

    for (const agent of this.agents) {
      this.tickAgent(agent);
    }

    for (const device of this.devices) {
      this.tickDevice(device);
    }

    this.tickTraffic();
  }

  private tickAgent(agent: SyntheticAgentRuntime): void {
    if (!this.agentGateway) {
      return;
    }

    const now = Date.now();
    const offlineWindow = agent.agentId === 'agt-edge-hk-03' && this.tickCount % 9 === 0;
    const pressureBoost = now < agent.commandPressureUntil ? 18 : 0;
    const cpuSpike = agent.agentId === 'agt-edge-sz-02' && this.tickCount % 7 === 0 ? 58 : 0;
    const memorySpike = agent.agentId === 'agt-edge-sh-01' && this.tickCount % 11 === 0 ? 34 : 0;
    const cpuUsage = this.clamp(agent.baseCpu + pressureBoost + cpuSpike + this.jitter(6), 6, 96);
    const memoryUsage = this.clamp(agent.baseMemory + Math.floor(pressureBoost / 2) + memorySpike + this.jitter(5), 18, 93);
    const lastHeartbeat = new Date();
    const status: AgentStatus = {
      agentId: agent.agentId,
      hostname: agent.hostname,
      platform: agent.platform,
      uptime: Math.max(60, Math.floor((now - agent.startedAt) / 1000)),
      cpuUsage,
      memoryUsage,
      lastHeartbeat: lastHeartbeat.toISOString(),
      isOnline: !offlineWindow
    };

    const agentAsset = securityOperationsService.upsertAsset({
      tenantId: this.tenantId,
      assetType: 'agent',
      externalRef: agent.agentId,
      displayName: agent.hostname,
      primaryAddress: agent.ip,
      status: status.isOnline ? 'online' : 'offline',
      metadata: {
        region: agent.region,
        role: agent.role,
        synthetic: true,
        blockedIps: Array.from(agent.blockedIps)
      }
    });

    this.syncAgentSignals(agent, status, agentAsset.assetId);

    this.agentGateway.upsertSyntheticAgent({
      agentId: agent.agentId,
      hostname: agent.hostname,
      platform: agent.platform,
      lastHeartbeat,
      status,
      registration: {
        ip: agent.ip,
        version: agent.version,
        region: agent.region,
        role: agent.role,
        synthetic: true,
        enrolledAt: new Date(agent.startedAt).toISOString(),
        capabilities: ['scan', 'block_ip', 'unblock_ip', 'telemetry']
      },
      commandHandler: (command) => this.handleAgentCommand(agent, command)
    });
  }

  private tickDevice(device: SyntheticDeviceRuntime): void {
    const offlineWindow = device.deviceId === 'esp32-yard-04' && this.tickCount % 10 === 0;
    const online = !offlineWindow;

    if (!online) {
      if (device.online) {
        addDeviceEvent(device.deviceId, 'disconnect', {
          reason: 'synthetic-link-loss',
          tick: this.tickCount
        });
      }
      setDeviceOffline(device.deviceId);
      device.online = false;
      return;
    }

    const cpuUsage = this.clamp(device.baseCpu + (device.deviceId === 'esp32-floor-02' && this.tickCount % 8 === 0 ? 46 : 0) + this.jitter(5), 8, 95);
    const memoryUsage = this.clamp(device.baseMemory + (device.deviceId === 'esp32-plant-03' && this.tickCount % 6 === 0 ? 31 : 0) + this.jitter(4), 18, 92);
    const wifiRssi = this.clamp(device.wifiBase + this.jitter(4) - (device.deviceId === 'esp32-yard-04' && this.tickCount % 5 === 0 ? 12 : 0), -92, -48);
    const uptime = Math.max(90, this.tickCount * 8 * 3 + Math.floor((device.freeHeap % 8000) / 10));

    if (!device.online || !getDeviceList().some((item) => item.deviceId === device.deviceId)) {
      registerDevice({
        deviceId: device.deviceId,
        version: device.version,
        chipModel: device.chipModel,
        flashSize: device.flashSize,
        freeHeap: device.freeHeap,
        sdkVersion: device.sdkVersion,
        mode: 'online',
        status: {
          cpuUsage,
          memoryUsage,
          uptime,
          wifiRssi
        },
        systemInfo: {
          hostname: device.hostname,
          os: device.os,
          kernel: device.kernel,
          arch: device.arch
        }
      });
      addDeviceEvent(device.deviceId, 'register', {
        synthetic: true,
        hostname: device.hostname
      });
    } else {
      updateDeviceStatus(device.deviceId, {
        cpuUsage,
        memoryUsage,
        uptime,
        wifiRssi
      });
      addDeviceEvent(device.deviceId, 'heartbeat', {
        synthetic: true,
        cpuUsage,
        memoryUsage,
        wifiRssi
      });
    }

    device.online = true;
  }

  private tickTraffic(): void {
    const stats = getTrafficStats();
    const syntheticFlowSnapshots: any[] = [];
    const threatCounts = new Map<string, number>();

    for (const flow of this.flows) {
      const packetDelta = 25 + Math.floor(Math.random() * 40);
      const byteDelta = packetDelta * (220 + Math.floor(Math.random() * 180));
      const isAnomalous = flow.classification !== 'normal' || (flow.sessionId === 'syn-flow-agent-sz-dns' && this.tickCount % 6 === 0);
      const classification = isAnomalous
        ? (flow.sessionId === 'syn-flow-agent-sz-dns' && this.tickCount % 6 === 0 ? 'scan-failure' : flow.classification)
        : 'normal';

      flow.packetCount += packetDelta;
      flow.byteCount += byteDelta;

      const sourceAsset = securityOperationsService.upsertAsset({
        tenantId: this.tenantId,
        assetType: flow.sourceType,
        externalRef: flow.sourceRef,
        displayName: flow.sourceRef,
        primaryAddress: flow.sourceIP,
        status: 'online',
        metadata: {
          synthetic: true
        }
      });
      const destAsset = securityOperationsService.upsertAsset({
        tenantId: this.tenantId,
        assetType: flow.destType,
        externalRef: flow.destRef,
        displayName: flow.destRef,
        primaryAddress: flow.destIP,
        status: 'observed',
        metadata: {
          synthetic: true
        }
      });

      securityOperationsService.upsertTrafficSession({
        tenantId: this.tenantId,
        sessionId: flow.sessionId,
        sourceIP: flow.sourceIP,
        destIP: flow.destIP,
        sourcePort: flow.sourcePort,
        destPort: flow.destPort,
        protocol: flow.protocol,
        state: isAnomalous ? 'SUSPICIOUS' : 'ESTABLISHED',
        packetCount: flow.packetCount,
        byteCount: flow.byteCount,
        startTime: flow.startedAt,
        lastActivity: new Date().toISOString(),
        sourceAssetId: sourceAsset.assetId,
        destAssetId: destAsset.assetId,
        metadata: {
          synthetic: true,
          classification,
          sourceRef: flow.sourceRef,
          destRef: flow.destRef
        }
      });

      stats.packetsProcessed += packetDelta;
      stats.packetsInspected += packetDelta;
      stats.packetsAllowed += isAnomalous ? Math.floor(packetDelta * 0.45) : packetDelta;
      stats.packetsBlocked += isAnomalous ? Math.ceil(packetDelta * 0.55) : 0;
      stats.bytesProcessed += byteDelta;

      syntheticFlowSnapshots.push({
        id: flow.sessionId,
        sourceIP: flow.sourceIP,
        destIP: flow.destIP,
        sourcePort: flow.sourcePort,
        destPort: flow.destPort,
        protocol: flow.protocol,
        state: isAnomalous ? 'SUSPICIOUS' : 'ESTABLISHED',
        packetCount: flow.packetCount,
        byteCount: flow.byteCount,
        synthetic: true,
        classification
      });

      if (isAnomalous) {
        const current = threatCounts.get(classification) || 0;
        threatCounts.set(classification, current + 1);
      }
    }

    stats.activeFlows = [
      ...stats.activeFlows.filter((flow: any) => !flow.synthetic),
      ...syntheticFlowSnapshots
    ].slice(0, 100);

    for (const [classification, count] of threatCounts.entries()) {
      stats.threats.set(`synthetic:${classification}`, {
        type: classification,
        count,
        severity: classification === 'security-signal' ? 'high' : 'medium'
      });
    }
  }

  private syncAgentSignals(agent: SyntheticAgentRuntime, status: AgentStatus, assetId: string): void {
    securityOperationsService.syncSignalFinding({
      tenantId: this.tenantId,
      active: !status.isOnline,
      assetId,
      sourceType: 'agent-health',
      sourceRef: agent.agentId,
      target: agent.hostname,
      category: 'agent-health',
      severity: 'high',
      title: 'Agent Offline',
      description: `Agent ${agent.agentId} stopped reporting telemetry from ${agent.region}.`,
      evidence: {
        agentId: agent.agentId,
        region: agent.region,
        lastHeartbeat: status.lastHeartbeat
      },
      remediation: {
        title: 'Recover agent connectivity',
        owner: 'operations',
        priority: 'high',
        suggestedSteps: [
          'Check the edge node network path.',
          'Verify the agent process is still running.',
          'Re-enroll the agent if credentials have rotated.'
        ]
      },
      fingerprint: `agent:${agent.agentId}:health:availability`,
      createAlert: true,
      alertType: 'system'
    });

    securityOperationsService.syncSignalFinding({
      tenantId: this.tenantId,
      active: status.cpuUsage >= 90,
      assetId,
      sourceType: 'agent-health',
      sourceRef: agent.agentId,
      target: agent.hostname,
      category: 'agent-health',
      severity: 'high',
      title: 'Agent CPU Saturation',
      description: `Agent ${agent.agentId} CPU usage is ${status.cpuUsage}%.`,
      evidence: {
        agentId: agent.agentId,
        cpuUsage: status.cpuUsage
      },
      remediation: {
        title: 'Reduce CPU pressure on the agent',
        owner: 'operations',
        priority: 'high',
        suggestedSteps: [
          'Throttle scan concurrency on the node.',
          'Inspect long-running command handlers.',
          'Redistribute inspection load to another edge agent.'
        ]
      },
      fingerprint: `agent:${agent.agentId}:health:cpu`,
      createAlert: true,
      alertType: 'system'
    });

    securityOperationsService.syncSignalFinding({
      tenantId: this.tenantId,
      active: status.memoryUsage >= 85,
      assetId,
      sourceType: 'agent-health',
      sourceRef: agent.agentId,
      target: agent.hostname,
      category: 'agent-health',
      severity: 'medium',
      title: 'Agent Memory Pressure',
      description: `Agent ${agent.agentId} memory usage is ${status.memoryUsage}%.`,
      evidence: {
        agentId: agent.agentId,
        memoryUsage: status.memoryUsage
      },
      remediation: {
        title: 'Stabilize memory pressure',
        owner: 'operations',
        priority: 'medium',
        suggestedSteps: [
          'Inspect recent scan results for oversized payloads.',
          'Rotate or restart the agent process.',
          'Review buffer sizing and rule set growth.'
        ]
      },
      fingerprint: `agent:${agent.agentId}:health:memory`,
      createAlert: true,
      alertType: 'system'
    });
  }

  private handleAgentCommand(
    agent: SyntheticAgentRuntime,
    command: { type: string; payload?: any; userId?: string }
  ): boolean {
    if (!this.agentGateway) {
      return false;
    }

    agent.commandPressureUntil = Date.now() + 30_000;

    if (command.type === 'block_ip' && command.payload?.ip) {
      agent.blockedIps.add(String(command.payload.ip));
    }

    if (command.type === 'unblock_ip' && command.payload?.ip) {
      agent.blockedIps.delete(String(command.payload.ip));
    }

    const ackTimer = setTimeout(() => {
      if (!this.agentGateway) {
        return;
      }
      this.agentGateway.broadcastToDashboards('agent:command:ack', {
        agentId: agent.agentId,
        tenantId: this.tenantId,
        command: command.type,
        payload: command.payload,
        operator: command.userId || 'system',
        synthetic: true,
        timestamp: new Date().toISOString()
      });
      this.agentGateway.broadcastToDashboards('agent:log', {
        agentId: agent.agentId,
        tenantId: this.tenantId,
        level: 'info',
        message: `Synthetic runtime accepted ${command.type} command.`,
        synthetic: true,
        timestamp: new Date().toISOString()
      });
    }, 350);
    ackTimer.unref?.();

    return true;
  }

  private jitter(spread: number): number {
    return Math.round((Math.random() - 0.5) * 2 * spread);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value)));
  }
}

// Exported for testing
export function jitter(spread: number): number {
  return Math.round((Math.random() - 0.5) * 2 * spread);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export const runtimeEmulatorService = new RuntimeEmulatorService();
