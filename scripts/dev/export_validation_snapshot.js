const fs = require('fs');
const path = require('path');
const { createAuthCookieSession, resolveProjectEnv } = require('./http-cookie-session');

const BASE_URL = process.env.AETHERGUARD_BASE_URL || 'http://localhost:3005';
const rootDir = path.resolve(__dirname, '..', '..');
const EMAIL = resolveProjectEnv(rootDir, 'ADMIN_EMAIL', 'AETHERGUARD_ADMIN_EMAIL', 'dev-admin@aetherguard.local');
const PASSWORD = resolveProjectEnv(rootDir, 'ADMIN_PASSWORD', 'AETHERGUARD_ADMIN_PASSWORD', 'DevAdmin!2026');

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${url} ${JSON.stringify(data)}`);
  }

  return data;
}

async function main() {
  const login = await createAuthCookieSession(BASE_URL, EMAIL, PASSWORD);

  const headers = {
    Cookie: login.cookieHeader
  };

  const config = await requestJson(`${BASE_URL}/api/config`, { headers });
  const benchmarkHistory = await requestJson(`${BASE_URL}/api/admin/benchmarks/history?limit=5`, { headers });
  const auditSegments = await requestJson(`${BASE_URL}/api/admin/audit/segments?limit=5`, { headers });
  const deliveries = await requestJson(`${BASE_URL}/api/config/notifications/deliveries?limit=10`, { headers });
  const aiEndpoints = await requestJson(`${BASE_URL}/api/ai-endpoints`, { headers });

  let latestAuditVerification = null;
  const firstSegment = auditSegments.segments && auditSegments.segments[0];
  if (firstSegment && firstSegment.id) {
    latestAuditVerification = await requestJson(
      `${BASE_URL}/api/admin/audit/segments/${firstSegment.id}/verify`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: '{}'
      }
    );
  }

  let deviceDetail = null;
  let deviceEvents = null;
  let deploymentBundleValidation = null;
  try {
    deviceDetail = await requestJson(`${BASE_URL}/api/devices/esp32-smoke`, { headers });
    deviceEvents = await requestJson(`${BASE_URL}/api/devices/esp32-smoke/events`, { headers });
  } catch (error) {
    deviceDetail = { error: error.message };
    deviceEvents = { error: error.message };
  }

  try {
    const deploymentValidationPath = path.resolve(
      __dirname,
      '../../artifacts/ops/deployment-bundle-validation/deployment-bundle-validation.json'
    );
    if (fs.existsSync(deploymentValidationPath)) {
      deploymentBundleValidation = JSON.parse(fs.readFileSync(deploymentValidationPath, 'utf8'));
    }
  } catch (error) {
    deploymentBundleValidation = { error: error.message };
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    config,
    benchmarkHistory,
    auditSegments,
    latestAuditVerification,
    deliveries,
    aiEndpoints,
    deviceDetail,
    deviceEvents,
    deploymentBundleValidation
  };

  const outDir = path.resolve(__dirname, '../../artifacts/ops');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'validation-snapshot.json');
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  process.stdout.write(`${outPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
