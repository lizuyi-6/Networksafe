/**
 * Tests for the safe-regex validator (R6 V2.4 ReDoS defense).
 */

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

import { validateRegexPattern, SAFE_REGEX_LIMITS } from '../../utils/safe-regex';

describe('safe-regex / validateRegexPattern', () => {
  describe('catastrophic backtracking detection', () => {
    it('rejects (a+)+$', () => {
      const r = validateRegexPattern('(a+)+$');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/backtracking|nested quantifier/i);
    });

    it('rejects (.*)* (nested unbounded quantifier)', () => {
      const r = validateRegexPattern('(.*)*');
      expect(r.valid).toBe(false);
    });

    it('rejects (a+)+  (plain nested quantifier)', () => {
      const r = validateRegexPattern('(a+)+');
      expect(r.valid).toBe(false);
    });

    it('rejects (.+)*', () => {
      const r = validateRegexPattern('(.+)*');
      expect(r.valid).toBe(false);
    });
  });

  describe('length limit', () => {
    it('rejects patterns longer than MAX_PATTERN_LENGTH', () => {
      const pattern = 'a' + 'b{4999}';
      // Pad past the 500-char ceiling deterministically.
      const padded = 'a'.repeat(SAFE_REGEX_LIMITS.MAX_PATTERN_LENGTH + 1);
      const r = validateRegexPattern(padded);
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/exceeds/i);
    });
  });

  describe('group nesting depth', () => {
    it('rejects 4+ nested groups', () => {
      const r = validateRegexPattern('((((a))))');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/nesting depth/i);
    });

    it('accepts 3 nested groups (boundary)', () => {
      const r = validateRegexPattern('((a))');
      expect(r.valid).toBe(true);
    });
  });

  describe('happy path', () => {
    it('accepts [a-z]+', () => {
      const r = validateRegexPattern('[a-z]+');
      expect(r.valid).toBe(true);
    });

    it('accepts ^foo$', () => {
      const r = validateRegexPattern('^foo$');
      expect(r.valid).toBe(true);
    });

    it('accepts a common SSRF / SQL / XSS pattern (matches input-validator defaults)', () => {
      // These mirror the literal patterns shipped in tool-executor.ts
      expect(validateRegexPattern("'\\s*(or|and)\\s+('|\\d)").valid).toBe(true);
      expect(validateRegexPattern('<script[^>]*>').valid).toBe(true);
      expect(validateRegexPattern('\\.\\.[\\/\\\\]').valid).toBe(true);
    });
  });

  describe('input sanity', () => {
    it('rejects empty string', () => {
      const r = validateRegexPattern('');
      expect(r.valid).toBe(false);
    });

    it('rejects non-string input', () => {
      // @ts-expect-error — runtime guard
      const r = validateRegexPattern(null);
      expect(r.valid).toBe(false);
    });
  });

  describe('escape handling', () => {
    it('does not count escaped parens toward nesting depth', () => {
      // 5 escaped parens should not push depth past the limit.
      const pattern = '\\(\\)\\(\\)\\(\\)\\(';
      const r = validateRegexPattern(pattern);
      expect(r.valid).toBe(true);
    });
  });

  // Wave 6 F13 — NESTED_QUANTIFIER false negatives. The original
  // `/\((?:[^()?:+*]+|\\.)[?+*]\)[+*]/` only matched capturing groups
  // whose direct content was a single quantifier. It missed alternation,
  // non-capturing groups, and lookahead wrappers — three classic ReDoS
  // families. See docs/security-audit/2026-06-06-wave5-meta-attack-2.md
  // (V8.6 / V8.7 / V8.8).
  describe('nested-quantifier family coverage (F13)', () => {
    it('rejects (a|a)* — alternation inside quantified group', () => {
      const r = validateRegexPattern('(a|a)*');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/backtracking|nested quantifier/i);
    });

    it('rejects ([abc]|[def])* — alternation with char classes', () => {
      const r = validateRegexPattern('([abc]|[def])*');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/backtracking|nested quantifier/i);
    });

    it('rejects (a|bc)+ — alternation with multi-char branches', () => {
      const r = validateRegexPattern('(a|bc)+');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/backtracking|nested quantifier/i);
    });

    it('rejects (?:a+)+ — non-capturing group with nested quantifier', () => {
      const r = validateRegexPattern('(?:a+)+');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/backtracking|nested quantifier/i);
    });

    it('rejects (?:a+)+b — non-capturing group with trailing literal', () => {
      const r = validateRegexPattern('(?:a+)+b');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/backtracking|nested quantifier/i);
    });

    it('rejects (?=(a+)+$) — lookahead wrapping nested quantifier', () => {
      const r = validateRegexPattern('(?=(a+)+$)');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/backtracking|nested quantifier/i);
    });

    it('rejects (((((a+)+)+)+)+) — deeply nested quantified groups', () => {
      const r = validateRegexPattern('((((a+)+)+)+)+');
      expect(r.valid).toBe(false);
    });

    it('rejects [\\s\\S]{400}+ — quantifier-on-quantifier (char class)', () => {
      const r = validateRegexPattern('[\\s\\S]{400}+');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/backtracking|nested quantifier/i);
    });

    it('rejects ([\\s\\S]{400})+\\d — char class + bounded quantifier + outer +', () => {
      const r = validateRegexPattern('([\\s\\S]{400})+\\d');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/backtracking|nested quantifier/i);
    });

    it('rejects ([a-z]|[0-9]){400}+x — alternation with bounded + outer +', () => {
      const r = validateRegexPattern('([a-z]|[0-9]){400}+x');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/backtracking|nested quantifier/i);
    });

    it('accepts a+ — sanity check (no group, no danger)', () => {
      const r = validateRegexPattern('a+');
      expect(r.valid).toBe(true);
    });

    it('accepts (a)+ — single quantifier on a literal group (no inner quantifier)', () => {
      // (a)+ is equivalent to a+ and is NOT ReDoS-prone because the
      // group contains no inner quantifier or alternation.
      const r = validateRegexPattern('(a)+');
      expect(r.valid).toBe(true);
    });

    it('accepts (?:abc) — non-capturing group, not quantified', () => {
      const r = validateRegexPattern('(?:abc)');
      expect(r.valid).toBe(true);
    });

    it('accepts (?=foo)bar — bare lookahead, not quantified', () => {
      const r = validateRegexPattern('(?=foo)bar');
      expect(r.valid).toBe(true);
    });
  });

  // Wave 8 F18 — back-reference-with-quantifier family coverage.
  // The original `HEAVY_BACKREFERENCE` regex only matched
  // `(.+)\1{n,m}` and missed the unbounded `(.+)\1+` shape that
  // shows up in V11.19. See
  // docs/security-audit/2026-06-06-wave7-meta-attack-3.md (V11.19).
  describe('back-reference-with-quantifier family coverage (F18)', () => {
    it('rejects (.+)\\1+ — greedy capture + quantified backref (V11.19 core)', () => {
      const r = validateRegexPattern('(.+)\\1+');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/backtracking|nested quantifier/i);
    });

    it('rejects (.+)\\1{2,} — greedy capture + bounded backref', () => {
      const r = validateRegexPattern('(.+)\\1{2,}');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/backtracking|nested quantifier/i);
    });

    it('rejects (a)\\1+ — quantified backref after any capture', () => {
      const r = validateRegexPattern('(a)\\1+');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/backtracking|nested quantifier/i);
    });

    it('rejects (.+)\\1* — unbounded star backref', () => {
      const r = validateRegexPattern('(.+)\\1*');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/backtracking|nested quantifier/i);
    });

    it('rejects (\\w+)\\1{2,5} — word capture + bounded backref', () => {
      const r = validateRegexPattern('(\\w+)\\1{2,5}');
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/backtracking|nested quantifier/i);
    });
  });
});
