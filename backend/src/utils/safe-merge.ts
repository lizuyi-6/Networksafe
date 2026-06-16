/**
 * SECURITY FIX (R6 V1.1-V1.3 + F6 defense-in-depth + Wave 5 R8 V8.1/V8.4/V8.5 +
 *               Wave 6 F15 + Sprint 5 Wave 8 F20 toJSON defense):
 * A drop-in replacement for spread/Object.assign that filters
 * prototype-pollution-prone keys at every level AND rejects special
 * object types (Function / Date / RegExp / Map / Set / Error / Promise /
 * Buffer / typed arrays / custom class instances) so they cannot be
 * smuggled into the merged result.
 *
 * Use for merging user-controlled data into existing objects, especially
 * when the result will be persisted to DB and later read back and merged
 * again (a multi-stage PP chain).
 *
 * Threat model: any call site that does `{...existing, ...userInput}` or
 * `Object.assign(target, userInput)` and then stores the result in a row
 * that may later be read back and merged again is a multi-stage PP chain.
 * Even if F6 (body-parser) blocks `__proto__` keys at parse time, an
 * attacker who already has data persisted in the DB (e.g. via a prior
 * vulnerable write) can re-trigger PP on read-back.
 *
 * Wave 5 R8 V8.1: explicit type whitelist for plain-object merging.
 *   - Function references are rejected (RCE vector via dispatcher)
 *   - Date / RegExp / Map / Set / Error / Promise / Buffer / typed arrays
 *     are converted to a safe primitive form (audit visibility)
 *   - Non-serializable objects are dropped
 *
 * Wave 5 R8 V8.4: defense against pre-polluted Object.prototype.
 *   - Result objects are built via Object.create(null) so prototype-chain
 *     reads on the result cannot leak attacker-controlled keys.
 *   - Object.prototype.hasOwnProperty.call() is used to gate reads from
 *     source, preventing inherited (polluted) properties from being
 *     treated as own data.
 *
 * Wave 5 R8 V8.5: DoS bounds.
 *   - A hard upper bound on top-level source key count prevents CPU/memory
 *     amplification via huge payloads.
 *
 * Sprint 5 Wave 8 F20 (V11.14 follow-up): defense against
 * attacker-controlled toJSON side-effects.
 *   - The previous implementation used `JSON.parse(JSON.stringify(value))`
 *     to coerce Date / RegExp / Map / Set / Error / Promise / Buffer into
 *     safe primitives. That call triggers ANY object's toJSON() method,
 *     including a class instance supplied by an attacker, giving them
 *     full control of the merged value at that key.
 *   - Fix: replace JSON.stringify with explicit `instanceof` dispatch for
 *     each known-safe built-in type, and reject every other non-plain
 *     object (typed arrays, custom class instances, thenables, exotic
 *     objects) with an opaque `[object ClassName]` marker. The marker
 *     is a primitive string, not even parseable as JSON, and the
 *     toJSON() of the rejected value is never invoked.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Portable own-property check. `Object.hasOwn` is ES2022, but this project
 * targets ES2020, so we use the well-supported `Object.prototype.hasOwnProperty.call`.
 * Using `.call(Object.prototype.hasOwnProperty, ...)` would itself walk the
 * prototype chain of the *function reference*; using the static method form
 * sidesteps any chance of a polluted `Object.prototype.hasOwnProperty`.
 */
const hasOwn = Object.prototype.hasOwnProperty;

/** Default upper bound on top-level keys accepted from `source`. */
const DEFAULT_MAX_SOURCE_KEYS = 1000;
/** Absolute upper bound regardless of caller-supplied options. */
const HARD_MAX_SOURCE_KEYS = 10000;

export interface SafeMergeOptions {
  /** Maximum recursion depth for nested objects. Default: 5. */
  maxDepth?: number;
  /** When true (default) array elements are deep-cloned. */
  allowArrays?: boolean;
  /**
   * Maximum number of own enumerable keys accepted from the top-level
   * source. Sources larger than this throw (defends against DoS).
   * Default: 1000. Hard upper bound: 10000.
   */
  maxSourceKeys?: number;
}

/**
 * Strict type guard for "plain" objects. Accepts only objects whose
 * prototype is `Object.prototype` or `null` (the latter is created by
 * `Object.create(null)`). Rejects arrays, Date, RegExp, Map, Set, Error,
 * Promise, Buffer, typed arrays, and any class instance.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Strict type guard for plain arrays (rejects Array subclasses and
 * array-like objects with a custom prototype).
 */
function isPlainArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Array.prototype || proto === null;
}

/**
 * Recursively merge `source` into `target` while skipping
 * prototype-pollution-prone keys (`__proto__`, `constructor`, `prototype`).
 *
 * - `source` is NEVER mutated; only `target` is mutated.
 * - Nested plain objects are deep-merged into a `Object.create(null)`
 *   result so prototype-chain access on the result cannot leak
 *   attacker-controlled keys.
 * - Plain arrays are deep-cloned element-by-element. Subclassed arrays
 *   are iterated by index (no toJSON is invoked) and each element is
 *   sanitized through mergeInternal.
 * - Built-in safe types (Date, RegExp, Map, Set, Error, Buffer,
 *   Promise/thenable) are converted via explicit `instanceof` / duck-type
 *   dispatch — NEVER via JSON.stringify, which would invoke attacker-
 *   controlled toJSON.
 * - Custom class instances (anything not in the safe-type whitelist) are
 *   replaced with an opaque `[object ClassName]` marker. Their toJSON
 *   is never called, so an attacker cannot smuggle data into the
 *   merged result.
 * - Function references are rejected (RCE vector).
 * - If the existing value at a key is also a plain object, the recursion
 *   will continue into it (so existing data is preserved).
 */
export function safeMerge<T extends Record<string, any>>(
  target: T,
  source: unknown,
  options: SafeMergeOptions = {}
): T {
  const maxDepth = options.maxDepth ?? 5;
  const allowArrays = options.allowArrays ?? true;
  const maxSourceKeys = Math.min(
    options.maxSourceKeys ?? DEFAULT_MAX_SOURCE_KEYS,
    HARD_MAX_SOURCE_KEYS
  );
  return mergeInternal(target, source, maxDepth, allowArrays, maxSourceKeys, 0) as T;
}

function mergeInternal(
  target: any,
  source: unknown,
  maxDepth: number,
  allowArrays: boolean,
  maxSourceKeys: number,
  depth: number
): any {
  if (source === null || source === undefined) return target;
  if (depth > maxDepth) return target;
  if (typeof source !== 'object') return target;
  // Source must be a plain object or a plain array; everything else
  // (Date, RegExp, Map, Set, Error, Promise, Buffer, typed arrays,
  // class instances) is rejected at the boundary.
  if (!isPlainObject(source) && !(allowArrays && isPlainArray(source))) {
    return target;
  }

  const sourceKeys = Object.keys(source as object);
  if (depth === 0 && sourceKeys.length > maxSourceKeys) {
    throw new Error(
      `safeMerge: source object exceeds max keys (${sourceKeys.length} > ${maxSourceKeys})`
    );
  }

  mergeInto(
    target,
    source as Record<string, unknown>,
    maxDepth,
    allowArrays,
    maxSourceKeys,
    depth
  );
  return target;
}

/**
 * Iterate over `source`'s own keys and merge each value into `target`.
 *
 * This is the per-key dispatch used by both the top-level mergeInternal
 * and recursive plain-object processing. Function references and PP-prone
 * keys are dropped; plain objects recurse via mergeInto again; everything
 * else is passed through `convertValue`, which applies the F20 toJSON
 * defense (explicit `instanceof` dispatch + type-tag marker for unknown
 * class instances).
 */
function mergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  maxDepth: number,
  allowArrays: boolean,
  maxSourceKeys: number,
  depth: number
): void {
  if (depth > maxDepth) return;
  for (const key of Object.keys(source)) {
    if (FORBIDDEN_KEYS.has(key)) continue; // skip __proto__ / constructor / prototype
    // Defense against a pre-polluted Object.prototype: even if the
    // attacker has smuggled keys into the prototype chain, only own
    // enumerable string keys of `source` are merged.
    if (!hasOwn.call(source, key)) continue;
    const value = source[key];

    // Reject function references outright (RCE vector).
    if (typeof value === 'function') continue;

    // Plain object → recurse (preserving existing data at target[key]
    // when it is also a plain object; otherwise create a null-prototype
    // container so prototype-chain access on the result cannot leak
    // attacker-controlled keys).
    if (isPlainObject(value)) {
      // Thenable duck-type: a thenable has Object.prototype as its
      // prototype and isPlainObject would return true. Never recurse
      // into a thenable — its .then() may have attacker-controlled
      // side-effects.
      if (typeof (value as { then?: unknown }).then === 'function') {
        target[key] = '[Promise]';
        continue;
      }
      const existing = target[key];
      if (existing && isPlainObject(existing)) {
        mergeInto(existing, value, maxDepth, allowArrays, maxSourceKeys, depth + 1);
        continue;
      }
      const sub: Record<string, unknown> = Object.create(null);
      mergeInto(sub, value, maxDepth, allowArrays, maxSourceKeys, depth + 1);
      target[key] = sub;
      continue;
    }

    // All other value types go through convertValue (F20 toJSON defense).
    const converted = convertValue(value, maxDepth, allowArrays, maxSourceKeys, depth);
    if (converted !== undefined) {
      target[key] = converted;
    }
  }
}

/**
 * Convert a single value into a safe merge result. This is the F20
 * toJSON-defense dispatch:
 *
 *  - Primitives pass through unchanged (with `null` preserved).
 *  - Thenable objects (Promise / custom then) are replaced with the
 *    `'[Promise]'` marker — we never call `.then()` or `toJSON`.
 *  - Arrays (plain or subclassed) are iterated by index (so toJSON
 *    is never called) and each element is recursively converted.
 *  - Plain objects produce a new null-prototype container whose keys
 *    are merged via mergeInto.
 *  - Built-in safe types (Date, RegExp, Map, Set, Error, Buffer) are
 *    converted via explicit `instanceof` dispatch — NEVER via
 *    JSON.stringify, which would invoke attacker-controlled toJSON.
 *  - Every other non-plain object (custom class instances, typed
 *    arrays, exotic objects) is replaced with the type-tag marker
 *    `'[object ClassName]'`. toJSON is never called.
 *
 * Returns `undefined` for values that should be dropped (e.g. a
 * function reference that slipped through, or a failed Map iteration).
 */
function convertValue(
  value: unknown,
  maxDepth: number,
  allowArrays: boolean,
  maxSourceKeys: number,
  depth: number
): unknown {
  if (typeof value === 'function') return undefined;
  if (value === null) return null;
  if (typeof value !== 'object') return value;

  // Thenable check FIRST — a thenable may have Object.prototype as its
  // prototype and look like a plain object, but it is NOT safe to recurse
  // into (could trigger .then() side-effects or attacker-controlled
  // toJSON via an internal promise implementation).
  if (typeof (value as { then?: unknown }).then === 'function') {
    return '[Promise]';
  }

  if (Array.isArray(value)) {
    if (!allowArrays) return [...value];
    let elements: unknown[];
    if (isPlainArray(value)) {
      elements = [...value];
    } else {
      // Subclassed / Proxy / custom-prototype array. Iterate by index
      // (which does not call toJSON) and fall back to dropping on error.
      try {
        elements = [];
        for (let i = 0; i < (value as any).length; i++) {
          elements.push((value as any)[i]);
        }
      } catch {
        return undefined;
      }
    }
    return elements.map((item) =>
      convertValue(item, maxDepth, allowArrays, maxSourceKeys, depth + 1)
    );
  }

  if (isPlainObject(value)) {
    if (depth > maxDepth) return Object.create(null);
    const sub: Record<string, unknown> = Object.create(null);
    mergeInto(sub, value, maxDepth, allowArrays, maxSourceKeys, depth + 1);
    return sub;
  }

  if (value instanceof Date) {
    // Date.prototype.toISOString is intrinsic; it cannot be overridden
    // by an attacker (it is a native function, not an own method on the
    // instance). Returns a primitive string.
    return value.toISOString();
  }
  if (value instanceof RegExp) {
    // RegExp.prototype.toString returns the source/flags literal.
    return value.toString();
  }
  if (value instanceof Map) {
    try {
      return Object.fromEntries(
        Array.from((value as Map<unknown, unknown>).entries())
          .filter(([k]) => typeof k === 'string' || typeof k === 'number')
          .map(([k, v]) => [k, v === null || typeof v !== 'object' ? v : null])
      );
    } catch {
      return undefined;
    }
  }
  if (value instanceof Set) {
    return Array.from(value as Set<unknown>)
      .filter((v) => v === null || typeof v !== 'object')
      .slice(0, 100);
  }
  if (value instanceof Error) {
    // Only the Error's name and message. The stack trace is dropped
    // because it can contain file paths, URLs, and other user-data
    // that may be persisted or logged downstream.
    return { name: value.name, message: value.message };
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    // Length-only marker — raw bytes are never copied into the merged
    // result (which may be persisted or logged).
    return `[Buffer:${(value as Buffer).length}b]`;
  }

  // F20 / V11.14: an attacker could supply a custom class instance
  // (or typed array / exotic object) with a toJSON() that returns
  // arbitrary attacker-controlled data. We never call toJSON; instead
  // we replace the value with an opaque type-tag marker. The marker
  // is a primitive string and cannot be parsed as JSON, so the
  // attacker's payload cannot reach downstream consumers.
  const ctorName =
    (value as { constructor?: { name?: string } }).constructor?.name || 'Unknown';
  return `[object ${ctorName}]`;
}

/**
 * Strip prototype-pollution keys from an object (non-mutating).
 * Use for sanitizing data read back from DB before re-spreading.
 *
 * Wave 5 R8 V8.4: result is built with `Object.create(null)` so a
 * pre-polluted Object.prototype cannot be reached via the result.
 */
/**
 * Strip prototype-pollution keys from an object (non-mutating).
 * Use for sanitizing data read back from DB before re-spreading.
 *
 * Wave 5 R8 V8.4: result is built with `Object.create(null)` so a
 * pre-polluted Object.prototype cannot be reached via the result.
 */
export function stripProtoKeys<T = any>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripProtoKeys) as any;
  const result: Record<string, any> = Object.create(null);
  for (const key of Object.keys(obj as object)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (!hasOwn.call(obj as object, key)) continue;
    result[key] = stripProtoKeys((obj as any)[key]);
  }
  return result as T;
}

/**
 * Merge one plain object into a new null-prototype object.
 *
 * Unlike `{ ...base, ...source }` which re-installs Object.prototype as
 * the result's prototype (enabling prototype-pollution chains), this
 * creates `Object.create(null)` as the result and copies every own,
 * enumerable, safe key from both `base` and `source` via
 * Object.defineProperty (which is immune to inherited/set-of-values
 * attacks on the target prototype).
 *
 * NESTED OBJECTS: Plain objects nested inside `source` are also converted
 * to null-prototype via `safeMerge(Object.create(null), nestedValue)`,
 * ensuring the PP-defense holds at all depths of the merged result.
 *
 * Use when you need to spread user-controlled metadata into an object
 * that will be stored in the DB and later re-spread again.
 *
 * @param base   The base object (copied first).
 * @param source The source object whose keys are merged in second
 *               (prototype-pollution keys are filtered out).
 */
export function safeMergeObject<T extends Record<string, unknown>>(
  base: T,
  source: unknown
): T {
  const result = Object.create(null) as Record<string, unknown>;

  // Copy base keys with safe own-property guard
  for (const key of Object.keys(base)) {
    if (!hasOwn.call(base, key)) continue;
    const desc = Object.getOwnPropertyDescriptor(base, key);
    if (desc) {
      Object.defineProperty(result, key, desc);
    }
  }

  // Merge source (only plain own enumerable string-keyed properties)
  if (source != null && typeof source === 'object') {
    const src = source as Record<string, unknown>;
    for (const key of Object.keys(src)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      if (!hasOwn.call(src, key)) continue;
      if (typeof src[key] === 'function') continue;

      const value = src[key];
      // Recursively convert nested plain objects to null-prototype,
      // matching safeMerge's depth-1 recursion for plain object values.
      if (isPlainObject(value)) {
        // depth=1 so the innermost safeMerge call allows one level of
        // nesting within the nested object (e.g. { a: { b: 1 } } is safe).
        // hasOwn guard inside safeMerge filters inherited PP keys.
        const nested = safeMerge(
          Object.create(null) as Record<string, unknown>,
          value,
          { maxDepth: 1 }
        );
        Object.defineProperty(result, key, {
          value: nested,
          writable: true,
          enumerable: true,
          configurable: true
        });
      } else {
        const desc = Object.getOwnPropertyDescriptor(src, key);
        if (desc) {
          Object.defineProperty(result, key, desc);
        }
      }
    }
  }

  return result as T;
}
