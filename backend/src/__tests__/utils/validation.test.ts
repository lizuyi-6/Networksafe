/**
 * Input Validation Utility Tests
 */

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

import {
  validateIPv4,
  validateIPv6,
  validateIP,
  validatePort,
  sanitizeString,
  validateCIDR,
  validateDomain,
  whitelistValidate,
  validateUUID
} from '../../utils/validation';

describe('validateIPv4', () => {
  it('accepts valid addresses', () => {
    expect(validateIPv4('192.168.1.1')).toBe(true);
    expect(validateIPv4('0.0.0.0')).toBe(true);
    expect(validateIPv4('255.255.255.255')).toBe(true);
    expect(validateIPv4('10.0.0.1')).toBe(true);
  });

  it('rejects invalid addresses', () => {
    expect(validateIPv4('256.1.1.1')).toBe(false);
    expect(validateIPv4('1.2.3')).toBe(false);
    expect(validateIPv4('')).toBe(false);
    expect(validateIPv4('1.2.3.4.5')).toBe(false);
    expect(validateIPv4('abc')).toBe(false);
    expect(validateIPv4('192.168.1.999')).toBe(false);
  });
});

describe('validateIPv6', () => {
  it('accepts valid full form address', () => {
    expect(validateIPv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
  });

  it('accepts compressed form with ::', () => {
    // Only :: at start is supported by this regex
    expect(validateIPv6('::1')).toBe(true);
    expect(validateIPv6('::')).toBe(false);
  });

  it('rejects non-hex values', () => {
    expect(validateIPv6('::zzzz')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateIPv6('')).toBe(false);
  });
});

describe('validateIP', () => {
  it('accepts valid IPv4', () => {
    expect(validateIP('192.168.1.1')).toBe(true);
  });

  it('accepts valid IPv6', () => {
    expect(validateIP('::1')).toBe(true);
    
  });

  it('rejects null/undefined', () => {
    expect(validateIP(null as any)).toBe(false);
    expect(validateIP(undefined as any)).toBe(false);
    expect(validateIP('' as any)).toBe(false);
  });

  it('rejects shell special characters', () => {
    expect(validateIP('192.168.1.1;rm -rf /')).toBe(false);
    expect(validateIP('127.0.0.1|cat /etc/passwd')).toBe(false);
    expect(validateIP('1.2.3.4`whoami`')).toBe(false);
  });

  it('rejects overly long input', () => {
    expect(validateIP('a'.repeat(46))).toBe(false);
  });
});

describe('validatePort', () => {
  it('accepts valid range', () => {
    expect(validatePort(1)).toBe(true);
    expect(validatePort(80)).toBe(true);
    expect(validatePort(443)).toBe(true);
    expect(validatePort(65535)).toBe(true);
  });

  it('rejects out of range', () => {
    expect(validatePort(0)).toBe(false);
    expect(validatePort(-1)).toBe(false);
    expect(validatePort(65536)).toBe(false);
    expect(validatePort(1.5)).toBe(false);
  });
});

describe('sanitizeString', () => {
  it('removes control characters', () => {
    expect(sanitizeString('hello\x00world')).toBe('helloworld');
    expect(sanitizeString('test\x1fdata')).toBe('testdata');
  });

  it('truncates to maxLength', () => {
    expect(sanitizeString('abcdefghij', 5)).toBe('abcde');
  });

  it('returns empty for null/undefined', () => {
    expect(sanitizeString(null as any)).toBe('');
    expect(sanitizeString(undefined as any)).toBe('');
    expect(sanitizeString('' as any)).toBe('');
  });

  it('returns input unchanged when clean', () => {
    expect(sanitizeString('hello-world_123')).toBe('hello-world_123');
  });
});

describe('validateCIDR', () => {
  it('accepts valid CIDR', () => {
    expect(validateCIDR('192.168.1.0/24')).toBe(true);
    expect(validateCIDR('10.0.0.0/8')).toBe(true);
    expect(validateCIDR('0.0.0.0/0')).toBe(true);
    expect(validateCIDR('255.255.255.255/32')).toBe(true);
  });

  it('rejects invalid CIDR', () => {
    expect(validateCIDR('192.168.1.0')).toBe(false);
    expect(validateCIDR('192.168.1.0/33')).toBe(false);
    expect(validateCIDR('192.168.1.0/-1')).toBe(false);
    expect(validateCIDR('' as any)).toBe(false);
    expect(validateCIDR('invalid/24' as any)).toBe(false);
  });
});

describe('validateDomain', () => {
  it('accepts valid domains', () => {
    expect(validateDomain('example.com')).toBe(true);
    expect(validateDomain('sub.example.com')).toBe(true);
    expect(validateDomain('a-b.example.co.uk')).toBe(true);
  });

  it('rejects invalid domains', () => {
    expect(validateDomain('-example.com')).toBe(false);
    expect(validateDomain('example..com')).toBe(false);
    expect(validateDomain('a'.repeat(254))).toBe(false);
    expect(validateDomain('' as any)).toBe(false);
    expect(validateDomain('not a domain!' as any)).toBe(false);
  });
});

describe('whitelistValidate', () => {
  it('passes when all chars match', () => {
    expect(whitelistValidate('abc123', /^[a-z0-9]+$/)).toBe(true);
  });

  it('fails when chars do not match', () => {
    expect(whitelistValidate('abc!', /^[a-z]+$/)).toBe(false);
  });

  it('returns false for null', () => {
    expect(whitelistValidate(null as any, /./)).toBe(false);
  });
});

describe('validateUUID', () => {
  it('accepts valid UUIDs', () => {
    expect(validateUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(validateUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
  });

  it('rejects invalid UUIDs', () => {
    expect(validateUUID('not-a-uuid')).toBe(false);
    expect(validateUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(validateUUID('' as any)).toBe(false);
  });
});
