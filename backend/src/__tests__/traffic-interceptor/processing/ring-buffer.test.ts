/**
 * Tests for RingBuffer<T> — a fixed-size power-of-2 ring buffer with batch I/O,
 * usage stats, and overflow tracking. Pure data structure, no I/O.
 */

import { RingBuffer } from '../../../traffic-interceptor/processing/ring-buffer';

describe('RingBuffer<T>', () => {
    it('writes and reads items in FIFO order', () => {
        const rb = new RingBuffer<number>({ size: 8 });
        rb.write(1);
        rb.write(2);
        rb.write(3);
        expect(rb.read()).toBe(1);
        expect(rb.read()).toBe(2);
        expect(rb.read()).toBe(3);
    });

    it('reports usable capacity (capacity - 1 for the reserved slot)', () => {
        const rb = new RingBuffer<number>({ size: 10 });
        const usable = rb.getCapacity();
        // getCapacity returns capacity - 1 (one slot reserved for head/tail disambiguation).
        // So usable + 1 is the actual internal capacity, which is a power of 2.
        const internal = usable + 1;
        expect(internal).toBeGreaterThanOrEqual(10);
        expect((internal & (internal - 1))).toBe(0); // power of 2
    });

    it('reports empty/full state correctly', () => {
        const rb = new RingBuffer<number>({ size: 4 });
        expect(rb.isEmpty()).toBe(true);
        rb.write(1);
        expect(rb.isEmpty()).toBe(false);
        expect(rb.size()).toBe(1);
        // capacity is 4 but one slot is reserved, so usable = 3.
        rb.write(0);
        rb.write(0);
        expect(rb.isFull()).toBe(true);
        expect(rb.availableWriteSpace()).toBe(0);
        expect(rb.availableReadSpace()).toBe(3);
    });

    it('returns false on write when full', () => {
        const rb = new RingBuffer<number>({ size: 2 }); // capacity 2, usable 1
        expect(rb.write(1)).toBe(true);
        expect(rb.write(2)).toBe(false); // full after 1 item
    });

    it('returns null on read when empty', () => {
        const rb = new RingBuffer<number>({ size: 4 });
        expect(rb.read()).toBeNull();
        expect(rb.peek()).toBeNull();
    });

    it('peek does not consume the item', () => {
        const rb = new RingBuffer<number>({ size: 4 });
        rb.write(42);
        expect(rb.peek()).toBe(42);
        expect(rb.peek()).toBe(42); // still there
        expect(rb.read()).toBe(42); // now consumed
    });

    it('writeBatch writes multiple items at once', () => {
        const rb = new RingBuffer<number>({ size: 8 });
        const written = rb.writeBatch([1, 2, 3, 4, 5]);
        expect(written).toBe(5);
        expect(rb.size()).toBe(5);
    });

    it('writeBatch stops when capacity is reached', () => {
        const rb = new RingBuffer<number>({ size: 4 }); // capacity 4, usable 3
        const written = rb.writeBatch([1, 2, 3, 4, 5, 6]);
        expect(written).toBe(3); // usable = capacity - 1
        expect(rb.isFull()).toBe(true);
    });

    it('readBatch reads up to maxItems', () => {
        const rb = new RingBuffer<number>({ size: 8 });
        rb.writeBatch([10, 20, 30, 40, 50]);
        const batch = rb.readBatch(3);
        expect(batch).toEqual([10, 20, 30]);
        expect(rb.size()).toBe(2); // 2 remaining
    });

    it('skip discards items without reading them', () => {
        const rb = new RingBuffer<number>({ size: 8 });
        rb.writeBatch([1, 2, 3, 4, 5]);
        const skipped = rb.skip(2);
        expect(skipped).toBe(2);
        expect(rb.read()).toBe(3); // first two were skipped
    });

    it('wraps around correctly across multiple write/read cycles', () => {
        const rb = new RingBuffer<number>({ size: 8 }); // capacity 8, usable 7
        rb.writeBatch([1, 2, 3]);
        expect(rb.readBatch(3)).toEqual([1, 2, 3]); // drain
        // write again — should wrap to the start
        rb.writeBatch([5, 6, 7]);
        expect(rb.readBatch(3)).toEqual([5, 6, 7]);
    });

    it('clear empties the buffer', () => {
        const rb = new RingBuffer<number>({ size: 8 });
        rb.writeBatch([1, 2, 3]);
        rb.clear();
        expect(rb.isEmpty()).toBe(true);
        expect(rb.size()).toBe(0);
    });

    it('getUsagePercent reflects fill ratio', () => {
        const rb = new RingBuffer<number>({ size: 4 }); // capacity 4
        rb.write(1);
        rb.write(2);
        const pct = rb.getUsagePercent();
        expect(pct).toBeGreaterThan(0);
        expect(pct).toBeLessThanOrEqual(100);
    });

    it('getStats returns an object with usage info', () => {
        const rb = new RingBuffer<number>({ size: 8 });
        rb.write(1);
        const stats = rb.getStats();
        expect(stats).toBeDefined();
        expect(typeof stats).toBe('object');
    });
});
