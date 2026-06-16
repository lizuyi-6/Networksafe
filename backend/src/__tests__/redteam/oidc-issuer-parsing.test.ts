/**
 * SECURITY FIX (redteam R4-ext): OIDC issuer URL parsing redteam tests.
 *
 * Tests that malicious issuer strings containing userinfo, hash fragments,
 * or backslash-based relays are rejected so that isConfigured() returns
 * false and the OIDC login path is unavailable.
 *
 * Attack vectors covered:
 *   - Userinfo injection:  https://user:pass@evil.com/
 *   - Hash-fragment relay: https://evil.com#@victim.com/
 *   - Backslash relay:     https://victim.com\@evil.com
 */

const MALICIOUS_ISSUERS = [
  { issuer: 'https://user:pass@evil.com/', description: 'userinfo injection' },
  { issuer: 'https://evil.com#@victim.com/', description: 'hash-fragment redirect' },
  { issuer: 'https://victim.com\\@evil.com', description: 'backslash relay' },
  { issuer: 'https://attacker:secret@okta.example.com/', description: 'userinfo with credentials' },
  { issuer: 'https://legitimate.com#@malicious.com/', description: 'hash fragment with misleading origin' },
];

describe('OIDC issuer URL parsing (redteam R4-ext)', () => {
  // These tests must run without any OIDC environment variables set so that
  // isConfigured() returns false only because of the malicious issuer.
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env to a clean state — no OIDC variables at all.
    process.env = {
      ...originalEnv,
      OIDC_CLIENT_ID: 'test-client',
      OIDC_CLIENT_SECRET: 'test-secret',
      OIDC_REDIRECT_URI: 'http://localhost/callback',
    };
    // Clear any cached state by deleting the module cache entry so the
    // service re-reads env on next import.
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  for (const { issuer, description } of MALICIOUS_ISSUERS) {
    it(`rejects issuer with ${description}: ${issuer}`, async () => {
      process.env.OIDC_ISSUER = issuer;
      process.env.OIDC_AUTHORIZATION_ENDPOINT = issuer + '/authorize';
      process.env.OIDC_TOKEN_ENDPOINT = issuer + '/token';
      process.env.OIDC_USERINFO_ENDPOINT = issuer + '/userinfo';

      // Re-import to get a fresh service instance with the test env.
      const { oidcAuthService } = await import('../../services/oidc-auth.service');
      expect(oidcAuthService.isConfigured()).toBe(false);
    });
  }

  it('accepts a legitimate https issuer with no userinfo or fragment', async () => {
    const legitimate = 'https://accounts.example.com';
    process.env.OIDC_ISSUER = legitimate;
    process.env.OIDC_AUTHORIZATION_ENDPOINT = legitimate + '/authorize';
    process.env.OIDC_TOKEN_ENDPOINT = legitimate + '/token';
    process.env.OIDC_USERINFO_ENDPOINT = legitimate + '/userinfo';

    jest.resetModules();
    const { oidcAuthService } = await import('../../services/oidc-auth.service');
    // A legitimate issuer with no userinfo, no hash, and no backslash
    // passes the URL validation gate. isConfigured() returns true if
    // all required env vars are set (it does NOT make a network call
    // to the IdP at config time). The point of this test is that
    // validateOidcIssuer does NOT reject the legitimate issuer.
    const result = oidcAuthService.isConfigured();
    expect(result).toBe(true);
  });
});
