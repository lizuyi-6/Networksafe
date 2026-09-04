/**
 * AG-B02 (audit 2026-08): operator-configured outbound URLs (AI endpoints,
 * notification webhooks) must never reach cloud instance-metadata endpoints,
 * and private targets need explicit opt-in.
 */
import {
  checkOutboundUrl,
  assertOutboundUrlAllowed,
  assertOutboundUrlAllowedResolved,
  assertOutboundUrlAllowedResolvedPinned,
  assertOutboundHostAllowedResolved,
  createPinnedDnsContext
} from '../../security/outbound-url-guard';

describe('outbound-url-guard (AG-B02)', () => {
  describe('cloud metadata endpoints are blocked UNCONDITIONALLY', () => {
    const metadataTargets = [
      'http://169.254.169.254/latest/meta-data/',
      'http://169.254.169.254:80/computeMetadata/v1/',
      'http://169.254.170.2/v2/credentials',
      'http://100.100.100.200/latest/meta-data/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://metadata.goog/computeMetadata/v1/',
      'http://[fd00:ec2::235]/latest/meta-data/'
    ];

    for (const target of metadataTargets) {
      it(`blocks ${target} even with allowPrivate`, () => {
        expect(checkOutboundUrl(target, { allowPrivate: true })).toMatchObject({
          allowed: false,
          reason: 'backend.cloud_metadata_endpoints_are_blocked'
        });
        expect(() => assertOutboundUrlAllowed(target, { allowPrivate: true })).toThrow(
          'backend.cloud_metadata_endpoints_are_blocked'
        );
      });
    }
  });

  describe('private targets follow the allowPrivate option', () => {
    it('blocks RFC1918/loopback without allowPrivate', () => {
      for (const target of [
        'http://10.1.2.3:11434/api',
        'http://192.168.1.10:11434',
        'http://172.20.0.5:8080',
        'http://127.0.0.1:3005/api',
        'http://localhost:11434/api',
        'http://0.0.0.0/x',
        'http://[::1]:8080/'
      ]) {
        expect(checkOutboundUrl(target)).toMatchObject({ allowed: false, reason: 'backend.private_ip_addresses_are_not_allowed' });
      }
    });

    it('allows LAN self-hosted targets with allowPrivate (ollama use case)', () => {
      for (const target of [
        'http://10.1.2.3:11434/api',
        'http://192.168.1.10:11434',
        'http://172.20.0.5:8080',
        'http://localhost:11434'
      ]) {
        expect(checkOutboundUrl(target, { allowPrivate: true }).allowed).toBe(true);
      }
    });

    it('172.16-31 range handled exactly (172.32 public, 172.15 public, 172.16-31 private)', () => {
      expect(checkOutboundUrl('http://172.15.0.1', { allowPrivate: true }).allowed).toBe(true);
      expect(checkOutboundUrl('http://172.32.0.1', { allowPrivate: true }).allowed).toBe(true);
      expect(checkOutboundUrl('http://172.16.0.1', { allowPrivate: true }).allowed).toBe(true);
      expect(checkOutboundUrl('http://172.31.255.255', { allowPrivate: true }).allowed).toBe(true);
      // Without allowPrivate, 172.16-31 are blocked...
      expect(checkOutboundUrl('http://172.16.0.1').allowed).toBe(false);
      // ...while 172.15/172.32 stay reachable.
      expect(checkOutboundUrl('http://172.32.0.1').allowed).toBe(true);
    });
  });

  describe('protocol and format validation', () => {
    it('rejects non-http(s) schemes', () => {
      for (const target of ['file:///etc/passwd', 'gopher://127.0.0.1:6379/_INFO', 'ftp://10.0.0.1/pub']) {
        expect(checkOutboundUrl(target)).toMatchObject({
          allowed: false,
          reason: 'backend.only_http_and_https_protocols_are_allowed'
        });
      }
    });

    it('rejects unparseable URLs', () => {
      expect(checkOutboundUrl('not a url')).toMatchObject({ allowed: false, reason: 'backend.invalid_url_format' });
    });

    it('allows ordinary public https targets', () => {
      expect(checkOutboundUrl('https://hooks.slack.com/services/T00/B00/xxx').allowed).toBe(true);
      expect(checkOutboundUrl('https://api.openai.com/v1/chat/completions').allowed).toBe(true);
    });
  });

  describe('IPv4-mapped IPv6 literals (R2-F002 follow-up: hex-form bypass)', () => {
    // Node's URL parser normalizes every IPv4-mapped form to HEX
    // (`[::ffff:169.254.169.254]` -> `::ffff:a9fe:a9fe`); the dotted-only
    // normalization used to let the hex variant reach the mapped IPv4 target.
    const mappedBypassUrls = [
      'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
      'http://[::ffff:169.254.169.254]/latest/meta-data/',
      'http://[0:0:0:0:0:ffff:169.254.169.254]/',
      'http://[::FFFF:A9FE:A9FE]/',
      'http://[::ffff:127.0.0.1]:3005/'
    ];

    it('blocks every mapped-form metadata literal unconditionally; loopback mapped follows allowPrivate', () => {
      // Metadata-mapped forms: blocked even with allowPrivate (AG-B02).
      for (const url of mappedBypassUrls.slice(0, 4)) {
        expect(checkOutboundUrl(url, { allowPrivate: true }).allowed).toBe(false);
        expect(() => assertOutboundUrlAllowed(url, { allowPrivate: true })).toThrow();
      }
      // Loopback-mapped form: private semantics, allowed only with allowPrivate.
      expect(checkOutboundUrl(mappedBypassUrls[4], { allowPrivate: true }).allowed).toBe(true);
      expect(checkOutboundUrl(mappedBypassUrls[4]).allowed).toBe(false);
      expect(() => assertOutboundUrlAllowed(mappedBypassUrls[4])).toThrow();
    });

    it('rejects mapped-form metadata literals with the metadata reason', () => {
      for (const url of mappedBypassUrls.slice(0, 4)) {
        expect(checkOutboundUrl(url).reason).toBe('backend.cloud_metadata_endpoints_are_blocked');
      }
      expect(checkOutboundUrl(mappedBypassUrls[4]).reason).toBe('backend.private_ip_addresses_are_not_allowed');
    });

    it('resolved path also rejects a resolver returning the hex-mapped metadata address', async () => {
      await expect(
        assertOutboundUrlAllowedResolved('http://bypass.example.com/', {
          resolver: async () => [{ address: '::ffff:a9fe:a9fe', family: 6 }]
        })
      ).rejects.toThrow('backend.cloud_metadata_endpoints_are_blocked');
    });

    it('still allows legitimate public targets through the mapped normalization', () => {
      expect(checkOutboundUrl('https://api.openai.com/v1/chat/completions').allowed).toBe(true);
      // A real (non-mapped) IPv6 literal is unaffected.
      expect(checkOutboundUrl('http://[2001:db8::1]/').allowed).toBe(true);
    });
  });

  describe('assertOutboundUrlAllowedResolvedPinned + createPinnedDnsContext', () => {
    it('returns exactly the validated addresses (single resolution)', async () => {
      const resolver = jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      const pinned = await assertOutboundUrlAllowedResolvedPinned('http://pin.example.com/x', { resolver });
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(pinned).toEqual([{ address: '93.184.216.34', family: 4 }]);
    });

    it('pinned lookup ignores the requested hostname and returns only validated peers', async () => {
      const pinned = await assertOutboundUrlAllowedResolvedPinned('http://pin.example.com/x', {
        resolver: async () => [{ address: '93.184.216.34', family: 4 }]
      });
      const ctx = createPinnedDnsContext(pinned);
      ctx.lookup('attacker-rebind.example.com', { all: true }, (err, addresses) => {
        expect(err).toBeNull();
        expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
      });
    });

    it('rejects before any address is returned when the target resolves to metadata', async () => {
      await expect(
        assertOutboundUrlAllowedResolvedPinned('http://bypass.example.com/x', {
          resolver: async () => [{ address: '169.254.169.254', family: 4 }]
        })
      ).rejects.toThrow('backend.cloud_metadata_endpoints_are_blocked');
    });

    it('honors the all:false single-address lookup contract', async () => {
      const pinned = await assertOutboundUrlAllowedResolvedPinned('http://pin.example.com/x', {
        resolver: async () => [{ address: '93.184.216.34', family: 4 }]
      });
      const ctx = createPinnedDnsContext(pinned);
      // net.connect's default lookup form: (err, addressString, family) with a
      // SINGLE address — not the array (AUD-07-4).
      ctx.lookup('pin.example.com', {}, (err, address, family) => {
        expect(err).toBeNull();
        expect(address).toBe('93.184.216.34');
        expect(family).toBe(4);
      });
      // Family-preferred pick stays within the validated set.
      ctx.lookup('pin.example.com', { family: 6 }, (err, address) => {
        expect(err).toBeNull();
        expect(address).toBe('93.184.216.34');
      });
    });

    // AUD-07-4: the pinning path is exercised end-to-end against a REAL
    // HTTP server with axios (loopback + allowPrivate), so a contract
    // regression in the lookup function fails the request instead of
    // silently mis-targeting the socket.
    it('completes a real axios request through the pinned agents', async () => {
      const http = require('http') as typeof import('http');
      const axios = require('axios').default as typeof import('axios').default;
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const port = (server.address() as { port: number }).port;
        const pinned = await assertOutboundUrlAllowedResolvedPinned(`http://pin-target.example.com:${port}/probe`, {
          resolver: async () => [{ address: '127.0.0.1', family: 4 }],
          allowPrivate: true
        });
        const ctx = createPinnedDnsContext(pinned);
        const response = await axios.get(`http://pin-target.example.com:${port}/probe`, {
          httpAgent: ctx.httpAgent,
          httpsAgent: ctx.httpsAgent,
          maxRedirects: 0,
          timeout: 5000
        });
        expect(response.status).toBe(200);
        expect(response.data).toEqual({ ok: true });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('assertOutboundHostAllowedResolved (N5-6: bare-host egress — SMTP / TCP probes)', () => {
    it('rejects a literal metadata IP without any DNS lookup', async () => {
      const resolver = jest.fn();
      await expect(
        assertOutboundHostAllowedResolved('169.254.169.254', { resolver })
      ).rejects.toThrow('backend.cloud_metadata_endpoints_are_blocked');
      expect(resolver).not.toHaveBeenCalled();
    });

    it('rejects metadata hostnames and AWS IMDS IPv6 literals unconditionally', async () => {
      const resolver = jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      await expect(
        assertOutboundHostAllowedResolved('metadata.google.internal', { resolver, allowPrivate: true })
      ).rejects.toThrow('backend.cloud_metadata_endpoints_are_blocked');
      await expect(
        assertOutboundHostAllowedResolved('[fd00:ec2::254]', { resolver, allowPrivate: true })
      ).rejects.toThrow('backend.cloud_metadata_endpoints_are_blocked');
      expect(resolver).not.toHaveBeenCalled();
    });

    it('rejects private literal relays without allowPrivate, allows with it', async () => {
      const resolver = jest.fn();
      await expect(assertOutboundHostAllowedResolved('10.0.0.25', { resolver })).rejects.toThrow(
        'backend.private_ip_addresses_are_not_allowed'
      );
      await expect(
        assertOutboundHostAllowedResolved('10.0.0.25', { resolver, allowPrivate: true })
      ).resolves.toEqual([{ address: '10.0.0.25', family: 4 }]);
      expect(resolver).not.toHaveBeenCalled();
    });

    it('validates EVERY resolved address — one metadata answer fails the host', async () => {
      const resolver = jest.fn().mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '169.254.170.2', family: 4 }
      ]);
      await expect(
        assertOutboundHostAllowedResolved('mail.example.com', { resolver, allowPrivate: true })
      ).rejects.toThrow('backend.cloud_metadata_endpoints_are_blocked');
      expect(resolver).toHaveBeenCalledTimes(1);
    });

    it('returns the validated peer set for a clean public relay host', async () => {
      const resolver = jest.fn().mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
      await expect(assertOutboundHostAllowedResolved('mail.example.com', { resolver })).resolves.toEqual([
        { address: '203.0.113.10', family: 4 }
      ]);
    });

    it('fails closed when the host cannot be resolved', async () => {
      await expect(
        assertOutboundHostAllowedResolved('gone.example.com', { resolver: async () => [] })
      ).rejects.toThrow('backend.outbound_target_unresolvable');
      await expect(
        assertOutboundHostAllowedResolved('gone.example.com', {
          resolver: async () => {
            throw new Error('ENOTFOUND');
          }
        })
      ).rejects.toThrow('backend.outbound_target_unresolvable');
    });
  });
});
