/**
 * Hardware Abstraction Layer - Cross-platform traffic capture interface
 */

import {
    Platform,
    PacketMetadata,
    ParsedPacket,
    Verdict,
    InterceptionResult,
    InterceptorConfig,
    InterceptorStats,
    LinuxConfig,
    WindowsConfig
} from './types';
import { Packet } from './packet';
import { RingBuffer } from '../processing/ring-buffer';
import logger from '../../utils/logger';

export interface TrafficCaptureInterface {
    initialize(config: InterceptorConfig): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    getStats(): InterceptorStats;
    setVerdictCallback(callback: (packet: Packet) => Promise<Verdict>): void;
    isRunning(): boolean;
}

export abstract class BaseCapture implements TrafficCaptureInterface {
    protected config: InterceptorConfig | null = null;
    protected running: boolean = false;
    protected verdictCallback: ((packet: Packet) => Promise<Verdict>) | null = null;
    protected stats: InterceptorStats = this.createEmptyStats();
    protected packetBuffer: RingBuffer<Packet> | null = null;

    abstract initialize(config: InterceptorConfig): Promise<void>;
    abstract start(): Promise<void>;
    abstract stop(): Promise<void>;

    protected createEmptyStats(): InterceptorStats {
        return {
            uptime: 0,
            packetsProcessed: BigInt(0),
            packetsAllowed: BigInt(0),
            packetsBlocked: BigInt(0),
            packetsInspected: BigInt(0),
            bytesProcessed: BigInt(0),
            currentFlows: 0,
            activeConnections: 0,
            droppedPackets: BigInt(0),
            bufferOverflows: BigInt(0),
            avgProcessingTime: 0,
            cpuUsage: 0,
            memoryUsage: 0
        };
    }

    setVerdictCallback(callback: (packet: Packet) => Promise<Verdict>): void {
        this.verdictCallback = callback;
    }

    getStats(): InterceptorStats {
        return { ...this.stats };
    }

    isRunning(): boolean {
        return this.running;
    }

    protected updateStats(packet: Packet, verdict: Verdict, processingTime: number): void {
        this.stats.packetsProcessed++;
        this.stats.bytesProcessed += BigInt(packet.raw.length);

        switch (verdict) {
            case 'allow':
                this.stats.packetsAllowed++;
                break;
            case 'block':
                this.stats.packetsBlocked++;
                break;
            case 'inspect':
                this.stats.packetsInspected++;
                break;
        }

        const totalTime = this.stats.avgProcessingTime * 
            Number(this.stats.packetsProcessed - BigInt(1)) + processingTime;
        this.stats.avgProcessingTime = totalTime / Number(this.stats.packetsProcessed);
    }
}

export class LinuxCapture extends BaseCapture {
    private xdpAttached: boolean = false;
    private afXdpSocket: any = null;
    private linuxConfig: LinuxConfig | null = null;

    async initialize(config: InterceptorConfig): Promise<void> {
        this.config = config;
        this.linuxConfig = {
            useXDP: true,
            useTC: false,
            xdpMode: 'skb',
            afXdpSocket: true,
            mapSize: 1024
        };

        this.packetBuffer = new RingBuffer({ size: config.bufferSize || 10000 });

        logger.info('Linux capture initialized', {
            useXDP: this.linuxConfig.useXDP,
            xdpMode: this.linuxConfig.xdpMode
        });
    }

    async start(): Promise<void> {
        if (!this.config) {
            throw new Error('Capture not initialized');
        }

        this.running = true;
        logger.info('Linux capture started');

        this.startCaptureLoop();
    }

    private startCaptureLoop(): void {
        const captureLoop = async () => {
            while (this.running) {
                await this.processBatch();
                await this.sleep(1);
            }
        };
        captureLoop();
    }

    private async processBatch(): Promise<void> {
        if (!this.packetBuffer || !this.verdictCallback) return;

        const packets = this.packetBuffer.readBatch(32);
        
        for (const packet of packets) {
            const startTime = Date.now();
            
            try {
                const verdict = await this.verdictCallback(packet);
                this.updateStats(packet, verdict, Date.now() - startTime);
            } catch (error: any) {
                logger.error('Error processing packet', { error: error.message });
            }
        }
    }

    async stop(): Promise<void> {
        this.running = false;
        
        if (this.xdpAttached) {
            await this.detachXDP();
        }

        logger.info('Linux capture stopped');
    }

    private async detachXDP(): Promise<void> {
        this.xdpAttached = false;
        logger.info('XDP program detached');
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    simulatePacket(rawData: Buffer, metadata: Partial<PacketMetadata>): void {
        if (!this.packetBuffer) return;

        const packet = Packet.createFromBuffer(rawData, metadata);
        this.packetBuffer.write(packet);
    }
}

export class WindowsCapture extends BaseCapture {
    private wfpConfig: WindowsConfig | null = null;
    private driverConnected: boolean = false;

    async initialize(config: InterceptorConfig): Promise<void> {
        this.config = config;
        this.wfpConfig = {
            providerGuid: '{D4A8E8A0-9B1C-4D3E-8F2A-5C6D7E8F9A0B}',
            subLayerGuid: '{E5B9F9B1-0C2D-4E4F-9G3B-6D7E8F9A0B1C}',
            calloutGuids: {
                inbound: '{F6C0F0C2-1D3E-5F5G-0H4C-7E8F9A0B1C2D}',
                outbound: '{G7D1G1D3-2E4F-6G6H-1I5D-8F9A0B1C2D3E}',
                connect: '{H8E2H2E4-3F5G-7H7I-2J6E-9A0B1C2D3E4F}',
                accept: '{I9F3I3F5-4G6H-8I8J-3K7F-0B1C2D3E4F5G}'
            },
            filterConditions: []
        };

        this.packetBuffer = new RingBuffer({ size: config.bufferSize || 10000 });

        logger.info('Windows capture initialized (simulation mode)');
    }

    async start(): Promise<void> {
        if (!this.config) {
            throw new Error('Capture not initialized');
        }

        this.running = true;
        logger.info('Windows capture started');

        this.startCaptureLoop();
    }

    private startCaptureLoop(): void {
        const captureLoop = async () => {
            while (this.running) {
                await this.processBatch();
                await this.sleep(1);
            }
        };
        captureLoop();
    }

    private async processBatch(): Promise<void> {
        if (!this.packetBuffer || !this.verdictCallback) return;

        const packets = this.packetBuffer.readBatch(32);
        
        for (const packet of packets) {
            const startTime = Date.now();
            
            try {
                const verdict = await this.verdictCallback(packet);
                this.updateStats(packet, verdict, Date.now() - startTime);
            } catch (error: any) {
                logger.error('Error processing packet', { error: error.message });
            }
        }
    }

    async stop(): Promise<void> {
        this.running = false;
        logger.info('Windows capture stopped');
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    simulatePacket(rawData: Buffer, metadata: Partial<PacketMetadata>): void {
        if (!this.packetBuffer) return;

        const packet = Packet.createFromBuffer(rawData, metadata);
        this.packetBuffer.write(packet);
    }
}

export class MacOSCapture extends BaseCapture {
    async initialize(config: InterceptorConfig): Promise<void> {
        this.config = config;
        this.packetBuffer = new RingBuffer({ size: config.bufferSize || 10000 });
        logger.info('macOS capture initialized (simulation mode)');
    }

    async start(): Promise<void> {
        this.running = true;
        logger.info('macOS capture started');
    }

    async stop(): Promise<void> {
        this.running = false;
        logger.info('macOS capture stopped');
    }

    simulatePacket(rawData: Buffer, metadata: Partial<PacketMetadata>): void {
        if (!this.packetBuffer) return;

        const packet = Packet.createFromBuffer(rawData, metadata);
        this.packetBuffer.write(packet);
    }
}

export function createCaptureInterface(platform: Platform): TrafficCaptureInterface {
    switch (platform) {
        case 'linux':
            return new LinuxCapture();
        case 'windows':
            return new WindowsCapture();
        case 'macos':
            return new MacOSCapture();
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
}

export { detectPlatform } from './types';
