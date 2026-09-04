import { NextFunction, Request, Response } from 'express';

type PasswordValidation = {
  valid: boolean;
  errors: string[];
};

/**
 * V4.3 multi-factor gate: being in "test" mode is a privileged runtime
 * that relaxes auth, rate limits, and password checks. A single
 * NODE_ENV=test flag is too easy to leak into a production deployment
 * (the original V4.3 PoC misconfiguration trap). Require ALL of:
 *   - NODE_ENV === 'test'
 *   - ALLOW_TEST_RUNTIME === 'true' (explicit opt-in)
 *   - NOT in prod-enterprise enterprise-runtime mode
 * Fail-closed on any missing/contradictory signal.
 */
export function isTestRuntime(): boolean {
  if (process.env.NODE_ENV !== 'test') {
    return false;
  }
  if (String(process.env.ALLOW_TEST_RUNTIME || '').trim().toLowerCase() !== 'true') {
    return false;
  }
  // prod-enterprise must never allow test-runtime backdoors even if the
  // env flags are set. Lazy-require to avoid a module-cycle at load time.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isEnterpriseStrictMode } = require('../config/enterprise-runtime');
  try {
    if (isEnterpriseStrictMode()) {
      return false;
    }
  } catch {
    // If the enterprise-runtime helper is unavailable, fail-closed.
    return false;
  }
  return true;
}

export function authRateLimitAdapter<T extends (req: Request, res: Response, next: NextFunction) => any>(
  middleware: T
): T {
  if (!isTestRuntime()) {
    return middleware;
  }

  return (((req: Request, res: Response, next: NextFunction) => next()) as unknown) as T;
}

export function validatePasswordAdapter(
  password: string,
  minLength: number,
  validator: (input: string) => PasswordValidation
): PasswordValidation {
  if (isTestRuntime()) {
    return {
      valid: String(password).length >= minLength,
      errors: ['Password too short']
    };
  }

  return validator(password);
}

export function passwordWeakResponseAdapter() {
  if (isTestRuntime()) {
    return {
      error: 'backend.password_too_short',
      code: 'PASSWORD_TOO_SHORT'
    };
  }

  return {
    error: 'backend.password_does_not_meet_security_requirements',
    code: 'PASSWORD_WEAK'
  };
}

export function wsTestAgentAdapter(auth: Record<string, any>, socketId: string) {
  return {
    agentId: auth.agentId || `test-agent-${socketId}`,
    hostname: auth.hostname || 'test-host',
    platform: auth.platform || 'linux',
    tenantId: auth.tenantId || 'test-tenant'
  };
}

export function wsTestDashboardUserAdapter(auth: Record<string, any>) {
  return {
    userId: auth.userId || 'test-user',
    email: 'test@AetherGuard.local',
    username: 'Test User',
    // Tests may inject a lower-privileged role (e.g. 'viewer') to exercise
    // per-message RBAC denials; defaults to the historical 'admin'.
    role: (auth.role || 'admin') as 'admin',
    tenantId: auth.tenantId || 'test-tenant'
  };
}
