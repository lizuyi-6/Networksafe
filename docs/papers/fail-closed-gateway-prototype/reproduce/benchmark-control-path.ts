import {
  createSign,
  generateKeyPairSync
} from 'crypto';
import {
  buildHardwareGrantMessage,
  verifyHardwareGrantSignature,
  type HardwareGrantEnvelope
} from '../../../../backend/src/security/hardware-grant';
import {
  computeFinalDefensePolicyDigest,
  type FinalDefensePolicyDocument
} from '../../../../backend/src/security/final-defense-policy';

interface BenchmarkResult {
  operation: string;
  batches: number;
  iterationsPerBatch: number;
  totalOperations: number;
  meanNsPerOp: number;
  p50NsPerOp: number;
  p95NsPerOp: number;
  minNsPerOp: number;
  maxNsPerOp: number;
}

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function benchmark(
  operation: string,
  fn: () => void,
  warmupIterations: number,
  batches: number,
  iterationsPerBatch: number
): BenchmarkResult {
  for (let i = 0; i < warmupIterations; i += 1) fn();

  const samples: number[] = [];
  for (let batch = 0; batch < batches; batch += 1) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterationsPerBatch; i += 1) fn();
    const elapsedNs = Number(process.hrtime.bigint() - start);
    samples.push(elapsedNs / iterationsPerBatch);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  return {
    operation,
    batches,
    iterationsPerBatch,
    totalOperations: batches * iterationsPerBatch,
    meanNsPerOp: Math.round(mean),
    p50NsPerOp: Math.round(percentile(sorted, 0.5)),
    p95NsPerOp: Math.round(percentile(sorted, 0.95)),
    minNsPerOp: Math.round(sorted[0]),
    maxNsPerOp: Math.round(sorted[sorted.length - 1])
  };
}

const policy: FinalDefensePolicyDocument = {
  policyId: 'policy-paper-benchmark',
  tenantId: 'tenant-paper',
  companionId: 'companion-paper',
  gateId: 'gateway-paper',
  allowedActions: [
    { commandType: 'interlock_release', requiresInterlockRelease: true }
  ],
  breakerTarget: 'server-lan-bridge',
  releaseTtlMs: 30_000,
  createdAt: '2026-07-13T00:00:00.000Z',
  status: 'active'
};
const policyDigest = computeFinalDefensePolicyDigest(policy);

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const unsignedGrant: Omit<HardwareGrantEnvelope, 'signature'> = {
  gateId: 'gateway-paper',
  sessionId: 'session-paper',
  actionId: 'action-paper',
  tenantId: 'tenant-paper',
  scope: 'device',
  targetId: 'gateway-paper',
  commandType: 'interlock_release',
  payloadHash: '0'.repeat(64),
  policyDigest,
  challenge: 'challenge-paper',
  breakerTarget: 'server-lan-bridge',
  interlockAction: 'release',
  issuedAt: '1783900800',
  expiresAt: '1783904400',
  monotonicCounter: 1,
  algorithm: 'ECDSA_P256_SHA256'
};

function signGrant(): string {
  return createSign('SHA256')
    .update(buildHardwareGrantMessage(unsignedGrant))
    .end()
    .sign(privateKey, 'base64');
}

const signature = signGrant();
const grant: HardwareGrantEnvelope = { ...unsignedGrant, signature };
const tamperedGrant: HardwareGrantEnvelope = {
  ...grant,
  policyDigest: `${policyDigest.slice(0, -1)}${policyDigest.endsWith('0') ? '1' : '0'}`
};

if (!verifyHardwareGrantSignature(publicKeyPem, grant)) {
  throw new Error('benchmark precondition failed: valid grant rejected');
}
if (verifyHardwareGrantSignature(publicKeyPem, tamperedGrant)) {
  throw new Error('benchmark precondition failed: tampered policyDigest accepted');
}
if (computeFinalDefensePolicyDigest(policy) !== policyDigest) {
  throw new Error('benchmark precondition failed: policy digest is not deterministic');
}

const results = [
  benchmark('policy_digest_sha256', () => {
    computeFinalDefensePolicyDigest(policy);
  }, 2_000, 30, 2_000),
  benchmark('grant_message_canonicalization', () => {
    buildHardwareGrantMessage(grant);
  }, 5_000, 30, 5_000),
  benchmark('ecdsa_p256_sign_mock_se', () => {
    signGrant();
  }, 200, 30, 100),
  benchmark('ecdsa_p256_verify_valid', () => {
    if (!verifyHardwareGrantSignature(publicKeyPem, grant)) {
      throw new Error('valid grant rejected during benchmark');
    }
  }, 200, 30, 200),
  benchmark('ecdsa_p256_verify_tampered_digest', () => {
    if (verifyHardwareGrantSignature(publicKeyPem, tamperedGrant)) {
      throw new Error('tampered grant accepted during benchmark');
    }
  }, 200, 30, 200)
];

console.log(JSON.stringify({
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpu: process.env.PROCESSOR_IDENTIFIER || 'unknown'
  },
  preconditions: {
    validGrantAccepted: true,
    tamperedPolicyDigestRejected: true,
    deterministicPolicyDigest: true,
    policyDigest
  },
  results
}, null, 2));
