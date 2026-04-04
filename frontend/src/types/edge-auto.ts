export type AgentNodeKind = 'cloud' | 'edge' | 'vehicle';
export type AgentDeploymentClass = 'standard' | 'edge' | 'vehicle';
export type AgentRuntimeMode = 'normal' | 'read_only_bypass';
export type EdgeAutoModuleKind = 'protocol' | 'node_capability' | 'device_command_pack';
export type EdgeAutoPolicyFieldType = 'boolean' | 'number' | 'string_array';

export interface AgentRuntimePolicy {
    cpuCeilingPct: number;
    sampleIntervalSec: number;
    breachWindowSec: number;
    recoveryWindowSec: number;
    autoReadOnlyBypass: boolean;
}

export interface EdgeAutoPolicyFieldSchema {
    type: EdgeAutoPolicyFieldType;
    label: string;
    description?: string;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
}

export interface EdgeAutoStatsFieldSchema {
    label: string;
    unit?: string;
}

export interface EdgeAutoModuleManifest {
    kind: EdgeAutoModuleKind;
    moduleId: string;
    version: string;
    displayName: string;
    defaultEnabled: boolean;
    supportedNodeKinds: AgentNodeKind[];
    supportedArchitectures: string[];
    policySchema: Record<string, EdgeAutoPolicyFieldSchema>;
    statsSchema: Record<string, EdgeAutoStatsFieldSchema>;
    uiSections: string[];
    capabilities: string[];
}

export interface ProtocolModuleManifest extends EdgeAutoModuleManifest {
    kind: 'protocol';
    protocol: 'http' | 'mqtt' | 'ros2_cyberrt';
}

export interface AgentProtocolPolicy {
    modules: Record<string, JsonObject>;
}

export interface ProtocolModuleStats {
    evaluations: number;
    findings: number;
    counters: Record<string, number>;
    findingsByCode: Record<string, number>;
    lastEventAt?: string | null;
    lastFindingAt?: string | null;
}

export interface AgentProtocolStats {
    totalEvaluations: number;
    protocolErrors: number;
    modules: Record<string, ProtocolModuleStats>;
}

export interface EdgeFinopsModuleStats {
    savedBytes: number;
    savedMessages: number;
    estimatedSavedMb: number;
}

export interface EdgeFinopsStats {
    savedBytes: number;
    savedMessages: number;
    estimatedSavedMb: number;
    modules: Record<string, EdgeFinopsModuleStats>;
}

export interface EdgeAutoDashboardModuleSummary {
    moduleId: string;
    evaluations: number;
    findings: number;
    counters: Record<string, number>;
    savedBytes: number;
    savedMessages: number;
    estimatedSavedMb: number;
    lastEventAt?: string | null;
    lastFindingAt?: string | null;
}

export interface EdgeAutoSummary {
    totalNodes: number;
    vehicleNodes: number;
    edgeNodes: number;
    cloudNodes: number;
    arm64Nodes: number;
    readOnlyBypassNodes: number;
    mqttSavedBytes: number;
    mqttSavedMessages: number;
    mqttSavedMb: number;
    protocolEvaluations: number;
    protocolAnomalies: number;
    modules: Record<string, EdgeAutoDashboardModuleSummary>;
    updatedAt: string;
}

export const DEFAULT_AGENT_RUNTIME_POLICY: AgentRuntimePolicy = {
    cpuCeilingPct: 1,
    sampleIntervalSec: 1,
    breachWindowSec: 30,
    recoveryWindowSec: 120,
    autoReadOnlyBypass: false
};

export const DEFAULT_AGENT_PROTOCOL_POLICY: AgentProtocolPolicy = {
    modules: {
        http: {},
        mqtt: {
            relayEnabled: false,
            suppressHighFrequency: false,
            heartbeatTopics: ['heartbeat', 'keepalive', 'telemetry/heartbeat', 'vehicle/heartbeat'],
            heartbeatMinIntervalMs: 1000
        },
        ros2_cyberrt: {
            observerEnabled: false,
            allowlist: []
        }
    }
};

export const DEFAULT_AGENT_PROTOCOL_STATS: AgentProtocolStats = {
    totalEvaluations: 0,
    protocolErrors: 0,
    modules: {
        http: {
            evaluations: 0,
            findings: 0,
            counters: { blockedRequests: 0 },
            findingsByCode: {},
            lastEventAt: null,
            lastFindingAt: null
        },
        mqtt: {
            evaluations: 0,
            findings: 0,
            counters: { messages: 0, suppressedMessages: 0, blockedMessages: 0, savedBytes: 0 },
            findingsByCode: {},
            lastEventAt: null,
            lastFindingAt: null
        },
        ros2_cyberrt: {
            evaluations: 0,
            findings: 0,
            counters: { events: 0, unauthorizedRpcFindings: 0 },
            findingsByCode: {},
            lastEventAt: null,
            lastFindingAt: null
        }
    }
};

export const DEFAULT_EDGE_FINOPS_STATS: EdgeFinopsStats = {
    savedBytes: 0,
    savedMessages: 0,
    estimatedSavedMb: 0,
    modules: {
        http: { savedBytes: 0, savedMessages: 0, estimatedSavedMb: 0 },
        mqtt: { savedBytes: 0, savedMessages: 0, estimatedSavedMb: 0 },
        ros2_cyberrt: { savedBytes: 0, savedMessages: 0, estimatedSavedMb: 0 }
    }
};

export function cloneEdgeAuto<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
import type { JsonObject } from './json';
