#!/usr/bin/env node
/**
 * Release guard: Root-Resistant claims must match the actual evidence level.
 *
 * Audit 2026-08 (batch 0): gateway status is a three-level evidence model
 * (reported / verified / attested) and ONLY the server-owned 'attested'
 * level may drive "Root-Resistant Active". The attestation verifier is not
 * implemented yet, so:
 *   1. the remediation matrix must exist and declare Root-Resistant
 *      EXPERIMENTAL/blocked;
 *   2. README.md and deployment/gateway/README.md must carry the
 *      experimental evidence-status labels;
 *   3. the gateway status report must NOT accept self-reported attestation
 *      fields (lastAttestationAt);
 *   4. `active` must be gated on the server-owned attestation level, not a
 *      reported timestamp.
 *
 * Usage: node scripts/guards/check-root-resistant-claims.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
let failures = 0;

function fail(message) {
  console.error(`root_resistant_claims=failed reason="${message}"`);
  failures += 1;
}

function readRepo(relativePath) {
  const absolute = join(root, relativePath);
  if (!existsSync(absolute)) {
    fail(`missing required file ${relativePath}`);
    return null;
  }
  return readFileSync(absolute, 'utf8');
}

// 1. Remediation matrix exists and keeps the Root-Resistant status honest.
const matrix = readRepo(join('docs', 'security-audit', '2026-08-remediation-matrix.md'));
if (matrix !== null) {
  if (!/Root-Resistant.*EXPERIMENTAL|EXPERIMENTAL \/ blocked/s.test(matrix)) {
    fail('remediation matrix must declare the overall Root-Resistant status as EXPERIMENTAL/blocked');
  }
  if (!/AUD-00-1/.test(matrix)) {
    fail('remediation matrix is missing the AUD-00-1 attestation fail-closed entry');
  }
}

// 2. README evidence-status label.
const readme = readRepo('README.md');
if (readme !== null) {
  if (!/Evidence status \(2026-08 security audit\): EXPERIMENTAL/.test(readme)) {
    fail('README.md must carry the Root-Resistant evidence-status EXPERIMENTAL label');
  }
  if (!/2026-08-remediation-matrix\.md/.test(readme)) {
    fail('README.md must link the remediation matrix');
  }
}

// 3. Gateway deployment README label.
const gatewayReadme = readRepo(join('deployment', 'gateway', 'README.md'));
if (gatewayReadme !== null) {
  if (!/EXPERIMENTAL \(2026-08 security audit\)/.test(gatewayReadme)) {
    fail('deployment/gateway/README.md must carry the EXPERIMENTAL banner');
  }
}

// 4. Control plane must not accept self-reported attestation timestamps.
const routePath = join(root, 'backend', 'src', 'api', 'routes', 'final-defense.routes.ts');
if (!existsSync(routePath)) {
  fail('missing backend/src/api/routes/final-defense.routes.ts');
} else {
  const routeSource = readFileSync(routePath, 'utf8');
  if (/lastAttestationAt\s*:\s*nonEmptyString\(req\.body/.test(routeSource)) {
    fail('gateway status report route still forwards self-reported lastAttestationAt');
  }
}

// 5. Service must gate attestation on the server-owned level column.
const servicePath = join(root, 'backend', 'src', 'services', 'final-defense.service.ts');
if (!existsSync(servicePath)) {
  fail('missing backend/src/services/final-defense.service.ts');
} else {
  const serviceSource = readFileSync(servicePath, 'utf8');
  if (!/attestation_level TEXT NOT NULL DEFAULT 'reported'/.test(serviceSource)) {
    fail('root_resistant_gateways schema must default attestation_level to reported');
  }
  if (!/gatewayAttestationLevel\(row\) !== 'attested'/.test(serviceSource)) {
    fail('attestation_missing must be driven by the server-owned attestation_level, not a reported timestamp');
  }
  if (/lastAttestationAt\?:\s*string;/.test(serviceSource.split('reportRootResistantGatewayStatus')[1]?.split('){')[0] || '')) {
    fail('reportRootResistantGatewayStatus input must not accept lastAttestationAt');
  }
}

if (failures > 0) {
  console.error(`root_resistant_claims=failed failures=${failures}`);
  process.exit(1);
}
console.log('root_resistant_claims=passed (matrix + labels + fail-closed attestation gating present)');
