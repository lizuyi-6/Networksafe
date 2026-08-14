/**
 * SECURITY (audit 2026-08, FE-002): defense-in-depth origin check for
 * browser redirects driven by backend-supplied URLs (OIDC
 * `authorizationUrl` / `endSessionUrl`).
 *
 * The backend already allowlists these URLs (auth.routes.ts
 * buildOidcRedirectTarget falls back to same-origin relative paths), but the
 * frontend previously passed any response value straight into
 * `window.location.assign`. If the backend response were ever misassembled
 * or compromised, that would hand an attacker a free redirect of an
 * authenticated operator session. This guard independently constrains the
 * redirect targets:
 *
 *   - relative paths (same-origin) are always allowed;
 *   - absolute URLs must be http(s) AND their origin must be listed in
 *     VITE_TRUSTED_EXTERNAL_ORIGINS (comma-separated, e.g. the IdP origin
 *     `https://accounts.example.com`). No wildcard matching.
 *
 * When nothing is configured, only same-origin redirects pass — deployments
 * using an external IdP must declare it explicitly at build time.
 */

const parseTrustedOrigins = (): string[] => {
    const raw = import.meta.env.VITE_TRUSTED_EXTERNAL_ORIGINS;
    if (typeof raw !== 'string' || raw.trim() === '') return [];
    return raw
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => {
            try {
                const parsed = new URL(value);
                return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : null;
            } catch {
                return null;
            }
        })
        .filter((origin): origin is string => origin !== null);
};

let cachedTrustedOrigins: string[] | null = null;

const getTrustedOrigins = (): string[] => {
    if (cachedTrustedOrigins === null) {
        cachedTrustedOrigins = parseTrustedOrigins();
    }
    return cachedTrustedOrigins;
};

/** Test hook: reset the memoized env parsing. */
export const resetTrustedOriginsCache = (): void => {
    cachedTrustedOrigins = null;
};

export const isAllowedRedirectTarget = (target: string | null | undefined): boolean => {
    if (typeof target !== 'string' || target.trim() === '') return false;
    const value = target.trim();

    // Relative paths (including `/login?...` style) are same-origin.
    if (value.startsWith('/') && !value.startsWith('//')) return true;

    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return false;
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin) return true;

    return getTrustedOrigins().includes(parsed.origin);
};
