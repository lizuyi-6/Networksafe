/**
 * Traffic Interceptor - Core Types
 * High-performance network traffic capture and analysis
 */

// ============================================================================
// Platform Detection
// ============================================================================

export type Platform = 'linux' | 'windows' | 'macos' | 'unknown';

export function detectPlatform(): Platform {
    switch (process.platform) {
        case 'linux': return 'linux';
        case 'win32': return 'windows';
        case 'darwin': return 'macos';
        default: return 'unknown';
    }
}

// ============================================================================
// Packet Types
// ============================================================================

export interface PacketMetadata {
    timestamp: bigint;
    interfaceIndex: number;
    packetLength: number;
    capturedLength: number;
    direction: 'inbound' | 'outbound';
    queueId?: number;
    cpuId?: number;
}

export interface IPHeader {
    version: number;
    headerLength: number;
    tos: number;
    totalLength: number;
    identification: number;
    flags: number;
    fragmentOffset: number;
    ttl: number;
    protocol: number;
    checksum: number;
    sourceIP: string;
    destIP: string;
}

export interface TCPHeader {
    sourcePort: number;
    destPort: number;
    seqNumber: number;
    ackNumber: number;
    dataOffset: number;
    flags: {
        fin: boolean;
        syn: boolean;
        rst: boolean;
        psh: boolean;
        ack: boolean;
        urg: boolean;
        ece: boolean;
        cwr: boolean;
    };
    window: number;
    checksum: number;
    urgentPointer: number;
}

export interface UDPHeader {
    sourcePort: number;
    destPort: number;
    length: number;
    checksum: number;
}

export interface ICMPHeader {
    type: number;
    code: number;
    checksum: number;
    restOfHeader: number;
}

export type TransportHeader = TCPHeader | UDPHeader | ICMPHeader;

export interface ParsedPacket {
    id: string;
    metadata: PacketMetadata;
    ipHeader?: IPHeader;
    transportHeader?: TransportHeader;
    protocol: 'tcp' | 'udp' | 'icmp' | 'unknown';
    payload: Buffer;
    raw: Buffer;
    applicationLayer?: ApplicationLayerData;
}

export interface ApplicationLayerData {
    protocol: 'http' | 'https' | 'dns' | 'tls' | 'ssh' | 'unknown';
    data: Buffer;
    parsed?: HTTPRequest | DNSQuery | TLSHandshake | null;
}

export interface HTTPRequest {
    method: string;
    path: string;
    version: string;
    headers: Record<string, string>;
    body?: Buffer;
}

export interface DNSQuery {
    transactionId: number;
    flags: number;
    questions: DNSQuestion[];
    answers: DNSAnswer[];
}

export interface DNSQuestion {
    name: string;
    type: number;
    class: number;
}

export interface DNSAnswer {
    name: string;
    type: number;
    class: number;
    ttl: number;
    data: string;
}

export interface TLSHandshake {
    version: string;
    random: Buffer;
    sessionId: Buffer;
    cipherSuites: number[];
    extensions: TLSSNIExtension[];
}

export interface TLSSNIExtension {
    type: 'sni';
    serverName: string;
}

// ============================================================================
// Flow Types
// ============================================================================

export interface FlowKey {
    sourceIP: string;
    destIP: string;
    sourcePort: number;
    destPort: number;
    protocol: 'tcp' | 'udp' | 'icmp';
}

export interface FlowState {
    key: FlowKey;
    id: string;
    startTime: bigint;
    lastActivity: bigint;
    packetCount: number;
    byteCount: number;
    state: TCPState | UDPState;
    direction: 'inbound' | 'outbound' | 'bidirectional';
    application?: string;
    processId?: number;
    processName?: string;
}

export type TCPState = 
    | 'closed'
    | 'listen'
    | 'syn_sent'
    | 'syn_received'
    | 'established'
    | 'fin_wait_1'
    | 'fin_wait_2'
    | 'close_wait'
    | 'closing'
    | 'last_ack'
    | 'time_wait';

export type UDPState = 'idle' | 'active';

export interface FlowStatistics {
    flowId: string;
    duration: number;
    packetsPerSecond: number;
    bytesPerSecond: number;
    avgPacketSize: number;
    retransmissions: number;
    outOfOrder: number;
    rtt?: number;
}

// ============================================================================
// Interceptor Types
// ============================================================================

export type Verdict = 'allow' | 'block' | 'inspect' | 'modify';

export interface InterceptionResult {
    packetId: string;
    verdict: Verdict;
    modifiedPacket?: Buffer;
    inspectionData?: any;
    processingTime: number;
    matchedRule?: string;
}

export interface InterceptorConfig {
    enabled: boolean;
    platform: Platform;
    mode: 'transparent' | 'proxy' | 'hybrid';
    interfaces: string[];
    fastPathRules: FastPathRule[];
    slowPathThreshold: number;
    bufferSize: number;
    batchSize: number;
    workerThreads: number;
}

export interface FastPathRule {
    id: string;
    priority: number;
    condition: RuleCondition;
    action: 'allow' | 'block';
    counter: number;
    enabled: boolean;
}

export interface RuleCondition {
    sourceIP?: string | string[];
    destIP?: string | string[];
    sourcePort?: number | number[];
    destPort?: number | number[];
    protocol?: 'tcp' | 'udp' | 'icmp';
    payloadPattern?: string;
    flags?: string[];
}

// ============================================================================
// Platform-Specific Types
// ============================================================================

export interface LinuxConfig {
    useXDP: boolean;
    useTC: boolean;
    xdpMode: 'native' | 'skb' | 'offload';
    afXdpSocket: boolean;
    mapSize: number;
}

export interface WindowsConfig {
    providerGuid: string;
    subLayerGuid: string;
    calloutGuids: {
        inbound: string;
        outbound: string;
        connect: string;
        accept: string;
    };
    filterConditions: WFPFilterCondition[];
}

export interface WFPFilterCondition {
    layer: string;
    field: string;
    matchType: 'equal' | 'notEqual' | 'contains';
    value: any;
}

// ============================================================================
// Buffer Types
// ============================================================================

export interface RingBufferConfig {
    size: number;
    elementSize: number;
    batchSize: number;
    spinLock: boolean;
    memoryLock: boolean;
}

export interface BufferSlice {
    data: Buffer;
    offset: number;
    length: number;
    refCount: number;
}

// ============================================================================
// Statistics Types
// ============================================================================

export interface InterceptorStats {
    uptime: number;
    packetsProcessed: bigint;
    packetsAllowed: bigint;
    packetsBlocked: bigint;
    packetsInspected: bigint;
    bytesProcessed: bigint;
    currentFlows: number;
    activeConnections: number;
    droppedPackets: bigint;
    bufferOverflows: bigint;
    avgProcessingTime: number;
    cpuUsage: number;
    memoryUsage: number;
}

export interface PerformanceMetrics {
    timestamp: bigint;
    packetsPerSecond: number;
    bytesPerSecond: number;
    flowsPerSecond: number;
    avgLatency: number;
    p99Latency: number;
    bufferSize: number;
    bufferUsage: number;
}

// ============================================================================
// Event Types
// ============================================================================

export type InterceptorEventType = 
    | 'packet_captured'
    | 'flow_created'
    | 'flow_closed'
    | 'threat_detected'
    | 'rule_matched'
    | 'error'
    | 'stats_update';

export interface InterceptorEvent {
    type: InterceptorEventType;
    timestamp: bigint;
    data: any;
}

export interface ThreatEvent {
    packetId: string;
    flowId: string;
    threatType: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    evidence: any;
    sourceIP: string;
    destIP: string;
    timestamp: bigint;
}

// ============================================================================
// Integration Types
// ============================================================================

export interface AgentIntegration {
    enabled: boolean;
    endpoint: string;
    batchSize: number;
    timeout: number;
    fallbackAction: 'allow' | 'block';
}

export interface PacketForAnalysis {
    id: string;
    timestamp: Date;
    sourceIP: string;
    destIP: string;
    sourcePort: number;
    destPort: number;
    protocol: string;
    payload: string;
    raw: string;
    flowId: string;
    direction: 'inbound' | 'outbound';
}

export interface AnalysisResult {
    packetId: string;
    verdict: 'allow' | 'block' | 'monitor';
    confidence: number;
    threatType?: string;
    threatLevel?: 'low' | 'medium' | 'high' | 'critical';
    reasoning?: string;
    actions?: string[];
}
