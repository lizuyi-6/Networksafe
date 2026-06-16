import crypto from 'crypto';

function signingSecret(): string {
  return String(
    process.env.DEPLOYMENT_BUNDLE_SIGNING_SECRET
    || process.env.DEVICE_COMMAND_SECRET
    || ''
  ).trim();
}

export function isDeploymentBundleSigningConfigured(): boolean {
  return signingSecret().length >= 24;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}

export function signDeploymentBundlePayload(payload: Record<string, unknown>): string {
  const secret = signingSecret();
  if (!secret) {
    throw new Error('backend.deployment_bundle_signing_secret_missing');
  }
  return crypto
    .createHmac('sha256', secret)
    .update(stableJson(payload))
    .digest('hex');
}

export function verifyDeploymentBundlePayload(payload: Record<string, unknown>, signature: string): boolean {
  if (!signature || !isDeploymentBundleSigningConfigured()) {
    return false;
  }

  const expected = signDeploymentBundlePayload(payload);
  if (expected.length !== signature.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
}
