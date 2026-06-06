/**
 * i18n Key Fallback — Redteam Regression Test
 * ==========================================
 *
 * NOTE: This test cannot be executed in the current environment because
 * i18next is a frontend-only dependency not available in backend Jest.
 * It is kept here as a specification document for the expected behavior.
 *
 * To run this test, the frontend must first have a working Jest/Vitest setup
 * (currently absent — see frontend/src/__tests__/i18n-xss.test.ts which is
 * also non-runnable dead code).
 *
 * VERIFICATION CHECKLIST (manual or when frontend test infra is added):
 *   1. i18next is configured with fallbackLng: 'en'
 *   2. When t('missing.key') is called with no matching locale entry,
 *      the result is the key name itself (e.g. "missing.key")
 *      and NOT undefined, null, or an empty string.
 *   3. The t() function does not throw on missing keys.
 *   4. When a key exists in the current locale, the translated value is returned.
 *   5. When a key is missing from the current locale but exists in the fallback,
 *      the fallback value is returned.
 *
 * Expected behavior (per i18next default):
 *   - missing key + fallback missing → key name itself
 *   - missing key + fallback exists  → fallback value
 *   - key exists in current locale   → current locale value
 *
 * Frontend config under test (frontend/src/i18n.ts):
 *   fallbackLng: 'en'
 *   interpolation: { escapeValue: true }
 *
 * Redteam attack scenario:
 *   Missing translation keys can reveal internal key names to attackers
 *   if the application renders them unescaped. The default i18next behavior
 *   of returning the key name itself is safe (it reveals no secrets), but
 *   the application must not crash or expose stack traces when keys are absent.
 */

describe.skip('i18n key fallback (redteam) — SPEC ONLY, NOT EXECUTED', () => {
  // These tests are written against i18next but cannot run without the
  // frontend package dependencies. Marked with describe.skip so the
  // backend test suite does not fail.

  it('SPEC: returns the key itself when key is absent from current and fallback locale', () => {
    // i18next default: t('missing.key') → 'missing.key'
    // This test should assert: expect(t('missing.key')).toBe('missing.key')
    // and must not throw.
  });

  it('SPEC: does not throw when t() is called with an entirely absent key', () => {
    // expect(() => t('completely.absent.key')).not.toThrow()
  });

  it('SPEC: returns the translated value when key exists in current locale', () => {
    // Given resources.en.translation.existing = 'Existing EN value'
    // expect(t('existing')).toBe('Existing EN value')
  });

  it('SPEC: returns fallback value when key is missing from current locale but exists in fallback', () => {
    // Given fallbackLng='en' and resources.en.translation.fallbackKey = 'Fallback Value'
    // When lng='zh' and 'fallbackKey' is not in zh
    // Then t('fallbackKey') → 'Fallback Value'
  });

  it('SPEC: gracefully handles empty and null keys without throwing', () => {
    // expect(() => t('')).not.toThrow()
    // expect(t('')).toBe('')
  });
});
