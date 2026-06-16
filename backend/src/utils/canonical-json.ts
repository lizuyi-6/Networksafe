/**
 * Canonical JSON serializer for HMAC signing.
 * Produces a stable, deterministic string representation by sorting
 * object keys recursively.  This prevents HMAC mismatches when the
 * same logical payload is serialized in different key orders on
 * different sides of a signing boundary.
 */

/**
 * Walk a value and return a deep copy with keys sorted alphabetically.
 * Handles cycles by replacing repeated object references with null
 * (which JSON.stringify will serialize as null — unique per cycle).
 */
export function canonicalizeForSigning(input: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  const walk = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') {
      return value;
    }
    if (seen.has(value as object)) {
      return null;
    }
    seen.add(value as object);
    if (Array.isArray(value)) {
      return value.map((entry) => walk(entry));
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = walk((value as Record<string, unknown>)[key]);
    }
    return out;
  };
  return JSON.stringify(walk(input));
}
