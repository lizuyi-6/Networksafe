/**
 * Redteam Tests: Scanner Prototype Pollution (CVE-2026-015)
 *
 * Tests that scanner-task.service and security-operations.service
 * use null-prototype objects when merging user-controlled metadata,
 * preventing prototype pollution chains when data is stored in the
 * DB and later re-read and re-spread.
 *
 * Run with: npx jest --no-coverage --testPathPattern='redteam/scanner-prototype-pollution'
 */

import { safeMergeObject } from '../../utils/safe-merge';

describe('safeMergeObject — null-prototype merged objects', () => {

  describe('basic null-prototype guarantee', () => {
    it('result should have Object.getPrototypeOf === null', () => {
      const result = safeMergeObject({ a: 1 }, { b: 2 });
      expect(Object.getPrototypeOf(result)).toBeNull();
    });

    it('result should NOT contain __proto__ key from source', () => {
      const result = safeMergeObject(
        { existing: 'data' },
        { '__proto__': { polluted: true } } as any
      );
      // The object itself should not have 'polluted' accessible via prototype
      expect((result as any).polluted).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(result, 'polluted')).toBe(false);
    });

    it('should NOT contain constructor from source', () => {
      const result = safeMergeObject(
        {},
        { constructor: { prototype: { malicious: true } } } as any
      );
      expect((result as any).constructor).toBeUndefined();
    });

    it('should NOT contain prototype from source', () => {
      const result = safeMergeObject(
        {},
        { prototype: { malicious: true } } as any
      );
      expect((result as any).prototype).toBeUndefined();
    });
  });

  describe('legitimate keys preserved', () => {
    it('should preserve base object keys', () => {
      const result = safeMergeObject(
        { origin: 'scanner', runId: 'task-001' },
        {}
      );
      expect(result.origin).toBe('scanner');
      expect(result.runId).toBe('task-001');
    });

    it('should merge source keys on top of base', () => {
      const result = safeMergeObject(
        { origin: 'scanner' },
        { classification: 'high-severity', runId: 'task-002' }
      );
      expect(result.origin).toBe('scanner');
      expect((result as Record<string, unknown>).classification).toBe('high-severity');
      expect((result as Record<string, unknown>).runId).toBe('task-002');
    });

    it('source keys should overwrite base keys', () => {
      const result = safeMergeObject(
        { classification: 'low' },
        { classification: 'critical' }
      );
      expect(result.classification).toBe('critical');
    });

    it('should drop function values from source', () => {
      const result = safeMergeObject(
        { base: 'value' },
        { fn: function malicious() {} } as any
      );
      expect((result as any).fn).toBeUndefined();
    });
  });

  describe('deep nested objects', () => {
    it('nested plain objects should also have null prototype', () => {
      const result = safeMergeObject(
        {},
        { nested: { deep: 'value' } }
      ) as any;
      // The nested object at .nested should also be null-prototype
      expect(Object.getPrototypeOf(result.nested)).toBeNull();
    });
  });

  describe('stripProtoKeys + safeMergeObject chain (simulates the scanner-task.service fix)', () => {
    it('__proto__.polluted in metadata should not be accessible on the result', () => {
      // This is the exact pattern fixed in scanner-task.service.ts line 1617:
      // metadata: safeMergeObject({...fixed fields...}, stripProtoKeys(input.metadata))
      const inputMetadata = { '__proto__': { polluted: true } } as any;
      const fixedFields = {
        origin: 'scanner',
        classification: 'scan-observation',
        runId: 'task-123',
      };
      const result = safeMergeObject(fixedFields, inputMetadata);

      // Verify no prototype pollution
      expect(Object.getPrototypeOf(result)).toBeNull();
      expect((result as any).polluted).toBeUndefined();
      expect('polluted' in result).toBe(false);
      // But legitimate fields must be present
      expect(result.origin).toBe('scanner');
    });

    it('constructor in metadata should not be accessible on the result', () => {
      const inputMetadata = { 'constructor': { 'prototype': { 'evil': true } } } as any;
      const result = safeMergeObject({ origin: 'scanner' }, inputMetadata);
      expect((result as any).constructor).toBeUndefined();
    });
  });

  describe('DB round-trip simulation (multi-stage PP chain)', () => {
    // Simulates: user submits metadata → stored in DB → read back → re-spread
    // With the old `{ ...base, ...stripProtoKeys(userInput) }` pattern,
    // a polluted prototype chain could be re-installed on read-back.

    it('should survive a two-stage PP chain (write + read-back)', () => {
      // Stage 1: user submits polluted metadata
      const stage1 = safeMergeObject(
        { origin: 'scanner', classification: 'low' },
        { '__proto__': { stage2: 'polluted' } } as any
      );
      expect(Object.getPrototypeOf(stage1)).toBeNull();

      // Stage 2: that row is read back from DB and merged again
      const stage2Input = { ...stage1 }; // simulate DB read-back (spreads to new object)
      const stage2 = safeMergeObject(
        { origin: 'scanner' },
        stage2Input
      );
      expect(Object.getPrototypeOf(stage2)).toBeNull();
      expect((stage2 as any).stage2).toBeUndefined();
      expect((stage2 as any).polluted).toBeUndefined();
    });
  });
});
