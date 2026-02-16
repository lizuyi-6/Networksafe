/**
 * Ring Buffer - Lock-free ring buffer for high-performance packet processing
 */

import {
    RingBufferConfig,
    BufferSlice
} from '../core/types';
import logger from '../../utils/logger';

export class RingBuffer<T> {
    private buffer: Array<T | null>;
    private mask: number;
    private head: number = 0;
    private tail: number = 0;
    private capacity: number;
    private batchSize: number;
    private stats = {
        totalWritten: 0,
        totalRead: 0,
        overflows: 0,
        underflows: 0
    };

    constructor(config: Partial<RingBufferConfig> & { size: number }) {
        this.capacity = this.nextPowerOf2(config.size);
        this.mask = this.capacity - 1;
        this.buffer = new Array(this.capacity).fill(null);
        this.batchSize = config.batchSize || 32;
    }

    private nextPowerOf2(n: number): number {
        let power = 1;
        while (power < n) {
            power *= 2;
        }
        return power;
    }

    write(item: T): boolean {
        const nextHead = (this.head + 1) & this.mask;
        
        if (nextHead === this.tail) {
            this.stats.overflows++;
            return false;
        }

        this.buffer[this.head] = item;
        this.head = nextHead;
        this.stats.totalWritten++;
        return true;
    }

    writeBatch(items: T[]): number {
        const available = this.availableWriteSpace();
        const toWrite = Math.min(items.length, available);

        for (let i = 0; i < toWrite; i++) {
            this.buffer[this.head] = items[i];
            this.head = (this.head + 1) & this.mask;
        }

        this.stats.totalWritten += toWrite;
        
        if (toWrite < items.length) {
            this.stats.overflows++;
        }

        return toWrite;
    }

    read(): T | null {
        if (this.tail === this.head) {
            this.stats.underflows++;
            return null;
        }

        const item = this.buffer[this.tail];
        this.buffer[this.tail] = null;
        this.tail = (this.tail + 1) & this.mask;
        this.stats.totalRead++;
        return item;
    }

    readBatch(maxItems: number = this.batchSize): T[] {
        const items: T[] = [];
        const available = this.availableReadSpace();
        const toRead = Math.min(maxItems, available);

        for (let i = 0; i < toRead; i++) {
            const item = this.buffer[this.tail];
            if (item !== null) {
                items.push(item);
            }
            this.buffer[this.tail] = null;
            this.tail = (this.tail + 1) & this.mask;
        }

        this.stats.totalRead += toRead;
        return items;
    }

    peek(): T | null {
        if (this.tail === this.head) {
            return null;
        }
        return this.buffer[this.tail];
    }

    skip(count: number): number {
        const available = this.availableReadSpace();
        const toSkip = Math.min(count, available);

        for (let i = 0; i < toSkip; i++) {
            this.buffer[this.tail] = null;
            this.tail = (this.tail + 1) & this.mask;
        }

        return toSkip;
    }

    availableWriteSpace(): number {
        return (this.tail - this.head - 1 + this.capacity) & this.mask;
    }

    availableReadSpace(): number {
        return (this.head - this.tail) & this.mask;
    }

    isEmpty(): boolean {
        return this.head === this.tail;
    }

    isFull(): boolean {
        return ((this.head + 1) & this.mask) === this.tail;
    }

    size(): number {
        return this.availableReadSpace();
    }

    getCapacity(): number {
        return this.capacity - 1;
    }

    getUsagePercent(): number {
        return (this.size() / this.getCapacity()) * 100;
    }

    getStats(): typeof this.stats & { usage: number } {
        return {
            ...this.stats,
            usage: this.getUsagePercent()
        };
    }

    clear(): void {
        this.buffer.fill(null);
        this.head = 0;
        this.tail = 0;
    }
}

export class PacketRingBuffer {
    private buffer: Buffer;
    private descriptors: Array<{ offset: number; length: number; valid: boolean }>;
    private mask: number;
    private head: number = 0;
    private tail: number = 0;
    private chunkSize: number;
    private totalChunks: number;

    constructor(totalSize: number, chunkSize: number = 2048) {
        this.chunkSize = chunkSize;
        this.totalChunks = Math.floor(totalSize / chunkSize);
        this.mask = this.totalChunks - 1;
        
        if (!Number.isInteger(Math.log2(this.totalChunks))) {
            const power = Math.pow(2, Math.ceil(Math.log2(this.totalChunks)));
            this.totalChunks = power;
            this.mask = power - 1;
        }

        this.buffer = Buffer.allocUnsafe(this.totalChunks * this.chunkSize);
        this.descriptors = new Array(this.totalChunks).fill(null).map(() => ({
            offset: 0,
            length: 0,
            valid: false
        }));
    }

    write(packet: Buffer): boolean {
        const nextHead = (this.head + 1) & this.mask;
        
        if (nextHead === this.tail) {
            return false;
        }

        if (packet.length > this.chunkSize) {
            return false;
        }

        const offset = this.head * this.chunkSize;
        packet.copy(this.buffer, offset, 0, packet.length);

        this.descriptors[this.head] = {
            offset,
            length: packet.length,
            valid: true
        };

        this.head = nextHead;
        return true;
    }

    read(): Buffer | null {
        if (this.tail === this.head) {
            return null;
        }

        const desc = this.descriptors[this.tail];
        if (!desc.valid) {
            return null;
        }

        const packet = this.buffer.subarray(desc.offset, desc.offset + desc.length);
        const copy = Buffer.from(packet);

        desc.valid = false;
        desc.length = 0;

        this.tail = (this.tail + 1) & this.mask;
        return copy;
    }

    readRef(): { data: Buffer; length: number } | null {
        if (this.tail === this.head) {
            return null;
        }

        const desc = this.descriptors[this.tail];
        if (!desc.valid) {
            return null;
        }

        return {
            data: this.buffer.subarray(desc.offset, desc.offset + desc.length),
            length: desc.length
        };
    }

    release(): void {
        if (this.tail === this.head) {
            return;
        }

        const desc = this.descriptors[this.tail];
        desc.valid = false;
        desc.length = 0;
        this.tail = (this.tail + 1) & this.mask;
    }

    availableWriteSpace(): number {
        return (this.tail - this.head - 1 + this.totalChunks) & this.mask;
    }

    availableReadSpace(): number {
        return (this.head - this.tail) & this.mask;
    }

    getStats(): {
        totalChunks: number;
        usedChunks: number;
        chunkSize: number;
        bufferSize: number;
    } {
        return {
            totalChunks: this.totalChunks,
            usedChunks: this.availableReadSpace(),
            chunkSize: this.chunkSize,
            bufferSize: this.buffer.length
        };
    }
}

export class MultiProducerRingBuffer<T> {
    private buffer: Array<T | null>;
    private mask: number;
    private head: number = 0;
    private tails: number[];
    private numProducers: number;

    constructor(size: number, numProducers: number) {
        const capacity = Math.pow(2, Math.ceil(Math.log2(size)));
        this.mask = capacity - 1;
        this.buffer = new Array(capacity).fill(null);
        this.numProducers = numProducers;
        this.tails = new Array(numProducers).fill(0);
    }

    write(producerId: number, item: T): boolean {
        if (producerId < 0 || producerId >= this.numProducers) {
            return false;
        }

        const tail = this.tails[producerId];
        const nextTail = (tail + 1) & this.mask;

        if (nextTail === this.head) {
            return false;
        }

        this.buffer[tail] = item;
        this.tails[producerId] = nextTail;
        return true;
    }

    read(): T | null {
        let minTail = this.tails[0];
        for (let i = 1; i < this.numProducers; i++) {
            const diff = (this.tails[i] - minTail + this.mask + 1) & this.mask;
            if (diff > 0 && this.tails[i] < minTail) {
                minTail = this.tails[i];
            }
        }

        if (this.head === minTail) {
            return null;
        }

        const item = this.buffer[this.head];
        this.buffer[this.head] = null;
        this.head = (this.head + 1) & this.mask;
        return item;
    }

    availableReadSpace(): number {
        let minTail = this.tails[0];
        for (let i = 1; i < this.numProducers; i++) {
            const diff = (this.tails[i] - minTail + this.mask + 1) & this.mask;
            if (diff > 0 && this.tails[i] < minTail) {
                minTail = this.tails[i];
            }
        }
        return (minTail - this.head) & this.mask;
    }
}

export default RingBuffer;
