/**
 * OidcAuthService full integration tests
 *
 * Covers: resolveUser, fetchUserProfile, exchangeCode, buildStateAndNonce,
 * validateMfaEvidence, isConfigured, buildAuthorizationUrl, buildSessionUser,
 * and the V11.2 email_verified fail-closed branch.
 *
 * Uses real RSA-signed JWTs (same pattern as oidc-auth.token-verify.test.ts).
 * The token-verify file focuses on verifyIdToken; this file covers the rest.
 */

import { generateKeyPairSync, sign, type KeyObject } from 'crypto';
import { oidcAuthService, type OidcUserProfile, type VerifiedIdTokenClaims } from '../../services/oidc-auth.service';
import { oidcRequireMfa } from '../../config/enterprise-runtime';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
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

function makeJwt(claims: Record<string, any>, privateKey: KeyObject, kid = KID): string {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const sig = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${sig}`;
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

function resetServiceState(): void {
  const svc = oidcAuthService as any;
  if (svc.nonceStore && typeof svc.nonceStore.clear === 'function') {
    svc.nonceStore.clear();
  }
  if (svc.pkceVerifierStore && typeof svc.pkceVerifierStore.clear === 'function') {
    svc.pkceVerifierStore.clear();
  }
  if ('jwksCache' in svc) {
    svc.jwksCache = null;
  }
}

const ORIGINAL_FETCH = global.fetch;

describe('OidcAuthService resolveUser (V11.2 email_verified)', () => {
  const { findAuthUserByEmail, createAuthUser } = require('../../modules/auth/auth-user.repository') as {
    findAuthUserByEmail: jest.Mock;
    createAuthUser: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    setOidcEnv();
    process.env.OIDC_AUTO_PROVISION = 'true';
    process.env.OIDC_AUTO_PROVISION_ROLE = 'tenant_viewer';
    findAuthUserByEmail.mockResolvedValue(null);
    createAuthUser.mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('provisions a new user when email_verified=true and no existing user found', async () => {
    const profile: OidcUserProfile = { sub: 'sub-new', email: 'new@corp.example' };
    const verified: VerifiedIdTokenClaims = { email: 'new@corp.example', email_verified: true };

    const result = await oidcAuthService.resolveUser(profile, verified);

    expect(findAuthUserByEmail).toHaveBeenCalledWith('new@corp.example');
    expect(createAuthUser).toHaveBeenCalledTimes(1);
    expect(result.isProvisioned).toBe(true);
    expect(result.row.email).toBe('new@corp.example');
  });

  it('returns existing user without re-provisioning when email already exists', async () => {
    const existingRow = {
      id: 'user-existing-id',
      email: 'existing@corp.example',
      username: 'existing',
      password_hash: 'oidc:sub-existing',
      role: 'tenant_viewer',
      plan: 'starter',
      tenant_id: 'tenant-1',
      status: 'active' as const
    };
    findAuthUserByEmail.mockResolvedValue(existingRow);

    const profile: OidcUserProfile = { sub: 'sub-attacker', email: 'existing@corp.example' };
    const verified: VerifiedIdTokenClaims = { email: 'existing@corp.example', email_verified: true };

    const result = await oidcAuthService.resolveUser(profile, verified);

    expect(result.isProvisioned).toBe(false);
    expect(result.row.id).toBe('user-existing-id');
    expect(createAuthUser).not.toHaveBeenCalled();
  });

  it('throws when email_verified=false (V11.2 fail-closed)', async () => {
    const profile: OidcUserProfile = { sub: 'sub-attacker', email: 'victim@corp.example' };
    const verified: VerifiedIdTokenClaims = { email: 'victim@corp.example', email_verified: false };

    await expect(oidcAuthService.resolveUser(profile, verified)).rejects.toThrow(/email_not_verified/);
    expect(findAuthUserByEmail).not.toHaveBeenCalled();
  });

  it('throws when email_verified is absent (fail-secure default)', async () => {
    const profile: OidcUserProfile = { sub: 'sub-attacker', email: 'victim@corp.example' };
    const verified: VerifiedIdTokenClaims = { email: 'victim@corp.example' } as any;

    await expect(oidcAuthService.resolveUser(profile, verified)).rejects.toThrow(/email_not_verified/);
    expect(findAuthUserByEmail).not.toHaveBeenCalled();
  });

  it('throws when no verifiedClaims are provided at all', async () => {
    const profile: OidcUserProfile = { sub: 'sub-attacker', email: 'any@corp.example' };

    await expect(oidcAuthService.resolveUser(profile)).rejects.toThrow(/email_not_verified/);
  });

  it('uses verified id_token email, never the userinfo profile email', async () => {
    // Compromised IdP serves victim email in userinfo but attacker email in id_token.
    // Lookup must use the id_token email (signature-verified), not userinfo.
    findAuthUserByEmail.mockResolvedValue(null);
    const profile: OidcUserProfile = { sub: 'attacker-sub', email: 'victim@corp.example' };
    const verified: VerifiedIdTokenClaims = { email: 'attacker@corp.example', email_verified: true };

    await oidcAuthService.resolveUser(profile, verified);

    expect(findAuthUserByEmail).toHaveBeenCalledWith('attacker@corp.example');
    expect(findAuthUserByEmail).not.toHaveBeenCalledWith('victim@corp.example');
  });

  it('selects first verified email from multi-email emails array', async () => {
    findAuthUserByEmail.mockResolvedValue(null);
    // verifiedClaims.email is empty/undefined so the emails array is consulted
    const profile: OidcUserProfile = { sub: 'multi-sub', email: 'first@corp.example' };
    const verified: VerifiedIdTokenClaims = {
      email: '',
      email_verified: true,
      emails: [
        { value: 'first@corp.example', verified: false },
        { value: 'second@corp.example', verified: true },
        { value: 'third@corp.example', verified: true }
      ]
    };

    const result = await oidcAuthService.resolveUser(profile, verified);

    expect(findAuthUserByEmail).toHaveBeenCalledWith('second@corp.example');
    expect(result.row.email).toBe('second@corp.example');
  });

  it('throws when emails array has no verified entry and email field is empty', async () => {
    findAuthUserByEmail.mockResolvedValue(null);
    const profile: OidcUserProfile = { sub: 'multi-sub', email: 'first@corp.example' };
    const verified: VerifiedIdTokenClaims = {
      email: '',
      email_verified: true,
      emails: [
        { value: 'first@corp.example', verified: false },
        { value: 'second@corp.example', verified: false }
      ]
    };

    await expect(oidcAuthService.resolveUser(profile, verified)).rejects.toThrow(/email/i);
    expect(createAuthUser).not.toHaveBeenCalled();
  });

  it('throws when OIDC_AUTO_PROVISION is false and user does not exist', async () => {
    process.env.OIDC_AUTO_PROVISION = 'false';
    findAuthUserByEmail.mockResolvedValue(null);

    const profile: OidcUserProfile = { sub: 'sub-new', email: 'new@corp.example' };
    const verified: VerifiedIdTokenClaims = { email: 'new@corp.example', email_verified: true };

    await expect(oidcAuthService.resolveUser(profile, verified)).rejects.toThrow(/not_provisioned/);
  });

  it('uses preferred_username from profile when creating new user', async () => {
    findAuthUserByEmail.mockResolvedValue(null);
    const profile: OidcUserProfile = {
      sub: 'sub-new',
      email: 'new@corp.example',
      preferred_username: 'custom_username'
    };
    const verified: VerifiedIdTokenClaims = { email: 'new@corp.example', email_verified: true };

    await oidcAuthService.resolveUser(profile, verified);

    const createCall = createAuthUser.mock.calls[0][0];
    expect(createCall.username).toBe('custom_username');
  });

  it('falls back to name or email prefix for username when preferred_username is absent', async () => {
    findAuthUserByEmail.mockResolvedValue(null);
    const profile: OidcUserProfile = { sub: 'sub-new', email: 'john.doe@corp.example', name: 'John Doe' };
    const verified: VerifiedIdTokenClaims = { email: 'john.doe@corp.example', email_verified: true };

    await oidcAuthService.resolveUser(profile, verified);

    const createCall = createAuthUser.mock.calls[0][0];
    expect(createCall.username).toBe('John Doe');
  });
});

describe('OidcAuthService exchangeCode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    setOidcEnv();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('exchanges authorization code for tokens successfully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ access_token: 'access-abc', id_token: 'id-xyz' })
    }) as any;

    // R5 V12.18 (PKCE): prime the verifier store by calling
    // buildAuthorizationUrl first so exchangeCode can look up the
    // verifier by state. The PKCE store is populated by
    // buildAuthorizationUrl (not by buildStateAndNonce).
    const { state } = oidcAuthService.buildStateAndNonce();
    oidcAuthService.buildAuthorizationUrl(state);

    const result = await oidcAuthService.exchangeCode('auth-code-123', state);

    expect(result.accessToken).toBe('access-abc');
    expect(result.idToken).toBe('id-xyz');
    expect(global.fetch).toHaveBeenCalledWith(
      `${ISSUER}/token`,
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('grant_type=authorization_code') })
    );
  });

  it('throws when token endpoint returns non-OK', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401
    }) as any;

    const { state } = oidcAuthService.buildStateAndNonce();
    oidcAuthService.buildAuthorizationUrl(state);
    await expect(oidcAuthService.exchangeCode('bad-code', state)).rejects.toThrow(/oidc_token_exchange_failed_401/);
  });

  it('throws when response is missing access_token', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id_token: 'only-id' })
    }) as any;

    const { state } = oidcAuthService.buildStateAndNonce();
    oidcAuthService.buildAuthorizationUrl(state);
    await expect(oidcAuthService.exchangeCode('code-no-access', state)).rejects.toThrow(/backend.oidc_access_token_missing/);
  });

  it('throws when PKCE verifier is missing for the supplied state', async () => {
    // SECURITY FIX (redteam R5 V12.18): PKCE is mandatory. An
    // exchangeCode call with a state that has no verifier in the
    // store must fail closed.
    global.fetch = jest.fn() as any;
    await expect(
      oidcAuthService.exchangeCode('any-code', 'state-without-verifier')
    ).rejects.toThrow(/pkce_verifier_missing/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('OidcAuthService fetchUserProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    setOidcEnv();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('returns user profile from userinfo endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sub: 'user-1', email: 'alice@corp.example', name: 'Alice' })
    }) as any;

    const result = await oidcAuthService.fetchUserProfile('Bearer access-token');

    expect(result.email).toBe('alice@corp.example');
    expect(result.name).toBe('Alice');
  });

  it('throws when userinfo endpoint fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503
    }) as any;

    await expect(oidcAuthService.fetchUserProfile('Bearer bad-token')).rejects.toThrow(/oidc_userinfo_failed_503/);
  });

  it('throws when userinfo response omits email', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sub: 'user-1', name: 'No Email' })
    }) as any;

    await expect(oidcAuthService.fetchUserProfile('Bearer token-no-email')).rejects.toThrow(/backend.oidc_email_missing/);
  });
});

describe('OidcAuthService isConfigured', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('returns true when all required env vars are set with https endpoints', () => {
    setOidcEnv();
    expect(oidcAuthService.isConfigured()).toBe(true);
  });

  it('returns false when OIDC_CLIENT_ID is missing', () => {
    setOidcEnv();
    delete process.env.OIDC_CLIENT_ID;
    expect(oidcAuthService.isConfigured()).toBe(false);
  });

  it('returns false when OIDC_CLIENT_SECRET is missing', () => {
    setOidcEnv();
    delete process.env.OIDC_CLIENT_SECRET;
    expect(oidcAuthService.isConfigured()).toBe(false);
  });

  it('returns false when OIDC_ISSUER uses http:// in production', () => {
    setOidcEnv();
    process.env.NODE_ENV = 'production';
    process.env.OIDC_ISSUER = 'http://insecure-idp.example.test';
    expect(oidcAuthService.isConfigured()).toBe(false);
  });

  it('allows http:// OIDC_ISSUER when ALLOW_INSECURE_OIDC_HTTP=true and not production', () => {
    setOidcEnv();
    process.env.ALLOW_INSECURE_OIDC_HTTP = 'true';
    process.env.NODE_ENV = 'development';
    process.env.OIDC_ISSUER = 'http://insecure-idp.example.test';
    expect(oidcAuthService.isConfigured()).toBe(true);
  });

  it('rejects non-http OIDC endpoint schemes', () => {
    setOidcEnv();
    process.env.OIDC_AUTHORIZATION_ENDPOINT = 'javascript:alert(1)';
    expect(oidcAuthService.isConfigured()).toBe(false);
  });
});

describe('OidcAuthService buildAuthorizationUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    setOidcEnv();
  });

  it('includes all required OAuth2/OIDC params', () => {
    const url = oidcAuthService.buildAuthorizationUrl('my-state', 'my-nonce');
    const parsed = new URL(url);

    expect(parsed.origin).toBe(ISSUER);
    expect(parsed.pathname).toBe('/authorize');
    expect(parsed.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example.test/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('state')).toBe('my-state');
    expect(parsed.searchParams.get('nonce')).toBe('my-nonce');
    expect(parsed.searchParams.get('scope')).toBe('openid profile email');
  });

  it('omits nonce when not provided', () => {
    const url = oidcAuthService.buildAuthorizationUrl('my-state');
    const parsed = new URL(url);

    expect(parsed.searchParams.get('nonce')).toBeNull();
  });

  it('uses custom scopes when OIDC_SCOPES is set', () => {
    process.env.OIDC_SCOPES = 'openid profile email phone';
    const url = oidcAuthService.buildAuthorizationUrl('state-1');
    const parsed = new URL(url);

    expect(parsed.searchParams.get('scope')).toBe('openid profile email phone');
  });
});

describe('OidcAuthService logout helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    setOidcEnv();
    process.env.OIDC_END_SESSION_ENDPOINT = `${ISSUER}/logout`;
    process.env.OIDC_POST_LOGOUT_REDIRECT_URI = 'https://app.example.test/login';
    process.env.OIDC_TOKEN_REVOCATION_ENDPOINT = `${ISSUER}/revoke`;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    delete process.env.OIDC_END_SESSION_ENDPOINT;
    delete process.env.OIDC_POST_LOGOUT_REDIRECT_URI;
    delete process.env.OIDC_TOKEN_REVOCATION_ENDPOINT;
  });

  it('builds an IdP end-session URL from trusted configuration only', () => {
    const url = oidcAuthService.buildEndSessionUrl();
    expect(url).not.toBeNull();

    const parsed = new URL(url!);
    expect(parsed.origin).toBe(ISSUER);
    expect(parsed.pathname).toBe('/logout');
    expect(parsed.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(parsed.searchParams.get('post_logout_redirect_uri'))
      .toBe('https://app.example.test/login');
  });

  it('returns null when the configured end-session endpoint is unsafe', () => {
    process.env.OIDC_END_SESSION_ENDPOINT = 'javascript:alert(1)';
    expect(oidcAuthService.buildEndSessionUrl()).toBeNull();
  });

  it('revokes the short-lived access token after userinfo use', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as any;

    await oidcAuthService.revokeToken('oidc-access-token');

    expect(global.fetch).toHaveBeenCalledWith(
      `${ISSUER}/revoke`,
      expect.objectContaining({
        method: 'POST',
        body: expect.any(URLSearchParams)
      })
    );
    const options = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(options.body.get('token')).toBe('oidc-access-token');
    expect(options.body.get('token_type_hint')).toBe('access_token');
  });
});

describe('OidcAuthService buildSessionUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    setOidcEnv();
  });

  it('maps a database row to a session user object', () => {
    const row = {
      id: 'user-session-id',
      email: 'session@corp.example',
      username: 'session_user',
      password_hash: 'hashed',
      role: 'tenant_admin',
      plan: 'enterprise' as any,
      tenant_id: 'tenant-session'
    };

    const session = oidcAuthService.buildSessionUser(row as any);

    expect(session.userId).toBe('user-session-id');
    expect(session.email).toBe('session@corp.example');
    expect(session.username).toBe('session_user');
    expect(session.role).toBe('tenant_admin');
    expect(session.plan).toBe('enterprise');
    expect(session.tenantId).toBe('tenant-session');
    expect(session.permissions).toBeDefined();
  });

  it('normalizes unknown role to tenant_viewer', () => {
    const row = {
      id: 'user-unknown-role',
      email: 'unknown@corp.example',
      username: 'unknown',
      password_hash: 'hashed',
      role: 'super_admin_unk' as any,
      plan: 'starter',
      tenant_id: 'tenant-1'
    };

    const session = oidcAuthService.buildSessionUser(row as any);

    expect(session.role).toBe('tenant_viewer');
  });
});

describe('OidcAuthService validateMfaEvidence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServiceState();
    setOidcEnv();
    (oidcRequireMfa as jest.Mock).mockReturnValue(true);
  });

  it('passes when verified claims contain accepted AMR', () => {
    const profile: OidcUserProfile = { sub: 'u', email: 'a@b.com' };
    const verified: VerifiedIdTokenClaims = { amr: ['pwd', 'mfa', 'otp'] };

    const result = oidcAuthService.validateMfaEvidence(profile, verified);

    expect(result.valid).toBe(true);
  });

  it('passes when amr is a space-separated string', () => {
    const profile: OidcUserProfile = { sub: 'u', email: 'a@b.com' };
    const verified: VerifiedIdTokenClaims = { amr: 'mfa otp' } as any;

    const result = oidcAuthService.validateMfaEvidence(profile, verified);

    expect(result.valid).toBe(true);
  });

  it('fails when verified amr is missing required method', () => {
    const profile: OidcUserProfile = { sub: 'u', email: 'a@b.com' };
    const verified: VerifiedIdTokenClaims = { amr: ['pwd'] };

    const result = oidcAuthService.validateMfaEvidence(profile, verified);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('amr_mfa_missing');
  });

  it('ignores profile.amr entirely (untrusted channel)', () => {
    const profile: OidcUserProfile = { sub: 'u', email: 'a@b.com', amr: ['mfa', 'otp'] };
    const verified: VerifiedIdTokenClaims = { amr: ['pwd'] };

    const result = oidcAuthService.validateMfaEvidence(profile, verified);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('amr_mfa_missing');
  });

  it('fails when verifiedClaims is a string (legacy unverified path)', () => {
    const profile: OidcUserProfile = { sub: 'u', email: 'a@b.com' };

    const result = oidcAuthService.validateMfaEvidence(profile, 'raw-token-string' as any);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unverified_id_token_rejected');
  });

  it('fails when verifiedClaims is missing or null', () => {
    const profile: OidcUserProfile = { sub: 'u', email: 'a@b.com' };

    const result = oidcAuthService.validateMfaEvidence(profile, undefined as any);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('verified_claims_required');

    const result2 = oidcAuthService.validateMfaEvidence(profile, null as any);
    expect(result2.valid).toBe(false);
    expect(result2.reason).toBe('verified_claims_required');
  });

  it('passes when OIDC_REQUIRED_ACR matches verified claim', () => {
    process.env.OIDC_REQUIRED_ACR = 'high';
    const profile: OidcUserProfile = { sub: 'u', email: 'a@b.com' };
    const verified: VerifiedIdTokenClaims = { acr: 'high' };

    const result = oidcAuthService.validateMfaEvidence(profile, verified);

    expect(result.valid).toBe(true);
  });

  it('fails when OIDC_REQUIRED_ACR does not match verified claim', () => {
    process.env.OIDC_REQUIRED_ACR = 'high';
    const profile: OidcUserProfile = { sub: 'u', email: 'a@b.com' };
    const verified: VerifiedIdTokenClaims = { acr: 'low' };

    const result = oidcAuthService.validateMfaEvidence(profile, verified);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('acr_missing_or_mismatch');
  });

  it('bypasses MFA gate entirely when oidcRequireMfa returns false', () => {
    (oidcRequireMfa as jest.Mock).mockReturnValue(false);
    const profile: OidcUserProfile = { sub: 'u', email: 'a@b.com' };
    const verified: VerifiedIdTokenClaims = { amr: ['pwd'] };

    const result = oidcAuthService.validateMfaEvidence(profile, verified);

    expect(result.valid).toBe(true);
  });
});
