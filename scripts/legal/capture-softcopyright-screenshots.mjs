import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outputDir = path.join(repoRoot, 'output', 'playwright', 'softcopyright-aetherguard-v1');
const baseUrl = process.env.SOFTCOPYRIGHT_BASE_URL || 'http://127.0.0.1:8080';
const playwrightEntry = pathToFileURL(
  path.join(repoRoot, 'frontend', 'node_modules', 'playwright', 'index.mjs'),
).href;
const { chromium } = await import(playwrightEntry);
const credentials = {
  email: process.env.SOFTCOPYRIGHT_ADMIN_EMAIL || 'dev-admin@aetherguard.local',
  password: process.env.SOFTCOPYRIGHT_ADMIN_PASSWORD || 'DevAdmin!2026',
};

const shots = [];

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function launchBrowser() {
  try {
    return await chromium.launch({
      channel: process.env.PW_CHANNEL || 'msedge',
      headless: true,
    });
  } catch (error) {
    console.warn('Falling back to bundled Chromium:', error.message);
    return chromium.launch({ headless: true });
  }
}

async function waitForConsole(page, selector = 'main') {
  await page.waitForLoadState('domcontentloaded');
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function capture(page, filename, title) {
  const filepath = path.join(outputDir, filename);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({
    path: filepath,
    type: 'png',
    fullPage: false,
  });
  shots.push({
    filename,
    title,
    filepath,
  });
  console.log(`Captured ${filename}`);
}

async function authenticateInUi(page) {
  const emailInput = page.locator('input[name="email"]').first();
  const passwordInput = page.locator('input[name="password"]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 30000 });
  await emailInput.fill(credentials.email);
  await passwordInput.fill(credentials.password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 30000 }),
    page.getByRole('button', { name: /安全登录|secure login/i }).click(),
  ]);
}

async function findFirstHref(page, pattern) {
  const href = await page.locator('main a[href]').evaluateAll((links, source) => {
    const matcher = new RegExp(source);
    for (const link of links) {
      const hrefValue = link.getAttribute('href');
      if (hrefValue && matcher.test(hrefValue)) {
        return hrefValue;
      }
    }
    return null;
  }, pattern.source);

  if (!href) {
    throw new Error(`No link found for pattern ${pattern}`);
  }

  return href;
}

async function resolveFirstAgentId(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/agents', { credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    const agents = payload?.agents || payload?.data?.agents || [];
    const first = Array.isArray(agents) ? agents[0] : null;
    return first?.agentId || first?.id || null;
  });
}

async function resolveFirstDeviceId(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/devices', { credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    const devices = payload?.devices || payload?.data?.devices || payload?.data || [];
    const first = Array.isArray(devices) ? devices[0] : null;
    return first?.deviceId || first?.id || null;
  });
}

async function resolveFirstSiteId(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/sites', { credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    const sites = payload?.sites || payload?.data?.sites || payload?.data || [];
    const first = Array.isArray(sites) ? sites[0] : null;
    return first?.id || first?.siteId || null;
  });
}

async function gotoRoute(page, route, selector = 'main') {
  await page.goto(new URL(route, baseUrl).toString(), {
    waitUntil: 'domcontentloaded',
  });
  await waitForConsole(page, selector);
}

async function getHeadingText(page) {
  const heading = page.locator('main h1, main h2').first();
  try {
    return ((await heading.textContent()) || '').trim();
  } catch {
    return '';
  }
}

async function waitForHeading(page, previousHeading = '') {
  const heading = page.locator('main h1, main h2').first();
  await heading.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(
    (previous) => {
      const text = document.querySelector('main h1, main h2')?.textContent?.trim() || '';
      return Boolean(text) && (!previous || text !== previous);
    },
    previousHeading,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1200);
  return getHeadingText(page);
}

async function navigateByLink(page, href, anchorSelector = `a[href="${href}"]`) {
  const previousHeading = await getHeadingText(page);
  const link = page.locator(anchorSelector).first();
  await link.waitFor({ state: 'visible', timeout: 30000 });
  await Promise.all([
    page.waitForURL((url) => url.pathname === href, { timeout: 30000 }),
    link.click(),
  ]);
  return waitForHeading(page, previousHeading);
}

async function main() {
  await ensureDir(outputDir);

  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
    locale: 'zh-CN',
  });
  await context.route('**/api/**', async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['if-none-match'];
    delete headers['if-modified-since'];
    headers['cache-control'] = 'no-cache, no-store, max-age=0';
    headers.pragma = 'no-cache';
    await route.continue({ headers });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript(() => {
    window.localStorage.setItem('aetherguard-theme-v2', 'light');
    window.localStorage.setItem('aetherguard-live-mode', 'false');
    window.localStorage.setItem('i18nextLng', 'zh');
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      headers.set('cache-control', 'no-cache, no-store, max-age=0');
      headers.set('pragma', 'no-cache');
      return originalFetch(input, {
        ...init,
        cache: 'no-store',
        headers,
      });
    };
  });

  try {
    await gotoRoute(page, '/login', 'form');
    await capture(page, '01-login.png', '登录页');

    await authenticateInUi(page);
    await waitForHeading(page);
    await capture(page, '02-dashboard.png', 'Dashboard 总览');

    await navigateByLink(page, '/agents');
    await capture(page, '03-agents.png', '智能体列表');

    const firstAgentId = (await resolveFirstAgentId(page)) || 'agt-edge-sh-01';
    await navigateByLink(page, `/agents/${firstAgentId}`, `main a[href="/agents/${firstAgentId}"]`);
    await capture(page, '04-agent-detail.png', '智能体详情');

    await navigateByLink(page, '/agent-monitor');
    await capture(page, '05-agent-monitor.png', '智能体监控');

    await navigateByLink(page, '/traffic');
    await capture(page, '06-traffic-interceptor.png', '流量拦截');

    await navigateByLink(page, '/attack-sim');
    await capture(page, '07-attack-simulator.png', '攻击模拟');

    await navigateByLink(page, '/devices');
    await capture(page, '08-devices.png', '设备管理');

    const firstDeviceId = (await resolveFirstDeviceId(page)) || 'esp32-core-01';
    await navigateByLink(page, `/devices/board-status/${firstDeviceId}`, `main a[href="/devices/board-status/${firstDeviceId}"]`);
    await capture(page, '09-board-status.png', '板卡状态');
    await page.waitForTimeout(65000);

    await navigateByLink(page, '/sites');
    await capture(page, '10-sites.png', '站点列表');

    const firstSiteId = (await resolveFirstSiteId(page)) || '1';
    await navigateByLink(page, `/sites/${firstSiteId}`, `main a[href="/sites/${firstSiteId}"]`);
    await capture(page, '11-site-detail.png', '站点详情');

    await navigateByLink(page, '/deploy');
    await capture(page, '12-deployment-wizard.png', '部署向导');

    await navigateByLink(page, '/scanner');
    await capture(page, '13-scanner.png', '扫描中心');

    await navigateByLink(page, '/alerts');
    await capture(page, '14-alerts.png', '告警中心');

    await navigateByLink(page, '/history');
    await capture(page, '15-history.png', '修复历史');

    await navigateByLink(page, '/settings');
    await capture(page, '16-settings.png', '系统设置');

    await fs.writeFile(
      path.join(outputDir, 'manifest.json'),
      JSON.stringify(
        {
          softwareName: 'AetherGuard 智能服务器安全防御平台 V1.0',
          baseUrl,
          capturedAt: new Date().toISOString(),
          screenshots: shots,
        },
        null,
        2,
      ),
      'utf8',
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
