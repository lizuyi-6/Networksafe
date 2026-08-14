import { createHmac } from 'crypto';
import { buildFastpathAuthHeader, fastpathClientService } from '../../services/fastpath-client.service';

/**
 * RF-001 (audit 2026-08): the backend must authenticate every fastpath request
 * with an HMAC-SHA256 MAC over the exact request body, mirroring the Rust
 * middleware (rust-fastpath main.rs FastpathAuth). rust-fastpath's
 * `hmac_rfc4231_vector_pins_cross_language_mac` test pins the same vector —
 * these two tests together prove cross-language agreement.
 */
describe('fastpath-client HMAC authentication (RF-001)', () => {
  it('buildFastpathAuthHeader matches RFC 4231 test case 2 (same vector as the Rust test)', () => {
    // RFC 4231 test case 2: key "Jefe", data "what do ya want for nothing?".
    const header = buildFastpathAuthHeader('Jefe', 'what do ya want for nothing?');
    expect(header).toBe(
      'HMAC-SHA256 5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
    );
  });

  it('signs the empty body for body-less GET requests', () => {
    const expected = createHmac('sha256', 'secret-value').update('', 'utf8').digest('hex');
    expect(buildFastpathAuthHeader('secret-value', '')).toBe(`HMAC-SHA256 ${expected}`);
  });

  it('MAC changes when any body byte changes (tamper binding)', () => {
    const secret = '0123456789abcdef0123456789abcdef';
    const a = buildFastpathAuthHeader(secret, '{"key":"a"}');
    const b = buildFastpathAuthHeader(secret, '{"key":"b"}');
    expect(a).not.toBe(b);
  });

  it('axios interceptor sets the auth header over the exact serialized body', async () => {
    const secret = '0123456789abcdef0123456789abcdef';
    process.env.FASTPATH_AUTH_SECRET = secret;
    try {
      // Reach into the private client factory through a public path: a health
      // call constructs the axios instance; instead of a network call, build
      // the instance via the same code path by exercising getClient through
      // (fastpathClientService as any) — the interceptor is what we assert on.
      const runtime = {
        tenantId: 'global',
        enabled: true,
        baseUrl: 'http://127.0.0.1:9',
        transport: 'tcp' as const,
        socketPath: null,
        timeoutMs: 100,
        fallbackEnabled: true,
        trafficShadowEnabled: false,
        trafficShadowSampleRatePct: 0,
        trafficMaxBodyBytes: 65536
      };
      const client = (fastpathClientService as any).getClient.call(fastpathClientService, runtime);
      const interceptors = client.interceptors.request['handlers'] as Array<{
        fulfilled: (config: any) => any;
      }>;
      expect(interceptors.length).toBeGreaterThan(0);

      const config = { method: 'post', data: { tenantId: 't', key: 'k', windowMs: 60000, limit: 10 }, headers: {} as Record<string, any> };
      const signed = interceptors[0].fulfilled(config);

      // Body was serialized to the exact string the MAC covers.
      expect(typeof signed.data).toBe('string');
      // Header is the expected MAC over that exact string.
      expect(signed.headers['X-Fastpath-Auth']).toBe(buildFastpathAuthHeader(secret, signed.data));
      expect(signed.headers['Content-Type']).toBe('application/json');

      // GET (no body): MAC over the empty string, no Content-Type forced.
      const getConfig = { method: 'get', headers: {} as Record<string, any> };
      const signedGet = interceptors[0].fulfilled(getConfig);
      expect(signedGet.headers['X-Fastpath-Auth']).toBe(buildFastpathAuthHeader(secret, ''));
      expect(signedGet.headers['Content-Type']).toBeUndefined();
    } finally {
      delete process.env.FASTPATH_AUTH_SECRET;
    }
  });

  it('interceptor is a no-op without FASTPATH_AUTH_SECRET (dev without fastpath auth)', async () => {
    const before = process.env.FASTPATH_AUTH_SECRET;
    delete process.env.FASTPATH_AUTH_SECRET;
    try {
      const runtime = {
        tenantId: 'global',
        enabled: true,
        baseUrl: 'http://127.0.0.1:9',
        transport: 'tcp' as const,
        socketPath: null,
        timeoutMs: 100,
        fallbackEnabled: true,
        trafficShadowEnabled: false,
        trafficShadowSampleRatePct: 0,
        trafficMaxBodyBytes: 65536
      };
      const client = (fastpathClientService as any).getClient.call(fastpathClientService, runtime);
      const interceptors = client.interceptors.request['handlers'] as Array<{
        fulfilled: (config: any) => any;
      }>;
      const config = { method: 'post', data: { a: 1 }, headers: {} as Record<string, any> };
      const result = interceptors[0].fulfilled(config);
      expect(result.headers['X-Fastpath-Auth']).toBeUndefined();
      expect(result.data).toEqual({ a: 1 });
    } finally {
      if (before !== undefined) {
        process.env.FASTPATH_AUTH_SECRET = before;
      }
    }
  });
});
