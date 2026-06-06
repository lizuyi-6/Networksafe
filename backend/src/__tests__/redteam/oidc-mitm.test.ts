/**
 * REDTEAM SECURITY TEST — OIDC issuer MITM (V9.11/V9.13 bypass)
 * ==============================================================
 *
 * Threat model: backend trusts `OIDC_ISSUER` from env. If the operator (or an
 * attacker who can influence the env) sets `OIDC_ISSUER=http://...` (no https
 * enforcement), an on-path attacker can serve a forged JWKS containing their
 * own RSA public key. The signature verification then succeeds against the
 * attacker's key — the entire JWT trust chain collapses to "trust whatever
 * the attacker serves."
 *
 * Combined with the V9.11 `validateMfaEvidence` spread-order weakness
 * (`{ ...profile, ...(verifiedClaims || {}) }`), the attacker can also
 * satisfy the MFA gate by serving userinfo with `amr: ['mfa']` (most IdPs
 * do NOT put amr in the id_token, only in userinfo).
 *
 * Result: full OIDC login bypass → arbitrary user takeover when OIDC_ISSUER
 * is misconfigured to an http:// URL.
 *
 * Fix proposals (Sprint target):
 *   1. Enforce https:// on OIDC_ISSUER / OIDC_USERINFO_ENDPOINT /
 *      OIDC_AUTHORIZATION_ENDPOINT / OIDC_TOKEN_ENDPOINT. Reject http:// in
 *      production runtime (allow only when ALLOW_INSECURE_OIDC_HTTP=true AND
 *      NODE_ENV !== 'production').
 *   2. Fix the `validateMfaEvidence` spread order: `verifiedClaims` must
 *      take precedence; `profile.amr` / `profile.acr` must NEVER be consulted
 *      when `verifiedClaims` is present (fail-closed if verifiedClaims is
 *      missing the claim).
 *   3. Add a JWKS negative cache (per-kid "not found" TTL) and per-IP rate
 *      limit on `findJwkByKid` to defeat the amplification DoS variant
 *      (separate test, see oidc-jwks-dos.test.ts).
 */

import { generateKeyPairSync, sign, KeyObject } from 'crypto';
import * as http from 'http';
import { AddressInfo } from 'net';
import { oidcAuthService, type VerifiedIdTokenClaims } from '../../services/oidc-auth.service';

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

jest.mock('../../modules/auth/auth-user.repository', () => ({
  findAuthUserByEmail: jest.fn(),
  createAuthUser: jest.fn().mockResolvedValue(undefined)
}));

interface KeyMaterial {
  privateKey: KeyObject;
  publicJwk: any;
}

function makeAttackerKey(): KeyMaterial {
  // Attacker generates their OWN RSA keypair — the "well-known" key the
  // MITM will serve via /jwks.json.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'attacker-kid-1';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { privateKey, publicJwk: jwk };
}

function b64url(input: object | string): string {
  const data = typeof input === 'string' ? Buffer.from(input) : Buffer.from(JSON.stringify(input));
  return data.toString('base64url');
}

function makeForgedJwt(
  claims: Record<string, any>,
  attackerKey: KeyObject
): string {
  const header = { alg: 'RS256', typ: 'JWT', kid: 'attacker-kid-1' };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const sig = sign('RSA-SHA256', Buffer.from(signingInput), attackerKey).toString('base64url');
  return `${signingInput}.${sig}`;
}

const ORIGINAL_FETCH = global.fetch;

function resetServiceState(): void {
  const svc = oidcAuthService as any;
  if (svc.nonceStore && typeof svc.nonceStore.clear === 'function') {
    svc.nonceStore.clear();
  }
  if ('jwksCache' in svc) {
    svc.jwksCache = null;
  }
}

describe('REDTEAM OIDC issuer MITM — V9.11/V9.13 bypass via http:// OIDC_ISSUER', () => {
  let attackerKey: KeyMaterial;
  let idpServer: http.Server;
  let idpPort: number;
  let idpUrl: string;

  beforeAll((done) => {
    // Stand up a tiny fake IdP on 127.0.0.1 — the "MITM" the operator's
    // misconfigured OIDC_ISSUER points at.
    attackerKey = makeAttackerKey();
    idpServer = http.createServer((req, res) => {
      // JWKS: serve the attacker's public key only.
      if (req.url?.endsWith('/.well-known/jwks.json')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ keys: [attackerKey.publicJwk] }));
        return;
      }
      // Userinfo: serve whatever the attacker wants, including amr=['mfa'].
      if (req.url?.endsWith('/userinfo')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          sub: 'attacker-sub',
          email: 'admin@victim',
          email_verified: true,
          preferred_username: 'attacker',
          // Attacker-controlled amr / acr in userinfo. The V9.11 spread
          // silently falls back to this when the id_token omits amr.
          amr: ['mfa', 'webauthn'],
          acr: 'urn:mace:incommon:iap:silver'
        }));
        return;
      }
      res.writeHead(404);
      res.end('not used');
    });
    idpServer.listen(0, '127.0.0.1', () => {
      idpPort = (idpServer.address() as AddressInfo).port;
      idpUrl = `http://127.0.0.1:${idpPort}`;
      done();
    });
  });

  afterAll((done) => {
    idpServer.close(() => done());
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();

    // === The exploit: OIDC_ISSUER is http:// ===
    // In production the operator either set this to a cleartext URL (LAN
    // IdP, dev/staging typo, env-injection) or an attacker controls the
    // env var (supply chain, malicious config-as-code, K8s configmap).
    // SECURITY FIX R1: the escape hatch ALLOW_INSECURE_OIDC_HTTP must be
    // explicitly false (not just defaulted) so this test is deterministic.
    process.env.ALLOW_INSECURE_OIDC_HTTP = 'false';
    process.env.OIDC_ISSUER = idpUrl;
    process.env.OIDC_CLIENT_ID = 'aetherguard-victim-client';
    process.env.OIDC_CLIENT_SECRET = 'irrelevant-the-mitm-doesnt-need-it';
    process.env.OIDC_AUTHORIZATION_ENDPOINT = `${idpUrl}/authorize`;
    process.env.OIDC_TOKEN_ENDPOINT = `${idpUrl}/token`;
    process.env.OIDC_USERINFO_ENDPOINT = `${idpUrl}/userinfo`;
    process.env.OIDC_REDIRECT_URI = 'https://app.victim.test/callback';
    process.env.OIDC_SCOPES = 'openid profile email';
    process.env.OIDC_REQUIRE_MFA = 'true';
    process.env.OIDC_MFA_AMR_VALUES = 'mfa,otp,webauthn,hwk';
    process.env.OIDC_REQUIRED_ACR = '';

    // Restore fetch — the test runtime will go through node's http and
    // hit our local MITM. We intentionally do NOT mock fetch: the goal
    // is to prove the real code path goes out to a cleartext URL and
    // trusts whatever it gets.
    global.fetch = ORIGINAL_FETCH;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('REFUSES to verify any id_token when OIDC_ISSUER is cleartext http://', async () => {
    // Patch assertion: after the R1 fix, isConfigured() returns false for
    // http:// trust anchors, and verifyIdToken refuses to fetch JWKS over
    // a cleartext URL even if the operator bypasses the isConfigured gate.
    expect(oidcAuthService.isConfigured()).toBe(false);

    const { state, nonce } = oidcAuthService.buildStateAndNonce();
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      sub: 'attacker-sub',
      iss: idpUrl,
      aud: 'aetherguard-victim-client',
      exp: now + 300,
      iat: now,
      nonce,
      email: 'admin@victim',
      email_verified: true
    };
    const token = makeForgedJwt(claims, attackerKey.privateKey);

    const result = await oidcAuthService.verifyIdToken(token, state);
    expect(result.valid).toBe(false);
    // Either reason is acceptable: the operator may have left the http://
    // env var set (issuer empty after the gate), or the runtime may have
    // refused the JWKS fetch directly. Both defeat the MITM.
    expect(['issuer_not_configured', 'unknown_kid']).toContain(result.reason);
  });

  it('REFUSES the MFA gate when only the userinfo profile supplies amr (R1 spread-order fix)', async () => {
    // Patch assertion: after the R1 fix, the spread is gone. amr is read
    // only from the signature-verified id_token. Even if an attacker
    // managed to bypass isConfigured and pass a verified-claims object,
    // an id_token without amr is a hard fail-closed for the MFA gate.
    const verifiedClaims: VerifiedIdTokenClaims = {
      iss: idpUrl,
      aud: 'aetherguard-victim-client',
      sub: 'attacker-sub',
      email: 'admin@victim',
      email_verified: true
      // NO amr / NO acr.
    };
    const userinfo = {
      sub: 'attacker-sub',
      email: 'admin@victim',
      amr: ['mfa', 'webauthn'],
      acr: 'urn:mace:incommon:iap:silver'
    };

    const mfa = oidcAuthService.validateMfaEvidence(userinfo, verifiedClaims);
    expect(mfa.valid).toBe(false);
    expect(mfa.reason).toBe('amr_mfa_missing');
  });

  it('REFUSES the ACR gate when only the userinfo profile supplies acr (R1 spread-order fix)', async () => {
    process.env.OIDC_REQUIRED_ACR = 'urn:mace:incommon:iap:silver';

    const verifiedClaims: VerifiedIdTokenClaims = {
      iss: idpUrl,
      aud: 'aetherguard-victim-client',
      sub: 'attacker-sub',
      email: 'admin@victim',
      email_verified: true
      // NO acr in the verified id_token.
    };
    const userinfo = {
      sub: 'attacker-sub',
      email: 'admin@victim',
      acr: 'urn:mace:incommon:iap:silver'
    };

    const mfa = oidcAuthService.validateMfaEvidence(userinfo, verifiedClaims);
    expect(mfa.valid).toBe(false);
    expect(mfa.reason).toBe('acr_missing_or_mismatch');
  });

  it('still allows the MFA gate when verified id_token carries amr=mfa (regression check)', async () => {
    // Sanity: the fix must not break the happy path. A legitimately
    // issued id_token with amr=['mfa'] should still satisfy the gate.
    const verifiedClaims: VerifiedIdTokenClaims = {
      iss: idpUrl,
      aud: 'aetherguard-victim-client',
      sub: 'real-user',
      email: 'real@victim',
      email_verified: true,
      amr: ['pwd', 'mfa']
    };
    const mfa = oidcAuthService.validateMfaEvidence(
      { sub: 'real-user', email: 'real@victim', amr: ['pwd'] }, // userinfo w/o mfa
      verifiedClaims
    );
    expect(mfa.valid).toBe(true);
    expect(mfa.reason).toBeUndefined();
  });
});
