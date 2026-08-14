/**
 * AG-B02 (audit 2026-08): operator-configured outbound URLs (AI endpoints,
 * notification webhooks) must never reach cloud instance-metadata endpoints,
 * and private targets need explicit opt-in.
 */
import {
  checkOutboundUrl,
  assertOutboundUrlAllowed
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
});
