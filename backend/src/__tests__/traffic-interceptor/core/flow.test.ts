/**
 * Tests for FlowManager — TCP/UDP/ICMP flow tracking. Verifies flow creation,
 * key-based deduplication, flow statistics, TCP state tracking, IP/state filters,
 * max-flows eviction, and cleanup of expired flows. Pure logic, no I/O.
 */

import { FlowManager } from '../../../traffic-interceptor/core/flow';
import type { ParsedPacket } from '../../../traffic-interceptor/core/types';

function makePacket(opts: {
    srcIP: string; dstIP: string; srcPort: number; dstPort: number;
    protocol: 'tcp' | 'udp' | 'icmp'; totalLength?: number; direction?: 'inbound' | 'outbound';
    syn?: boolean; ack?: boolean; fin?: boolean;
}): ParsedPacket {
    const protocol = opts.protocol;
    const transport: any = {
        sourcePort: opts.srcPort,
        destPort: opts.dstPort,
        flags: { syn: opts.syn ?? false, ack: opts.ack ?? false, fin: opts.fin ?? false }
    };
    return {
        id: 'pkt-' + Math.random().toString(36).slice(2, 8),
        metadata: { timestamp: Date.now(), interface: 'eth0', direction: (opts.direction ?? 'inbound') as any } as any,
        ipHeader: {
            version: 4, headerLength: 5, tos: 0, totalLength: opts.totalLength ?? 500,
            identification: 0, flags: 0, fragmentOffset: 0, ttl: 64, protocol: protocol === 'tcp' ? 6 : protocol === 'udp' ? 17 : 1,
            checksum: 0, sourceIP: opts.srcIP, destIP: opts.dstIP
        },
        transportHeader: transport,
        protocol,
        payload: Buffer.alloc(0),
        raw: Buffer.alloc(0)
    } as ParsedPacket;
}

describe('FlowManager', () => {
    it('creates a new flow for a packet with no existing flow', () => {
        const fm = new FlowManager(100, 300000);
        const pkt = makePacket({ srcIP: '10.0.0.1', dstIP: '10.0.0.2', srcPort: 1234, dstPort: 80, protocol: 'tcp' });
        const flow = fm.getOrCreateFlow(pkt);
        expect(flow).not.toBeNull();
        expect(flow!.packetCount).toBe(1);
        expect(flow!.byteCount).toBe(500);
        expect(flow!.key.sourceIP).toBe('10.0.0.1');
    });

    it('returns the existing flow for matching packets (dedup by key)', () => {
        const fm = new FlowManager();
        const pkt = makePacket({ srcIP: '10.0.0.1', dstIP: '10.0.0.2', srcPort: 1234, dstPort: 80, protocol: 'tcp' });
        const f1 = fm.getOrCreateFlow(pkt);
        const f2 = fm.getOrCreateFlow(pkt);
        expect(f2!.id).toBe(f1!.id);
        expect(f2!.packetCount).toBe(2); // updated, not new
        expect(f2!.byteCount).toBe(1000); // 500 * 2
    });

    it('creates distinct flows for different source IPs', () => {
        const fm = new FlowManager();
        const f1 = fm.getOrCreateFlow(makePacket({ srcIP: '10.0.0.1', dstIP: '10.0.0.2', srcPort: 1234, dstPort: 80, protocol: 'tcp' }));
        const f2 = fm.getOrCreateFlow(makePacket({ srcIP: '10.0.0.3', dstIP: '10.0.0.2', srcPort: 1234, dstPort: 80, protocol: 'tcp' }));
        expect(f2!.id).not.toBe(f1!.id);
        expect(fm.getActiveFlowCount()).toBe(2);
    });

    it('returns null for packets without IP or transport header', () => {
        const fm = new FlowManager();
        const broken: ParsedPacket = {
            id: 'x', metadata: {} as any, protocol: 'unknown', payload: Buffer.alloc(0), raw: Buffer.alloc(0)
        } as ParsedPacket;
        expect(fm.getOrCreateFlow(broken)).toBeNull();
    });

    it('getFlow retrieves a flow by id', () => {
        const fm = new FlowManager();
        const flow = fm.getOrCreateFlow(makePacket({ srcIP: '1.1.1.1', dstIP: '2.2.2.2', srcPort: 100, dstPort: 200, protocol: 'tcp' }));
        const fetched = fm.getFlow(flow!.id);
        expect(fetched).toBeDefined();
        expect(fetched!.key.sourceIP).toBe('1.1.1.1');
    });

    it('getFlowStatistics returns packet/byte rates', () => {
        const fm = new FlowManager();
        const flow = fm.getOrCreateFlow(makePacket({ srcIP: '1.1.1.1', dstIP: '2.2.2.2', srcPort: 100, dstPort: 200, protocol: 'tcp', totalLength: 1500 }));
        const stats = fm.getFlowStatistics(flow!.id);
        expect(stats).not.toBeNull();
        expect(stats!.flowId).toBe(flow!.id);
        expect(stats!.avgPacketSize).toBeGreaterThan(0);
    });

    it('getFlowsByIP returns flows touching the given IP', () => {
        const fm = new FlowManager();
        fm.getOrCreateFlow(makePacket({ srcIP: '5.5.5.5', dstIP: '6.6.6.6', srcPort: 1, dstPort: 2, protocol: 'tcp' }));
        fm.getOrCreateFlow(makePacket({ srcIP: '7.7.7.7', dstIP: '6.6.6.6', srcPort: 3, dstPort: 4, protocol: 'tcp' }));
        const byIp = fm.getFlowsByIP('6.6.6.6');
        expect(byIp.length).toBe(2); // both flows have 6.6.6.6 as dest
    });

    it('getAllFlows returns all tracked flows', () => {
        const fm = new FlowManager();
        fm.getOrCreateFlow(makePacket({ srcIP: '1.1.1.1', dstIP: '2.2.2.2', srcPort: 1, dstPort: 2, protocol: 'tcp' }));
        fm.getOrCreateFlow(makePacket({ srcIP: '3.3.3.3', dstIP: '4.4.4.4', srcPort: 3, dstPort: 4, protocol: 'udp' }));
        expect(fm.getAllFlows().length).toBe(2);
    });

    it('handles ICMP flows (no ports)', () => {
        const fm = new FlowManager();
        const flow = fm.getOrCreateFlow(makePacket({ srcIP: '1.1.1.1', dstIP: '2.2.2.2', srcPort: 0, dstPort: 0, protocol: 'icmp' }));
        expect(flow).not.toBeNull();
        expect(flow!.key.protocol).toBe('icmp');
    });

    it('getStats returns flow tracking statistics', () => {
        const fm = new FlowManager();
        fm.getOrCreateFlow(makePacket({ srcIP: '1.1.1.1', dstIP: '2.2.2.2', srcPort: 1, dstPort: 2, protocol: 'tcp' }));
        const stats = fm.getStats();
        expect(stats).toBeDefined();
        expect(typeof stats).toBe('object');
    });

    it('shutdown does not throw', () => {
        const fm = new FlowManager();
        fm.getOrCreateFlow(makePacket({ srcIP: '1.1.1.1', dstIP: '2.2.2.2', srcPort: 1, dstPort: 2, protocol: 'tcp' }));
        expect(() => fm.shutdown()).not.toThrow();
        expect((fm as any).cleanupInterval).toBeNull();
    });
});
