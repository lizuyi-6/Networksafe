import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { components, screenCatalog } from './component-softcopyright-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const workRoot = path.join(repoRoot, 'output', 'softcopyright-components');
const packageRoot = path.join(repoRoot, 'output', 'softcopyright-submit', '组件软著材料_20260713_待名称权属确认');
const baseUrl = process.env.SOFTCOPYRIGHT_BASE_URL || 'http://127.0.0.1:8080';
const runtimeNodeModules = path.resolve(
  process.env.CODEX_RUNTIME_NODE_MODULES
    || 'C:/Users/Abraham/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules',
);
const playwrightEntry = pathToFileURL(
  path.join(repoRoot, 'frontend', 'node_modules', 'playwright', 'index.mjs'),
).href;
const docxEntry = pathToFileURL(path.join(runtimeNodeModules, 'docx', 'dist', 'index.mjs')).href;
const pdfLibCjsEntry = path.join(runtimeNodeModules, 'pdf-lib', 'dist', 'pdf-lib.js');
const require = createRequire(import.meta.url);
const documentDate = '2026年7月13日';
const sourceLineCount = 1500;
const sourcePageSize = 50;
const maxSourceLineLength = 160;
const captureViewport = Object.freeze({
  width: Number.parseInt(process.env.SOFTCOPYRIGHT_VIEWPORT_WIDTH || '1920', 10),
  height: Number.parseInt(process.env.SOFTCOPYRIGHT_VIEWPORT_HEIGHT || '1440', 10),
  deviceScaleFactor: 1,
});
const screenshotMethod = 'Playwright page.screenshot({ type: png, fullPage: true }) direct output';
const manualCopy = Object.freeze({
  overviewTitle: '软件概述与功能范围',
  overviewLead: '本组件的功能范围、运行入口和页面组成如下。',
  workflowTitle: '日常操作流程',
  screenshotNote: '手册插图直接使用浏览器原始 PNG，未裁剪、未打码、未缩放或拼接。',
});
const forbiddenMaterialLanguage = Object.freeze([
  ['生成过程自述', /本轮|本工具|未使用\s*(?:AI|人工智能)|(?:AI|人工智能).{0,8}(?:辅助|生成|编制|参与)|(?:辅助|生成|编制).{0,8}(?:AI|人工智能)|机械验收|二次验收|正式提交阻断项|documentDesignPreset|documentHeaderPattern|workingTreeDirty/iu],
  ['模板化说教', /本手册旨在|本章说明|本章将|本节将|日常操作流程与管理注意事项|可以看到|值得注意的是|综上所述|通过上述|用户应|应先|不等于|不构成|不能.{0,24}证明|不仅.{0,32}(?:也|还|而且)/u],
  ['空泛宣传', /赋能|助力|行业领先|卓越体验|强大易用|智能化升级|全面提升|显著提升|核心价值|最佳实践|颠覆性|革命性/u],
]);
const excludedMainProgramSources = new Set([
  'frontend/src/App.tsx',
  'frontend/src/pages/Dashboard.tsx',
  'frontend/src/pages/Devices.tsx',
  'backend/src/index.ts',
  'backend/src/websocket/agent-gateway.ts',
  'backend/src/api/routes/devices.routes.ts',
]);
const forbiddenSourcePathPattern = /(^|\/)(?:__tests__|tests?|test-data|fixtures?|examples?|generated|dist|build|coverage)(?:\/|$)/i;

if (!Number.isInteger(captureViewport.width) || !Number.isInteger(captureViewport.height)
  || captureViewport.width < 1600 || captureViewport.height < 900) {
  throw new Error(`Invalid screenshot viewport ${captureViewport.width}x${captureViewport.height}`);
}

function parseArgs(argv) {
  const options = {
    capture: false,
    generate: false,
    validateSources: false,
    component: 'all',
  };

  for (const arg of argv) {
    if (arg === '--capture') options.capture = true;
    else if (arg === '--generate') options.generate = true;
    else if (arg === '--validate-sources') options.validateSources = true;
    else if (arg === '--all') {
      options.capture = true;
      options.generate = true;
    } else if (arg.startsWith('--component=')) {
      options.component = arg.slice('--component='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.capture && !options.generate && !options.validateSources) {
    options.capture = true;
    options.generate = true;
  }

  const selected = options.component === 'all'
    ? components
    : components.filter((component) => component.id === options.component);
  if (selected.length === 0) {
    throw new Error(`Unknown component: ${options.component}`);
  }
  return { ...options, selected };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function assertPlainMaterialLanguage(value, context) {
  for (const [label, pattern] of forbiddenMaterialLanguage) {
    const match = String(value).match(pattern);
    if (match) {
      throw new Error(`${context} contains ${label}: ${match[0]}`);
    }
  }
}

function safeStem(value) {
  return value.replaceAll(/[\\/:*?"<>|]/g, '').replaceAll(/\s+/g, '');
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

async function sha256File(filepath) {
  return sha256Buffer(await fs.readFile(filepath));
}

function pngDimensions(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('Screenshot is not a PNG');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function readEnvFile() {
  const values = {};
  try {
    const text = await fs.readFile(path.join(repoRoot, '.env'), 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      values[key] = value;
    }
  } catch {
    // Explicit environment variables and development fallbacks remain available.
  }
  return values;
}

async function launchBrowser(chromium) {
  try {
    return await chromium.launch({
      channel: process.env.PW_CHANNEL || 'msedge',
      headless: true,
    });
  } catch (error) {
    console.warn(`Falling back to bundled Chromium: ${error.message}`);
    return chromium.launch({ headless: true });
  }
}

async function waitForPage(page, selector = 'main') {
  await page.waitForLoadState('domcontentloaded');
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(500);
}

async function waitForRouteContent(page) {
  const stateHandle = await page.waitForFunction(() => {
    const main = document.querySelector('main');
    if (!main) return false;
    const sessionBanner = document.querySelector('[data-testid="session-unverified-banner"]');
    if (sessionBanner) return 'session_unverified';
    const text = (main.textContent || '').replace(/\s+/g, ' ').trim();
    const visibleSpinners = Array.from(main.querySelectorAll('.animate-spin')).filter((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
    const hasFailureMarker = /数据加载失败|加载失败|请求失败|会话未验证|后端暂不可达|身份来自本地缓存|RATE_LIMIT_EXCEEDED|failed to load|temporarily unavailable|status could not be verified|too many requests/i.test(text);
    return text.length >= 180 && visibleSpinners.length === 0 && !hasFailureMarker ? 'ready' : false;
  }, undefined, { timeout: 45000 });
  const state = await stateHandle.jsonValue();
  await page.waitForTimeout(700);
  return state;
}

async function readAuthenticatedProfile(page) {
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    const payload = await response.json().catch(() => null);
    const user = payload?.data?.user || payload?.user || null;
    return {
      ok: response.ok && Boolean(user),
      status: response.status,
      user,
    };
  });
  if (!result.ok || !result.user) {
    throw new Error(`Authenticated profile unavailable: /api/auth/me returned ${result.status}`);
  }
  const displayName = String(result.user.username || result.user.email || '').trim();
  const plan = String(result.user.plan || 'starter').trim().toLowerCase();
  const planBadge = plan === 'ultra' ? 'ULTRA' : plan === 'pro' ? 'PRO' : 'STARTER';
  if (!displayName) throw new Error('Authenticated profile has no display name');
  return { displayName, planBadge };
}

async function waitForAuthenticatedProfile(page, expectedProfile) {
  await page.waitForFunction(({ displayName, planBadge }) => {
    const text = document.querySelector('aside')?.textContent || '';
    return text.includes(displayName)
      && text.includes(planBadge)
      && !text.includes('未命名用户');
  }, expectedProfile, { timeout: 30000 });
}

async function gotoRoute(page, route, selector = 'main') {
  const expected = new URL(route, baseUrl);
  const current = new URL(page.url());
  if (current.origin === expected.origin && current.pathname !== '/login') {
    if (current.pathname !== expected.pathname || current.search !== expected.search) {
      await page.evaluate(({ pathname, search, hash }) => {
        window.history.pushState({}, '', `${pathname}${search}${hash}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, { pathname: expected.pathname, search: expected.search, hash: expected.hash });
      await page.waitForURL((url) => url.pathname === expected.pathname && url.search === expected.search, {
        timeout: 30000,
      });
    }
  } else {
    await page.goto(expected.toString(), { waitUntil: 'domcontentloaded' });
  }
  await waitForPage(page, selector);
  if (selector === 'main') {
    let routeState = await waitForRouteContent(page);
    if (routeState === 'session_unverified') {
      await readAuthenticatedProfile(page);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForPage(page);
      routeState = await waitForRouteContent(page);
    }
    if (routeState !== 'ready') {
      throw new Error(`Route ${expected.pathname} session remained unverified after refresh`);
    }
  }
  const actual = new URL(page.url());
  if (actual.pathname !== expected.pathname) {
    throw new Error(`Route ${expected.pathname} redirected to ${actual.pathname}`);
  }
}

async function authenticate(page, credentials) {
  await gotoRoute(page, '/login', 'form');
  const emailInput = page.locator('input[name="email"]').first();
  const passwordInput = page.locator('input[name="password"]').first();
  await emailInput.fill(credentials.email);
  await passwordInput.fill(credentials.password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 30000 }),
    page.getByRole('button', { name: /安全登录|secure login/i }).click(),
  ]);
  await waitForPage(page);
  const demoUserKey = await page.evaluate((email) => {
    let identity = {};
    try {
      identity = JSON.parse(window.sessionStorage.getItem('aetherguard:session-user') || '{}');
    } catch {
      identity = {};
    }
    const key = String(identity.email || identity.userId || identity.username || email).trim().toLowerCase();
    window.localStorage.setItem('demo_mode', 'true');
    window.localStorage.setItem(`demo-mode:${key}`, 'true');
    window.localStorage.setItem('aetherguard-theme-v2', 'light');
    window.localStorage.setItem('aetherguard-live-mode', 'false');
    window.localStorage.setItem('i18nextLng', 'zh');
    return key;
  }, credentials.email);
  if (!demoUserKey) throw new Error('Authenticated session has no stable demo-mode user key');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPage(page);
  let expectedProfile = await readAuthenticatedProfile(page);
  await waitForAuthenticatedProfile(page, expectedProfile);
  if (await page.getByTestId('session-unverified-banner').isVisible().catch(() => false)) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPage(page);
    expectedProfile = await readAuthenticatedProfile(page);
    await waitForAuthenticatedProfile(page, expectedProfile);
  }
  if (await page.getByTestId('session-unverified-banner').isVisible().catch(() => false)) {
    throw new Error('Authenticated session remains unverified after refresh');
  }
  return expectedProfile;
}

async function listHrefs(page, route, pattern) {
  await gotoRoute(page, route);
  let hrefs = [];
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    hrefs = await page.locator('main a[href]').evaluateAll(
      (links, source) => links
        .map((link) => link.getAttribute('href'))
        .filter((href) => href && new RegExp(source).test(href)),
      pattern.source,
    );
    if (hrefs.length > 0) break;
    if (attempt === 3) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForPage(page);
    } else {
      await page.waitForTimeout(attempt * 600);
    }
  }
  if (hrefs.length === 0) {
    const heading = await page.locator('main h1, main h2').first().textContent().catch(() => '');
    const allHrefs = await page.locator('main a[href]').evaluateAll((links) => links
      .map((link) => link.getAttribute('href'))
      .filter(Boolean)
      .slice(0, 20));
    const visibleText = await page.locator('main').innerText().catch(() => '');
    console.warn(JSON.stringify({
      route,
      heading: (heading || '').trim(),
      hrefs: allHrefs,
      visibleText: visibleText.slice(0, 500),
    }));
  }
  return [...new Set(hrefs)];
}

async function resolveRoutes(page, neededKeys) {
  // These navigations share one page, so they must remain sequential.
  const agents = neededKeys.has('agentDetail') ? await listHrefs(page, '/agents', /^\/agents\/[^/]+$/) : [];
  const traffic = neededKeys.has('trafficDetail') ? await listHrefs(page, '/traffic', /^\/traffic\/sessions\/[^/]+$/) : [];
  const sites = neededKeys.has('siteDetail') ? await listHrefs(page, '/sites', /^\/sites\/[^/]+$/) : [];
  const scans = neededKeys.has('scannerDetail') ? await listHrefs(page, '/scanner', /^\/scanner\/runs\/[^/]+$/) : [];
  const alerts = neededKeys.has('alertDetail') ? await listHrefs(page, '/alerts', /^\/alerts\/[^/]+$/) : [];
  const history = neededKeys.has('historyDetail') ? await listHrefs(page, '/history', /^\/history\/[^/]+$/) : [];
  const needsBoards = ['boardPrimary', 'boardSecondary', 'boardOffline'].some((key) => neededKeys.has(key));
  const boards = needsBoards ? await listHrefs(page, '/devices', /^\/devices\/board-status\/[^/]+$/) : [];

  const required = {
    ...(neededKeys.has('agentDetail') ? { agents } : {}),
    ...(neededKeys.has('trafficDetail') ? { traffic } : {}),
    ...(neededKeys.has('siteDetail') ? { sites } : {}),
    ...(neededKeys.has('scannerDetail') ? { scans } : {}),
    ...(neededKeys.has('alertDetail') ? { alerts } : {}),
    ...(neededKeys.has('historyDetail') ? { history } : {}),
    ...(needsBoards ? { boards } : {}),
  };
  for (const [name, values] of Object.entries(required)) {
    if (values.length === 0) throw new Error(`No dynamic route found for ${name}`);
  }
  if (needsBoards && boards.length < 3) throw new Error(`Expected at least 3 board routes, found ${boards.length}`);

  return {
    login: '/login',
    dashboard: '/dashboard',
    agents: '/agents',
    agentDetail: agents[0],
    agentMonitor: '/agent-monitor',
    cognition: '/cognition',
    traffic: '/traffic',
    trafficDetail: traffic[0],
    sites: '/sites',
    siteDetail: sites[0],
    deploy: '/deploy',
    scanner: '/scanner',
    scannerDetail: scans[0],
    alerts: '/alerts',
    alertDetail: alerts[0],
    history: '/history',
    historyDetail: history[0],
    settings: '/settings',
    rules: '/rules',
    devices: '/devices',
    boardPrimary: boards[0],
    boardSecondary: boards[1],
    boardOffline: boards[2],
    hardwareGates: '/hardware-gates',
    deploymentRuns: '/deployment-runs',
    deploymentEvidence: '/deployment-evidence',
  };
}

async function prepareCaptureState(page, captureState) {
  if (!captureState) return;
  if ([
    'devices-secondary-selected',
    'devices-offline-selected',
    'device-settings',
    'deploy-target-selected',
    'deploy-config',
    'deploy-preview',
  ].includes(captureState)) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPage(page);
    await waitForRouteContent(page);
  }
  if (captureState === 'devices-secondary-selected' || captureState === 'devices-offline-selected') {
    const cards = page.locator('main div.cursor-pointer').filter({
      has: page.locator('a[href^="/devices/board-status/"]'),
    });
    const targetIndex = captureState === 'devices-secondary-selected' ? 1 : 2;
    if (await cards.count() <= targetIndex) {
      throw new Error(`Expected at least ${targetIndex + 1} device cards`);
    }
    await cards.nth(targetIndex).click();
    await page.waitForFunction((index) => {
      const candidates = Array.from(document.querySelectorAll('main div.cursor-pointer'))
        .filter((element) => element.querySelector('a[href^="/devices/board-status/"]'));
      return Boolean(candidates[index]?.classList.contains('ring-2'));
    }, targetIndex);
  } else if (captureState === 'device-settings') {
    await page.getByRole('button', { name: /编辑配置|edit config/i }).first().click();
    const modal = page.locator('main .fixed.inset-0.z-40').first();
    await modal.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const panel = document.querySelector('main .fixed.inset-0.z-40');
      const firstInput = panel?.querySelector('input');
      return Boolean(firstInput && firstInput.value.trim().length > 0);
    });
  } else if (captureState === 'hardware-gate-enrollment') {
    const form = page.locator('form').filter({ hasText: 'Gate ID' }).first();
    await form.locator('label').filter({ hasText: 'Gate ID' }).locator('input').fill('gateway-appliance-04');
    await form.locator('label').filter({ hasText: 'Display Name' }).locator('input').fill('Recovery Gateway');
    await form.locator('label').filter({ hasText: 'Public Key PEM' }).locator('textarea').fill(
      '-----BEGIN PUBLIC KEY-----\n[device provisioning output]\n-----END PUBLIC KEY-----',
    );
  } else if (captureState === 'deployment-run-install' || captureState === 'deployment-run-remove') {
    const form = page.locator('form').filter({ hasText: 'Profile JSON' }).first();
    const requestType = captureState === 'deployment-run-install' ? 'install' : 'remove';
    await form.locator('label').filter({ hasText: 'Action' }).locator('select').selectOption(requestType);
    await form.locator('label').filter({ hasText: 'Target' }).locator('select').selectOption('binary_agent');
    const profile = captureState === 'deployment-run-install'
      ? {
          serviceName: 'aetherguard-agent',
          installDir: '/opt/aetherguard',
          restartPolicy: 'on-failure',
        }
      : {
          serviceName: 'aetherguard-agent',
          preserveData: true,
        };
    await form.locator('label').filter({ hasText: 'Profile JSON' }).locator('textarea').fill(JSON.stringify(profile, null, 2));
  } else if (captureState === 'deploy-target-selected') {
    await page.getByTestId('deploy-target-binary_agent').click();
    await page.getByTestId('deploy-next').waitFor({ state: 'visible' });
  } else if (captureState === 'deploy-config' || captureState === 'deploy-preview') {
    await page.getByTestId('deploy-target-binary_agent').click();
    await page.getByTestId('deploy-next').click();
    await page.getByTestId('deploy-port').waitFor({ state: 'visible' });
    await page.getByTestId('deploy-port').fill('8443');
    await page.getByTestId('deploy-server-name').fill('gateway-mgmt.local');
    await page.getByTestId('deploy-rate-limit').fill('60');
    await page.getByTestId('deploy-upstream').fill('http://backend:3005');
    if (captureState === 'deploy-preview') {
      await page.getByTestId('deploy-next').click();
      await page.getByTestId('deploy-save-version').waitFor({ state: 'visible', timeout: 30000 });
    }
  } else {
    throw new Error(`Unknown screenshot capture state: ${captureState}`);
  }
  await page.waitForTimeout(250);
}

async function captureScreenshot(page, outputPath, route, title, screenKey) {
  if (screenKey === 'alerts') {
    await page.getByTestId('alerts-active-count').waitFor({ state: 'visible', timeout: 30000 });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(350);
  const readiness = await page.evaluate(({ currentRoute, currentScreenKey }) => {
    const isLogin = currentRoute === '/login';
    const root = isLogin ? document.body : document.querySelector('main');
    if (!root) return { ok: false, reason: 'capture_root_missing' };
    const text = (root.textContent || '').replace(/\s+/g, ' ').trim();
    const visibleSpinnerCount = Array.from(root.querySelectorAll('.animate-spin')).filter((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }).length;
    const hasFailureMarker = /数据加载失败|加载失败|请求失败|会话未验证|后端暂不可达|身份来自本地缓存|RATE_LIMIT_EXCEEDED|failed to load|temporarily unavailable|status could not be verified|too many requests/i.test(text);
    const emailValue = isLogin ? String(document.querySelector('input[name="email"]')?.value || '') : '';
    const passwordValue = isLogin ? String(document.querySelector('input[name="password"]')?.value || '') : '';
    const minimumTextLength = isLogin ? 120 : 180;
    const selectedDeviceCard = root.querySelector('div.cursor-pointer.ring-2');
    const captureStateReady = currentScreenKey === 'devicesSecondary'
      ? Boolean(selectedDeviceCard?.querySelector('a[href*="gateway-appliance-02"]'))
      : currentScreenKey === 'devicesOfflineSelection'
        ? Boolean(selectedDeviceCard?.querySelector('a[href*="gateway-appliance-03"]'))
        : currentScreenKey === 'deviceSettings'
          ? Boolean(root.querySelector('.fixed.inset-0.z-40'))
            && Array.from(root.querySelectorAll('.fixed.inset-0.z-40 input')).some((element) => element.value.trim().length > 0)
        : currentScreenKey === 'hardwareGateEnrollment'
          ? String(root.querySelector('input[required]')?.value || '').length > 0
        && String(root.querySelector('textarea[required]')?.value || '').length > 0
      : currentScreenKey === 'deploymentRunsInstall'
        ? Array.from(root.querySelectorAll('select')).some((element) => element.value === 'install')
          && Array.from(root.querySelectorAll('select')).some((element) => element.value === 'binary_agent')
          && Array.from(root.querySelectorAll('textarea')).some((element) => element.value.includes('installDir'))
        : currentScreenKey === 'deploymentRunsRemove'
          ? Array.from(root.querySelectorAll('select')).some((element) => element.value === 'remove')
        : currentScreenKey === 'deployTarget'
          ? Boolean(root.querySelector('[data-testid="deploy-target-binary_agent"].border-primary'))
          : currentScreenKey === 'deployConfig'
            ? Boolean(root.querySelector('[data-testid="deploy-port"]'))
              && String(root.querySelector('[data-testid="deploy-port"]')?.value || '') === '8443'
            : currentScreenKey === 'deployPreview'
              ? Boolean(root.querySelector('[data-testid="deploy-save-version"]'))
        : true;
    const listedActiveAlertCount = currentScreenKey === 'alerts'
      ? Array.from(root.querySelectorAll('[data-alert-status]')).filter((element) => {
        const status = element.getAttribute('data-alert-status');
        return status !== 'resolved' && status !== 'suppressed';
      }).length
      : 0;
    const renderedActiveAlertCount = currentScreenKey === 'alerts'
      ? Number.parseInt(root.querySelector('[data-testid="alerts-active-count"]')?.textContent || '', 10)
      : 0;
    const alertsSummaryConsistent = currentScreenKey !== 'alerts'
      || (Number.isInteger(renderedActiveAlertCount) && renderedActiveAlertCount >= listedActiveAlertCount);
    return {
      ok: text.length >= minimumTextLength
        && visibleSpinnerCount === 0
        && !hasFailureMarker
        && emailValue.length === 0
        && passwordValue.length === 0
        && captureStateReady
        && alertsSummaryConsistent,
      textLength: text.length,
      visibleSpinnerCount,
      hasFailureMarker,
      loginInputsEmpty: !isLogin || (emailValue.length === 0 && passwordValue.length === 0),
      listedActiveAlertCount,
      renderedActiveAlertCount,
      alertsSummaryConsistent,
      captureStateReady,
    };
  }, { currentRoute: route, currentScreenKey: screenKey });
  if (!readiness.ok) {
    throw new Error(`Page is not ready for screenshot ${route}: ${JSON.stringify(readiness)}`);
  }
  const buffer = await page.screenshot({
    path: outputPath,
    type: 'png',
    fullPage: true,
  });
  const dimensions = pngDimensions(buffer);
  if (dimensions.width !== captureViewport.width || dimensions.height < captureViewport.height) {
    throw new Error(`Unexpected screenshot dimensions ${dimensions.width}x${dimensions.height} for ${outputPath}`);
  }
  return {
    title,
    route,
    width: dimensions.width,
    height: dimensions.height,
    bytes: buffer.length,
    sha256: sha256Buffer(buffer),
    readiness,
  };
}

async function captureComponent(component, chromium, credentials) {
  const screenshotDir = path.join(workRoot, component.id, 'screenshots');
  await fs.rm(screenshotDir, { recursive: true, force: true });
  await fs.mkdir(screenshotDir, { recursive: true });
  const browser = await launchBrowser(chromium);
  const context = await browser.newContext({
    viewport: { width: captureViewport.width, height: captureViewport.height },
    deviceScaleFactor: captureViewport.deviceScaleFactor,
    ignoreHTTPSErrors: true,
    locale: 'zh-CN',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript((email) => {
    const key = String(email).trim().toLowerCase();
    window.localStorage.setItem('demo_mode', 'true');
    window.localStorage.setItem(`demo-mode:${key}`, 'true');
    window.localStorage.setItem('aetherguard-theme-v2', 'light');
    window.localStorage.setItem('aetherguard-live-mode', 'false');
    window.localStorage.setItem('i18nextLng', 'zh');
  }, credentials.email);

  try {
    const firstKey = component.screens[0][0];
    if (firstKey !== 'login') throw new Error(`${component.id} first screenshot must be login`);
    await gotoRoute(page, '/login', 'form');
    const entries = [];
    const firstFilename = `01-${firstKey}.png`;
    entries.push({
      filename: firstFilename,
      ...(await captureScreenshot(
        page,
        path.join(screenshotDir, firstFilename),
        '/login',
        screenCatalog[firstKey].title,
        firstKey,
      )),
    });

    const expectedProfile = await authenticate(page, credentials);
    const neededKeys = new Set(component.screens.map(([key]) => screenCatalog[key].routeKey));
    const routeMap = await resolveRoutes(page, neededKeys);
    for (let index = 1; index < component.screens.length; index += 1) {
      const [key] = component.screens[index];
      const screen = screenCatalog[key];
      const route = routeMap[screen.routeKey];
      if (!route) throw new Error(`No route resolved for ${component.id}/${key}`);
      await gotoRoute(page, route);
      await waitForAuthenticatedProfile(page, expectedProfile);
      await prepareCaptureState(page, screen.captureState);
      const filename = `${String(index + 1).padStart(2, '0')}-${key}.png`;
      entries.push({
        filename,
        ...(await captureScreenshot(
          page,
          path.join(screenshotDir, filename),
          route,
          screen.title,
          key,
        )),
      });
      console.log(`Captured ${component.id}/${filename}`);
    }

    const manifest = {
      softwareName: component.softwareName,
      componentId: component.id,
      baseUrl,
      capturedAt: new Date().toISOString(),
      viewport: captureViewport,
      method: screenshotMethod,
      postProcessing: 'none',
      captureAssertions: {
        authenticatedProfileMatched: true,
        dynamicRoutesResolvedWithoutGuessedIds: true,
        pageContentReadyWithoutVisibleSpinners: true,
      },
      screenshotCount: entries.length,
      screenshots: entries,
    };
    await fs.writeFile(
      path.join(screenshotDir, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

function routeMatchesScreen(route, routeKey) {
  const exactRoutes = {
    login: '/login',
    dashboard: '/dashboard',
    agents: '/agents',
    agentMonitor: '/agent-monitor',
    cognition: '/cognition',
    traffic: '/traffic',
    sites: '/sites',
    deploy: '/deploy',
    scanner: '/scanner',
    alerts: '/alerts',
    history: '/history',
    settings: '/settings',
    rules: '/rules',
    devices: '/devices',
    hardwareGates: '/hardware-gates',
    deploymentRuns: '/deployment-runs',
    deploymentEvidence: '/deployment-evidence',
  };
  const dynamicRoutes = {
    agentDetail: /^\/agents\/[^/]+$/,
    trafficDetail: /^\/traffic\/sessions\/[^/]+$/,
    siteDetail: /^\/sites\/[^/]+$/,
    scannerDetail: /^\/scanner\/runs\/[^/]+$/,
    alertDetail: /^\/alerts\/[^/]+$/,
    historyDetail: /^\/history\/[^/]+$/,
    boardPrimary: /^\/devices\/board-status\/[^/]+$/,
    boardSecondary: /^\/devices\/board-status\/[^/]+$/,
    boardOffline: /^\/devices\/board-status\/[^/]+$/,
  };
  if (Object.hasOwn(exactRoutes, routeKey)) return route === exactRoutes[routeKey];
  return dynamicRoutes[routeKey]?.test(route) || false;
}

async function validateScreenshotManifest(component, manifest, screenshotDir) {
  if (manifest.componentId !== component.id || manifest.softwareName !== component.softwareName) {
    throw new Error(`${component.id} screenshot manifest identity mismatch`);
  }
  if (manifest.method !== screenshotMethod || manifest.postProcessing !== 'none') {
    throw new Error(`${component.id} screenshot capture method is not direct full-page PNG output`);
  }
  if (manifest.captureAssertions?.authenticatedProfileMatched !== true
    || manifest.captureAssertions?.dynamicRoutesResolvedWithoutGuessedIds !== true
    || manifest.captureAssertions?.pageContentReadyWithoutVisibleSpinners !== true) {
    throw new Error(`${component.id} screenshot readiness assertions are missing`);
  }
  if (!manifest.viewport
    || manifest.viewport.width !== captureViewport.width
    || manifest.viewport.height !== captureViewport.height
    || manifest.viewport.deviceScaleFactor !== captureViewport.deviceScaleFactor) {
    throw new Error(`${component.id} screenshot viewport mismatch`);
  }
  if (!Array.isArray(manifest.screenshots)
    || manifest.screenshotCount !== component.screens.length
    || manifest.screenshots.length !== component.screens.length) {
    throw new Error(`${component.id} screenshot count mismatch`);
  }
  if (!Number.isFinite(Date.parse(manifest.capturedAt))) {
    throw new Error(`${component.id} screenshot capturedAt is invalid`);
  }

  const filenames = new Set();
  for (let index = 0; index < component.screens.length; index += 1) {
    const [key] = component.screens[index];
    const screen = screenCatalog[key];
    const item = manifest.screenshots[index];
    const expectedFilename = `${String(index + 1).padStart(2, '0')}-${key}.png`;
    if (item.filename !== expectedFilename || path.basename(item.filename) !== item.filename) {
      throw new Error(`${component.id} screenshot filename/order mismatch at ${index + 1}`);
    }
    if (filenames.has(item.filename)) throw new Error(`${component.id} duplicate screenshot ${item.filename}`);
    filenames.add(item.filename);
    if (item.title !== screen.title || !routeMatchesScreen(item.route, screen.routeKey)) {
      throw new Error(`${component.id} screenshot title/route mismatch for ${item.filename}`);
    }
    const screenshotPath = path.join(screenshotDir, item.filename);
    const stat = await fs.lstat(screenshotPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`${component.id} screenshot is not a regular file: ${item.filename}`);
    }
    const buffer = await fs.readFile(screenshotPath);
    const dimensions = pngDimensions(buffer);
    const actualHash = sha256Buffer(buffer);
    if (dimensions.width !== captureViewport.width || dimensions.height < captureViewport.height
      || item.width !== dimensions.width || item.height !== dimensions.height
      || item.bytes !== buffer.length || stat.size !== buffer.length || item.sha256 !== actualHash) {
      throw new Error(`${component.id} screenshot evidence mismatch: ${item.filename}`);
    }
    if (item.readiness?.ok !== true
      || item.readiness.visibleSpinnerCount !== 0
      || item.readiness.hasFailureMarker !== false
      || item.readiness.loginInputsEmpty !== true) {
      throw new Error(`${component.id} screenshot readiness evidence mismatch: ${item.filename}`);
    }
  }
}

function validateSourceSelections(selections) {
  for (const selection of selections) {
    const normalized = selection.file.replaceAll('\\', '/');
    if (path.isAbsolute(selection.file) || normalized.startsWith('../') || normalized.includes('/../')) {
      throw new Error(`Source selection escapes repository: ${selection.file}`);
    }
    if (forbiddenSourcePathPattern.test(normalized)) {
      throw new Error(`Source selection includes forbidden non-production path: ${selection.file}`);
    }
    if (excludedMainProgramSources.has(normalized)) {
      throw new Error(`Source selection reuses a main-program filing source: ${selection.file}`);
    }
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', '--', normalized], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch {
      throw new Error(`Source selection is not tracked by git: ${selection.file}`);
    }
  }
}

async function loadSourceRecords(selections) {
  validateSourceSelections(selections);
  const files = new Map();
  const seen = new Set();
  const pools = [];
  let skippedOverlong = 0;
  for (const selection of selections) {
    const absolute = path.resolve(repoRoot, selection.file);
    const relative = path.relative(repoRoot, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Source selection escapes repository: ${selection.file}`);
    }
    const raw = await fs.readFile(absolute, 'utf8');
    const lines = raw.split(/\r?\n/);
    const start = selection.start || 1;
    const end = Math.min(selection.end || lines.length, lines.length);
    if (start < 1 || start > end) throw new Error(`Invalid range for ${selection.file}: ${start}-${end}`);
    const fileHash = sha256Buffer(Buffer.from(raw, 'utf8'));
    files.set(selection.file, { file: selection.file, sha256: fileHash, physicalLines: lines.length });
    const candidates = [];
    for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
      const text = lines[lineNumber - 1] ?? '';
      if (text.trim().length === 0) continue;
      const visualLength = text.replaceAll('\t', '    ').length;
      if (visualLength > maxSourceLineLength) {
        skippedOverlong += 1;
        continue;
      }
      const identity = `${selection.file}:${lineNumber}`;
      if (seen.has(identity)) {
        throw new Error(`Overlapping source selection includes ${identity} more than once`);
      }
      seen.add(identity);
      candidates.push({
        file: selection.file,
        shortFile: path.basename(selection.file),
        originalLine: lineNumber,
        text,
      });
    }
    if (candidates.length === 0) {
      throw new Error(`Source selection has no printable production lines: ${selection.file}:${start}-${end}`);
    }
    pools.push({ selection, candidates });
  }

  const available = pools.reduce((total, pool) => total + pool.candidates.length, 0);
  if (available < sourceLineCount) {
    throw new Error(`Source selection produced ${available} printable lines, expected at least ${sourceLineCount}; ${skippedOverlong} lines exceeded ${maxSourceLineLength} characters`);
  }
  const baseQuota = Math.floor(sourceLineCount / pools.length);
  const quotas = pools.map((pool) => Math.min(baseQuota, pool.candidates.length));
  let remaining = sourceLineCount - quotas.reduce((total, value) => total + value, 0);
  while (remaining > 0) {
    let progressed = false;
    for (let index = 0; index < pools.length && remaining > 0; index += 1) {
      if (quotas[index] >= pools[index].candidates.length) continue;
      quotas[index] += 1;
      remaining -= 1;
      progressed = true;
    }
    if (!progressed) throw new Error('Unable to allocate balanced source quotas');
  }
  const records = pools.flatMap((pool, index) => pool.candidates.slice(0, quotas[index]));
  if (records.length !== sourceLineCount || new Set(records.map((record) => `${record.file}:${record.originalLine}`)).size !== sourceLineCount) {
    throw new Error(`Balanced source allocation is not ${sourceLineCount} unique lines`);
  }
  return {
    records,
    files: [...files.values()],
    skippedOverlong,
    allocation: pools.map((pool, index) => ({
      file: pool.selection.file,
      start: pool.selection.start || 1,
      end: pool.selection.end || null,
      available: pool.candidates.length,
      selected: quotas[index],
    })),
  };
}

function chunk(records, size) {
  const pages = [];
  for (let index = 0; index < records.length; index += size) {
    pages.push(records.slice(index, index + size));
  }
  return pages;
}

function summarizeRecords(records) {
  const grouped = new Map();
  for (const record of records) {
    const current = grouped.get(record.file);
    if (!current) {
      grouped.set(record.file, { first: record.originalLine, last: record.originalLine, count: 1 });
    } else {
      current.last = record.originalLine;
      current.count += 1;
    }
  }
  return [...grouped.entries()].map(([file, range]) => ({ file, ...range }));
}

function pageSummary(records) {
  return summarizeRecords(records)
    .map((item) => `${item.file}:${item.first}-${item.last} (${item.count}行)`)
    .join(' | ');
}

function buildSourceText(component, sideLabel, records) {
  const lines = [
    sideLabel,
    `软件名称: ${component.softwareName}`,
    `源码行数: ${records.length}`,
    '',
  ];
  for (const record of records) {
    lines.push(`[${record.shortFile}:${String(record.originalLine).padStart(4, '0')}] ${record.text}`);
  }
  return `${lines.join('\n')}\n`;
}

function buildSourceHtml(component, sideLabel, records) {
  const pages = chunk(records, sourcePageSize);
  if (pages.length !== 30 || pages.some((page) => page.length !== sourcePageSize)) {
    throw new Error(`${component.id}/${sideLabel} is not 30 pages x 50 lines`);
  }
  const body = pages.map((pageRecords, pageIndex) => {
    const rows = pageRecords.map((record) => `
      <div class="code-line">
        <span class="source">${escapeHtml(`${record.shortFile}:${String(record.originalLine).padStart(4, '0')}`)}</span>
        <span class="code">${escapeHtml(record.text)}</span>
      </div>`).join('');
    return `
      <section class="page">
        <header><div><strong>${escapeHtml(component.softwareName)}</strong><small>${escapeHtml(sideLabel)}</small></div><b>第 ${pageIndex + 1} / 30 页</b></header>
        <div class="summary">${escapeHtml(pageSummary(pageRecords))}</div>
        <div class="code-block">${rows}</div>
        <footer>本页 50 行非空源程序，本册共 1500 行。</footer>
      </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(sideLabel)}</title>
<style>
@page{size:A4 landscape;margin:0}*{box-sizing:border-box}body{margin:0;background:#e5e7eb;color:#101828;font-family:Consolas,"Cascadia Mono","Microsoft YaHei UI",monospace}.page{width:297mm;height:210mm;padding:9mm 10mm 7mm;background:#fff;page-break-after:always;display:flex;flex-direction:column;gap:2.4mm}.page:last-child{page-break-after:auto}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:.35mm solid #d0d5dd;padding-bottom:1.8mm;font-size:9pt}header div{display:flex;flex-direction:column;gap:.6mm}header small{font-size:8pt;color:#475467}.summary{font-size:7pt;color:#475467;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.code-block{flex:1;border:.3mm solid #d0d5dd;background:#fcfcfd;padding:1.8mm 2.1mm;display:grid;grid-template-rows:repeat(50,1fr);overflow:hidden}.code-line{display:grid;grid-template-columns:58mm minmax(0,1fr);gap:2.3mm;align-items:center;min-height:0;font-size:5.8pt;line-height:1;white-space:pre;tab-size:4}.source{color:#475467;min-width:0}.code{color:#101828;min-width:0}footer{font-size:7pt;color:#667085;text-align:right}
</style></head><body>${body}</body></html>`;
}

function manualSections(component, screenshotManifest) {
  return component.screens.map(([key, relevance], index) => {
    const screen = screenCatalog[key];
    const screenshot = screenshotManifest.screenshots[index];
    if (!screenshot) throw new Error(`Missing screenshot ${index + 1} for ${component.id}`);
    const substantiveText = [screen.subtitle, screen.overview, screen.operations, relevance, ...screen.steps]
      .join('')
      .replaceAll(/\s+/g, '');
    if (screen.steps.length !== 3 || substantiveText.length < 120) {
      throw new Error(`${component.id}/${key} manual copy is too short or lacks three steps: ${substantiveText.length}`);
    }
    return {
      ...screen,
      relevance,
      filename: screenshot.filename,
      width: screenshot.width,
      height: screenshot.height,
    };
  });
}

function formatManualSteps(steps) {
  return steps.map((step, index) => `${index + 1}. ${step}`).join('  ');
}

function buildManualHtml(component, sections, screenshotDir) {
  const facts = [
    ['软件名称', component.softwareName],
    ['文档版本', 'V1.0'],
    ['文档类型', '用户手册'],
    ['编制日期', documentDate],
    ['适用对象', component.audience],
    ['运行入口', component.runtimeEntry],
  ];
  const cover = `<section class="page cover"><div class="kicker">用户操作手册</div><h1>${escapeHtml(component.softwareName)} 用户手册</h1><h2>${escapeHtml(component.subtitle)}</h2><div class="facts">${facts.map(([label, value]) => `<div><b>${escapeHtml(label)}：</b>${escapeHtml(value)}</div>`).join('')}</div><div class="toc"><h3>目录</h3><ol><li>${manualCopy.overviewTitle}</li>${sections.map((section) => `<li>${escapeHtml(section.title)}</li>`).join('')}<li>${manualCopy.workflowTitle}</li></ol></div><footer>${escapeHtml(component.softwareName)}</footer></section>`;
  const overview = `<section class="page"><h1>1. ${manualCopy.overviewTitle}</h1><p class="lead">${manualCopy.overviewLead}</p>${component.overview.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}<p>${manualCopy.screenshotNote}</p><table><tbody>${facts.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</tbody></table><footer>${escapeHtml(component.softwareName)}</footer></section>`;
  const screenshotPages = sections.map((section, index) => {
    const screenshotUrl = pathToFileURL(path.join(screenshotDir, section.filename)).href;
    const stepText = formatManualSteps(section.steps);
    return `<section class="page"><h1>${index + 2}. ${escapeHtml(section.title)}</h1><p class="lead">${escapeHtml(section.subtitle)}</p><p>${escapeHtml(`${section.overview} ${section.relevance} ${section.operations}`)}</p><p class="steps"><b>操作顺序：</b>${escapeHtml(stepText)}</p><figure><img src="${screenshotUrl}" alt="${escapeHtml(section.title)}"><figcaption>图 ${index + 1}：${escapeHtml(section.title)}</figcaption></figure><footer>${escapeHtml(component.softwareName)}</footer></section>`;
  }).join('');
  const workflow = `<section class="page"><h1>${sections.length + 2}. ${manualCopy.workflowTitle}</h1><p class="lead">${escapeHtml(component.workflowSummary)}</p><table><tbody>${component.workflowRows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</tbody></table><footer>${escapeHtml(component.softwareName)}</footer></section>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(component.softwareName)} 用户手册</title><style>
@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0;background:#e5e7eb;color:#101828;font-family:"Microsoft YaHei","Noto Sans CJK SC",Arial,sans-serif}.page{position:relative;width:210mm;height:297mm;padding:16mm 16mm 17mm;background:#fff;page-break-after:always;overflow:hidden}.page:last-child{page-break-after:auto}.page:before{content:"";position:absolute;left:0;right:0;top:0;height:8mm;background:#111827}.cover{padding-top:32mm}.kicker{font-size:12pt;color:#475467;margin-bottom:22mm}.cover h1{font-size:25pt;line-height:1.25;margin:0 0 9mm;max-width:175mm}.cover h2{font-size:15pt;color:#344054;margin:0 0 12mm;border-bottom:.35mm solid #d0d5dd;padding-bottom:4mm}.facts{display:grid;grid-template-columns:1fr 1fr;gap:6mm 8mm;border-top:.3mm solid #d0d5dd;border-bottom:.3mm solid #d0d5dd;padding:6mm 0;font-size:10pt;line-height:1.55}.toc{margin-top:12mm;border:.3mm solid #d0d5dd;background:#f8fafc;padding:6mm 8mm}.toc h3{margin:0 0 3mm;font-size:14pt}.toc ol{columns:2;margin:0;padding-left:6mm;font-size:8.5pt;line-height:1.65}.page>h1{font-size:20pt;line-height:1.25;margin:0 0 2.5mm;border-bottom:.35mm solid #cbd5e1;padding-bottom:2.5mm}.lead{font-size:10.5pt;color:#475467;margin:0 0 5mm}.page p{font-size:9.5pt;line-height:1.75;margin:0 0 3.4mm;text-align:justify}.steps{font-size:8.8pt!important;line-height:1.55!important;background:#f8fafc;border-left:1.1mm solid #475467;padding:2.2mm 3.2mm;margin-bottom:3.4mm!important}figure{margin:2mm 0 0;border:.3mm solid #d1d5db;padding:2.4mm;background:#fff;height:128mm;display:flex;flex-direction:column;align-items:center;justify-content:center}figure img{display:block;max-width:100%;max-height:116mm;object-fit:contain}figcaption{margin-top:1.6mm;font-size:7.8pt;color:#4b5563;text-align:center;line-height:1.35}table{width:100%;border-collapse:collapse;margin-top:6mm;font-size:9.5pt}th,td{border:.3mm solid #d0d5dd;padding:3mm;text-align:left;vertical-align:middle}th{width:28%;background:#f3f4f6}footer{position:absolute;left:16mm;right:16mm;bottom:7mm;border-top:.25mm solid #d1d5db;padding-top:2mm;font-size:8pt;color:#6b7280}
</style></head><body>${cover}${overview}${screenshotPages}${workflow}</body></html>`;
}

async function renderHtmlToPdf(browser, htmlPath, pdfPath, options = {}) {
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      await Promise.all(Array.from(document.images).map((image) => image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        })));
      if (document.fonts?.ready) await document.fonts.ready;
    });
    if (options.verifyCodeVisibility) {
      const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('.code-line'))
        .map((line, index) => {
          const source = line.querySelector('.source');
          const code = line.querySelector('.code');
          return {
            index: index + 1,
            sourceOverflow: Boolean(source && source.scrollWidth > source.clientWidth + 1),
            codeOverflow: Boolean(code && code.scrollWidth > code.clientWidth + 1),
          };
        })
        .filter((item) => item.sourceOverflow || item.codeOverflow)
        .slice(0, 10));
      if (overflow.length > 0) {
        throw new Error(`Source print contains clipped lines: ${JSON.stringify(overflow)}`);
      }
    }
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: pdfPath,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    await page.close();
  }
}

async function buildManualDocx(component, sections, screenshotDir, outputPath, docx) {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    Header,
    HeadingLevel,
    ImageRun,
    LevelFormat,
    PageNumber,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableLayoutType,
    TableRow,
    TextRun,
    VerticalAlign,
    WidthType,
    convertMillimetersToTwip,
  } = docx;

  const text = (value, options = {}) => new TextRun({
    text: value,
    font: 'Microsoft YaHei',
    size: options.size || 20,
    bold: options.bold || false,
    color: options.color || '111827',
  });
  const paragraph = (value, options = {}) => new Paragraph({
    children: [text(value, options)],
    heading: options.heading,
    numbering: options.numbering,
    alignment: options.alignment,
    pageBreakBefore: options.pageBreakBefore,
    spacing: {
      before: options.before ?? 0,
      after: options.after ?? 130,
      line: options.line ?? 300,
    },
  });
  const cell = (value, width, bold = false) => new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    shading: bold ? { fill: 'E8EEF5', color: 'auto' } : undefined,
    children: [paragraph(value, { size: 18, bold, after: 0, line: 260 })],
  });
  const table = (rows) => new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [2500, 6500],
    indent: { size: 120, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'D0D5DD' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D0D5DD' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'D0D5DD' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'D0D5DD' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'D0D5DD' },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'D0D5DD' },
    },
    rows: rows.map(([label, value]) => new TableRow({
      children: [cell(label, 2500, true), cell(value, 6500)],
    })),
  });

  const facts = [
    ['软件名称', component.softwareName],
    ['文档版本', 'V1.0'],
    ['文档类型', '用户手册'],
    ['编制日期', documentDate],
    ['适用对象', component.audience],
    ['运行入口', component.runtimeEntry],
  ];
  const tocEntries = [
    manualCopy.overviewTitle,
    ...sections.map((section) => section.title),
    manualCopy.workflowTitle,
  ];
  const children = [
    paragraph('用户操作手册', { size: 20, color: '475467', after: 620 }),
    paragraph(`${component.softwareName} 用户手册`, { heading: HeadingLevel.TITLE, size: 42, bold: true, after: 260, line: 340 }),
    paragraph(component.subtitle, { size: 26, bold: true, color: '344054', after: 420 }),
    table(facts),
    paragraph('目录', { heading: HeadingLevel.HEADING_1, size: 28, bold: true, before: 320, after: 140 }),
    ...tocEntries.map((entry) => paragraph(entry, {
      size: 17,
      line: 250,
      after: 20,
      numbering: { reference: 'manual-toc-numbering', level: 0 },
    })),
    paragraph(`1. ${manualCopy.overviewTitle}`, {
      heading: HeadingLevel.HEADING_1,
      size: 30,
      bold: true,
      after: 160,
      pageBreakBefore: true,
    }),
    paragraph(manualCopy.overviewLead, { size: 20, color: '475467', after: 220 }),
    ...component.overview.map((value) => paragraph(value, { size: 20, line: 320, after: 170 })),
    paragraph(manualCopy.screenshotNote, { size: 20, line: 320, after: 170 }),
    table(facts),
  ];

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    children.push(paragraph(`${index + 2}. ${section.title}`, {
      heading: HeadingLevel.HEADING_1,
      size: 28,
      bold: true,
      after: 120,
      pageBreakBefore: true,
    }));
    children.push(paragraph(section.subtitle, { size: 19, color: '475467', after: 150 }));
    children.push(paragraph(`${section.overview} ${section.relevance} ${section.operations}`, { size: 18, line: 285, after: 105 }));
    children.push(paragraph(`操作顺序：${formatManualSteps(section.steps)}`, { size: 17, color: '374151', line: 255, after: 100 }));
    const imageData = await fs.readFile(path.join(screenshotDir, section.filename));
    const maxWidth = 610;
    const maxHeight = 460;
    const scale = Math.min(maxWidth / section.width, maxHeight / section.height);
    children.push(new Paragraph({
      children: [new ImageRun({
        data: imageData,
        type: 'png',
        transformation: {
          width: Math.max(1, Math.round(section.width * scale)),
          height: Math.max(1, Math.round(section.height * scale)),
        },
      })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 60 },
    }));
    children.push(paragraph(`图 ${index + 1}：${section.title}`, {
      size: 16,
      color: '4B5563',
      alignment: AlignmentType.CENTER,
      after: 0,
      line: 230,
    }));
  }

  children.push(paragraph(`${sections.length + 2}. ${manualCopy.workflowTitle}`, {
    heading: HeadingLevel.HEADING_1,
    size: 28,
    bold: true,
    after: 160,
    pageBreakBefore: true,
  }));
  children.push(paragraph(component.workflowSummary, { size: 20, line: 320 }));
  children.push(table(component.workflowRows));

  const document = new Document({
    creator: 'AetherGuard Project',
    title: `${component.softwareName} 用户手册`,
    description: '计算机软件著作权登记用户手册',
    numbering: {
      config: [{
        reference: 'manual-toc-numbering',
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START,
          style: {
            paragraph: {
              indent: { left: 540, hanging: 270 },
              spacing: { after: 20, line: 250 },
            },
          },
        }],
      }],
    },
    styles: {
      default: {
        document: {
          run: { font: 'Microsoft YaHei', size: 20, color: '111827' },
          paragraph: { spacing: { line: 300, after: 130 } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: convertMillimetersToTwip(210),
            height: convertMillimetersToTwip(297),
          },
          margin: {
            top: convertMillimetersToTwip(18),
            right: convertMillimetersToTwip(17),
            bottom: convertMillimetersToTwip(16),
            left: convertMillimetersToTwip(17),
            header: convertMillimetersToTwip(8),
            footer: convertMillimetersToTwip(7),
          },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              text(component.softwareName, { size: 15, color: '4B5563' }),
              text('    第 ', { size: 15, color: '4B5563' }),
              new TextRun({
                children: [PageNumber.CURRENT],
                font: 'Microsoft YaHei',
                size: 15,
                color: '4B5563',
              }),
              text(' 页', { size: 15, color: '4B5563' }),
            ],
            alignment: AlignmentType.RIGHT,
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [text('用户操作手册', { size: 15, color: '6B7280' })],
            alignment: AlignmentType.CENTER,
          })],
        }),
      },
      children,
    }],
  });
  await fs.writeFile(outputPath, await Packer.toBuffer(document));
}

async function mergePdfs(frontendPath, backendPath, outputPath, pdfLib) {
  const { PDFDocument } = pdfLib;
  const merged = await PDFDocument.create();
  for (const sourcePath of [frontendPath, backendPath]) {
    const source = await PDFDocument.load(await fs.readFile(sourcePath));
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  await fs.writeFile(outputPath, await merged.save());
}

async function pdfPageCount(filepath, pdfLib) {
  const document = await pdfLib.PDFDocument.load(await fs.readFile(filepath));
  return document.getPageCount();
}

async function copyScreenshots(component, screenshotManifest, screenshotDir, packageDir) {
  const destination = path.join(packageDir, '运行截图原图');
  await fs.mkdir(destination, { recursive: true });
  const copied = [];
  for (const item of screenshotManifest.screenshots) {
    const sourcePath = path.join(screenshotDir, item.filename);
    const destinationPath = path.join(destination, item.filename);
    await fs.copyFile(sourcePath, destinationPath);
    const copiedHash = await sha256File(destinationPath);
    if (copiedHash !== item.sha256) {
      throw new Error(`Screenshot hash changed while packaging: ${item.filename}`);
    }
    copied.push({ ...item, packagedSha256: copiedHash });
  }
  await fs.writeFile(
    path.join(destination, '截图清单.json'),
    `${JSON.stringify({
      softwareName: component.softwareName,
      screenshotCount: copied.length,
      method: screenshotManifest.method,
      postProcessing: screenshotManifest.postProcessing,
      captureAssertions: screenshotManifest.captureAssertions,
      screenshots: copied,
    }, null, 2)}\n`,
    'utf8',
  );
}

async function generateComponent(component, chromium, docx, pdfLib) {
  const componentWorkDir = path.join(workRoot, component.id);
  const generatedDir = path.join(componentWorkDir, 'generated');
  const screenshotDir = path.join(componentWorkDir, 'screenshots');
  const screenshotManifestPath = path.join(screenshotDir, 'manifest.json');
  const screenshotManifest = JSON.parse(await fs.readFile(screenshotManifestPath, 'utf8'));
  await validateScreenshotManifest(component, screenshotManifest, screenshotDir);
  await fs.rm(generatedDir, { recursive: true, force: true });
  await fs.mkdir(generatedDir, { recursive: true });
  await fs.mkdir(packageRoot, { recursive: true });
  const finalPackageDir = path.join(packageRoot, `${safeStem(component.softwareName)}_提交材料`);
  const packageDir = `${finalPackageDir}.partial`;
  await fs.rm(finalPackageDir, { recursive: true, force: true });
  await fs.rm(packageDir, { recursive: true, force: true });
  await fs.mkdir(packageDir, { recursive: true });
  const softwareStem = safeStem(component.softwareName);
  const manualHtmlPath = path.join(generatedDir, 'user-manual.html');
  const manualDocxPath = path.join(packageDir, `01-用户手册-${softwareStem}.docx`);
  const manualPdfPath = path.join(packageDir, `01-用户手册-${softwareStem}.pdf`);
  const frontendHtmlPath = path.join(generatedDir, 'frontend-source.html');
  const backendHtmlPath = path.join(generatedDir, 'backend-source.html');
  const frontendTextPath = path.join(packageDir, '05-源代码-前端-文本备查.txt');
  const backendTextPath = path.join(packageDir, '06-源代码-后端-文本备查.txt');
  const frontendPdfPath = path.join(packageDir, '02-源代码-前端-30页-1500行.pdf');
  const backendPdfPath = path.join(packageDir, '03-源代码-后端-30页-1500行.pdf');
  const mergedPdfPath = path.join(packageDir, '04-源代码-合并-60页-3000行.pdf');

  const [frontend, backend] = await Promise.all([
    loadSourceRecords(component.source.frontend),
    loadSourceRecords(component.source.backend),
  ]);
  await Promise.all([
    fs.writeFile(frontendHtmlPath, buildSourceHtml(component, '前端源代码打印稿', frontend.records), 'utf8'),
    fs.writeFile(backendHtmlPath, buildSourceHtml(component, '后端源代码打印稿', backend.records), 'utf8'),
    fs.writeFile(frontendTextPath, buildSourceText(component, '前端源代码打印稿', frontend.records), 'utf8'),
    fs.writeFile(backendTextPath, buildSourceText(component, '后端源代码打印稿', backend.records), 'utf8'),
  ]);

  const sections = manualSections(component, screenshotManifest);
  const manualHtml = buildManualHtml(component, sections, screenshotDir);
  assertPlainMaterialLanguage(manualHtml, `${component.id} manual`);
  await fs.writeFile(manualHtmlPath, manualHtml, 'utf8');
  await buildManualDocx(component, sections, screenshotDir, manualDocxPath, docx);

  const browser = await launchBrowser(chromium);
  try {
    await renderHtmlToPdf(browser, manualHtmlPath, manualPdfPath);
    await renderHtmlToPdf(browser, frontendHtmlPath, frontendPdfPath, { verifyCodeVisibility: true });
    await renderHtmlToPdf(browser, backendHtmlPath, backendPdfPath, { verifyCodeVisibility: true });
  } finally {
    await browser.close();
  }
  await mergePdfs(frontendPdfPath, backendPdfPath, mergedPdfPath, pdfLib);
  await copyScreenshots(component, screenshotManifest, screenshotDir, packageDir);

  const frontendSummary = summarizeRecords(frontend.records);
  const backendSummary = summarizeRecords(backend.records);
  const selectionMarkdown = `# ${component.softwareName} 源代码选取说明\n\n`
    + `- 生成日期：${documentDate}\n`
    + '- 选取口径：仅 Git 跟踪的非空生产源程序行；排除测试、示例、生成物和旧主程序软著已选取的 `App.tsx` / `Dashboard.tsx` / `Devices.tsx` / `index.ts` / `agent-gateway.ts` / `devices.routes.ts`。\n'
    + `- 可见性口径：仅纳入展开制表符后不超过 ${maxSourceLineLength} 个字符的原始代码行；前端跳过 ${frontend.skippedOverlong} 个超长行，后端跳过 ${backend.skippedOverlong} 个超长行。打印前逐行断言 \`scrollWidth <= clientWidth\`，防止右侧代码被静默裁掉。\n`
    + '- 行数与页数：前端 1500 行 / 30 页，后端 1500 行 / 30 页，每页 50 行。\n'
    + `${component.source.notes?.length ? `- 已知源码排除：${component.source.notes.join('；')}\n` : ''}\n`
    + '## 前端选取\n\n'
    + frontendSummary.map((item) => `- \`${item.file}\` 原始行 ${item.first}-${item.last}，选取 ${item.count} 个非空源程序行。`).join('\n')
    + '\n\n## 后端选取\n\n'
    + backendSummary.map((item) => `- \`${item.file}\` 原始行 ${item.first}-${item.last}，选取 ${item.count} 个非空源程序行。`).join('\n')
    + '\n\n## 均衡配额明细\n\n### 前端\n\n'
    + frontend.allocation.map((item) => `- \`${item.file}\` 配置区间 ${item.start}-${item.end || 'EOF'}，可打印 ${item.available} 行，纳入 ${item.selected} 行。`).join('\n')
    + '\n\n### 后端\n\n'
    + backend.allocation.map((item) => `- \`${item.file}\` 配置区间 ${item.start}-${item.end || 'EOF'}，可打印 ${item.available} 行，纳入 ${item.selected} 行。`).join('\n')
    + '\n\n## 源文件 SHA-256\n\n'
    + [...frontend.files, ...backend.files].map((item) => `- \`${item.file}\`：\`${item.sha256}\``).join('\n')
    + '\n';
  assertPlainMaterialLanguage(selectionMarkdown, `${component.id} source selection`);
  await fs.writeFile(path.join(packageDir, '07-源代码选取说明.md'), selectionMarkdown, 'utf8');

  const pages = {
    manual: await pdfPageCount(manualPdfPath, pdfLib),
    frontend: await pdfPageCount(frontendPdfPath, pdfLib),
    backend: await pdfPageCount(backendPdfPath, pdfLib),
    merged: await pdfPageCount(mergedPdfPath, pdfLib),
  };
  if (pages.manual < 12 || pages.frontend !== 30 || pages.backend !== 30 || pages.merged !== 60) {
    throw new Error(`${component.id} page-count verification failed: ${JSON.stringify(pages)}`);
  }
  const artifactPaths = [manualDocxPath, manualPdfPath, frontendPdfPath, backendPdfPath, mergedPdfPath, frontendTextPath, backendTextPath];
  const artifacts = [];
  for (const filepath of artifactPaths) {
    const stat = await fs.stat(filepath);
    artifacts.push({
      filename: path.basename(filepath),
      bytes: stat.size,
      sha256: await sha256File(filepath),
    });
  }
  const validation = {
    softwareName: component.softwareName,
    generatedAt: new Date().toISOString(),
    checks: {
      screenshotCount: screenshotManifest.screenshotCount,
      screenshotsDirectFullPagePng: screenshotManifest.method === screenshotMethod,
      screenshotPostProcessing: screenshotManifest.postProcessing,
      screenshotFilesVerifiedAgainstManifest: true,
      screenshotProfileAndDynamicRouteReadinessAsserted: true,
      manualPdfPages: pages.manual,
      frontendSourceLines: frontend.records.length,
      frontendSourcePages: pages.frontend,
      frontendSkippedOverlongLines: frontend.skippedOverlong,
      backendSourceLines: backend.records.length,
      backendSourcePages: pages.backend,
      backendSkippedOverlongLines: backend.skippedOverlong,
      mergedSourcePages: pages.merged,
      linesPerSourcePage: sourcePageSize,
      maxSourceLineLength,
      sourceLineVisualOverflowCount: 0,
      sourceSelectionsGitTrackedUniqueAndProductionOnly: true,
      plainLanguageAudit: 'passed',
    },
    artifacts,
    pendingConfirmation: [
      '申请人',
      '开发完成日期',
      '首次发表日期与发表状态',
      '权利归属',
      '组件正式申报名称',
    ],
    scopeNotes: [
      '截图数据源为演示环境。',
      '截图校验范围包括软件界面、尺寸和文件哈希；生产数据、权限拒绝和外部硬件状态未纳入。',
      'DOCX 页数和排版由外部渲染验收记录确认。',
      ...(component.source.notes || []),
    ],
  };
  const validationText = `${JSON.stringify(validation, null, 2)}\n`;
  assertPlainMaterialLanguage(validationText, `${component.id} validation manifest`);
  await fs.writeFile(path.join(packageDir, '08-材料校验清单.json'), validationText, 'utf8');

  const checklist = `${component.softwareName}\n软件著作权登记材料目录\n\n`
    + `一、用户手册\n1. DOCX：${path.basename(manualDocxPath)}\n2. PDF：${path.basename(manualPdfPath)}\n3. PDF 页数：${pages.manual} 页\n4. 运行截图：${screenshotManifest.screenshotCount} 张\n\n`
    + '二、运行截图原图\n1. 截图方式：Playwright 对当前运行页面直接 fullPage PNG 截图\n2. 后期处理：无裁剪、无 PS、无打码、无缩放或拼接\n3. 每张图的尺寸和 SHA-256 见“运行截图原图/截图清单.json”\n\n'
    + '三、源代码\n1. 前端：30 页，每页 50 行，共 1500 行\n2. 后端：30 页，每页 50 行，共 1500 行\n3. 合并稿：60 页，共 3000 行\n4. 选取范围、原始行号和源文件哈希见 07-源代码选取说明.md\n\n'
    + '四、申报信息待确认\n请以证书、协议和申请表为准，确认申请人、开发完成日期、首次发表日期、权利归属和软件正式名称。\n';
  assertPlainMaterialLanguage(checklist, `${component.id} package index`);
  await fs.writeFile(path.join(packageDir, '00-提交材料清单.txt'), checklist, 'utf8');
  await fs.rename(packageDir, finalPackageDir);
  console.log(`Generated package: ${finalPackageDir}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(workRoot, { recursive: true });
  await fs.mkdir(packageRoot, { recursive: true });
  if (options.validateSources) {
    for (const component of options.selected) {
      const [frontend, backend] = await Promise.all([
        loadSourceRecords(component.source.frontend),
        loadSourceRecords(component.source.backend),
      ]);
      console.log(JSON.stringify({
        componentId: component.id,
        frontend: {
          selected: frontend.records.length,
          unique: new Set(frontend.records.map((record) => `${record.file}:${record.originalLine}`)).size,
          allocation: frontend.allocation,
        },
        backend: {
          selected: backend.records.length,
          unique: new Set(backend.records.map((record) => `${record.file}:${record.originalLine}`)).size,
          allocation: backend.allocation,
        },
      }));
    }
    return;
  }
  const { chromium } = await import(playwrightEntry);
  if (options.capture) {
    const env = await readEnvFile();
    const credentials = {
      email: process.env.SOFTCOPYRIGHT_ADMIN_EMAIL || env.ADMIN_EMAIL || 'dev-admin@aetherguard.local',
      password: process.env.SOFTCOPYRIGHT_ADMIN_PASSWORD || env.ADMIN_PASSWORD || 'DevAdmin!2026',
    };
    for (const component of options.selected) {
      await captureComponent(component, chromium, credentials);
    }
  }
  if (options.generate) {
    const docx = await import(docxEntry);
    const pdfLib = require(pdfLibCjsEntry);
    for (const component of options.selected) {
      try {
        await generateComponent(component, chromium, docx, pdfLib);
      } catch (error) {
        const finalPackageDir = path.join(packageRoot, `${safeStem(component.softwareName)}_提交材料`);
        await fs.rm(`${finalPackageDir}.partial`, { recursive: true, force: true });
        throw error;
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
