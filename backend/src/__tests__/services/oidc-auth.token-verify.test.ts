/**
 * OIDC id_token verification tests
 *
 * SECURITY FIX V9.11 / V9.13 (Sprint 5 R9 audit):
 *  - id_token signature is now verified via JWKS.
 *  - iss / aud / nonce / exp are all enforced.
 *  - `decodeJwtClaims` has been deleted; the legacy `validateMfaEvidence`
 *    path that fed a raw, attacker-controlled `idToken` string is no longer
 *    reachable from the OIDC callback.
 *
 * These tests exercise the real `OidcAuthService` (not a mock) and produce
 * real RSA-signed JWTs to confirm the verification surface area behaves as
 * documented.
 */

import { generateKeyPairSync, sign, KeyObject } from 'crypto';
import { oidcAuthService, type VerifiedIdTokenClaims } from '../../services/oidc-auth.service';
import { oidcRequireMfa } from '../../config/enterprise-runtime';

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
  oidcRequireMfa: jest.fn(() => true)
}));

// Mock the persistence layer so resolveUser is exercised in isolation.
// The repo is only consulted after the security gate has admitted the call.
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

function makeKey(): KeyMaterial {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = KID;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { privateKey, publicJwk: jwk };
}

function b64url(input: object | string): string {
  const data = typeof input === 'string' ? Buffer.from(input) : Buffer.from(JSON.stringify(input));
  return data.toString('base64url');
}

interface SignArgs {
  alg?: 'RS256' | 'none' | 'HS256';
  kid?: string;
  claims: Record<string, any>;
  privateKey?: KeyObject;
  secretForHS?: string;
}

function makeJwt({ alg = 'RS256', kid = KID, claims, privateKey, secretForHS }: SignArgs): string {
  const header = { alg, typ: 'JWT', kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;

  if (alg === 'none') {
    return `${signingInput}.`;
  }
  if (alg === 'HS256') {
    const crypto = require('crypto');
    const sig = crypto
      .createHmac('sha256', secretForHS || 'shared-secret')
      .update(signingInput)
      .digest('base64url');
    return `${signingInput}.${sig}`;
  }
  if (!privateKey) {
    throw new Error('privateKey is required for RS256 signing');
  }
  const sig = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${sig}`;
}

const ORIGINAL_FETCH = global.fetch;

/**
 * Reach into the singleton to clear in-memory caches. We do this so that
 * tests with different JWKs / nonces do not leak state across `it()` blocks.
 */
function resetServiceState(): void {
  // The maps are private; cast through `any` for test-only access.
  const svc = oidcAuthService as any;
  if (svc.nonceStore && typeof svc.nonceStore.clear === 'function') {
    svc.nonceStore.clear();
  }
  if ('jwksCache' in svc) {
    svc.jwksCache = null;
  }
  // SECURITY FIX R4: also clear the JWKS DoS hardening state so that
  // negative-cache entries from previous tests do not cause findJwkByKid
  // to return null before signature verification runs.
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
  process.env.OIDC_AUTHORIZATION_ENDPOINT = 'https://idp.example.test/authorize';
  process.env.OIDC_TOKEN_ENDPOINT = 'https://idp.example.test/token';
  process.env.OIDC_USERINFO_ENDPOINT = 'https://idp.example.test/userinfo';
  process.env.OIDC_REDIRECT_URI = 'https://app.example.test/callback';
  process.env.OIDC_SCOPES = 'openid profile email';
  process.env.OIDC_REQUIRE_MFA = 'true';
  process.env.OIDC_MFA_AMR_VALUES = 'mfa,otp,webauthn,hwk';
}

describe('OidcAuthService id_token verification (V9.11/V9.13)', () => {
  let key: KeyMaterial;

  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    setOidcEnv();
    key = makeKey();

    // Default: JWKS endpoint returns our test key. Individual tests override
    // this when they need to simulate a kid miss, key rotation, etc.
    global.fetch = jest.fn(async (url: any) => {
      const u = String(url);
      if (u.endsWith('/.well-known/jwks.json')) {
        return new Response(JSON.stringify({ keys: [key.publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response('not used', { status: 404 });
    }) as any;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  /**
   * Convenience: produce a freshly primed state/nonce pair, build a signed
   * RS256 JWT using the provided claim overrides, and return everything the
   * test needs.
   */
  function makeSignedToken(overrides: Partial<Record<string, any>> = {}): {
    token: string;
    state: string;
    nonce: string;
    claims: Record<string, any>;
  } {
    const { state, nonce } = oidcAuthService.buildStateAndNonce();
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, any> = {
      sub: 'user-1',
      iss: ISSUER,
      aud: CLIENT_ID,
      exp: now + 300,
      iat: now,
      nonce,
      amr: ['pwd', 'mfa'],
      ...overrides
    };
    const token = makeJwt({ claims, privateKey: key.privateKey });
    return { token, state, nonce, claims };
  }

  it('accepts a valid RS256-signed id_token whose claims match the stored nonce', async () => {
    const { token, state, nonce, claims } = makeSignedToken();

    const result = await oidcAuthService.verifyIdToken(token, state);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.claims?.iss).toBe(ISSUER);
    expect(result.claims?.aud).toBe(CLIENT_ID);
    expect(result.claims?.nonce).toBe(nonce);
    expect(result.claims?.amr).toEqual(claims.amr);
  });

  it('rejects id_token with alg=none (no signature)', async () => {
    const { state, nonce } = oidcAuthService.buildStateAndNonce();
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      sub: 'user-1',
      iss: ISSUER,
      aud: CLIENT_ID,
      exp: now + 300,
      nonce
    };
    const token = makeJwt({ alg: 'none', claims });

    const result = await oidcAuthService.verifyIdToken(token, state);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unsupported_alg');
  });

  it('rejects id_token signed with HS256 (symmetric algorithm not in RSA/EC whitelist)', async () => {
    const { state, nonce } = oidcAuthService.buildStateAndNonce();
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      sub: 'user-1',
      iss: ISSUER,
      aud: CLIENT_ID,
      exp: now + 300,
      nonce
    };
    const token = makeJwt({
      alg: 'HS256',
      claims,
      // Attacker tries to use the JWK thumbprint as a shared secret.
      secretForHS: 'attacker-controlled-string'
    });

    const result = await oidcAuthService.verifyIdToken(token, state);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unsupported_alg');
  });

  it('rejects id_token with a tampered signature (good header, bad signature)', async () => {
    const { state, nonce } = oidcAuthService.buildStateAndNonce();
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      sub: 'user-1',
      iss: ISSUER,
      aud: CLIENT_ID,
      exp: now + 300,
      nonce
    };
    const good = makeJwt({ claims, privateKey: key.privateKey });
    const [h, p] = good.split('.');
    const badSig = Buffer.alloc(256, 0xaa).toString('base64url');
    const tampered = `${h}.${p}.${badSig}`;

    const result = await oidcAuthService.verifyIdToken(tampered, state);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad_signature');
  });

  it('rejects id_token with an unknown kid (JWKS returns no matching key)', async () => {
    // JWKS endpoint has no keys at all
    global.fetch = jest.fn(async () => {
      return new Response(JSON.stringify({ keys: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as any;

    const { token, state } = makeSignedToken();

    const result = await oidcAuthService.verifyIdToken(token, state);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unknown_kid');
  });

  it('rejects id_token whose iss does not match OIDC_ISSUER', async () => {
    const { token, state } = makeSignedToken({ iss: 'https://attacker.example.test' });

    const result = await oidcAuthService.verifyIdToken(token, state);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('iss_mismatch');
  });

  it('rejects id_token whose aud does not contain OIDC_CLIENT_ID', async () => {
    const { token, state } = makeSignedToken({ aud: 'some-other-client' });

    const result = await oidcAuthService.verifyIdToken(token, state);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('aud_mismatch');
  });

  it('accepts id_token whose aud is an array containing OIDC_CLIENT_ID', async () => {
    const { token, state } = makeSignedToken({ aud: ['unrelated', CLIENT_ID, 'another'] });

    const result = await oidcAuthService.verifyIdToken(token, state);
    expect(result.valid).toBe(true);
  });

  it('rejects id_token whose nonce does not match the server-side stored nonce', async () => {
    const { state, nonce } = oidcAuthService.buildStateAndNonce();
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      sub: 'user-1',
      iss: ISSUER,
      aud: CLIENT_ID,
      exp: now + 300,
      iat: now,
      // Token claims a different nonce than the one we stored
      nonce: 'attacker-supplied-nonce'
    };
    const token = makeJwt({ claims, privateKey: key.privateKey });

    const result = await oidcAuthService.verifyIdToken(token, state);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('nonce_mismatch');
    void nonce;
  });

  it('rejects expired id_token (exp in the past beyond the 5s clock skew)', async () => {
    const { state, nonce } = oidcAuthService.buildStateAndNonce();
    const now = Math.floor(Date.now() / 1000);
    const pastExp = now - 3600;
    const claims = {
      sub: 'user-1',
      iss: ISSUER,
      aud: CLIENT_ID,
      exp: pastExp,
      iat: now - 7200,
      nonce
    };
    const token = makeJwt({ claims, privateKey: key.privateKey });

    const result = await oidcAuthService.verifyIdToken(token, state);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects id_token whose nbf is in the future beyond the 5s clock skew', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { token, state } = makeSignedToken({ nbf: now + 3600 });

    const result = await oidcAuthService.verifyIdToken(token, state);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('not_yet_valid');
  });

  it('rejects id_token that omits the required exp claim', async () => {
    const { token, state } = makeSignedToken({ exp: undefined });

    const result = await oidcAuthService.verifyIdToken(token, state);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid_exp');
  });

  it('rejects id_token that omits the required iat claim', async () => {
    const { token, state } = makeSignedToken({ iat: undefined });

    const result = await oidcAuthService.verifyIdToken(token, state);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid_iat');
  });

  it.each([
    ['exp encoded as a string', { exp: String(Math.floor(Date.now() / 1000) + 300) }, 'invalid_exp'],
    ['exp encoded as a fractional number', { exp: Math.floor(Date.now() / 1000) + 300.5 }, 'invalid_exp'],
    ['iat encoded as a string', { iat: String(Math.floor(Date.now() / 1000)) }, 'invalid_iat'],
    ['iat encoded as a fractional number', { iat: Math.floor(Date.now() / 1000) + 0.5 }, 'invalid_iat']
  ])('rejects id_token with %s', async (_label, overrides, expectedReason) => {
    const { token, state } = makeSignedToken(overrides);

    const result = await oidcAuthService.verifyIdToken(token, state);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe(expectedReason);
  });

  it('rejects id_token when the state has no nonce entry (replay of /callback with stale state)', async () => {
    const { token } = makeSignedToken();
    const result = await oidcAuthService.verifyIdToken(token, 'state-that-was-never-issued');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('state_unknown');
  });

  it('rejects when OIDC_ISSUER is not configured (fail-closed)', async () => {
    delete process.env.OIDC_ISSUER;
    const { token, state } = makeSignedToken();

    const result = await oidcAuthService.verifyIdToken(token, state);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('issuer_not_configured');
  });

  it('consumes the nonce exactly once — replaying the same token/state fails the second time', async () => {
    const { token, state } = makeSignedToken();

    const first = await oidcAuthService.verifyIdToken(token, state);
    expect(first.valid).toBe(true);

    const second = await oidcAuthService.verifyIdToken(token, state);
    expect(second.valid).toBe(false);
    expect(second.reason).toBe('state_unknown');
  });

  // Redteam R1-oidc-state-replay: verify that a replayed OIDC state cookie
  // (the same state value used twice on the callback) is rejected because the
  // nonce store entry is deleted after first consumption.  This is the CSRF
  // variant of the id_token replay test above — it covers the /oidc/callback
  // route-level check where req.cookies.oidcState is compared against the
  // stored state AND the nonce is consumed from the nonceStore.
  it('redteam R1-oidc-state-replay: the same state value cannot be used twice on the callback', async () => {
    // Build a valid token and state; simulate first successful callback consumption.
    const { token, state } = makeSignedToken();
    const first = await oidcAuthService.verifyIdToken(token, state);
    expect(first.valid).toBe(true); // Nonce consumed; nonceStore entry deleted.

    // Attacker re-uses the same state cookie value on a second callback.
    // The nonceStore has already deleted this state entry, so verifyIdToken
    // returns 'state_unknown' — the CSRF attack is blocked.
    const replay = await oidcAuthService.verifyIdToken(token, state);
    expect(replay.valid).toBe(false);
    expect(replay.reason).toBe('state_unknown');
  });

  it('isConfigured() now requires OIDC_ISSUER in addition to the other OIDC env vars', () => {
    expect(oidcAuthService.isConfigured()).toBe(true);

    delete process.env.OIDC_ISSUER;
    expect(oidcAuthService.isConfigured()).toBe(false);
  });
});

describe('OidcAuthService validateMfaEvidence requires verified claims', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    setOidcEnv();
    (oidcRequireMfa as jest.Mock).mockReturnValue(true);
  });

  it('refuses to use a raw idToken string (legacy bypass path)', () => {
    const profile = { sub: 'u', email: 'a@b.com' };
    // Build a fake idToken where the *unverified* claims include amr=[mfa].
    // Under the old code this would have been accepted; under the fix it
    // must be rejected outright so the bypass cannot come back.
    const fakeIdToken =
      Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url') + '.' +
      Buffer.from(JSON.stringify({ amr: ['mfa'], acr: 'high' })).toString('base64url') + '.';

    const result = oidcAuthService.validateMfaEvidence(profile, fakeIdToken);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unverified_id_token_rejected');
  });

  it('uses verified claim amr values for the MFA gate', () => {
    const profile = { sub: 'u', email: 'a@b.com' };
    const verified: VerifiedIdTokenClaims = { amr: ['pwd', 'mfa'] };
    const ok = oidcAuthService.validateMfaEvidence(profile, verified);
    expect(ok.valid).toBe(true);
  });

  it('rejects when verified claim amr is empty even if profile.amr claims mfa', () => {
    // SECURITY: the profile (untrusted userinfo) MUST NOT be allowed to make
    // up for missing amr evidence. Verified id_token amr is authoritative.
    const profile = { sub: 'u', email: 'a@b.com', amr: ['mfa', 'otp'] };
    const verified: VerifiedIdTokenClaims = { amr: ['pwd'] };
    const result = oidcAuthService.validateMfaEvidence(profile, verified);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('amr_mfa_missing');
  });

  it('honors OIDC_REQUIRED_ACR against verified claims (not the unverified token)', () => {
    process.env.OIDC_REQUIRED_ACR = 'high';
    const profile = { sub: 'u', email: 'a@b.com' };
    const verified: VerifiedIdTokenClaims = { acr: 'low' };
    const result = oidcAuthService.validateMfaEvidence(profile, verified);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('acr_missing_or_mismatch');

    const verifiedHigh: VerifiedIdTokenClaims = { acr: 'high' };
    const ok = oidcAuthService.validateMfaEvidence(profile, verifiedHigh);
    expect(ok.valid).toBe(true);
  });

  it('bypasses MFA evidence entirely when oidcRequireMfa() is false', () => {
    (oidcRequireMfa as jest.Mock).mockReturnValue(false);
    const profile = { sub: 'u', email: 'a@b.com' };
    const verified: VerifiedIdTokenClaims = { amr: ['pwd'] };
    const result = oidcAuthService.validateMfaEvidence(profile, verified);
    expect(result.valid).toBe(true);
  });
});

describe('OidcAuthService buildStateAndNonce', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    setOidcEnv();
  });

  it('returns a unique state and nonce on every call', () => {
    const a = oidcAuthService.buildStateAndNonce();
    const b = oidcAuthService.buildStateAndNonce();
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.state).toMatch(/^[0-9a-f-]{36}$/i);
    expect(a.nonce).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('buildAuthorizationUrl appends nonce when provided', () => {
    const url = oidcAuthService.buildAuthorizationUrl('abc-state', 'abc-nonce');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('state')).toBe('abc-state');
    expect(parsed.searchParams.get('nonce')).toBe('abc-nonce');
  });

  it('buildAuthorizationUrl omits nonce when not provided', () => {
    const url = oidcAuthService.buildAuthorizationUrl('abc-state');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('state')).toBe('abc-state');
    expect(parsed.searchParams.get('nonce')).toBeNull();
  });
});

/**
 * SECURITY FIX V11.2 (Sprint 5 Wave 8 / F17): resolveUser must require
 * `email_verified === true` on a signature-verified id_token, and must look
 * the user up by the email from that token — never by the untrusted userinfo
 * profile. Otherwise an attacker who controls the userinfo response can
 * take over any existing account simply by returning the victim's email.
 */
describe('OidcAuthService resolveUser requires email_verified (V11.2)', () => {
  const { findAuthUserByEmail, createAuthUser } = require('../../modules/auth/auth-user.repository') as {
    findAuthUserByEmail: jest.Mock;
    createAuthUser: jest.Mock;
  };

  const existingRow = {
    id: 'user-existing',
    email: 'victim@corp.example',
    username: 'victim',
    password_hash: 'oidc:victim-sub',
    role: 'tenant_viewer',
    plan: 'starter',
    tenant_id: 'tenant-1',
    status: 'active'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    setOidcEnv();
    findAuthUserByEmail.mockResolvedValue(null);
    createAuthUser.mockResolvedValue(undefined);
    process.env.OIDC_AUTO_PROVISION = 'true';
  });

  it('admits a login whose verified id_token has email_verified: true', async () => {
    const profile = { sub: 'attacker-sub', email: 'attacker@corp.example' };
    const verified: VerifiedIdTokenClaims = {
      sub: 'attacker-sub',
      email: 'attacker@corp.example',
      email_verified: true
    };
    findAuthUserByEmail.mockResolvedValue(null);

    const result = await oidcAuthService.resolveUser(profile, verified);

    expect(findAuthUserByEmail).toHaveBeenCalledWith('attacker@corp.example');
    expect(createAuthUser).toHaveBeenCalledTimes(1);
    expect(result.isProvisioned).toBe(true);
    expect(result.row.email).toBe('attacker@corp.example');
  });

  it('rejects a login whose verified id_token has email_verified: false', async () => {
    const profile = { sub: 'attacker-sub', email: 'victim@corp.example' };
    const verified: VerifiedIdTokenClaims = {
      sub: 'attacker-sub',
      email: 'victim@corp.example',
      email_verified: false
    };
    findAuthUserByEmail.mockResolvedValue(existingRow);

    await expect(
      oidcAuthService.resolveUser(profile, verified)
    ).rejects.toThrow(/email_not_verified/);

    // The user lookup must NOT be reached: an attacker who can flip
    // email_verified to false must not even be allowed to confirm the
    // account exists.
    expect(findAuthUserByEmail).not.toHaveBeenCalled();
    expect(createAuthUser).not.toHaveBeenCalled();
  });

  it('rejects a login when the verified id_token omits email_verified (fail-secure)', async () => {
    // Some IdPs legitimately do not emit email_verified. OIDC Core requires
    // it whenever the email scope is requested, so the safe default is to
    // reject — not to assume "missing means verified".
    const profile = { sub: 'attacker-sub', email: 'victim@corp.example' };
    const verified: VerifiedIdTokenClaims = {
      sub: 'attacker-sub',
      email: 'victim@corp.example'
      // email_verified is intentionally absent
    };
    findAuthUserByEmail.mockResolvedValue(existingRow);

    await expect(
      oidcAuthService.resolveUser(profile, verified)
    ).rejects.toThrow(/email_not_verified/);

    expect(findAuthUserByEmail).not.toHaveBeenCalled();
    expect(createAuthUser).not.toHaveBeenCalled();
  });

  it('rejects a login with email_verified: false even when sub and email match the victim', async () => {
    // Strongest attack: attacker has obtained a valid id_token for a
    // legitimate subject (e.g. token theft), but the IdP did NOT confirm
    // the email. The previous implementation would still return the
    // victim row. The fix must reject before any DB read.
    const profile = { sub: 'victim-sub', email: 'victim@corp.example' };
    const verified: VerifiedIdTokenClaims = {
      sub: 'victim-sub',
      email: 'victim@corp.example',
      email_verified: false
    };
    findAuthUserByEmail.mockResolvedValue(existingRow);

    await expect(
      oidcAuthService.resolveUser(profile, verified)
    ).rejects.toThrow(/email_not_verified/);

    expect(findAuthUserByEmail).not.toHaveBeenCalled();
    expect(createAuthUser).not.toHaveBeenCalled();
  });

  it('rejects a login when no verified claims object is supplied (fail-closed default)', async () => {
    // Defensive: callers that pass nothing (e.g. legacy code) must be
    // rejected, not silently admitted.
    const profile = { sub: 'attacker-sub', email: 'victim@corp.example' };
    findAuthUserByEmail.mockResolvedValue(existingRow);

    await expect(
      oidcAuthService.resolveUser(profile)
    ).rejects.toThrow(/email_not_verified/);

    expect(findAuthUserByEmail).not.toHaveBeenCalled();
  });

  it('uses the verified id_token email, not the unverified userinfo profile email', async () => {
    // V11.2 also covers the case where the userinfo response and the
    // id_token disagree: a compromised IdP might serve userinfo with the
    // victim's email but issue an id_token for the attacker. The lookup
    // must key on the id_token email.
    const profile = { sub: 'attacker-sub', email: 'victim@corp.example' };
    const verified: VerifiedIdTokenClaims = {
      sub: 'attacker-sub',
      email: 'attacker@corp.example',
      email_verified: true
    };
    findAuthUserByEmail.mockResolvedValue(null);

    const result = await oidcAuthService.resolveUser(profile, verified);

    expect(findAuthUserByEmail).toHaveBeenCalledWith('attacker@corp.example');
    expect(findAuthUserByEmail).not.toHaveBeenCalledWith('victim@corp.example');
    expect(result.row.email).toBe('attacker@corp.example');
  });

  it('picks the first verified email from a multi-email `emails` claim', async () => {
    const profile = { sub: 'multi-sub', email: 'a@corp.example' };
    const verified: VerifiedIdTokenClaims = {
      sub: 'multi-sub',
      emails: [
        { value: 'a@corp.example', verified: false },
        { value: 'b@corp.example', verified: true },
        { value: 'c@corp.example', verified: true }
      ],
      email_verified: true
    };
    findAuthUserByEmail.mockResolvedValue(null);

    const result = await oidcAuthService.resolveUser(profile, verified);

    expect(findAuthUserByEmail).toHaveBeenCalledWith('b@corp.example');
    expect(result.row.email).toBe('b@corp.example');
  });

  it('rejects a login whose `emails` array contains no verified entry', async () => {
    const profile = { sub: 'multi-sub', email: 'a@corp.example' };
    const verified: VerifiedIdTokenClaims = {
      sub: 'multi-sub',
      emails: [
        { value: 'a@corp.example', verified: false },
        { value: 'b@corp.example', verified: false }
      ],
      email_verified: true
    };
    findAuthUserByEmail.mockResolvedValue(null);

    await expect(
      oidcAuthService.resolveUser(profile, verified)
    ).rejects.toThrow(/email/i);

    expect(findAuthUserByEmail).not.toHaveBeenCalled();
    expect(createAuthUser).not.toHaveBeenCalled();
  });
});
