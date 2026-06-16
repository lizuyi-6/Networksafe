const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const frontendUrl = process.env.AETHERGUARD_FRONTEND_URL || 'http://127.0.0.1:8080';
const runId = process.env.AETHERGUARD_REVIEW_RUN_ID || `review-lab-shots-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = path.resolve(process.env.AETHERGUARD_REVIEW_OUTPUT_DIR || path.join(rootDir, 'artifacts', 'ops', runId));
const screenshotsDir = path.join(outputDir, 'screenshots');
const email = process.env.AETHERGUARD_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'admin@AetherGuard.com';
const password = process.env.AETHERGUARD_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'AdminLocal!2026';

const routes = [
  { route: '/dashboard', file: '01-dashboard.png', selector: 'main' },
  { route: '/rules', file: '02-detection-pipeline-rules.png', selector: 'main' },
  { route: '/agent-monitor', file: '03-agent-monitor.png', selector: 'main' },
  { route: '/traffic', file: '04-traffic.png', selector: 'main' },
  { route: '/alerts', file: '05-alerts.png', selector: 'main' },
  { route: '/devices', file: '06-hardware-gates.png', selector: 'main' },
  { route: '/scanner', file: '07-scanner.png', selector: 'main' },
  { route: '/settings', file: '08-settings.png', selector: 'main' }
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return require(path.join(rootDir, 'node_modules', 'playwright'));
  }
}

async function waitForPageReady(page, selector) {
  await page.waitForLoadState('domcontentloaded');
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1200);
}

async function prepareRouteForCapture(page, item) {
  await page.addStyleTag({
    content: `
      [data-testid="demo-mode-toggle"],
      [data-testid="live-mode-toggle"],
      [aria-label*="演示模式"],
      [aria-label*="Demo mode"] {
        display: none !important;
      }
    `
  });

  if (item.route === '/scanner') {
    const firstHistory = page.locator('[data-testid^="scanner-history-"]').first();
    if (await firstHistory.count()) {
      await firstHistory.click();
      await page.waitForTimeout(1500);
    }
  }
}

async function login(page) {
  await page.goto(`${frontendUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').first().fill(email);
  await page.locator('input[name="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname !== '/login', { timeout: 30000 }),
    page.locator('button[type="submit"]').first().click()
  ]);
}

async function capture(page, item) {
  await page.goto(`${frontendUrl}${item.route}`, { waitUntil: 'domcontentloaded' });
  await waitForPageReady(page, item.selector);
  await prepareRouteForCapture(page, item);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  const filePath = path.join(screenshotsDir, item.file);
  await page.screenshot({ path: filePath, fullPage: false, type: 'png' });
  return {
    route: item.route,
    file: item.file,
    filePath,
    bytes: fs.statSync(filePath).size
  };
}

async function main() {
  ensureDir(screenshotsDir);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
    locale: 'zh-CN'
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript(() => {
    window.localStorage.setItem('aetherguard-theme-v2', 'light');
    window.localStorage.setItem('aetherguard-live-mode', 'true');
    window.localStorage.setItem('i18nextLng', 'zh');
  });

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  try {
    await login(page);
    const shots = [];
    for (const item of routes) {
      shots.push(await capture(page, item));
    }

    const manifest = {
      generatedAt: new Date().toISOString(),
      runId,
      frontendUrl,
      outputDir,
      screenshots: shots,
      consoleErrors
    };
    fs.writeFileSync(path.join(outputDir, 'screenshot-manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({
      outputDir,
      screenshotsDir,
      count: shots.length,
      consoleErrors: consoleErrors.length
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  ensureDir(outputDir);
  fs.writeFileSync(path.join(outputDir, 'screenshot-error.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    runId,
    error: error?.stack || error?.message || String(error)
  }, null, 2));
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
