import { createHash, createVerify } from 'crypto';

export interface HardwareGrantMessageInput {
  gateId: string;
  sessionId: string;
  actionId: string;
  tenantId: string;
  scope: 'agent' | 'device' | 'deployment';
  targetId: string;
  commandType: string;
  payloadHash: string;
  issuedAt: string;
  expiresAt: string;
  monotonicCounter: number;
}

export interface HardwareGrantEnvelope extends HardwareGrantMessageInput {
  signature: string;
  algorithm?: string;
}

function sortValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortValue(value[key]);
    }
    return sorted;
  }
  return value;
}

export function stableStringify(value: any): string {
  return JSON.stringify(sortValue(value ?? {}));
}

export function hashPayload(payload: any): string {
  return createHash('sha256').update(stableStringify(payload ?? {})).digest('hex');
}

export function buildHardwareGrantMessage(input: HardwareGrantMessageInput): string {
  return [
    input.gateId,
    input.sessionId,
    input.actionId,
    input.tenantId,
    input.scope,
    input.targetId,
    input.commandType,
    input.payloadHash,
    input.issuedAt,
    input.expiresAt,
    String(input.monotonicCounter)
  ].join('\n');
}

export function verifyHardwareGrantSignature(
  publicKeyPem: string,
  grant: HardwareGrantEnvelope
): boolean {
  if (!publicKeyPem || !grant.signature) {
    return false;
  }

  try {
    return createVerify('SHA256')
      .update(buildHardwareGrantMessage(grant))
      .end()
      .verify(publicKeyPem, grant.signature, 'base64');
  } catch {
    return false;
  }
}
