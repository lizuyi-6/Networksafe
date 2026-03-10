const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const rootDir = path.resolve(__dirname, '..', '..');
const outputDir = path.join(rootDir, 'artifacts', 'ops');
const outputPath = path.join(outputDir, 'ui-release-smoke.json');
const frontendUrl = process.env.AETHERGUARD_FRONTEND_URL || 'http://localhost:8080';
const baseUrl = process.env.AETHERGUARD_BASE_URL || 'http://localhost:3005';
const email = process.env.AETHERGUARD_ADMIN_EMAIL || 'dev-admin@aetherguard.local';
const password = process.env.AETHERGUARD_ADMIN_PASSWORD || 'DevAdmin!2026';

function ensureOutputDir() {
  fs.mkdirSync(outputDir, { recursive: true });
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

async function loginApi() {
  const login = await requestJson(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (!login.ok || !login.data?.accessToken) {
    throw new Error(`API login failed: ${JSON.stringify(login.data)}`);
  }

  return login.data.accessToken;
}

async function switchMode(token, appMode) {
  return requestJson(`${baseUrl}/api/system/mode`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ appMode, seedDemoData: false, clearExisting: false })
  });
}

async function main() {
  ensureOutputDir();

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      frontendUrl,
      baseUrl
    },
    checks: {},
    summary: {
      pass: false
    }
  };

  const token = await loginApi();
  const modeResponse = await requestJson(`${baseUrl}/api/system/mode`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const previousMode = modeResponse.data?.appMode || 'production';

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${frontendUrl}/login`, { waitUntil: 'networkidle' });
    await page.getByRole('textbox', { name: 'name@company.com' }).fill(email);
    await page.getByRole('textbox', { name: '........' }).fill(password);
    await page.getByRole('button', { name: 'Secure Login' }).click();
    await page.waitForURL('**/dashboard', { timeout: 30000 });
    report.checks.loginUi = {
      ok: true,
      url: page.url()
    };

    await page.goto(`${frontendUrl}/settings`, { waitUntil: 'networkidle' });
    const verifyButton = page.getByRole('button', { name: /Verify Platform AI/i });
    await verifyButton.waitFor({ timeout: 30000 });
    await verifyButton.click();
    await page.getByText('AETHERGUARD_REMOTE_AI_OK', { exact: true }).waitFor({ timeout: 30000 });
    report.checks.settings = {
      ok: true,
      url: page.url(),
      heading: await page.locator('h1').first().textContent(),
      platformAiProofVisible: await page.getByText('AETHERGUARD_REMOTE_AI_OK', { exact: true }).isVisible()
    };

    await page.goto(`${frontendUrl}/deploy`, { waitUntil: 'networkidle' });
    report.checks.deploy = {
      ok: true,
      url: page.url(),
      heading: await page.locator('h1').first().textContent(),
      historyVisible: await page.getByText(/Recent deployments|最近/i).first().isVisible().catch(() => false)
    };

    const switchToDemo = await switchMode(token, 'demo');
    report.checks.switchToDemo = switchToDemo;
    if (!switchToDemo.ok) {
      throw new Error(`Failed to switch to demo mode: ${JSON.stringify(switchToDemo.data)}`);
    }

    await page.goto(`${frontendUrl}/attack-sim`, { waitUntil: 'networkidle' });
    report.checks.attackSim = {
      ok: true,
      url: page.url(),
      heading: await page.locator('h1').first().textContent(),
      runButtonVisible: await page.getByRole('button', { name: /Run Simulation|运行/i }).first().isVisible()
    };

    report.summary.pass = Boolean(
      report.checks.loginUi?.ok
      && report.checks.settings?.platformAiProofVisible
      && report.checks.deploy?.historyVisible
      && report.checks.attackSim?.runButtonVisible
    );
  } finally {
    try {
      await switchMode(token, previousMode);
    } catch (error) {
      report.checks.restoreMode = {
        ok: false,
        error: error.message || String(error)
      };
    }

    if (browser) {
      await browser.close();
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    pass: report.summary.pass,
    outputPath,
    checks: report.checks
  }, null, 2));
}

main().catch((error) => {
  ensureOutputDir();
  const failure = {
    generatedAt: new Date().toISOString(),
    summary: { pass: false },
    error: error.message || String(error)
  };
  fs.writeFileSync(outputPath, JSON.stringify(failure, null, 2));
  console.error(JSON.stringify(failure, null, 2));
  process.exit(1);
});
