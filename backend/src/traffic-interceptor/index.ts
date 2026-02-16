/**
 * Traffic Interceptor - Main Entry Point
 * High-performance network traffic capture and security analysis
 */

import {
    Platform,
    detectPlatform,
    InterceptorConfig,
    Verdict,
    InterceptionResult,
    InterceptorStats,
    ThreatEvent
} from './core/types';
import { Packet } from './core/packet';
import { FlowManager } from './core/flow';
import { createCaptureInterface, TrafficCaptureInterface } from './core/hal';
import { RingBuffer } from './processing/ring-buffer';
import { AgentBridge } from './integration/agent-bridge';
import logger from '../utils/logger';

export * from './core/types';
export { Packet } from './core/packet';
export { FlowManager } from './core/flow';
export { RingBuffer } from './processing/ring-buffer';
export { ProtocolParser } from './processing/protocol-parser';
export { AgentBridge } from './integration/agent-bridge';

const DEFAULT_CONFIG: Partial<InterceptorConfig> = {
    enabled: true,
    mode: 'transparent',
    interfaces: ['eth0'],
    bufferSize: 100000,
    batchSize: 64,
    workerThreads: 4,
    fastPathRules: [],
    slowPathThreshold: 0.7
};

export class TrafficInterceptor {
    private config: InterceptorConfig;
    private platform: Platform;
    private capture: TrafficCaptureInterface;
    private flowManager: FlowManager;
    private agentBridge: AgentBridge;
    private packetBuffer: RingBuffer<Packet>;
    private running: boolean = false;
    private processingLoop: NodeJS.Timeout | null = null;
    private eventListeners: Map<string, Set<Function>> = new Map();
    private startTime: number = 0;

    constructor(config: Partial<InterceptorConfig> = {}) {
        this.platform = detectPlatform();
        this.config = { ...DEFAULT_CONFIG, ...config, platform: this.platform } as InterceptorConfig;
        
        this.capture = createCaptureInterface(this.platform);
        this.flowManager = new FlowManager(100000, 300000);
        this.agentBridge = new AgentBridge(this.flowManager, {
            enabled: true,
            batchSize: 32,
            timeout: 5000,
            fallbackVerdict: 'allow'
        });
        this.packetBuffer = new RingBuffer({ size: this.config.bufferSize });

        this.setupVerdictCallback();
    }

    private setupVerdictCallback(): void {
        this.capture.setVerdictCallback(async (packet: Packet) => {
            return this.processPacket(packet);
        });
    }

    async initialize(): Promise<void> {
        logger.info('Initializing Traffic Interceptor', {
            platform: this.platform,
            mode: this.config.mode
        });

        await this.capture.initialize(this.config);
        await this.agentBridge.initialize();

        logger.info('Traffic Interceptor initialized successfully');
    }

    async start(): Promise<void> {
        if (this.running) {
            logger.warn('Traffic Interceptor already running');
            return;
        }

        this.running = true;
        this.startTime = Date.now();

        await this.capture.start();
        this.startProcessingLoop();

        logger.info('Traffic Interceptor started', {
            interfaces: this.config.interfaces
        });
    }

    private startProcessingLoop(): void {
        this.processingLoop = setInterval(async () => {
            await this.processBatch();
        }, 1);
    }

    private async processBatch(): Promise<void> {
        const packets = this.packetBuffer.readBatch(this.config.batchSize);
        
        if (packets.length === 0) return;

        for (const packet of packets) {
            try {
                const verdict = await this.agentBridge.analyzePacket(packet);
                await this.applyVerdict(packet, verdict);
            } catch (error: any) {
                logger.error('Error processing packet', { 
                    error: error.message,
                    packetId: packet.id 
                });
            }
        }
    }

    private async processPacket(packet: Packet): Promise<Verdict> {
        const result = await this.agentBridge.analyzePacket(packet);
        
        if (result.verdict === 'block') {
            this.emit('threat_detected', {
                packetId: packet.id,
                threatType: result.matchedRule || 'unknown',
                severity: 'high',
                sourceIP: packet.parsed.ipHeader?.sourceIP,
                destIP: packet.parsed.ipHeader?.destIP,
                timestamp: BigInt(Date.now()) * BigInt(1_000_000)
            } as ThreatEvent);
        }

        return result.verdict;
    }

    private async applyVerdict(packet: Packet, result: InterceptionResult): Promise<void> {
        switch (result.verdict) {
            case 'allow':
                break;
            case 'block':
                logger.debug('Packet blocked', { 
                    packetId: packet.id,
                    rule: result.matchedRule 
                });
                break;
            case 'inspect':
                this.emit('packet_captured', {
                    packetId: packet.id,
                    parsed: packet.parsed
                });
                break;
        }
    }

    async stop(): Promise<void> {
        if (!this.running) return;

        this.running = false;

        if (this.processingLoop) {
            clearInterval(this.processingLoop);
            this.processingLoop = null;
        }

        await this.capture.stop();
        await this.agentBridge.shutdown();
        this.flowManager.shutdown();

        logger.info('Traffic Interceptor stopped');
    }

    injectPacket(rawData: Buffer, metadata: {
        direction: 'inbound' | 'outbound';
        interfaceIndex?: number;
    }): void {
        const packet = Packet.createFromBuffer(rawData, {
            timestamp: BigInt(Date.now()) * BigInt(1_000_000),
            direction: metadata.direction,
            interfaceIndex: metadata.interfaceIndex || 0,
            packetLength: rawData.length,
            capturedLength: rawData.length
        });

        this.packetBuffer.write(packet);
    }

    on(event: string, listener: Function): void {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event)!.add(listener);
    }

    off(event: string, listener: Function): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.delete(listener);
        }
    }

    private emit(event: string, data: any): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            for (const listener of listeners) {
                try {
                    listener(data);
                } catch (error: any) {
                    logger.error('Event listener error', { event, error: error.message });
                }
            }
        }
    }

    getStats(): InterceptorStats & {
        flows: ReturnType<FlowManager['getStats']>;
        bridge: ReturnType<AgentBridge['getStats']>;
        buffer: ReturnType<RingBuffer<any>['getStats']>;
        uptime: number;
    } {
        const captureStats = this.capture.getStats();
        
        return {
            ...captureStats,
            flows: this.flowManager.getStats(),
            bridge: this.agentBridge.getStats(),
            buffer: this.packetBuffer.getStats(),
            uptime: this.startTime > 0 ? Date.now() - this.startTime : 0
        };
    }

    getFlowManager(): FlowManager {
        return this.flowManager;
    }

    isRunning(): boolean {
        return this.running;
    }

    getPlatform(): Platform {
        return this.platform;
    }
}

export const createTrafficInterceptor = (config?: Partial<InterceptorConfig>): TrafficInterceptor => {
    return new TrafficInterceptor(config);
};

export default TrafficInterceptor;
