import { createHash, createPublicKey, createVerify } from 'crypto';

export const SUPPORTED_HARDWARE_GRANT_ALGORITHM = 'ECDSA_P256_SHA256';
export type HardwareGrantAlgorithm = typeof SUPPORTED_HARDWARE_GRANT_ALGORITHM;

export interface HardwareGrantMessageInput {
  gateId: string;
  sessionId: string;
  actionId: string;
  tenantId: string;
  scope: 'agent' | 'device' | 'deployment';
  targetId: string;
  commandType: string;
  payloadHash: string;
  policyDigest?: string;
  challenge?: string;
  breakerTarget?: string;
  interlockAction?: string;
  issuedAt: string;
  expiresAt: string;
  monotonicCounter: number;
}

export interface HardwareGrantEnvelope extends HardwareGrantMessageInput {
  signature: string;
  algorithm?: string;
}

export function isSupportedHardwareGrantAlgorithm(algorithm: string): algorithm is HardwareGrantAlgorithm {
  return algorithm === SUPPORTED_HARDWARE_GRANT_ALGORITHM;
}

export function validateHardwareGrantPublicKey(publicKeyPem: string): boolean {
  if (!publicKeyPem) {
    return false;
  }
  try {
    const key = createPublicKey(publicKeyPem);
    const curve = key.asymmetricKeyDetails?.namedCurve;
    return key.asymmetricKeyType === 'ec' && (curve === 'prime256v1' || curve === 'secp256r1');
  } catch {
    return false;
  }
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
    input.policyDigest || '',
    input.challenge || '',
    input.breakerTarget || '',
    input.interlockAction || '',
    input.issuedAt,
    input.expiresAt,
    String(input.monotonicCounter)
  ].join('\n');
}

function hasExtendedGrantFields(input: HardwareGrantMessageInput): boolean {
  return Boolean(input.policyDigest || input.challenge || input.breakerTarget || input.interlockAction);
}

function buildLegacyHardwareGrantMessage(input: HardwareGrantMessageInput): string {
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
  grant: HardwareGrantEnvelope,
  expectedAlgorithm: string = SUPPORTED_HARDWARE_GRANT_ALGORITHM
): boolean {
  if (!publicKeyPem || !grant.signature) {
    return false;
  }

  const grantAlgorithm = grant.algorithm || SUPPORTED_HARDWARE_GRANT_ALGORITHM;
  if (
    !isSupportedHardwareGrantAlgorithm(expectedAlgorithm)
    || grantAlgorithm !== expectedAlgorithm
    || !validateHardwareGrantPublicKey(publicKeyPem)
  ) {
    return false;
  }

  try {
    const verified = createVerify('SHA256')
      .update(buildHardwareGrantMessage(grant))
      .end()
      .verify(publicKeyPem, grant.signature, 'base64');
    if (verified) {
      return true;
    }
    if (hasExtendedGrantFields(grant)) {
      return false;
    }
    return createVerify('SHA256')
      .update(buildLegacyHardwareGrantMessage(grant))
      .end()
      .verify(publicKeyPem, grant.signature, 'base64');
  } catch {
    return false;
  }
}
