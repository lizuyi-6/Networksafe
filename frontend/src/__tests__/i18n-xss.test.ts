/**
 * @jest-environment node
 */
/**
 * REDTEAM SECURITY TEST — Frontend i18n XSS Prevention (R4-w3 · V12.25)
 * =====================================================================
 *
 * Attack scenario:
 *   A translation string is defined as "Welcome, {username}" and the
 *   username is set to `<script>alert(1)</script>`. With escapeValue: false
 *   the raw HTML is interpolated into the translated string, leading to XSS
 *   when the result is rendered in an attribute or innerHTML context.
 *
 * Fix (frontend/src/i18n.ts):
 *   interpolation.escapeValue is set to true (the default in i18next v23+)
 *   so all interpolated values are HTML-escaped before insertion.
 *
 * Red-team test:
 *   Initialise i18next with escapeValue: true and call t() with a script tag.
 *   Assert the output does not contain the raw `<script>` tag.
 */

/// <reference types="jest" />
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Replicate the actual config from frontend/src/i18n.ts
i18n.use(initReactI18next).init({
    resources: {
        en: { translation: { 'greeting': 'Hello, {name}!' } },
        zh: { translation: { 'greeting': '你好，{name}！' } }
    },
    fallbackLng: 'en',
    interpolation: {
        prefix: '{',
        suffix: '}',
        // This is the security fix: escapeValue: true
        escapeValue: true
    },
    lng: 'en'
});

describe('i18n interpolation XSS prevention', () => {
    it('should HTML-escape interpolated values when escapeValue is true', () => {
        const maliciousInput = '<script>alert(1)</script>';
        const result = i18n.t('greeting', { name: maliciousInput });

        // The raw <script> tag must NOT appear in the output
        expect(result).not.toContain('<script>');
        expect(result).not.toContain('</script>');
        // The rest of the string should be intact
        expect(result).toContain('Hello');
        expect(result).toContain(maliciousInput.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    });

    it('should NOT contain unescaped angle brackets from malicious input', () => {
        const result = i18n.t('greeting', { name: '"><img src=x onerror=alert(1)>' });
        expect(result).not.toContain('onerror=');
        expect(result).not.toContain('src=x');
    });
});
