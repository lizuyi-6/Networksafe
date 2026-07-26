import { createPublicKey, createVerify, createHash, randomUUID, randomBytes, type KeyObject } from 'crypto';
import type { WritableOptions } from 'stream';
import { uuidv4 } from '../utils/uuid';
import { createAuthUser, findAuthUserByEmail, type AuthUserRow } from '../modules/auth/auth-user.repository';
import { getRolePermissions, normalizeRole } from '../security/permissions';
import { oidcRequireMfa } from '../config/enterprise-runtime';
import logger from '../utils/logger';

export interface OidcUserProfile {
  sub: string;
  email: string;
  name?: string;
  preferred_username?: string;
  amr?: string[] | string;
  acr?: string;
  [key: string]: any;
}

export interface OidcTokenResponse {
  accessToken: string;
  idToken?: string;
}

/**
 * Verified claims extracted from a cryptographically verified id_token.
 * SECURITY FIX V9.11/V9.13: These claims come only after JWKS-backed signature
 * verification, issuer/audience validation, and nonce replay protection. They
 * are the only safe source for downstream authorization decisions such as MFA
 * gate enforcement.
 */
export interface VerifiedIdTokenClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
  nonce?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  amr?: string[] | string;
  acr?: string;
  [key: string]: any;
}

export interface IdTokenVerification {
  valid: boolean;
  reason?: string;
  claims?: VerifiedIdTokenClaims;
}

interface NonceEntry {
  nonce: string;
  expiresAt: number;
}

interface JwksCache {
  fetchedAt: number;
  issuer: string;
  keys: any[];
}

interface AlgSpec {
  alg: string;
  keyType: 'rsa' | 'ec';
}

const ALLOWED_ALGS: Record<string, AlgSpec> = {
  RS256: { alg: 'RSA-SHA256', keyType: 'rsa' },
  RS384: { alg: 'RSA-SHA384', keyType: 'rsa' },
  RS512: { alg: 'RSA-SHA512', keyType: 'rsa' },
  ES256: { alg: 'ecdsa-with-SHA256', keyType: 'ec' },
  ES384: { alg: 'ecdsa-with-SHA384', keyType: 'ec' },
  ES512: { alg: 'ecdsa-with-SHA512', keyType: 'ec' }
};

const CLOCK_SKEW_SECONDS = 5;
const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const JWKS_TTL_MS = 5 * 60 * 1000; // 5 minutes
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — kid not found in last fetch
const JWKS_FETCH_RATE_LIMIT_MS = 10 * 1000; // 10 seconds — per-issuer fetch throttle
const MAX_KID_LENGTH = 256; // prevent memory-pressure abuse

function env(name: string): string {
  return String(process.env[name] || '').trim();
}

function boolEnv(name: string, fallback = false): boolean {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

/**
 * SECURITY FIX (redteam R1): reject cleartext http:// URLs for the
 * trust-anchor OIDC endpoints (issuer + userinfo + authorization + token)
 * unless the operator has explicitly opted in to insecure HTTP AND the
 * process is not running in production. This closes the OIDC issuer
 * MITM attack surface: with an http:// OIDC_ISSUER, an on-path attacker
 * serves a forged JWKS and the signature-verification step trusts the
 * attacker's public key.
 *
 * The escape hatch is only honored when:
 *   1. ALLOW_INSECURE_OIDC_HTTP=true, AND
 *   2. NODE_ENV is not 'production' (also refused when APP_MODE=production).
 *
 * In all other configurations, any http:// endpoint value causes
 * `isConfigured()` to return false and the OIDC login button emits a
 * 503 OIDC_NOT_CONFIGURED.
 */
function isInsecureOidcHttpAllowed(): boolean {
  if (!boolEnv('ALLOW_INSECURE_OIDC_HTTP', false)) {
    return false;
  }
  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  const appMode = String(process.env.APP_MODE || '').trim().toLowerCase();
  if (nodeEnv === 'production' || appMode === 'production') {
    return false;
  }
  return true;
}

/**
 * SECURITY FIX (redteam R4-ext): Validate an OIDC issuer URL against
 * common URL-based attack vectors before it is used as a trust anchor.
 *
 * Covers:
 *   1. Userinfo injection:  https://user:pass@evil.com/  — the URL parser
 *      extracts credentials that are invisible when only the origin is shown.
 *   2. Hash-fragment redirect: https://evil.com#@victim.com/ — the fragment
 *      is not sent to the server but confounds URL parsing when constructing
 *      the JWKS endpoint via new URL('/.well-known/jwks.json', issuer).
 *   3. Backslash relay:      https://victim.com\@evil.com  — some parsers
 *      treat the backslash as an authority terminator on Windows, creating a
 *      different origin than intended.
 *
 * @returns true if the URL is safe to use as an OIDC issuer; false otherwise.
 */
function validateOidcIssuer(issuer: string): boolean {
  if (!issuer || typeof issuer !== 'string') return false;
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    logger.error('OIDC issuer is not a valid URL', { issuer });
    return false;
  }
  if (url.username || url.password) {
    logger.error('OIDC issuer contains userinfo (username/password) and is rejected', { issuer });
    return false;
  }
  if (url.hash) {
    logger.error('OIDC issuer contains a hash fragment and is rejected', { issuer });
    return false;
  }
  // Backslash is not a valid path separator in a URL authority component.
  // Reject issuers that contain \@ which can be interpreted as a relay hint.
  if (issuer.includes('\\@') || issuer.includes('@\\')) {
    logger.error('OIDC issuer contains a backslash-before-at-sign and is rejected', { issuer });
    return false;
  }
  return true;
}

function assertHttpsOrWarn(endpointName: string, value: string): string {
  if (!value) {
    return value;
  }
  // SECURITY FIX (redteam R4-ext): validate the full URL structure before
  // accepting an https:// prefix as safe.
  if (!validateOidcIssuer(value)) {
    return '';
  }
  const lower = value.toLowerCase();
  if (lower.startsWith('https://')) {
    return value;
  }
  if (lower.startsWith('http://')) {
    if (isInsecureOidcHttpAllowed()) {
      return value;
    }
    // SECURITY (redteam R1): refuse to use a cleartext URL as a trust
    // anchor. Return empty so isConfigured() reports unconfigured and
    // operators see the misconfig in the OIDC login error path.
    logger.error(
      `OIDC endpoint ${endpointName}=${value} uses cleartext http:// and is not allowed in this environment; ` +
      `set OIDC_*_ENDPOINT to an https:// URL or, for non-production testing only, ` +
      `set ALLOW_INSECURE_OIDC_HTTP=true and ensure NODE_ENV is not 'production'.`
    );
    return '';
  }
  logger.error(`OIDC endpoint ${endpointName} must use http:// or https://`, { value });
  return '';
}

class OidcAuthService {
  private nonceStore: Map<string, NonceEntry> = new Map();
  // PKCE: state → code_verifier (transient, consumed on use)
  private pkceVerifierStore: Map<string, string> = new Map();
  private jwksCache: JwksCache | null = null;
  // Negative cache: kid → expiry timestamp (0 = no entry)
  private negativeCache: Map<string, number> = new Map();
  // In-flight JWKS fetch promises, keyed by issuer (deduplication)
  private inflightFetch: Map<string, Promise<any | null>> = new Map();
  // Per-issuer rate limit: last fetch attempt timestamp
  private lastFetchByIssuer: Map<string, number> = new Map();

  isConfigured(): boolean {
    return Boolean(
      env('OIDC_CLIENT_ID')
      && env('OIDC_CLIENT_SECRET')
      && assertHttpsOrWarn('OIDC_AUTHORIZATION_ENDPOINT', env('OIDC_AUTHORIZATION_ENDPOINT'))
      && assertHttpsOrWarn('OIDC_TOKEN_ENDPOINT', env('OIDC_TOKEN_ENDPOINT'))
      && assertHttpsOrWarn('OIDC_USERINFO_ENDPOINT', env('OIDC_USERINFO_ENDPOINT'))
      && assertHttpsOrWarn('OIDC_ISSUER', env('OIDC_ISSUER'))
      && env('OIDC_REDIRECT_URI')
    );
  }

  /**
   * Generate PKCE code verifier and challenge.
   * Uses crypto.randomBytes for 32 bytes of entropy, base64url-encoded.
   * The challenge is the SHA-256 hash of the verifier, base64url-encoded.
   */
  private generatePkce(): { verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256')
      .update(Buffer.from(verifier))
      .digest('base64url');
    return { verifier, challenge };
  }

  buildAuthorizationUrl(state: string, nonce?: string): string {
    const { verifier, challenge } = this.generatePkce();
    // Store verifier so it can be verified on callback
    this.pkceVerifierStore.set(state, verifier);

    const url = new URL(env('OIDC_AUTHORIZATION_ENDPOINT'));
    url.searchParams.set('client_id', env('OIDC_CLIENT_ID'));
    url.searchParams.set('redirect_uri', env('OIDC_REDIRECT_URI'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', env('OIDC_SCOPES') || 'openid profile email');
    url.searchParams.set('state', state);
    if (nonce) {
      url.searchParams.set('nonce', nonce);
    }
    // PKCE: required for public clients (SPA/mobile), recommended for confidential
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  buildEndSessionUrl(): string | null {
    const endpoint = assertHttpsOrWarn(
      'OIDC_END_SESSION_ENDPOINT',
      env('OIDC_END_SESSION_ENDPOINT')
    );
    if (!endpoint) {
      return null;
    }

    const configuredRedirect = env('OIDC_POST_LOGOUT_REDIRECT_URI');
    const postLogoutRedirectUri = configuredRedirect
      ? assertHttpsOrWarn('OIDC_POST_LOGOUT_REDIRECT_URI', configuredRedirect)
      : '';
    if (configuredRedirect && !postLogoutRedirectUri) {
      return null;
    }

    const url = new URL(endpoint);
    const clientId = env('OIDC_CLIENT_ID');
    if (clientId) {
      url.searchParams.set('client_id', clientId);
    }
    if (postLogoutRedirectUri) {
      url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
    }
    return url.toString();
  }

  /**
   * Generates a fresh OAuth state value AND a matching OIDC nonce, storing the
   * nonce server-side keyed by state. The nonce is later consumed exactly once
   * during id_token verification, providing replay protection.
   */
  buildStateAndNonce(): { state: string; nonce: string } {
    const state = randomUUID();
    const nonce = randomUUID();
    this.nonceStore.set(state, { nonce, expiresAt: Date.now() + NONCE_TTL_MS });
    this.cleanupExpiredNonces();
    return { state, nonce };
  }

  private cleanupExpiredNonces(): void {
    const now = Date.now();
    for (const [key, entry] of this.nonceStore.entries()) {
      if (now > entry.expiresAt) {
        this.nonceStore.delete(key);
        // Also purge the associated PKCE verifier
        this.pkceVerifierStore.delete(key);
      }
    }
  }

  async exchangeCode(code: string, state: string): Promise<OidcTokenResponse> {
    // Retrieve and consume the PKCE code_verifier for this state.
    // If the state is unknown or the verifier was already consumed (replay),
    // the token exchange fails — this prevents authorization code interception.
    const verifier = this.pkceVerifierStore.get(state);
    if (!verifier) {
      throw new Error('backend.oidc_pkce_verifier_missing');
    }
    this.pkceVerifierStore.delete(state);

    const response = await fetch(env('OIDC_TOKEN_ENDPOINT'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: env('OIDC_REDIRECT_URI'),
        client_id: env('OIDC_CLIENT_ID'),
        client_secret: env('OIDC_CLIENT_SECRET'),
        // PKCE: required for public clients, recommended for confidential
        code_verifier: verifier,
      }).toString()
    });

    if (!response.ok) {
      throw new Error(`backend.oidc_token_exchange_failed_${response.status}`);
    }

    const payload = await response.json() as { access_token?: string; id_token?: string };
    if (!payload.access_token) {
      throw new Error('backend.oidc_access_token_missing');
    }

    return {
      accessToken: payload.access_token,
      idToken: payload.id_token
    };
  }

  /**
   * MFA gate enforcement using cryptographically verified id_token claims.
   *
   * SECURITY FIX V9.11: prior implementation fed `idToken` (a raw, unverified
   * string) into `decodeJwtClaims`, allowing attackers to forge `amr: ["mfa"]`
   * / `acr: high` claims and bypass MFA. This method now refuses to run unless
   * it receives a `VerifiedIdTokenClaims` object produced by `verifyIdToken`.
   * The `amr` / `acr` source is the signature-verified token, not the
   * userinfo profile (which is a separate, untrusted channel).
   *
   * SECURITY FIX (redteam R1): the previous spread `{ ...profile, ...verifiedClaims }`
   * silently used attacker-controlled `amr` / `acr` from the userinfo
   * profile whenever the id_token omitted those claims (which is the
   * realistic shape for Okta / Auth0 / Keycloak / Azure AD). The MFA gate
   * is now exclusively evaluated against the signature-verified id_token
   * claims; the `profile` argument is rejected entirely for amr/acr
   * lookups, and `verifiedClaims` missing `amr` is a hard fail when an
   * AMR is required.
   */
  validateMfaEvidence(
    profile: OidcUserProfile,
    verifiedClaims?: VerifiedIdTokenClaims | string
  ): { valid: boolean; reason?: string } {
    if (!oidcRequireMfa()) {
      return { valid: true };
    }

    if (typeof verifiedClaims === 'string') {
      // SECURITY: callers MUST pass verified claim objects, not raw id_token
      // strings. Reject any legacy callers that still hand us an unverified
      // token — otherwise the previous bypass comes right back.
      return { valid: false, reason: 'unverified_id_token_rejected' };
    }

    if (!verifiedClaims || typeof verifiedClaims !== 'object') {
      // SECURITY (redteam R1): refuse to run without a verified-claims
      // object. Reading amr/acr from the unverified userinfo `profile`
      // is the V9.11/V9.13 bypass vector (a malicious or MITM'd IdP can
      // shape userinfo arbitrarily).
      return { valid: false, reason: 'verified_claims_required' };
    }

    const acrRequired = env('OIDC_REQUIRED_ACR');
    if (acrRequired) {
      // SECURITY (redteam R1): only the signature-verified id_token's
      // `acr` claim is consulted. `profile.acr` is NEVER read.
      const claimAcr = typeof verifiedClaims.acr === 'string' ? verifiedClaims.acr : '';
      return claimAcr === acrRequired
        ? { valid: true }
        : { valid: false, reason: 'acr_missing_or_mismatch' };
    }

    const accepted = (env('OIDC_MFA_AMR_VALUES') || 'mfa,otp,webauthn,hwk')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    // SECURITY (redteam R1): only the signature-verified id_token's `amr`
    // claim is consulted. `profile.amr` is NEVER read. If the verified
    // id_token has no `amr` claim, the gate fails closed — the operator
    // must configure their IdP to include amr in the id_token, or remove
    // the MFA requirement.
    const verifiedAmr = verifiedClaims.amr;
    const amr = Array.isArray(verifiedAmr)
      ? verifiedAmr
      : typeof verifiedAmr === 'string'
        ? verifiedAmr.split(/[,\s]+/)
        : [];
    const hasAcceptedAmr = amr.some((value) => accepted.includes(String(value).toLowerCase()));
    return hasAcceptedAmr
      ? { valid: true }
      : { valid: false, reason: 'amr_mfa_missing' };
  }

  /**
   * Fully verifies an OIDC id_token: structural checks, JWKS-backed signature
   * verification, issuer / audience / expiry validation, and nonce replay
   * protection. The nonce store entry is consumed exactly once.
   *
   * SECURITY FIX V9.11 + V9.13: the previous implementation trusted whatever
   * the userinfo endpoint (or the attacker) provided. Verification is now
   * fail-closed: any check that fails returns `valid: false` with a `reason`.
   */
  async verifyIdToken(idToken: string, state: string): Promise<IdTokenVerification> {
    const entry = this.nonceStore.get(state);
    if (!entry) {
      return { valid: false, reason: 'state_unknown' };
    }
    // Consume the nonce immediately to prevent replay of the same callback.
    this.nonceStore.delete(state);
    if (Date.now() > entry.expiresAt) {
      return { valid: false, reason: 'state_expired' };
    }

    if (!idToken || typeof idToken !== 'string') {
      return { valid: false, reason: 'id_token_missing' };
    }

    const issuer = env('OIDC_ISSUER');
    if (!issuer) {
      return { valid: false, reason: 'issuer_not_configured' };
    }
    const clientId = env('OIDC_CLIENT_ID');
    if (!clientId) {
      return { valid: false, reason: 'audience_not_configured' };
    }

    const parts = idToken.split('.');
    if (parts.length !== 3) {
      return { valid: false, reason: 'malformed_token' };
    }

    let header: { alg?: string; kid?: string; typ?: string };
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch {
      return { valid: false, reason: 'malformed_header' };
    }

    if (!header.alg || !Object.prototype.hasOwnProperty.call(ALLOWED_ALGS, header.alg)) {
      return { valid: false, reason: 'unsupported_alg' };
    }
    if (!header.kid || typeof header.kid !== 'string') {
      return { valid: false, reason: 'missing_kid' };
    }

    const jwk = await this.findJwkByKid(issuer, header.kid);
    if (!jwk) {
      return { valid: false, reason: 'unknown_kid' };
    }

    let pubKey: KeyObject;
    try {
      pubKey = createPublicKey({ key: jwk, format: 'jwk' });
    } catch {
      return { valid: false, reason: 'invalid_jwk' };
    }

    const spec = ALLOWED_ALGS[header.alg];
    const signature = Buffer.from(parts[2], 'base64url');
    const signingInput = `${parts[0]}.${parts[1]}`;
    let verified = false;
    try {
      // For ECDSA (ES*), JWT signatures are r||s (IEEE P-1363) — not DER.
      // For RSA (RS*), the signature is the raw PKCS#1 v1.5 value.
      // The Node types declare `options` as `stream.WritableOptions`, but the
      // runtime additionally accepts `dsaEncoding`. We cast through `unknown`
      // so we keep both type-safety and runtime correctness.
      const verifierOptions: WritableOptions | undefined = spec.keyType === 'ec'
        ? ({ dsaEncoding: 'ieee-p1363' } as unknown as WritableOptions)
        : undefined;
      const verifier = createVerify(spec.alg, verifierOptions);
      // `createVerify` is a writable stream; we must feed the signing input
      // before calling `verify()`. Omitting this would make verification
      // trivially fail for every token.
      verifier.write(Buffer.from(signingInput, 'utf8'));
      verifier.end();
      verified = verifier.verify(pubKey, signature);
    } catch {
      verified = false;
    }
    if (!verified) {
      return { valid: false, reason: 'bad_signature' };
    }

    let claims: VerifiedIdTokenClaims;
    try {
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      return { valid: false, reason: 'malformed_claims' };
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = claims.exp;
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || !Number.isInteger(expiresAt)) {
      return { valid: false, reason: 'invalid_exp' };
    }
    const issuedAt = claims.iat;
    if (typeof issuedAt !== 'number' || !Number.isFinite(issuedAt) || !Number.isInteger(issuedAt)) {
      return { valid: false, reason: 'invalid_iat' };
    }
    if (expiresAt + CLOCK_SKEW_SECONDS < now) {
      return { valid: false, reason: 'expired' };
    }
    if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > now) {
      return { valid: false, reason: 'not_yet_valid' };
    }

    if (claims.iss !== issuer) {
      return { valid: false, reason: 'iss_mismatch' };
    }

    const audList = Array.isArray(claims.aud)
      ? claims.aud
      : claims.aud
        ? [claims.aud]
        : [];
    if (!audList.includes(clientId)) {
      return { valid: false, reason: 'aud_mismatch' };
    }

    if (claims.nonce !== entry.nonce) {
      return { valid: false, reason: 'nonce_mismatch' };
    }

    return { valid: true, claims };
  }

  private async findJwkByKid(issuer: string, kid: string): Promise<any | null> {
    // SECURITY (redteam R1 + R4):
    // R1: refuse to fetch JWKS over cleartext http://.  Even when the operator
    // bypasses isConfigured(), this guard closes the MITM attack surface.
    // R4: OIDC JWKS amplification DoS fix.  An attacker randomizes the `kid`
    // header per request, forcing one outbound fetch per call → DoS the IdP.
    //
    // Fixes applied (in order of cheapest check first):
    //   1. R1 http:// block: refuse cleartext issuers.
    //   2. MAX_KID_LENGTH: reject absurdly long kids before any cache lookup.
    //   3. Negative cache: kid that 404'd in the last 5 minutes → skip fetch.
    //   4. Positive JWKS cache: fresh hit avoids all downstream guards.
    //   5. Per-issuer rate limit: max 1 fetch per 10 seconds per issuer.
    //   6. In-flight de-duplication: concurrent requests share one outbound fetch.

    // Guard R1 — block cleartext http:// issuers.
    if (!issuer || (issuer.toLowerCase().startsWith('http://') && !isInsecureOidcHttpAllowed())) {
      logger.error('findJwkByKid refused: OIDC issuer is cleartext http://', { issuer });
      return null;
    }

    // Guard 1 — upper bound on kid string length.
    if (!kid || typeof kid !== 'string' || kid.length > MAX_KID_LENGTH) {
      return null;
    }

    // Guard 2 — negative cache: kid that was not found in the last fetch.
    const negExpiry = this.negativeCache.get(kid);
    if (negExpiry !== undefined && Date.now() < negExpiry) {
      return null;
    }

    // Positive cache — cheapest possible hit; if we have a fresh JWKS that
    // already contains this kid, return it without any downstream checks.
    if (
      this.jwksCache
      && this.jwksCache.issuer === issuer
      && Date.now() - this.jwksCache.fetchedAt < JWKS_TTL_MS
    ) {
      const hit = this.jwksCache.keys.find((k) => k && k.kid === kid);
      if (hit) return hit;
      // kid not in positive cache but cache is fresh — do NOT refetch yet;
      // fall through to rate-limit and in-flight guards.
    }

    // Guard 3 — per-issuer rate limit.
    const lastFetch = this.lastFetchByIssuer.get(issuer) ?? 0;
    const rateLimited = Date.now() - lastFetch < JWKS_FETCH_RATE_LIMIT_MS;

    // Guard 4 — in-flight de-duplication.  Set BEFORE checking so that
    // concurrent entrants all share the same promise (not their own).
    // If another fetch is already in-flight, reuse it rather than starting a new one.
    const existing = this.inflightFetch.get(issuer);
    if (existing !== undefined) {
      // A fetch for this issuer is already running.  Wait for it; its result
      // will be in jwksCache when it resolves.
      try {
        const keys = await existing;
        // After the in-flight resolves, search the now-cached JWKS.
        if (
          this.jwksCache
          && this.jwksCache.issuer === issuer
          && Date.now() - this.jwksCache.fetchedAt < JWKS_TTL_MS
        ) {
          return this.jwksCache.keys.find((k) => k && k.kid === kid) ?? null;
        }
        return null;
      } catch {
        // In-flight was rejected; it has been cleared.  Proceed to fetch.
        // But skip if rate-limited (another fetch just succeeded and the cache
        // is fresh enough for a positive hit; for unknown kids we rate-limit).
        if (rateLimited) return null;
      }
    }

    // If we are rate-limited and have no in-flight request, we cannot make
    // progress: a fetch now would violate the rate-limit.  Return null.
    if (rateLimited) {
      return null;
    }

    // ---- Actually fetch JWKS from the IdP ----
    const doFetch = async (): Promise<any[]> => {
      try {
        const jwksUrl = new URL('/.well-known/jwks.json', issuer).toString();
        const response = await fetch(jwksUrl);
        if (!response.ok) return [];
        const jwks = await response.json() as { keys?: any[] };
        return Array.isArray(jwks.keys) ? jwks.keys : [];
      } catch {
        return [];
      }
    };

    const fetchPromise = (async () => {
      const keys = await doFetch();
      this.jwksCache = { fetchedAt: Date.now(), issuer, keys };
      this.lastFetchByIssuer.set(issuer, Date.now());
      // Clear negative-cache entries for kids that ARE present in the result.
      for (const k of keys) {
        if (k && k.kid) this.negativeCache.delete(k.kid);
      }
      // If the result is empty, record a negative entry for the requested kid.
      if (keys.length === 0) {
        this.negativeCache.set(kid, Date.now() + NEGATIVE_CACHE_TTL_MS);
      }
      return keys;
    })();

    this.inflightFetch.set(issuer, fetchPromise);

    const keys = await fetchPromise;
    this.inflightFetch.delete(issuer);
    return keys.find((k) => k && k.kid === kid) ?? null;
  }

  async fetchUserProfile(accessToken: string): Promise<OidcUserProfile> {
    const response = await fetch(env('OIDC_USERINFO_ENDPOINT'), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`backend.oidc_userinfo_failed_${response.status}`);
    }

    const payload = await response.json() as OidcUserProfile;
    if (!payload.email) {
      throw new Error('backend.oidc_email_missing');
    }
    return payload;
  }

  /**
   * Revoke the short-lived OIDC access token after userinfo has been read.
   * Browser SSO termination is handled separately through buildEndSessionUrl().
   */
  async revokeToken(accessToken: string): Promise<void> {
    const revocationEndpoint = process.env.OIDC_TOKEN_REVOCATION_ENDPOINT;
    if (!revocationEndpoint) return;

    try {
      const validatedEndpoint = assertHttpsOrWarn(
        'OIDC_TOKEN_REVOCATION_ENDPOINT',
        revocationEndpoint.trim()
      );
      if (!validatedEndpoint) {
        return;
      }

      const response = await fetch(validatedEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${process.env.OIDC_CLIENT_ID}:${process.env.OIDC_CLIENT_SECRET}`
          ).toString('base64')}`
        },
        body: new URLSearchParams({ token: accessToken, token_type_hint: 'access_token' })
      });
      if (!response.ok) {
        logger.warn('OIDC token revocation was rejected', { status: response.status });
      }
    } catch (err) {
      logger.warn('OIDC token revocation failed', { error: (err as Error).message });
    }
  }

  /**
   * Resolves a user row from an OIDC login callback.
   *
   * SECURITY FIX V11.2 (Sprint 5 Wave 8 / F17): prior implementation trusted
   * `profile.email` from the unverified userinfo endpoint, allowing an IdP
   * that controls the userinfo response (compromised IdP, misconfigured OIDC
   * tenant, self-hosted attacker IdP) to take over any existing account by
   * returning a victim's email. The id_token `email_verified` claim was never
   * read.
   *
   * The function now requires a signature-verified claims object and:
   *  - refuses to run unless `email_verified === true` (fail-closed — IdPs
   *    that omit the claim are rejected, since the claim is a hard OIDC Core
   *    requirement when the `email` scope is requested);
   *  - uses the email from the verified id_token, never the untrusted
   *    userinfo profile, so a tampered userinfo response cannot redirect
   *    the lookup to a victim's account;
   *  - handles the multi-email `emails` array claim by selecting the first
   *    entry whose `verified === true`.
   *
   * `verifiedClaims` is optional only so that legacy/misconfigured callers
   * fail closed: omitting it (or passing one without `email_verified: true`)
   * causes a hard rejection rather than a silent account takeover.
   */
  async resolveUser(
    profile: OidcUserProfile,
    verifiedClaims?: VerifiedIdTokenClaims
  ): Promise<{
    row: AuthUserRow;
    isProvisioned: boolean;
  }> {
    if (!verifiedClaims || verifiedClaims.email_verified !== true) {
      // SECURITY V11.2: never admit a user whose email is not confirmed by
      // the IdP in a signature-verified token. Includes the "claim missing"
      // case (IdP failed to assert verification) — fail-secure.
      throw new Error('backend.oidc_email_not_verified');
    }

    // SECURITY V11.2: prefer the email from the verified id_token over the
    // userinfo profile. The id_token is signature-verified end-to-end; the
    // userinfo response is fetched with a bearer token and is a separate,
    // attacker-influenced channel.
    let trustedEmail: string | null = null;
    if (typeof verifiedClaims.email === 'string' && verifiedClaims.email.length > 0) {
      trustedEmail = verifiedClaims.email;
    } else if (Array.isArray(verifiedClaims.emails) && verifiedClaims.emails.length > 0) {
      // Multi-email case: only accept entries the IdP marks as verified.
      for (const entry of verifiedClaims.emails) {
        if (
          entry
          && typeof entry === 'object'
          && (entry as { verified?: unknown }).verified === true
          && typeof (entry as { value?: unknown }).value === 'string'
          && ((entry as { value: string }).value.length > 0)
        ) {
          trustedEmail = (entry as { value: string }).value;
          break;
        }
      }
    }
    if (!trustedEmail) {
      throw new Error('backend.oidc_email_claim_missing_or_unverified');
    }

    const existing = await findAuthUserByEmail(trustedEmail);
    if (existing) {
      return { row: existing, isProvisioned: false };
    }

    if (!boolEnv('OIDC_AUTO_PROVISION', false)) {
      throw new Error('backend.oidc_user_not_provisioned');
    }

    const defaultRole = normalizeRole(env('OIDC_AUTO_PROVISION_ROLE') || 'tenant_viewer');
    const tenantId = env('OIDC_DEFAULT_TENANT_ID') || randomUUID();
    const row: AuthUserRow = {
      id: uuidv4(),
      email: trustedEmail,
      username: profile.preferred_username || profile.name || trustedEmail.split('@')[0],
      password_hash: `oidc:${profile.sub}`,
      role: defaultRole,
      plan: 'starter',
      tenant_id: tenantId,
      status: 'active'
    };
    await createAuthUser(row);
    return { row, isProvisioned: true };
  }

  buildState(): string {
    return randomUUID();
  }

  buildSessionUser(row: AuthUserRow) {
    return {
      userId: row.id,
      email: row.email,
      username: row.username,
      role: normalizeRole(row.role),
      plan: row.plan || 'starter',
      tenantId: row.tenant_id || undefined,
      permissions: getRolePermissions(row.role)
    };
  }
}

export const oidcAuthService = new OidcAuthService();
