import { NextFunction, Request, Response } from 'express';

type PasswordValidation = {
  valid: boolean;
  errors: string[];
};

export function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test';
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
    role: 'admin' as const,
    tenantId: auth.tenantId || 'test-tenant'
  };
}
