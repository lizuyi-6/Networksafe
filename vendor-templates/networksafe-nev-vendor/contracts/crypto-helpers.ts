import { createHash, createHmac, createSign, createVerify, randomBytes } from 'node:crypto';
import type {
  ControlPlaneCommandType,
  JsonObject,
  SignedDeviceCommand
} from './device-types.js';

export function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`).join(',')}}`;
}

export function hashPayload(payload: JsonObject): string {
  return createHash('sha256').update(stableJsonStringify(payload)).digest('hex');
}

export function signDeviceCommand(input: {
  deviceId: string;
  commandType: ControlPlaneCommandType;
  params?: JsonObject;
  secret: string;
  timestamp?: number;
  nonce?: string;
}): SignedDeviceCommand {
  const command = {
    cmd: input.commandType,
    params: input.params,
    timestamp: input.timestamp ?? Date.now(),
    nonce: input.nonce ?? randomBytes(8).toString('hex')
  };
  const signature = createHmac('sha256', input.secret).update(JSON.stringify(command)).digest('hex');
  return {
    deviceId: input.deviceId,
    command,
    signature
  };
}

export function verifyDeviceCommand(input: {
  envelope: SignedDeviceCommand;
  secret: string;
  maxSkewMs?: number;
}): { ok: boolean; reason?: string } {
  const maxSkewMs = input.maxSkewMs ?? 5 * 60 * 1000;
  const expected = createHmac('sha256', input.secret)
    .update(JSON.stringify(input.envelope.command))
    .digest('hex');

  if (expected !== input.envelope.signature) {
    return { ok: false, reason: 'invalid_signature' };
  }

  if (Math.abs(Date.now() - input.envelope.command.timestamp) > maxSkewMs) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  return { ok: true };
}

export function buildPhysicalConfirmationMessage(input: {
  deviceId: string;
  confirmationSessionId: string;
  commandType: string;
  payloadHash: string;
  monotonicCounter: number;
  timestamp: number;
}): string {
  return [
    input.deviceId,
    input.confirmationSessionId,
    input.commandType,
    input.payloadHash,
    String(input.monotonicCounter),
    String(input.timestamp)
  ].join('\n');
}

export function signPhysicalConfirmation(input: {
  privateKeyPem: string;
  deviceId: string;
  confirmationSessionId: string;
  commandType: string;
  payloadHash: string;
  monotonicCounter: number;
  timestamp: number;
}): string {
  const message = buildPhysicalConfirmationMessage(input);
  return createSign('SHA256').update(message).end().sign(input.privateKeyPem, 'base64');
}

export function verifyPhysicalConfirmation(input: {
  publicKeyPem: string;
  deviceId: string;
  confirmationSessionId: string;
  commandType: string;
  payloadHash: string;
  monotonicCounter: number;
  timestamp: number;
  signature: string;
}): boolean {
  const message = buildPhysicalConfirmationMessage(input);
  const encodings: Array<'base64' | 'hex' | 'base64url'> = ['base64', 'hex', 'base64url'];
  return encodings.some((encoding) => {
    try {
      return createVerify('SHA256').update(message).end().verify(input.publicKeyPem, input.signature, encoding);
    } catch {
      return false;
    }
  });
}
