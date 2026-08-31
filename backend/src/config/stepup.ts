/**
 * Step-up re-authentication (WebAuthn/Passkey) runtime configuration.
 *
 * ADR 2026-08-29-stepup-webauthn-risk-elevation: high-risk control-plane
 * operations require a fresh Passkey assertion. Enforcement is OFF by
 * default so existing deployments keep working; operators opt in with
 * STEPUP_ENFORCEMENT=on after admins have enrolled credentials.
 *
 * Every getter reads the environment at call time (never cached at module
 * load) so tests and runtime reconfiguration can flip enforcement without a
 * restart.
 */

export type StepUpEnforcement = 'off' | 'on';

function normalizeEnforcement(value: string | undefined): StepUpEnforcement {
  return String(value || '').trim().toLowerCase() === 'on' ? 'on' : 'off';
}

export function getStepUpEnforcement(): StepUpEnforcement {
  return normalizeEnforcement(process.env.STEPUP_ENFORCEMENT);
}

export function isStepUpEnforced(): boolean {
  return getStepUpEnforcement() === 'on';
}

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(String(value || '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), max);
}

export function getStepUpTokenTtlSeconds(): number {
  return parsePositiveInt(process.env.STEPUP_TOKEN_TTL_SECONDS, 300, 3600);
}

export function getStepUpChallengeTtlSeconds(): number {
  return parsePositiveInt(process.env.STEPUP_CHALLENGE_TTL_SECONDS, 120, 600);
}

function firstNonEmptyEnv(keys: string[]): string | null {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function hostnameOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
      return null;
    }
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * WebAuthn RP ID must be a registrable domain suffix of the origin the
 * browser sees. Explicit override first, else derived from the configured
 * frontend/public URL. Returns null when unresolvable — ceremonies must
 * refuse to run (fail-closed) instead of guessing.
 */
export function resolveWebAuthnRpId(): string | null {
  const explicit = firstNonEmptyEnv(['WEBAUTHN_RP_ID']);
  if (explicit) {
    return explicit.toLowerCase();
  }
  const derivedFrom = firstNonEmptyEnv(['FRONTEND_APP_URL', 'APP_URL', 'PUBLIC_URL'])
    || String(process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .find(Boolean)
    || null;
  if (derivedFrom) {
    return hostnameOf(derivedFrom);
  }
  return null;
}

/**
 * The exact origin (scheme + host + optional port) the browser uses to reach
 * the dashboard. Explicit override first, else the first allowlisted origin,
 * else the configured frontend/public URL. Returns null when unresolvable.
 */
export function resolveWebAuthnExpectedOrigin(): string | null {
  const explicit = firstNonEmptyEnv(['WEBAUTHN_EXPECTED_ORIGIN']);
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      return null;
    }
  }
  const allowlisted = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const derivedFrom = allowlisted[0] || firstNonEmptyEnv(['FRONTEND_APP_URL', 'APP_URL', 'PUBLIC_URL']);
  if (derivedFrom) {
    try {
      return new URL(derivedFrom).origin;
    } catch {
      return null;
    }
  }
  return null;
}

export function getWebAuthnRpName(): string {
  return firstNonEmptyEnv(['WEBAUTHN_RP_NAME']) || 'AetherGuard';
}

export function isWebAuthnConfigured(): boolean {
  return resolveWebAuthnRpId() !== null && resolveWebAuthnExpectedOrigin() !== null;
}
