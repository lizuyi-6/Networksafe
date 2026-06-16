/**
 * REDTEAM SECURITY TEST — OIDC JWKS amplification DoS (Round 4)
 * =============================================================
 *
 * Threat model: an attacker calls /api/auth/oidc/callback with an id_token
 * whose JWT header `kid` is randomized per request. The original
 * `findJwkByKid` fetched JWKS on every unknown kid with no rate limit,
 * no negative cache, and no in-flight de-duplication — one outbound HTTPS
 * fetch per attacker request.
 *
 * Attacker cost: 1 API call → 1 HTTPS fetch to the IdP.
 * IdP cost: unbounded.
 *
 * Fix requirements:
 *   1. Negative cache: kid that 404'd in the last 5 minutes → skip fetch.
 *   2. In-flight de-duplication: concurrent requests share one fetch.
 *   3. Per-issuer rate limit: max 1 fetch per 10 seconds per issuer.
 *   4. MAX_KID_LENGTH: reject kids longer than 256 chars without a fetch.
 */

import { generateKeyPairSync, sign, KeyObject } from 'crypto';
import * as http from 'http';
import { AddressInfo } from 'net';
import { oidcAuthService } from '../../services/oidc-auth.service';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('../../config/enterprise-runtime', () => ({
  oidcRequireMfa: jest.fn(() => false)
}));

jest.mock('../../modules/auth/auth-user.repository', () => ({
  findAuthUserByEmail: jest.fn(),
  createAuthUser: jest.fn().mockResolvedValue(undefined)
}));

const ISSUER = 'https://idp.example.test';
const CLIENT_ID = 'aetherguard-test-client';
const KID = 'test-key-1';

interface KeyMaterial {
  privateKey: KeyObject;
  publicJwk: any;
}

function makeKey(kid: string = KID): KeyMaterial {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { privateKey, publicJwk: jwk };
}

function b64url(input: object | string): string {
  const data = typeof input === 'string' ? Buffer.from(input) : Buffer.from(JSON.stringify(input));
  return data.toString('base64url');
}

function makeJwt(
  claims: Record<string, any>,
  privateKey: KeyObject,
  kid: string,
  alg: string = 'RS256'
): string {
  const header = { alg, typ: 'JWT', kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const sig = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${sig}`;
}

const ORIGINAL_FETCH = global.fetch;

function resetServiceState(): void {
  const svc = oidcAuthService as any;
  if (svc.nonceStore && typeof svc.nonceStore.clear === 'function') {
    svc.nonceStore.clear();
  }
  if ('jwksCache' in svc) svc.jwksCache = null;
  if (svc.negativeCache && typeof svc.negativeCache.clear === 'function') {
    svc.negativeCache.clear();
  }
  if (svc.inflightFetch && typeof svc.inflightFetch.clear === 'function') {
    svc.inflightFetch.clear();
  }
  if (svc.lastFetchByIssuer && typeof svc.lastFetchByIssuer.clear === 'function') {
    svc.lastFetchByIssuer.clear();
  }
}

function setOidcEnv(): void {
  process.env.OIDC_ISSUER = ISSUER;
  process.env.OIDC_CLIENT_ID = CLIENT_ID;
  process.env.OIDC_CLIENT_SECRET = 'test-client-secret';
  process.env.OIDC_AUTHORIZATION_ENDPOINT = `${ISSUER}/authorize`;
  process.env.OIDC_TOKEN_ENDPOINT = `${ISSUER}/token`;
  process.env.OIDC_USERINFO_ENDPOINT = `${ISSUER}/userinfo`;
  process.env.OIDC_REDIRECT_URI = 'https://app.example.test/callback';
  process.env.OIDC_SCOPES = 'openid profile email';
}

function makeSignedToken(
  privateKey: KeyObject,
  kid: string,
  nonce: string,
  overrides: Record<string, any> = {}
): string {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: 'user-1',
    iss: ISSUER,
    aud: CLIENT_ID,
    exp: now + 300,
    iat: now,
    nonce,
    ...overrides
  };
  return makeJwt(claims, privateKey, kid);
}

describe('REDTEAM OIDC JWKS amplification DoS (Round 4)', () => {
  let key: KeyMaterial;
  let fetchSpy: jest.Mock;
  let tokenCount: number;

  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    setOidcEnv();
    key = makeKey();
    tokenCount = 0;

    // Track fetch calls across the test
    fetchSpy = jest.fn(async (url: any) => {
      const u = String(url);
      if (u.endsWith('/.well-known/jwks.json')) {
        tokenCount++;
        // Return JWKS with only the known key — all random kids will miss.
        return new Response(JSON.stringify({ keys: [key.publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response('not used', { status: 404 });
    });
    global.fetch = fetchSpy as any;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  // -------------------------------------------------------------------------
  // Fix 1 + 2 + 3: negative cache + in-flight dedup + rate limit
  // -------------------------------------------------------------------------

  it(
    'calls fetch at most 2-3 times when verifyIdToken is invoked 100 times with ' +
      'different random kids (not 100)',
    async () => {
      // Call verifyIdToken 100 times with unique random kids.
      // Without the fix: 100 outbound JWKS fetches.
      // With the fix: negative cache + rate limit cap the fetch count.
      const calls: Promise<void>[] = [];
      for (let i = 0; i < 100; i++) {
        const randomKid = `random-kid-${i}-${Date.now()}`;
        calls.push(
          (async () => {
            const { state: s2, nonce: n2 } = oidcAuthService.buildStateAndNonce();
            const t = makeSignedToken(key.privateKey, randomKid, n2);
            await oidcAuthService.verifyIdToken(t, s2);
          })()
        );
      }
      await Promise.all(calls);

      // With negative cache + rate limit, we expect at most a handful of fetches:
      // - 1 initial JWKS fetch (populates cache + negative cache)
      // - 1 retry fetch after the rate-limit window expires (10s)
      // NOT 100.
      expect(tokenCount).toBeLessThanOrEqual(3);
    }
  );

  // -------------------------------------------------------------------------
  // Fix 1: negative cache — kid that 404'd should not re-fetch within TTL
  // -------------------------------------------------------------------------

  it(
    'does NOT fetch when a kid was not found in the first call and is ' +
      're-requested within the negative-cache window',
    async () => {
      const unknownKid = 'kid-not-in-jwks';

      // First call: kid is unknown — ONE fetch to populate the negative cache.
      const { state: s1, nonce: n1 } = oidcAuthService.buildStateAndNonce();
      const token1 = makeSignedToken(key.privateKey, unknownKid, n1);
      const result1 = await oidcAuthService.verifyIdToken(token1, s1);
      expect(result1.valid).toBe(false);
      expect(result1.reason).toBe('unknown_kid');

      const fetchCountAfterFirst = tokenCount;
      expect(fetchCountAfterFirst).toBe(1); // one fetch must have occurred

      // Second call with the SAME unknown kid: negative cache should block the fetch.
      // Use a fresh state/nonce (nonces are consumed per call).
      const { state: s2, nonce: n2 } = oidcAuthService.buildStateAndNonce();
      const token2 = makeSignedToken(key.privateKey, unknownKid, n2);
      const result2 = await oidcAuthService.verifyIdToken(token2, s2);

      expect(result2.valid).toBe(false);
      expect(result2.reason).toBe('unknown_kid');
      // NO additional fetch — negative cache hit.
      expect(tokenCount).toBe(fetchCountAfterFirst);
    }
  );

  // -------------------------------------------------------------------------
  // Fix 4: MAX_KID_LENGTH — kids longer than 256 chars are rejected without fetch
  // -------------------------------------------------------------------------

  it('rejects a kid longer than 256 characters without calling fetch', async () => {
    const longKid = 'a'.repeat(300); // 300 chars — exceeds 256 limit
    const { state, nonce } = oidcAuthService.buildStateAndNonce();
    const token = makeSignedToken(key.privateKey, longKid, nonce);

    const countBefore = tokenCount;
    const result = await oidcAuthService.verifyIdToken(token, state);

    // Must be rejected at the MAX_KID_LENGTH guard, before any cache lookup.
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unknown_kid');
    // NO fetch should have been made.
    expect(tokenCount).toBe(countBefore);
  });

  it('accepts a kid at exactly 256 characters (boundary check)', async () => {
    const boundaryKid = 'a'.repeat(256);
    const { state, nonce } = oidcAuthService.buildStateAndNonce();
    const token = makeSignedToken(key.privateKey, boundaryKid, nonce);

    const countBefore = tokenCount;
    const result = await oidcAuthService.verifyIdToken(token, state);

    // This kid does not exist in the JWKS, so it will fail verification,
    // but it SHOULD have gone through the cache lookup (not rejected early).
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unknown_kid');
    // One fetch should have occurred to check.
    expect(tokenCount).toBeGreaterThan(countBefore);
  });

  // -------------------------------------------------------------------------
  // Sanity: the fix does not break the happy path
  // -------------------------------------------------------------------------

  it('still verifies a token when the kid IS present in the JWKS (happy path)', async () => {
    const { state, nonce } = oidcAuthService.buildStateAndNonce();
    const token = makeSignedToken(key.privateKey, KID, nonce);

    const result = await oidcAuthService.verifyIdToken(token, state);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('still verifies multiple tokens with the same valid kid using one fetch (in-flight dedup)', async () => {
    const { state: s1, nonce: n1 } = oidcAuthService.buildStateAndNonce();
    const { state: s2, nonce: n2 } = oidcAuthService.buildStateAndNonce();
    const { state: s3, nonce: n3 } = oidcAuthService.buildStateAndNonce();

    const token1 = makeSignedToken(key.privateKey, KID, n1);
    const token2 = makeSignedToken(key.privateKey, KID, n2);
    const token3 = makeSignedToken(key.privateKey, KID, n3);

    // Fire all three simultaneously.
    const [r1, r2, r3] = await Promise.all([
      oidcAuthService.verifyIdToken(token1, s1),
      oidcAuthService.verifyIdToken(token2, s2),
      oidcAuthService.verifyIdToken(token3, s3)
    ]);

    expect(r1.valid).toBe(true);
    expect(r2.valid).toBe(true);
    expect(r3.valid).toBe(true);

    // Only ONE JWKS fetch should have occurred — in-flight de-duplication.
    expect(tokenCount).toBe(1);
  });
});
