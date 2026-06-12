/**
 * Packet Abstraction - Zero-copy packet handling
 */

import { uuidv4 } from '../../utils/uuid';
import {
    PacketMetadata,
    IPHeader,
    TCPHeader,
    UDPHeader,
    ICMPHeader,
    ParsedPacket,
    ApplicationLayerData
} from './types';

const PROTOCOL_TCP = 6;
const PROTOCOL_UDP = 17;
const PROTOCOL_ICMP = 1;

export class Packet {
    private _raw: Buffer;
    private _metadata: PacketMetadata;
    private _id: string;
    private _parsed: ParsedPacket | null = null;
    private _refCount: number = 1;

    constructor(raw: Buffer, metadata: PacketMetadata) {
        this._raw = raw;
        this._metadata = metadata;
        this._id = uuidv4();
    }

    get id(): string {
        return this._id;
    }

    get raw(): Buffer {
        return this._raw;
    }

    get metadata(): PacketMetadata {
        return this._metadata;
    }

    get parsed(): ParsedPacket {
        if (!this._parsed) {
            this._parsed = this.parse();
        }
        return this._parsed;
    }

    retain(): void {
        this._refCount++;
    }

    release(): boolean {
        this._refCount--;
        return this._refCount <= 0;
    }

    private parse(): ParsedPacket {
        const result: ParsedPacket = {
            id: this._id,
            metadata: this._metadata,
            protocol: 'unknown',
            payload: Buffer.alloc(0),
            raw: this._raw
        };

        if (this._raw.length < 20) {
            return result;
        }

        const ipHeader = this.parseIPHeader();
        if (!ipHeader) {
            return result;
        }
        result.ipHeader = ipHeader;

        const ipHeaderOffset = ipHeader.headerLength * 4;
        const transportData = this._raw.subarray(ipHeaderOffset);

        switch (ipHeader.protocol) {
            case PROTOCOL_TCP:
                result.protocol = 'tcp';
                result.transportHeader = this.parseTCPHeader(transportData);
                result.payload = this.extractTCPPayload(transportData, result.transportHeader);
                break;
            case PROTOCOL_UDP:
                result.protocol = 'udp';
                result.transportHeader = this.parseUDPHeader(transportData);
                result.payload = this.extractUDPPayload(transportData);
                break;
            case PROTOCOL_ICMP:
                result.protocol = 'icmp';
                result.transportHeader = this.parseICMPHeader(transportData);
                result.payload = transportData.subarray(8);
                break;
        }

        if (result.payload.length > 0) {
            result.applicationLayer = this.parseApplicationLayer(result);
        }

        return result;
    }

    private parseIPHeader(): IPHeader | null {
        if (this._raw.length < 20) return null;

        const version = (this._raw[0] >> 4) & 0x0F;
        if (version !== 4) return null;

        const headerLength = this._raw[0] & 0x0F;
        const totalLength = this._raw.readUInt16BE(2);
        const identification = this._raw.readUInt16BE(4);
        const flagsAndFragment = this._raw.readUInt16BE(6);
        const flags = (flagsAndFragment >> 13) & 0x07;
        const fragmentOffset = flagsAndFragment & 0x1FFF;
        const ttl = this._raw[8];
        const protocol = this._raw[9];
        const checksum = this._raw.readUInt16BE(10);

        const sourceIP = `${this._raw[12]}.${this._raw[13]}.${this._raw[14]}.${this._raw[15]}`;
        const destIP = `${this._raw[16]}.${this._raw[17]}.${this._raw[18]}.${this._raw[19]}`;

        return {
            version,
            headerLength,
            tos: this._raw[1],
            totalLength,
            identification,
            flags,
            fragmentOffset,
            ttl,
            protocol,
            checksum,
            sourceIP,
            destIP
        };
    }

    private parseTCPHeader(data: Buffer): TCPHeader {
        const sourcePort = data.readUInt16BE(0);
        const destPort = data.readUInt16BE(2);
        const seqNumber = data.readUInt32BE(4);
        const ackNumber = data.readUInt32BE(8);
        const dataOffset = (data[12] >> 4) & 0x0F;
        const flagsByte = data[13];
        const window = data.readUInt16BE(14);
        const checksum = data.readUInt16BE(16);
        const urgentPointer = data.readUInt16BE(18);

        return {
            sourcePort,
            destPort,
            seqNumber,
            ackNumber,
            dataOffset,
            flags: {
                fin: (flagsByte & 0x01) !== 0,
                syn: (flagsByte & 0x02) !== 0,
                rst: (flagsByte & 0x04) !== 0,
                psh: (flagsByte & 0x08) !== 0,
                ack: (flagsByte & 0x10) !== 0,
                urg: (flagsByte & 0x20) !== 0,
                ece: (flagsByte & 0x40) !== 0,
                cwr: (flagsByte & 0x80) !== 0
            },
            window,
            checksum,
            urgentPointer
        };
    }

    private parseUDPHeader(data: Buffer): UDPHeader {
        return {
            sourcePort: data.readUInt16BE(0),
            destPort: data.readUInt16BE(2),
            length: data.readUInt16BE(4),
            checksum: data.readUInt16BE(6)
        };
    }

    private parseICMPHeader(data: Buffer): ICMPHeader {
        return {
            type: data[0],
            code: data[1],
            checksum: data.readUInt16BE(2),
            restOfHeader: data.readUInt32BE(4)
        };
    }

    private extractTCPPayload(data: Buffer, header: TCPHeader): Buffer {
        const headerOffset = header.dataOffset * 4;
        if (data.length <= headerOffset) {
            return Buffer.alloc(0);
        }
        return data.subarray(headerOffset);
    }

    private extractUDPPayload(data: Buffer): Buffer {
        if (data.length <= 8) {
            return Buffer.alloc(0);
        }
        return data.subarray(8);
    }

    private parseApplicationLayer(packet: ParsedPacket): ApplicationLayerData | undefined {
        const payload = packet.payload;
        if (payload.length === 0) return undefined;

        const tcpHeader = packet.transportHeader as TCPHeader | undefined;
        const destPort = tcpHeader?.destPort || (packet.transportHeader as UDPHeader)?.destPort;
        const sourcePort = tcpHeader?.sourcePort || (packet.transportHeader as UDPHeader)?.sourcePort;

        if (destPort === 80 || sourcePort === 80 || destPort === 8080 || sourcePort === 8080) {
            return this.parseHTTP(payload);
        }

        if (destPort === 443 || sourcePort === 443) {
            return this.parseTLS(payload);
        }

        if (destPort === 53 || sourcePort === 53) {
            return this.parseDNS(payload);
        }

        return {
            protocol: 'unknown',
            data: payload
        };
    }

    private parseHTTP(payload: Buffer): ApplicationLayerData {
        const headerEnd = this.findHeaderEnd(payload);
        const headerPart = headerEnd !== -1 ? payload.subarray(0, headerEnd) : payload;
        const headerStr = headerPart.toString('utf-8');

        const lines = headerStr.split('\r\n');
        const firstLine = lines[0] || '';
        const [method, path, version] = firstLine.split(' ');

        const headers: Record<string, string> = {};
        for (let i = 1; i < lines.length; i++) {
            const colonIndex = lines[i].indexOf(':');
            if (colonIndex !== -1) {
                const key = lines[i].substring(0, colonIndex).trim().toLowerCase();
                const value = lines[i].substring(colonIndex + 1).trim();
                headers[key] = value;
            }
        }

        const body = headerEnd !== -1 ? payload.subarray(headerEnd + 4) : Buffer.alloc(0);

        return {
            protocol: 'http',
            data: payload,
            parsed: {
                method: method || '',
                path: path || '',
                version: version || '',
                headers,
                body: body.length > 0 ? body : undefined
            }
        };
    }

    private parseTLS(payload: Buffer): ApplicationLayerData {
        if (payload.length < 5) {
            return { protocol: 'tls', data: payload };
        }

        const contentType = payload[0];
        const version = `${payload[1]}.${payload[2]}`;
        const length = payload.readUInt16BE(3);

        return {
            protocol: 'tls',
            data: payload.subarray(0, 5 + length),
            parsed: {
                version,
                random: payload.subarray(5, 37),
                sessionId: payload.subarray(37, 69),
                cipherSuites: [],
                extensions: []
            }
        };
    }

    private parseDNS(payload: Buffer): ApplicationLayerData {
        if (payload.length < 12) {
            return { protocol: 'dns', data: payload };
        }

        const transactionId = payload.readUInt16BE(0);
        const flags = payload.readUInt16BE(2);

        return {
            protocol: 'dns',
            data: payload,
            parsed: {
                transactionId,
                flags,
                questions: [],
                answers: []
            }
        };
    }

    private findHeaderEnd(data: Buffer): number {
        for (let i = 0; i < data.length - 3; i++) {
            if (data[i] === 0x0D && data[i + 1] === 0x0A && 
                data[i + 2] === 0x0D && data[i + 3] === 0x0A) {
                return i;
            }
        }
        return -1;
    }

    static createFromBuffer(raw: Buffer, metadata: Partial<PacketMetadata>): Packet {
        const fullMetadata: PacketMetadata = {
            timestamp: metadata.timestamp || BigInt(Date.now()) * BigInt(1_000_000),
            interfaceIndex: metadata.interfaceIndex || 0,
            packetLength: metadata.packetLength || raw.length,
            capturedLength: metadata.capturedLength || raw.length,
            direction: metadata.direction || 'inbound',
            queueId: metadata.queueId,
            cpuId: metadata.cpuId
        };
        return new Packet(raw, fullMetadata);
    }
}

export class PacketPool {
    private pool: Packet[] = [];
    private maxSize: number;
    private allocated: number = 0;

    constructor(maxSize: number = 10000) {
        this.maxSize = maxSize;
    }

    acquire(raw: Buffer, metadata: PacketMetadata): Packet {
        let packet = this.pool.pop();
        if (packet) {
            return new Packet(raw, metadata);
        }
        this.allocated++;
        return new Packet(raw, metadata);
    }

    release(packet: Packet): void {
        if (this.pool.length < this.maxSize && packet.release()) {
            this.pool.push(packet);
        }
    }

    getStats(): { pooled: number; allocated: number; maxSize: number } {
        return {
            pooled: this.pool.length,
            allocated: this.allocated,
            maxSize: this.maxSize
        };
    }

    clear(): void {
        this.pool = [];
    }
}

export default Packet;
