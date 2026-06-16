/**
 * Tests for the Packet class — zero-copy IPv4/TCP/UDP/ICMP header parsing.
 * Constructs raw binary buffers matching the wire format and asserts the parser
 * extracts the correct fields. Pure logic, no DB/network dependency.
 */

import { Packet } from '../../../traffic-interceptor/core/packet';

function buildIPv4TCP(opts: {
    srcIP?: [number, number, number, number];
    dstIP?: [number, number, number, number];
    srcPort?: number;
    dstPort?: number;
    protocol?: number;
    ttl?: number;
    payload?: Buffer;
}): Buffer {
    const srcIP = opts.srcIP ?? [192, 168, 1, 1];
    const dstIP = opts.dstIP ?? [10, 0, 0, 1];
    const srcPort = opts.srcPort ?? 12345;
    const dstPort = opts.dstPort ?? 80;
    const protocol = opts.protocol ?? 6; // TCP
    const ttl = opts.ttl ?? 64;
    const payload = opts.payload ?? Buffer.from('GET / HTTP/1.1\r\n');
    const ihl = 5; // 20 bytes, no options

    const ipHeader = Buffer.alloc(20);
    ipHeader[0] = (4 << 4) | ihl; // version 4, IHL 5
    ipHeader[1] = 0; // TOS
    ipHeader.writeUInt16BE(20 + 20 + payload.length, 2); // total length
    ipHeader.writeUInt16BE(0x1234, 4); // identification
    ipHeader.writeUInt16BE(0x4000, 6); // flags=DF
    ipHeader[8] = ttl;
    ipHeader[9] = protocol;
    ipHeader.writeUInt16BE(0, 10); // checksum (not validated)
    ipHeader[12] = srcIP[0]; ipHeader[13] = srcIP[1]; ipHeader[14] = srcIP[2]; ipHeader[15] = srcIP[3];
    ipHeader[16] = dstIP[0]; ipHeader[17] = dstIP[1]; ipHeader[18] = dstIP[2]; ipHeader[19] = dstIP[3];

    const tcpHeader = Buffer.alloc(20);
    tcpHeader.writeUInt16BE(srcPort, 0);
    tcpHeader.writeUInt16BE(dstPort, 2);
    tcpHeader.writeUInt32BE(1000, 4); // seq
    tcpHeader.writeUInt32BE(0, 8); // ack
    tcpHeader[12] = (5 << 4); // data offset 5 (20 bytes)

    return Buffer.concat([ipHeader, tcpHeader, payload]);
}

function buildIPv4UDP(srcPort: number, dstPort: number, payload: Buffer): Buffer {
    const ipHeader = Buffer.alloc(20);
    ipHeader[0] = (4 << 4) | 5;
    ipHeader.writeUInt16BE(20 + 8 + payload.length, 2);
    ipHeader[9] = 17; // UDP
    const udpHeader = Buffer.alloc(8);
    udpHeader.writeUInt16BE(srcPort, 0);
    udpHeader.writeUInt16BE(dstPort, 2);
    udpHeader.writeUInt16BE(8 + payload.length, 4); // UDP length
    return Buffer.concat([ipHeader, udpHeader, payload]);
}

describe('Packet parsing', () => {
    const meta = { timestamp: Date.now(), interface: 'eth0', direction: 'ingress' as const };

    it('parses an IPv4+TCP packet (IP header fields + ports)', () => {
        const buf = buildIPv4TCP({ srcIP: [192, 168, 1, 100], dstIP: [10, 0, 0, 5], srcPort: 54321, dstPort: 443 });
        const pkt = new Packet(buf, meta as any);
        const parsed = pkt.parsed;

        expect(parsed.protocol).toBe('tcp');
        expect(parsed.ipHeader?.sourceIP).toBe('192.168.1.100');
        expect(parsed.ipHeader?.destIP).toBe('10.0.0.5');
        expect(parsed.ipHeader?.ttl).toBe(64);
        expect(parsed.ipHeader?.headerLength).toBe(5);
        expect(parsed.transportHeader).toBeDefined();
        expect((parsed.transportHeader as any).sourcePort).toBe(54321);
        expect((parsed.transportHeader as any).destPort).toBe(443);
    });

    it('parses an IPv4+UDP packet', () => {
        const payload = Buffer.from('query');
        const buf = buildIPv4UDP(5353, 5353, payload);
        const pkt = new Packet(buf, meta as any);
        const parsed = pkt.parsed;

        expect(parsed.protocol).toBe('udp');
        expect(parsed.transportHeader).toBeDefined();
        expect((parsed.transportHeader as any).sourcePort).toBe(5353);
        expect((parsed.transportHeader as any).destPort).toBe(5353);
    });

    it('parses an IPv4+ICMP packet', () => {
        const ipHeader = Buffer.alloc(20);
        ipHeader[0] = (4 << 4) | 5;
        ipHeader[9] = 1; // ICMP
        const icmpHeader = Buffer.alloc(8); // type 0 (echo reply)
        const buf = Buffer.concat([ipHeader, icmpHeader]);
        const pkt = new Packet(buf, meta as any);
        expect(pkt.parsed.protocol).toBe('icmp');
        expect(pkt.parsed.transportHeader).toBeDefined();
    });

    it('returns protocol "unknown" for an unrecognized protocol number', () => {
        const buf = buildIPv4TCP({ protocol: 132 }); // SCTP
        const pkt = new Packet(buf, meta as any);
        expect(pkt.parsed.protocol).toBe('unknown');
    });

    it('returns protocol "unknown" for a too-short packet (< 20 bytes)', () => {
        const pkt = new Packet(Buffer.from([1, 2, 3]), meta as any);
        expect(pkt.parsed.protocol).toBe('unknown');
        expect(pkt.parsed.ipHeader).toBeUndefined();
    });

    it('returns null IP header for non-IPv4 packet', () => {
        const buf = Buffer.alloc(40, 0);
        buf[0] = (6 << 4); // version 6 (IPv6)
        const pkt = new Packet(buf, meta as any);
        expect(pkt.parsed.protocol).toBe('unknown');
        expect(pkt.parsed.ipHeader).toBeUndefined();
    });

    it('caches the parsed result (parsed getter is idempotent)', () => {
        const buf = buildIPv4TCP({});
        const pkt = new Packet(buf, meta as any);
        const first = pkt.parsed;
        const second = pkt.parsed;
        expect(second).toBe(first); // same reference (cached)
    });

    it('retain/release tracks reference count', () => {
        const buf = buildIPv4TCP({});
        const pkt = new Packet(buf, meta as any);
        pkt.retain();
        expect(pkt.release()).toBe(false); // ref count now 1
        expect(pkt.release()).toBe(true);  // ref count now 0 -> released
    });

    it('assigns a unique id per packet', () => {
        const buf = buildIPv4TCP({});
        const a = new Packet(buf, meta as any);
        const b = new Packet(buf, meta as any);
        expect(a.id).not.toBe(b.id);
        expect(a.id).toMatch(/^[0-9a-f-]+$/);
    });

    it('exposes raw buffer and metadata', () => {
        const buf = buildIPv4TCP({});
        const pkt = new Packet(buf, meta as any);
        expect(pkt.raw).toBe(buf);
        expect(pkt.metadata.interface).toBe('eth0');
    });
});
