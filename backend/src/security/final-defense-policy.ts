import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { stableStringify } from './hardware-grant';

export type InterlockState = 'isolated' | 'armed' | 'released' | 'fault' | 'disabled' | 'unknown';
export type FinalDefensePolicyStatus = 'active' | 'staged' | 'revoked';

export interface FinalDefenseAllowedAction {
  commandType: string;
  scriptPath?: string;
  maxExecutionMs?: number;
  requiresInterlockRelease?: boolean;
}

export interface FinalDefensePolicyDocument {
  policyId: string;
  tenantId: string;
  companionId: string;
  gateId: string;
  allowedActions: FinalDefenseAllowedAction[];
  breakerTarget: string;
  releaseTtlMs: number;
  createdAt: string;
  status: FinalDefensePolicyStatus;
}

export interface SignedFinalDefensePolicyDocument extends FinalDefensePolicyDocument {
  policyDigest?: string;
  signature?: string;
}

const VALID_INTERLOCK_STATES = new Set<InterlockState>([
  'isolated',
  'armed',
  'released',
  'fault',
  'disabled',
  'unknown'
]);

export function normalizeInterlockState(value: unknown): InterlockState {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'asserted') {
    return 'isolated';
  }
  return VALID_INTERLOCK_STATES.has(normalized as InterlockState)
    ? normalized as InterlockState
    : 'unknown';
}

export function policyDigestInput(policy: Partial<SignedFinalDefensePolicyDocument>): FinalDefensePolicyDocument {
  return {
    policyId: String(policy.policyId || ''),
    tenantId: String(policy.tenantId || ''),
    companionId: String(policy.companionId || ''),
    gateId: String(policy.gateId || ''),
    allowedActions: Array.isArray(policy.allowedActions)
      ? policy.allowedActions.map((action) => ({
        commandType: String(action.commandType || '').trim(),
        scriptPath: action.scriptPath ? String(action.scriptPath) : undefined,
        maxExecutionMs: Number.isFinite(Number(action.maxExecutionMs)) ? Number(action.maxExecutionMs) : undefined,
        requiresInterlockRelease: Boolean(action.requiresInterlockRelease)
      }))
      : [],
    breakerTarget: String(policy.breakerTarget || ''),
    releaseTtlMs: Number.isFinite(Number(policy.releaseTtlMs)) ? Number(policy.releaseTtlMs) : 0,
    createdAt: String(policy.createdAt || ''),
    status: (policy.status || 'staged') as FinalDefensePolicyStatus
  };
}

export function computeFinalDefensePolicyDigest(policy: Partial<SignedFinalDefensePolicyDocument>): string {
  return createHash('sha256')
    .update(stableStringify(policyDigestInput(policy)))
    .digest('hex');
}

export function signFinalDefensePolicy(policy: Partial<SignedFinalDefensePolicyDocument>, secret: string): string {
  return createHmac('sha256', secret)
    .update(computeFinalDefensePolicyDigest(policy))
    .digest('hex');
}

export function verifyFinalDefensePolicySignature(
  policy: Partial<SignedFinalDefensePolicyDocument>,
  signature: string | undefined,
  secret: string | undefined
): boolean {
  if (!secret || !signature) {
    return false;
  }
  const expected = signFinalDefensePolicy(policy, secret);
  if (expected.length !== signature.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
}
