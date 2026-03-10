const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..', '..');
const outputDir = path.join(rootDir, 'artifacts', 'ops');
const outputPath = path.join(outputDir, 'local-platform-acceptance.json');
const baseUrl = process.env.AETHERGUARD_BASE_URL || 'http://localhost:3005';
const frontendUrl = process.env.AETHERGUARD_FRONTEND_URL || 'http://localhost:8080';

function ensureOutputDir() {
  fs.mkdirSync(outputDir, { recursive: true });
}

function runCommand(command, args) {
  return execFileSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

async function main() {
  ensureOutputDir();

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      baseUrl,
      frontendUrl
    },
    checks: {}
  };

  try {
    report.checks.composePsRaw = runCommand('docker', ['compose', 'ps']);
  } catch (error) {
    report.checks.composePsRaw = String(error.stderr || error.message || error);
  }

  const frontend = await fetch(frontendUrl);
  report.checks.frontend = { status: frontend.status, ok: frontend.ok };

  const login = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'dev-admin@aetherguard.local',
      password: 'DevAdmin!2026'
    })
  });
  if (!login.ok || !login.data?.accessToken) {
    throw new Error(`Login failed: ${JSON.stringify(login.data)}`);
  }
  report.checks.login = {
    status: login.status,
    user: login.data.user
  };

  const authHeaders = {
    'content-type': 'application/json',
    authorization: `Bearer ${login.data.accessToken}`
  };

  const readChecks = {
    health: '/api/health',
    me: '/api/auth/me',
    alerts: '/api/alerts?limit=5',
    adminUsers: '/api/admin/users?limit=5',
    aiEndpoints: '/api/ai-endpoints',
    deploymentHistory: '/api/deployments/history/list?limit=5',
    auditSegments: '/api/admin/audit/segments?limit=3',
    systemMode: '/api/system/mode'
  };

  for (const [key, route] of Object.entries(readChecks)) {
    report.checks[key] = await requestJson(`${baseUrl}${route}`, {
      headers: authHeaders
    });
  }

  const aiProof = await requestJson(`${baseUrl}/api/ai-endpoints/chat`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      modelId: 'qwen3-max-2026-01-23',
      purpose: 'deep_analysis',
      messages: [
        { role: 'system', content: 'You are a concise security assistant.' },
        { role: 'user', content: 'Reply with exactly the text: AETHERGUARD_REMOTE_AI_OK' }
      ]
    })
  });
  report.checks.platformAIProof = aiProof;

  const previousMode = report.checks.systemMode?.data?.appMode || 'production';
  let restoreRequired = false;

  try {
    if (previousMode !== 'demo') {
      const switchToDemo = await requestJson(`${baseUrl}/api/system/mode`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ appMode: 'demo', seedDemoData: false, clearExisting: false })
      });
      report.checks.switchToDemo = switchToDemo;
      restoreRequired = switchToDemo.ok;
      await sleep(250);
    }

    const modeAfterSwitch = await requestJson(`${baseUrl}/api/system/mode`, {
      headers: authHeaders
    });
    report.checks.systemModeAfterSwitch = modeAfterSwitch;

    report.checks.attackTypes = await requestJson(`${baseUrl}/api/attack/types`, {
      headers: authHeaders
    });
    report.checks.attackSimulation = await requestJson(`${baseUrl}/api/attack/simulate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ attackIds: ['sql-1'] })
    });
  } finally {
    if (restoreRequired) {
      report.checks.restoreMode = await requestJson(`${baseUrl}/api/system/mode`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ appMode: previousMode, seedDemoData: false, clearExisting: false })
      });
    }
  }

  const attackResult = report.checks.attackSimulation.data?.results?.[0] || null;
  const attackDecision = attackResult?.decision || null;
  const attackAiAnalysis = attackResult?.aiAnalysis || null;
  const hasDecisionShape = Boolean(
    attackDecision
    && typeof attackDecision.verdict === 'string'
    && typeof attackDecision.confidence === 'number'
    && typeof attackDecision.reasoning === 'string'
    && Array.isArray(attackDecision.evidence)
  );
  const hasConcreteAiRoute = Boolean(
    attackAiAnalysis?.usedAI
    && typeof attackAiAnalysis.route === 'string'
    && !['unknown', 'error'].includes(attackAiAnalysis.route)
  );

  report.summary = {
    frontendOk: report.checks.frontend.ok === true,
    healthOk: report.checks.health.ok === true && report.checks.health.data?.status === 'healthy',
    aiProofOk: report.checks.platformAIProof.ok === true
      && report.checks.platformAIProof.data?.content === 'AETHERGUARD_REMOTE_AI_OK',
    attackSimulationOk: report.checks.attackSimulation.ok === true
      && hasDecisionShape
      && hasConcreteAiRoute,
    attackSimulationRoute: attackAiAnalysis?.route || null,
    attackSimulationVerdict: attackDecision?.verdict || null
  };
  report.summary.pass = Boolean(
    report.summary.frontendOk
    && report.summary.healthOk
    && report.summary.aiProofOk
    && report.summary.attackSimulationOk
  );

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    pass: report.summary.pass,
    outputPath,
    aiProof: report.checks.platformAIProof.data,
    attackSimulation: {
      aiAnalysis: attackAiAnalysis,
      decision: attackDecision
    }
  }, null, 2));
}

main().catch((error) => {
  ensureOutputDir();
  const failure = {
    generatedAt: new Date().toISOString(),
    error: error.message || String(error)
  };
  fs.writeFileSync(outputPath, JSON.stringify(failure, null, 2));
  console.error(JSON.stringify(failure, null, 2));
  process.exit(1);
});
