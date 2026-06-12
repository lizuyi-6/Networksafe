/**
 * UUID v4 helper backed by Node's crypto.randomUUID().
 *
 * This replaces the third-party `uuid` package. The package's only
 * advisory (GHSA-w5hq-g745-h8pq) affects the v3/v5/v6 buffer API,
 * which this codebase never used, but pinning to v9 forever is not
 * viable. crypto.randomUUID() is available on Node >= 14.17 and is
 * the cryptographically-strong RFC 4122 v4 generator.
 */
import { randomUUID } from 'crypto';

/** Drop-in replacement for `uuid.v4()`. Returns a lowercase UUID string. */
export function uuidv4(): string {
  return randomUUID();
}

export default uuidv4;
