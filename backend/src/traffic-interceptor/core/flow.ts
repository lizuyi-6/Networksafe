/**
 * Flow Management - Connection tracking and state management
 */

import { uuidv4 } from '../../utils/uuid';
import {
    FlowKey,
    FlowState,
    TCPState,
    FlowStatistics,
    ParsedPacket
} from './types';
import { Packet } from './packet';
import logger from '../../utils/logger';

export class FlowManager {
    private flows: Map<string, FlowState> = new Map();
    private flowByKey: Map<string, string> = new Map();
    private maxFlows: number;
    private flowTimeout: number;
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(maxFlows: number = 100000, flowTimeout: number = 300000) {
        this.maxFlows = maxFlows;
        this.flowTimeout = flowTimeout;
        this.startCleanup();
    }

    private startCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredFlows();
        }, 60000);
        this.cleanupInterval.unref?.();
    }

    getOrCreateFlow(packet: ParsedPacket): FlowState | null {
        if (!packet.ipHeader || !packet.transportHeader) {
            return null;
        }

        const key = this.createFlowKey(packet);
        const keyStr = this.flowKeyToString(key);

        let flowId = this.flowByKey.get(keyStr);
        if (flowId) {
            const flow = this.flows.get(flowId);
            if (flow) {
                this.updateFlow(flow, packet);
                return flow;
            }
        }

        if (this.flows.size >= this.maxFlows) {
            this.evictOldestFlow();
        }

        const newFlow = this.createFlow(key, packet);
        this.flows.set(newFlow.id, newFlow);
        this.flowByKey.set(keyStr, newFlow.id);

        return newFlow;
    }

    private createFlow(key: FlowKey, packet: ParsedPacket): FlowState {
        const now = BigInt(Date.now()) * BigInt(1_000_000);
        
        const flow: FlowState = {
            key,
            id: uuidv4(),
            startTime: now,
            lastActivity: now,
            packetCount: 1,
            byteCount: packet.ipHeader?.totalLength || 0,
            state: this.getInitialState(packet),
            direction: packet.metadata.direction
        };

        if (packet.protocol === 'tcp') {
            const tcp = packet.transportHeader as any;
            if (tcp?.flags?.syn && !tcp?.flags?.ack) {
                flow.direction = 'outbound';
            }
        }

        return flow;
    }

    private updateFlow(flow: FlowState, packet: ParsedPacket): void {
        flow.lastActivity = BigInt(Date.now()) * BigInt(1_000_000);
        flow.packetCount++;
        flow.byteCount += packet.ipHeader?.totalLength || 0;

        if (packet.protocol === 'tcp') {
            this.updateTCPState(flow, packet);
        }
    }

    private createFlowKey(packet: ParsedPacket): FlowKey {
        const ip = packet.ipHeader!;
        const transport = packet.transportHeader as any;

        return {
            sourceIP: ip.sourceIP,
            destIP: ip.destIP,
            sourcePort: transport.sourcePort || 0,
            destPort: transport.destPort || 0,
            protocol: packet.protocol as 'tcp' | 'udp' | 'icmp'
        };
    }

    private flowKeyToString(key: FlowKey): string {
        return `${key.sourceIP}:${key.sourcePort}->${key.destIP}:${key.destPort}:${key.protocol}`;
    }

    private getInitialState(packet: ParsedPacket): TCPState | 'active' {
        if (packet.protocol === 'tcp') {
            const tcp = packet.transportHeader as any;
            if (tcp?.flags?.syn && !tcp?.flags?.ack) {
                return 'syn_sent';
            }
            if (tcp?.flags?.syn && tcp?.flags?.ack) {
                return 'syn_received';
            }
            return 'established';
        }
        return 'active';
    }

    private updateTCPState(flow: FlowState, packet: ParsedPacket): void {
        const tcp = packet.transportHeader as any;
        if (!tcp?.flags) return;

        const currentState = flow.state as TCPState;

        if (tcp.flags.rst) {
            flow.state = 'closed';
            return;
        }

        switch (currentState) {
            case 'syn_sent':
                if (tcp.flags.syn && tcp.flags.ack) {
                    flow.state = 'established';
                }
                break;
            case 'syn_received':
                if (tcp.flags.ack) {
                    flow.state = 'established';
                }
                break;
            case 'established':
                if (tcp.flags.fin) {
                    flow.state = tcp.flags.ack ? 'close_wait' : 'fin_wait_1';
                }
                break;
            case 'fin_wait_1':
                if (tcp.flags.ack) {
                    flow.state = 'fin_wait_2';
                }
                if (tcp.flags.fin) {
                    flow.state = 'closing';
                }
                break;
            case 'fin_wait_2':
                if (tcp.flags.fin) {
                    flow.state = 'time_wait';
                }
                break;
            case 'close_wait':
                if (tcp.flags.fin) {
                    flow.state = 'last_ack';
                }
                break;
            case 'closing':
                if (tcp.flags.ack) {
                    flow.state = 'time_wait';
                }
                break;
            case 'last_ack':
                if (tcp.flags.ack) {
                    flow.state = 'closed';
                }
                break;
        }
    }

    private cleanupExpiredFlows(): void {
        const now = BigInt(Date.now()) * BigInt(1_000_000);
        const expiredFlows: string[] = [];

        for (const [id, flow] of this.flows) {
            const age = Number(now - flow.lastActivity) / 1_000_000;
            const timeout = this.getFlowTimeout(flow);

            if (age > timeout || flow.state === 'closed') {
                expiredFlows.push(id);
            }
        }

        for (const id of expiredFlows) {
            this.removeFlow(id);
        }

        if (expiredFlows.length > 0) {
            logger.debug(`Cleaned up ${expiredFlows.length} expired flows`);
        }
    }

    private getFlowTimeout(flow: FlowState): number {
        const state = flow.state;
        
        if (typeof state === 'string') {
            switch (state) {
                case 'time_wait': return 60000;
                case 'close_wait': return 300000;
                case 'fin_wait_1':
                case 'fin_wait_2': return 120000;
                case 'established': return 86400000;
                default: return this.flowTimeout;
            }
        }
        
        return this.flowTimeout;
    }

    private evictOldestFlow(): void {
        let oldestId: string | null = null;
        let oldestTime = BigInt(Number.MAX_SAFE_INTEGER);

        for (const [id, flow] of this.flows) {
            if (flow.lastActivity < oldestTime) {
                oldestTime = flow.lastActivity;
                oldestId = id;
            }
        }

        if (oldestId) {
            this.removeFlow(oldestId);
            logger.debug(`Evicted oldest flow: ${oldestId}`);
        }
    }

    private removeFlow(flowId: string): void {
        const flow = this.flows.get(flowId);
        if (flow) {
            const keyStr = this.flowKeyToString(flow.key);
            this.flowByKey.delete(keyStr);
            this.flows.delete(flowId);
        }
    }

    getFlow(flowId: string): FlowState | undefined {
        return this.flows.get(flowId);
    }

    getFlowByKey(key: FlowKey): FlowState | undefined {
        const keyStr = this.flowKeyToString(key);
        const flowId = this.flowByKey.get(keyStr);
        return flowId ? this.flows.get(flowId) : undefined;
    }

    getFlowStatistics(flowId: string): FlowStatistics | null {
        const flow = this.flows.get(flowId);
        if (!flow) return null;

        const duration = Number(flow.lastActivity - flow.startTime) / 1_000_000_000;
        const seconds = Math.max(duration, 1);

        return {
            flowId: flow.id,
            duration: seconds,
            packetsPerSecond: flow.packetCount / seconds,
            bytesPerSecond: flow.byteCount / seconds,
            avgPacketSize: flow.byteCount / Math.max(flow.packetCount, 1),
            retransmissions: 0,
            outOfOrder: 0
        };
    }

    getAllFlows(): FlowState[] {
        return Array.from(this.flows.values());
    }

    getActiveFlowCount(): number {
        return this.flows.size;
    }

    getFlowsByIP(ip: string): FlowState[] {
        return Array.from(this.flows.values()).filter(
            f => f.key.sourceIP === ip || f.key.destIP === ip
        );
    }

    getFlowsByState(state: TCPState | 'active'): FlowState[] {
        return Array.from(this.flows.values()).filter(f => f.state === state);
    }

    shutdown(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.flows.clear();
        this.flowByKey.clear();
        logger.info('Flow manager shutdown complete');
    }

    getStats(): {
        totalFlows: number;
        tcpFlows: number;
        udpFlows: number;
        establishedFlows: number;
        closingFlows: number;
    } {
        let tcpFlows = 0;
        let udpFlows = 0;
        let establishedFlows = 0;
        let closingFlows = 0;

        for (const flow of this.flows.values()) {
            if (flow.key.protocol === 'tcp') {
                tcpFlows++;
                const state = flow.state as TCPState;
                if (state === 'established') establishedFlows++;
                if (['fin_wait_1', 'fin_wait_2', 'close_wait', 'closing', 'last_ack', 'time_wait'].includes(state)) {
                    closingFlows++;
                }
            } else if (flow.key.protocol === 'udp') {
                udpFlows++;
            }
        }

        return {
            totalFlows: this.flows.size,
            tcpFlows,
            udpFlows,
            establishedFlows,
            closingFlows
        };
    }
}

export default FlowManager;
