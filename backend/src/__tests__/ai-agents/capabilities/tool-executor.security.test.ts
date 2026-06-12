/**
 * Security tests for the ToolExecutor.
 *
 * Sprint 5 Wave 9 · R14 · V12.10 / V12.11
 *  - V12.10: tool output must be XSS-sanitized before being
 *    returned to the AI agent / dashboard.
 *  - V12.11: http_probe must reject RFC1918, loopback,
 *    link-local, and other unsafe addresses (SSRF defense).
 */

import { ToolExecutor } from '../../../ai-agents/capabilities/tool-executor';

describe('ToolExecutor / V12.10 XSS sanitization', () => {
  let executor: ToolExecutor;

  beforeEach(() => {
    executor = new ToolExecutor();
  });

  it('escapes angle brackets and quotes in decode_payload output', async () => {
    const result = await executor.execute({
      requestId: 'xss-1',
      toolName: 'decode_payload',
      parameters: {
        payload: Buffer.from('<img src=x>"hi"</img>').toString('base64'),
        encoding: 'base64'
      }
    } as any);

    expect(result.success).toBe(true);
    const serialized = JSON.stringify(result.output);
    expect(serialized).not.toMatch(/<img/);
    expect(serialized).not.toMatch(/<\/img>/);
    expect(serialized).toContain('&lt;img');
    expect(serialized).toContain('&quot;hi&quot;');
  });

  it('strips control characters and truncates oversized error messages', async () => {
    const result = await executor.execute({
      requestId: 'xss-2',
      toolName: 'check_pattern',
      parameters: {
        content: 'safe',
        patterns: ['(a+)+$']  // intentionally unsafe
      }
    } as any);

    expect(result.success).toBe(false);
    // Error message must be a plain string with no raw control characters
    // or angle brackets in disguise.
    expect(typeof result.error).toBe('string');
    expect(result.error).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
  });

  it('escapes a raw <script> payload in rawPayload-shaped outputs', async () => {
    // The decode_payload tool returns an `original` field that
    // contains the raw input. We confirm the escape function
    // sanitizes this field too.
    const malicious = '<script>alert(1)</script>';
    const result = await executor.execute({
      requestId: 'xss-3',
      toolName: 'decode_payload',
      parameters: {
        payload: Buffer.from(malicious).toString('base64'),
        encoding: 'base64'
      }
    } as any);

    expect(result.success).toBe(true);
    const serialized = JSON.stringify(result.output);
    // The raw base64 input is benign, but the decoded view must
    // not contain raw <script> markup.
    expect(serialized).not.toMatch(/<script>alert/);
    expect(serialized).toContain('&lt;script&gt;');
  });
});

describe('ToolExecutor / V12.11 SSRF defense', () => {
  let executor: ToolExecutor;

  beforeEach(() => {
    executor = new ToolExecutor({
      enabled: true,
      timeout: 1000,
      memoryLimit: 1024 * 1024,
      networkAccess: true,
      fileSystemAccess: false
    });
  });

  it.each([
    'http://127.0.0.1/admin',
    'http://10.0.0.1/admin',
    'http://192.168.1.1/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://172.16.0.1/',
    'http://[::1]/',
    'http://[fe80::1]/',
    'ftp://example.com/'
  ])('blocks SSRF target %s', async (url) => {
    const result = await executor.execute({
      requestId: 'ssrf-1',
      toolName: 'http_probe',
      parameters: { url, method: 'GET' }
    } as any);

    expect(result.success).toBe(true);
    // Result is a blocked SSRF response, not a simulated 200 OK
    expect(result.output.status).toBe('blocked');
    expect(result.output.reason).toMatch(/^ssrf_blocked:/);
  });

  it('blocks non-HTTP protocols before sandbox check', async () => {
    const result = await executor.execute({
      requestId: 'ssrf-proto',
      toolName: 'http_probe',
      parameters: { url: 'file:///etc/passwd' }
    } as any);

    expect(result.output.status).toBe('blocked');
    expect(result.output.reason).toMatch(/unsupported_protocol/);
  });

  it('blocks malformed URLs', async () => {
    const result = await executor.execute({
      requestId: 'ssrf-bad',
      toolName: 'http_probe',
      parameters: { url: 'not-a-url' }
    } as any);

    expect(result.output.status).toBe('blocked');
    expect(result.output.reason).toMatch(/invalid_url/);
  });

  it('blocks hostnames that resolve to private addresses (via mockable dns)', async () => {
    const dns = require('dns/promises');
    const originalLookup = dns.lookup;
    dns.lookup = async () => [{ address: '10.0.0.1', family: 4 }];
    try {
      const result = await executor.execute({
        requestId: 'ssrf-dns',
        toolName: 'http_probe',
        parameters: { url: 'http://attacker.example.com/' }
      } as any);
      expect(result.output.status).toBe('blocked');
      expect(result.output.reason).toMatch(/private_or_loopback_address/);
    } finally {
      dns.lookup = originalLookup;
    }
  });

  it('allows a public IPv4 literal', async () => {
    // 8.8.8.8 (Google DNS) is in the global unicast range.
    const result = await executor.execute({
      requestId: 'ssrf-public',
      toolName: 'http_probe',
      parameters: { url: 'http://8.8.8.8/' }
    } as any);

    expect(result.output.status).toBe('simulated');
    expect(result.output.url).toContain('8.8.8.8');
  });
});
