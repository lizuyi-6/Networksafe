/**
 * Request Body Validators
 * Hand-rolled validators for high-risk API endpoints.
 * Replaces ad-hoc checks in auth.routes.ts and final-defense.routes.ts.
 */

import { isPlatformAdminRole } from '../security/permissions';

// ---------------------------------------------------------------------------
// Auth validators
// ---------------------------------------------------------------------------

export interface LoginBody {
  email: string;
  password: string;
}

export interface RegisterBody {
  email: string;
  password: string;
  username: string;
}

export interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const USERNAME_MIN_LENGTH = 2;
const USERNAME_MAX_LENGTH = 64;

export function validateLoginBody(body: unknown): { valid: true; data: LoginBody } | { valid: false; error: string } {
  if (body === null || body === undefined || typeof body !== 'object') {
    return { valid: false, error: 'backend.request_body_must_be_an_object' };
  }

  const obj = body as Record<string, unknown>;

  // email
  if (typeof obj.email !== 'string' || !EMAIL_REGEX.test(obj.email)) {
    return { valid: false, error: 'backend.invalid_email_format' };
  }

  // password
  if (typeof obj.password !== 'string' || obj.password.length === 0) {
    return { valid: false, error: 'backend.password_is_required' };
  }

  return {
    valid: true,
    data: {
      email: (obj.email as string).toLowerCase().trim(),
      password: obj.password as string
    }
  };
}

export function validateRegisterBody(body: unknown): { valid: true; data: RegisterBody } | { valid: false; error: string } {
  if (body === null || body === undefined || typeof body !== 'object') {
    return { valid: false, error: 'backend.request_body_must_be_an_object' };
  }

  const obj = body as Record<string, unknown>;

  // email
  if (typeof obj.email !== 'string' || !EMAIL_REGEX.test(obj.email)) {
    return { valid: false, error: 'backend.invalid_email_format' };
  }

  // password
  if (typeof obj.password !== 'string' || obj.password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, error: 'backend.password_must_be_at_least_8_characters' };
  }

  // username
  if (typeof obj.username !== 'string' || obj.username.trim().length < USERNAME_MIN_LENGTH) {
    return { valid: false, error: 'backend.username_must_be_at_least_2_characters' };
  }
  const username = obj.username.trim().slice(0, USERNAME_MAX_LENGTH).replace(/<[^>]*>/g, '');

  return {
    valid: true,
    data: {
      email: (obj.email as string).toLowerCase().trim(),
      password: obj.password as string,
      username
    }
  };
}

export function validateChangePasswordBody(body: unknown): { valid: true; data: ChangePasswordBody } | { valid: false; error: string } {
  if (body === null || body === undefined || typeof body !== 'object') {
    return { valid: false, error: 'backend.request_body_must_be_an_object' };
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.currentPassword !== 'string' || obj.currentPassword.length === 0) {
    return { valid: false, error: 'backend.current_password_is_required' };
  }

  if (typeof obj.newPassword !== 'string' || obj.newPassword.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, error: 'backend.new_password_must_be_at_least_8_characters' };
  }

  return {
    valid: true,
    data: {
      currentPassword: obj.currentPassword as string,
      newPassword: obj.newPassword as string
    }
  };
}

// ---------------------------------------------------------------------------
// Final-defense validators
// ---------------------------------------------------------------------------

export interface FinalDefensePolicyBody {
  companionId: string;
  gateId: string;
  breakerTarget: string;
  allowedActions: Array<{
    commandType: string;
    scriptPath?: string;
    maxExecutionMs?: number;
    requiresInterlockRelease?: boolean;
  }>;
  releaseTtlMs?: number;
  status?: 'active' | 'staged' | 'revoked';
}

export interface FinalDefenseActionBody {
  companionId: string;
  commandType: string;
  payload?: Record<string, unknown>;
  challenge?: string;
}

export interface GatewayActionBody {
  gatewayId: string;
  action: string;
  payload?: Record<string, unknown>;
  challenge?: string;
}

export function validateFinalDefensePolicyBody(body: unknown): {
  valid: true;
  data: FinalDefensePolicyBody;
} | { valid: false; error: string } {
  if (body === null || body === undefined || typeof body !== 'object') {
    return { valid: false, error: 'backend.request_body_must_be_an_object' };
  }

  const obj = body as Record<string, unknown>;

  const companionId = typeof obj.companionId === 'string' ? obj.companionId.trim() : '';
  const gateId = typeof obj.gateId === 'string' ? obj.gateId.trim() : '';
  const breakerTarget = typeof obj.breakerTarget === 'string' ? obj.breakerTarget.trim() : '';

  if (!companionId || !gateId || !breakerTarget) {
    return { valid: false, error: 'backend.final_defense_policy_required_fields' };
  }

  // allowedActions
  if (!Array.isArray(obj.allowedActions) || obj.allowedActions.length === 0) {
    return { valid: false, error: 'backend.final_defense_policy_allowed_actions_required' };
  }

  const allowedActions: FinalDefensePolicyBody['allowedActions'] = [];
  for (const item of obj.allowedActions) {
    if (!item || typeof item !== 'object') {
      return { valid: false, error: 'backend.final_defense_policy_invalid_allowed_action' };
    }
    const action = item as Record<string, unknown>;
    const commandType = typeof action.commandType === 'string' ? action.commandType.trim() : '';
    if (!commandType) {
      return { valid: false, error: 'backend.final_defense_policy_invalid_allowed_action_command_type' };
    }
    allowedActions.push({
      commandType,
      scriptPath: typeof action.scriptPath === 'string' ? action.scriptPath.trim() : undefined,
      maxExecutionMs: typeof action.maxExecutionMs === 'number' && Number.isFinite(action.maxExecutionMs) ? action.maxExecutionMs : undefined,
      requiresInterlockRelease: typeof action.requiresInterlockRelease === 'boolean' ? action.requiresInterlockRelease : undefined
    });
  }

  const VALID_STATUSES = new Set(['active', 'staged', 'revoked']);
  const status = typeof obj.status === 'string' && VALID_STATUSES.has(obj.status) ? obj.status : 'active';

  return {
    valid: true,
    data: {
      companionId,
      gateId,
      breakerTarget,
      allowedActions,
      releaseTtlMs: typeof obj.releaseTtlMs === 'number' && Number.isFinite(obj.releaseTtlMs) ? obj.releaseTtlMs : undefined,
      status: status as FinalDefensePolicyBody['status']
    }
  };
}

export function validateFinalDefenseActionBody(body: unknown): {
  valid: true;
  data: FinalDefenseActionBody;
} | { valid: false; error: string } {
  if (body === null || body === undefined || typeof body !== 'object') {
    return { valid: false, error: 'backend.request_body_must_be_an_object' };
  }

  const obj = body as Record<string, unknown>;

  const companionId = typeof obj.companionId === 'string' ? obj.companionId.trim() : '';
  const commandType = typeof obj.commandType === 'string' ? obj.commandType.trim() : '';

  if (!companionId || !commandType) {
    return { valid: false, error: 'backend.final_defense_action_required_fields' };
  }

  return {
    valid: true,
    data: {
      companionId,
      commandType,
      payload: obj.payload && typeof obj.payload === 'object' ? obj.payload as Record<string, unknown> : {},
      challenge: typeof obj.challenge === 'string' ? obj.challenge.trim() : undefined
    }
  };
}

export function validateGatewayActionBody(body: unknown): {
  valid: true;
  data: GatewayActionBody;
} | { valid: false; error: string } {
  if (body === null || body === undefined || typeof body !== 'object') {
    return { valid: false, error: 'backend.request_body_must_be_an_object' };
  }

  const obj = body as Record<string, unknown>;

  const gatewayId = typeof obj.gatewayId === 'string' ? obj.gatewayId.trim() : '';
  const action = typeof obj.action === 'string' ? obj.action.trim() : '';

  if (!gatewayId || !action) {
    return { valid: false, error: 'backend.root_gateway_action_required_fields' };
  }

  return {
    valid: true,
    data: {
      gatewayId,
      action,
      payload: obj.payload && typeof obj.payload === 'object' ? obj.payload as Record<string, unknown> : {},
      challenge: typeof obj.challenge === 'string' ? obj.challenge.trim() : undefined
    }
  };
}
