import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildSceneRenderSpec } from './video-scene-compositor.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(__dirname, 'aetherguard-demo-1min.manifest.json');
const FONT_SOURCE_PATH = 'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf';
const DEMO_AUXILIARY_COPY = /Demo Data|demo data|Data Source|demonstration data|sandbox/i;

function log(step, message) {
  console.log(`[video:${step}] ${message}`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resetDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(payload, fallbackSeconds = 10) {
  const retryAfter = Number(payload?.retryAfter);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter * 1000;
  }
  return fallbackSeconds * 1000;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const entries = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    entries[key] = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return entries;
}

function loadEnvMap() {
  const envMap = {
    ...parseEnvFile(path.join(ROOT_DIR, '.env')),
    ...parseEnvFile(path.join(ROOT_DIR, 'backend', '.env'))
  };

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') envMap[key] = value;
  }

  return envMap;
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function resolveFromRoot(relativePath) {
  return path.join(ROOT_DIR, relativePath);
}

function toPosixPath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function secondsToDisplay(totalSeconds) {
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function secondsToSrtTimestamp(totalSeconds) {
  const totalMs = Math.max(0, Math.round(totalSeconds * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function legacyWrapSubtitleText(text) {
  const clean = String(text || '').trim();
  if (clean.length <= 24) return clean;
  const midpoint = Math.floor(clean.length / 2);
  const breakpoints = ['，', '。', '；', '：', '、', ',', '.'];
  let splitIndex = -1;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 6; index < clean.length - 6; index += 1) {
    if (!breakpoints.includes(clean[index])) continue;
    const distance = Math.abs(index - midpoint);
    if (distance < closestDistance) {
      closestDistance = distance;
      splitIndex = index + 1;
    }
  }

  if (splitIndex > 0) {
    return `${clean.slice(0, splitIndex).trim()}\n${clean.slice(splitIndex).trim()}`;
  }

  return `${clean.slice(0, midpoint).trim()}\n${clean.slice(midpoint).trim()}`;
}

function wrapSubtitleText(text) {
  const clean = String(text || '').trim();
  if (clean.length <= 24) return clean;
  const midpoint = Math.floor(clean.length / 2);
  const breakpoints = ['，', '。', '；', '：', '、', ',', '.', ' '];
  let splitIndex = -1;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 6; index < clean.length - 6; index += 1) {
    if (!breakpoints.includes(clean[index])) continue;
    const distance = Math.abs(index - midpoint);
    if (distance < closestDistance) {
      closestDistance = distance;
      splitIndex = index + 1;
    }
  }

  if (splitIndex > 0) {
    return `${clean.slice(0, splitIndex).trim()}\n${clean.slice(splitIndex).trim()}`;
  }

  return `${clean.slice(0, midpoint).trim()}\n${clean.slice(midpoint).trim()}`;
}

function getSceneCards(scene) {
  return scene.objectCards || scene.uiCards || [];
}

function formatSubtitleText(text) {
  const clean = String(text || '').trim();
  if (clean.length <= 24) return clean;
  const midpoint = Math.floor(clean.length / 2);
  const breakpoints = ['，', '。', '、', '；', '：', ',', '.', ' '];
  let splitIndex = -1;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 6; index < clean.length - 6; index += 1) {
    if (!breakpoints.includes(clean[index])) continue;
    const distance = Math.abs(index - midpoint);
    if (distance < closestDistance) {
      closestDistance = distance;
      splitIndex = index + 1;
    }
  }

  if (splitIndex > 0) {
    return `${clean.slice(0, splitIndex).trim()}\n${clean.slice(splitIndex).trim()}`;
  }

  return `${clean.slice(0, midpoint).trim()}\n${clean.slice(midpoint).trim()}`;
}

function computeScenes(manifest) {
  let cursor = 0;
  return manifest.scenes.map((scene, index) => {
    const startSec = cursor;
    const endSec = startSec + scene.durationSec;
    cursor = endSec;
    return {
      ...scene,
      index,
      startSec,
      endSec,
      startLabel: secondsToDisplay(startSec),
      endLabel: secondsToDisplay(endSec)
    };
  });
}

function buildPaths(manifest) {
  const artifactsDir = resolveFromRoot(manifest.output.artifactsDir);
  const docsDir = resolveFromRoot(manifest.output.docsDir);
  const stagingDir = path.join(artifactsDir, '.staging');

  return {
    artifactsDir,
    docsDir,
    stagingDir,
    authStatePath: path.join(stagingDir, 'auth-state.json'),
    rawAssetDir: path.join(stagingDir, 'raw-assets'),
    renderedSceneDir: path.join(stagingDir, 'rendered-scenes'),
    sceneClipDir: path.join(stagingDir, 'scene-clips'),
    frameDir: path.join(stagingDir, 'frames'),
    audioDir: path.join(stagingDir, 'audio'),
    capturedDir: path.join(stagingDir, 'captured'),
    brandDir: path.join(stagingDir, 'brand'),
    filterDir: path.join(stagingDir, 'filters'),
    runtimeDir: path.join(stagingDir, 'runtime')
  };
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webm':
      return 'video/webm';
    case '.mp4':
      return 'video/mp4';
    case '.wav':
      return 'audio/wav';
    case '.ttf':
      return 'font/ttf';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function runCommand(command, args, { cwd = ROOT_DIR, env = process.env, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false });
    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        if (!quiet) process.stdout.write(text);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        if (!quiet) process.stderr.write(text);
      });
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with code ${code}\n${stderr}`));
    });
  });
}

async function getMediaDuration(filePath) {
  const { stdout } = await runCommand(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
    { quiet: true }
  );
  return Number.parseFloat(stdout.trim());
}

async function ensurePrerequisites() {
  await runCommand('ffmpeg', ['-version'], { quiet: true });
  await runCommand('ffprobe', ['-version'], { quiet: true });
}

async function verifyLocalStack(manifest) {
  const frontendResponse = await fetch(manifest.frontendUrl);
  if (!frontendResponse.ok) {
    throw new Error(`Frontend is not reachable: ${manifest.frontendUrl} -> ${frontendResponse.status}`);
  }

  const backendResponse = await fetch(`${manifest.backendUrl}/health/ready`);
  if (!backendResponse.ok) {
    throw new Error(`Backend healthcheck failed: ${manifest.backendUrl}/health/ready -> ${backendResponse.status}`);
  }

  const payload = await backendResponse.json();
  if (payload.status !== 'healthy') {
    throw new Error(`Backend healthcheck returned unexpected status: ${JSON.stringify(payload)}`);
  }
}

function resolveCredentialCandidates(manifest, envMap) {
  const candidates = [];

  for (const candidate of manifest.capture.credentials || []) {
    const email = candidate.email || envMap[candidate.emailEnv] || candidate.fallbackEmail;
    const password = candidate.password || envMap[candidate.passwordEnv];
    if (!email || !password) continue;
    candidates.push({ email, password });
  }

  return candidates;
}

async function findWorkingCredentials(manifest, candidates) {
  for (const credentials of candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${manifest.backendUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(credentials)
      });

      if (response.ok) {
        return credentials;
      }

      if (response.status === 429 && attempt === 0) {
        const payload = await response.json().catch(() => null);
        await sleep(getRetryDelayMs(payload, 15));
        continue;
      }

      break;
    }
  }

  throw new Error('None of the configured credential candidates could log in to the backend API.');
}

function createIssueMonitor(page, urls) {
  const issues = {
    consoleErrors: [],
    pageErrors: [],
    responseErrors: [],
    requestFailures: []
  };
  const allowedOrigins = new Set(urls.map((url) => new URL(url).origin));

  const isRelevant = (url, pathname, resourceType) => {
    if (!allowedOrigins.has(new URL(url).origin)) return false;
    return pathname.startsWith('/api/') || pathname.startsWith('/socket.io/') || resourceType === 'document';
  };

  page.on('console', (message) => {
    if (message.type() === 'error') {
      issues.consoleErrors.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    issues.pageErrors.push(error.message);
  });

  page.on('response', (response) => {
    const resourceType = response.request().resourceType();
    const url = response.url();
    const pathname = new URL(url).pathname;
    if (!isRelevant(url, pathname, resourceType)) return;
    if (response.status() < 400) return;
    if (response.status() === 429 && pathname.startsWith('/api/stats')) return;
    if (response.status() === 401 && pathname === '/api/system/mode') return;
    issues.responseErrors.push(`${response.request().method()} ${pathname} -> ${response.status()}`);
  });

  page.on('requestfailed', (request) => {
    const resourceType = request.resourceType();
    const url = request.url();
    const pathname = new URL(url).pathname;
    if (!isRelevant(url, pathname, resourceType)) return;
    const failureText = request.failure()?.errorText || 'request failed';
    if (/ERR_ABORTED|NS_BINDING_ABORTED|Request was cancelled/i.test(failureText)) return;
    issues.requestFailures.push(`${request.method()} ${pathname} -> ${failureText}`);
  });

  return {
    snapshot() {
      return {
        consoleErrors: issues.consoleErrors.length,
        pageErrors: issues.pageErrors.length,
        responseErrors: issues.responseErrors.length,
        requestFailures: issues.requestFailures.length
      };
    },
    assertNoNewIssues(snapshot, label) {
      const newIssues = [
        ...issues.consoleErrors.slice(snapshot.consoleErrors).map((value) => `console.error: ${value}`),
        ...issues.pageErrors.slice(snapshot.pageErrors).map((value) => `pageerror: ${value}`),
        ...issues.responseErrors.slice(snapshot.responseErrors).map((value) => `response: ${value}`),
        ...issues.requestFailures.slice(snapshot.requestFailures).map((value) => `requestfailed: ${value}`)
      ];

      if (newIssues.length > 0) {
        throw new Error(`${label} produced browser or API issues:\n${newIssues.join('\n')}`);
      }
    }
  };
}

async function waitForRenderablePage(page, label) {
  await page.waitForLoadState('domcontentloaded');
  const main = page.locator('main, [role="main"]').first();
  await main.waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(900);

  const bodyText = ((await page.locator('body').textContent()) || '').replace(/\s+/g, ' ').trim();
  if (bodyText.length < 60) {
    throw new Error(`${label} rendered too little visible content`);
  }
  if (/FG-[A-Z]+(?:-[A-Z0-9]+)+/.test(bodyText)) {
    throw new Error(`${label} exposed internal error markers`);
  }
  if (/Error Loading Data|Error Loading Dashboard/i.test(bodyText)) {
    throw new Error(`${label} rendered an explicit loading error`);
  }
}

async function ensureDemoModeOff(page) {
  const toggle = page.getByTestId('demo-mode-toggle');
  if ((await toggle.count()) === 0) return;
  const ariaPressed = await toggle.getAttribute('aria-pressed');
  if (ariaPressed === 'true') {
    await toggle.click();
    await page.waitForTimeout(400);
  }

  const bodyText = ((await page.locator('body').textContent()) || '').replace(/\s+/g, ' ').trim();
  if (DEMO_AUXILIARY_COPY.test(bodyText)) {
    throw new Error('Demo auxiliary copy is still visible after disabling demo mode.');
  }
}

async function applyForcedThemeInit(context, manifest) {
  const storageKey = manifest.capture.themeStorageKey || 'aetherguard-theme-v2';
  const theme = manifest.capture.forceTheme || 'light';
  await context.addInitScript(
    ({ storageKeyValue, themeValue }) => {
      const applyTheme = () => {
        const root = document.documentElement;
        if (!root) return;
        root.classList.remove('dark', 'light');
        root.classList.add(themeValue);
      };
      try {
        window.localStorage.setItem(storageKeyValue, themeValue);
      } catch (error) {
        // ignored
      }
      applyTheme();
      document.addEventListener('DOMContentLoaded', applyTheme, { once: true });
    },
    { storageKeyValue: storageKey, themeValue: theme }
  );
}

async function loginAndSaveState(browser, manifest, credentials, statePath) {
  const context = await browser.newContext({
    viewport: manifest.viewport,
    locale: manifest.capture.locale || 'zh-CN'
  });

  try {
    await applyForcedThemeInit(context, manifest);
    const page = await context.newPage();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.goto(`${manifest.frontendUrl}/login`, { waitUntil: 'domcontentloaded' });
      await page.locator('input[name="email"]').fill(credentials.email);
      await page.locator('input[name="password"]').fill(credentials.password);
      const loginResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/auth/login') && response.request().method() === 'POST',
        { timeout: 30000 }
      );
      await page.locator('button[type="submit"]').click();
      const loginResponse = await loginResponsePromise;
      if (loginResponse.ok()) {
        break;
      }

      const payload = await loginResponse.json().catch(() => null);
      if (loginResponse.status() === 429 && attempt === 0) {
        await sleep(getRetryDelayMs(payload, 15));
        continue;
      }

      throw new Error(`Login request failed: ${loginResponse.status()} ${JSON.stringify(payload)}`);
    }

    await page.waitForFunction(() => window.location.pathname !== '/login', undefined, { timeout: 30000 });
    await waitForRenderablePage(page, 'dashboard');
    if (manifest.capture.disableDemoMode) {
      await ensureDemoModeOff(page);
    }
    await context.storageState({ path: statePath });
  } finally {
    await context.close();
  }
}

async function performAssetActions(page, asset) {
  const main = page.locator('main, [role="main"]').first();
  const startedAt = Date.now();

  try {
    await main.hover();
  } catch (error) {
    // Ignore hover failures on routes without a main scrolling region.
  }

  if (asset.waitMs) {
    await page.waitForTimeout(asset.waitMs);
  }

  for (const action of asset.actions || []) {
    if (action.type === 'scroll') {
      try {
        await main.hover();
      } catch (error) {
        // ignored
      }
      await page.mouse.wheel(0, action.deltaY || 0);
      await page.waitForTimeout(action.waitMs || action.delayAfterMs || action.ms || 800);
      continue;
    }

    if (action.type === 'click' && action.selector) {
      await page.locator(action.selector).first().click();
      await page.waitForTimeout(action.waitMs || action.delayAfterMs || action.ms || 800);
      continue;
    }

    if (action.type === 'wait') {
      await page.waitForTimeout(action.waitMs || action.ms || 800);
    }
  }

  const elapsed = Date.now() - startedAt;
  const remaining = Math.max(0, Math.round(asset.durationSec * 1000) - elapsed);
  if (remaining > 0) {
    await page.waitForTimeout(remaining);
  }
}

async function transcodeTrimmedVideo(inputPath, outputPath, startSec, durationSec, width, height, fps) {
  const filterGraph = `fps=${fps},eq=contrast=1.02:saturation=1.0:brightness=0.0,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuv420p`;

  await runCommand(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputPath,
      '-ss',
      startSec.toFixed(3),
      '-t',
      durationSec.toFixed(3),
      '-vf',
      filterGraph,
      '-an',
      '-r',
      String(fps),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '16',
      '-movflags',
      '+faststart',
      outputPath
    ],
    { quiet: true }
  );
}

async function copyFallbackAsset(asset, capturedDir) {
  const fallbackSource = resolveFromRoot(asset.fallbackImage);
  if (!fs.existsSync(fallbackSource)) {
    throw new Error(`Fallback asset is missing for ${asset.id}: ${fallbackSource}`);
  }

  const extension = path.extname(fallbackSource) || '.png';
  const fallbackTarget = path.join(capturedDir, `${asset.id}${extension}`);
  await fsp.copyFile(fallbackSource, fallbackTarget);

  return {
    id: asset.id,
    mode: 'fallback',
    type: 'image',
    publicUrl: `/captured/${path.basename(fallbackTarget)}`,
    sourcePath: fallbackTarget,
    route: asset.route,
    durationSec: asset.durationSec,
    fallbackImage: asset.fallbackImage
  };
}

async function captureAsset(browser, manifest, asset, paths) {
  let context;
  let captureVideo;
  let captureStartedAt = 0;
  let contentReadyAt = 0;

  try {
    context = await browser.newContext({
      viewport: manifest.viewport,
      locale: manifest.capture.locale || 'zh-CN',
      storageState: paths.authStatePath,
      recordVideo: {
        dir: paths.rawAssetDir,
        size: manifest.viewport
      }
    });

    await applyForcedThemeInit(context, manifest);
    const page = await context.newPage();
    captureVideo = page.video();
    const monitor = createIssueMonitor(page, [manifest.frontendUrl, manifest.backendUrl]);
    const snapshot = monitor.snapshot();

    captureStartedAt = Date.now();
    await page.goto(`${manifest.frontendUrl}${asset.route}`, { waitUntil: 'commit', timeout: 45000 });
    await waitForRenderablePage(page, asset.id);
    if (manifest.capture.disableDemoMode) {
      await ensureDemoModeOff(page);
    }
    contentReadyAt = Date.now();
    await performAssetActions(page, asset);
    monitor.assertNoNewIssues(snapshot, asset.id);

    await context.close();
    const rawPath = await captureVideo.path();
    const renderedPath = path.join(paths.capturedDir, `${asset.id}.mp4`);
    const startSec = Math.max(0, (contentReadyAt - captureStartedAt) / 1000);
    await transcodeTrimmedVideo(rawPath, renderedPath, startSec, asset.durationSec, manifest.viewport.width, manifest.viewport.height, manifest.captureFps);

    return {
      id: asset.id,
      mode: 'capture',
      type: 'video',
      publicUrl: `/captured/${path.basename(renderedPath)}`,
      sourcePath: renderedPath,
      rawSourcePath: rawPath,
      route: asset.route,
      durationSec: asset.durationSec,
      fallbackImage: asset.fallbackImage
    };
  } catch (error) {
    if (context) {
      try {
        await context.close();
      } catch (closeError) {
        // ignored
      }
    }

    const fallbackResult = await copyFallbackAsset(asset, paths.capturedDir);
    return {
      ...fallbackResult,
      error: error.message
    };
  }
}

async function copyBrandAssetsToStaging(manifest, paths) {
  ensureDir(paths.brandDir);
  const shieldTarget = path.join(paths.brandDir, path.basename(manifest.brand.shieldImage));
  const fontTarget = path.join(paths.brandDir, path.basename(FONT_SOURCE_PATH));
  await fsp.copyFile(resolveFromRoot(manifest.brand.shieldImage), shieldTarget);
  await fsp.copyFile(FONT_SOURCE_PATH, fontTarget);
  return {
    shieldPath: path.relative(ROOT_DIR, shieldTarget),
    fontPath: path.relative(ROOT_DIR, fontTarget)
  };
}

function createAssetResultMap(assetResults) {
  return Object.fromEntries(assetResults.map((asset) => [asset.id, asset]));
}

async function renderSceneComposition(manifest, scene, orientation, assetResultMap, brandAssets, paths) {
  const outputDir = path.join(paths.renderedSceneDir, orientation);
  ensureDir(outputDir);
  ensureDir(paths.filterDir);

  const outputPath = path.join(outputDir, `${String(scene.index).padStart(2, '0')}-${scene.id}.mp4`);
  const filterPath = path.join(paths.filterDir, `${orientation}-${String(scene.index).padStart(2, '0')}-${scene.id}.fcs`);
  const spec = buildSceneRenderSpec({
    manifest,
    scene,
    orientation,
    assetResults: assetResultMap,
    fontPath: brandAssets.fontPath,
    shieldPath: brandAssets.shieldPath
  });

  await fsp.writeFile(filterPath, spec.filterScript, 'utf8');
  await runCommand(
    'ffmpeg',
    ['-y', ...spec.inputArgs, '-filter_complex_script', filterPath, ...spec.outputArgs, outputPath],
    { quiet: true }
  );

  return {
    outputPath,
    filterPath,
    ...spec.sceneAnalytics
  };
}

async function concatVideoClips(inputs, outputPath) {
  const listFilePath = path.join(path.dirname(outputPath), `${path.basename(outputPath, path.extname(outputPath))}.concat.txt`);
  const lines = inputs.map((input) => `file '${toPosixPath(path.resolve(input)).replace(/'/g, "'\\''")}'`);
  await fsp.writeFile(listFilePath, `${lines.join('\n')}\n`, 'utf8');
  await runCommand('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFilePath, '-c', 'copy', outputPath], { quiet: true });
}

function buildRuntimeAssets(assetResults) {
  const assets = {};
  const fileMap = new Map();

  for (const asset of assetResults) {
    const extension = path.extname(asset.sourcePath) || (asset.type === 'image' ? '.png' : '.mp4');
    const fileName = `${asset.id}${extension}`;
    const publicPath = `/__promo-assets__/${fileName}`;
    assets[asset.id] = {
      id: asset.id,
      url: publicPath,
      type: asset.type === 'image' ? 'image' : 'video',
      durationSec: asset.durationSec,
      fallback: asset.mode !== 'capture'
    };
    fileMap.set(publicPath, asset.sourcePath);
  }

  return { assets, fileMap };
}

async function fulfillFileRequest(route, filePath) {
  const request = route.request();
  const stat = await fsp.stat(filePath);
  const contentType = mimeTypeForPath(filePath);
  const rangeHeader = request.headers().range;

  if (rangeHeader) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (match) {
      const start = Number.parseInt(match[1], 10);
      const end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;
      const safeEnd = Math.min(end, stat.size - 1);
      const chunkSize = safeEnd - start + 1;
      const buffer = await fsp.readFile(filePath);

      await route.fulfill({
        status: 206,
        headers: {
          'content-type': contentType,
          'content-length': String(chunkSize),
          'content-range': `bytes ${start}-${safeEnd}/${stat.size}`,
          'accept-ranges': 'bytes',
          'cache-control': 'no-store'
        },
        body: buffer.subarray(start, safeEnd + 1)
      });
      return;
    }
  }

  await route.fulfill({
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(stat.size),
      'accept-ranges': 'bytes',
      'cache-control': 'no-store'
    },
    body: await fsp.readFile(filePath)
  });
}

async function registerRuntimeAssetRoutes(context, fileMap) {
  await context.route('**/__promo-assets__/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const sourcePath = fileMap.get(pathname);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      await route.abort('failed');
      return;
    }
    await fulfillFileRequest(route, sourcePath);
  });
}

function buildPromoFilmPayload(manifest, scenes, assetResults) {
  const runtime = buildRuntimeAssets(assetResults);
  return {
    payload: {
      manifest: {
        id: manifest.id,
        title: manifest.title,
        theme: manifest.theme,
        brand: manifest.brand,
        scenes
      },
      assets: runtime.assets
    },
    fileMap: runtime.fileMap
  };
}

async function encodeFramesToVideo(frameDir, fps, outputPath) {
  await runCommand(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      String(fps),
      '-i',
      path.join(frameDir, 'frame-%05d.png'),
      '-vf',
      'format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '14',
      '-movflags',
      '+faststart',
      outputPath
    ],
    { quiet: true }
  );
}

async function renderOrientationFilm(browser, manifest, scenes, assetResults, paths, orientation) {
  const viewport = manifest.output[orientation];
  const outputDir = path.join(paths.sceneClipDir, orientation);
  const frameDir = path.join(paths.frameDir, orientation);
  ensureDir(outputDir);
  ensureDir(frameDir);

  const { payload, fileMap } = buildPromoFilmPayload(manifest, scenes, assetResults);
  const context = await browser.newContext({
    viewport,
    locale: manifest.capture.locale || 'zh-CN',
    storageState: paths.authStatePath,
    deviceScaleFactor: 1
  });

  try {
    await applyForcedThemeInit(context, manifest);
    await context.addInitScript((runtimePayload) => {
      window.__PROMO_FILM_DATA__ = runtimePayload;
    }, payload);
    await registerRuntimeAssetRoutes(context, fileMap);

    const page = await context.newPage();
    const monitor = createIssueMonitor(page, [manifest.frontendUrl, manifest.backendUrl]);
    const snapshot = monitor.snapshot();
    await page.goto(`${manifest.frontendUrl}${manifest.promo.route}?capture=1&orientation=${orientation}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });
    await page.waitForFunction(() => window.__PROMO_FILM__?.ready === true, undefined, { timeout: 45000 });
    await page.evaluate(() => (document.fonts && 'ready' in document.fonts ? document.fonts.ready : Promise.resolve()));

    const sceneResults = [];
    for (const scene of scenes) {
      const sceneFrameDir = path.join(frameDir, `${String(scene.index).padStart(2, '0')}-${scene.id}`);
      resetDir(sceneFrameDir);
      const frameCount = Math.round(scene.durationSec * manifest.compositionFps);

      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const timeMs = scene.startSec * 1000 + (frameIndex * 1000) / manifest.compositionFps;
        await page.evaluate(async (targetMs) => {
          if (!window.__PROMO_FILM__) {
            throw new Error('Promo film capture API is unavailable.');
          }
          await window.__PROMO_FILM__.seek(targetMs);
        }, timeMs);
        await page.screenshot({
          path: path.join(sceneFrameDir, `frame-${String(frameIndex + 1).padStart(5, '0')}.png`),
          type: 'png'
        });
      }

      const outputPath = path.join(outputDir, `${String(scene.index).padStart(2, '0')}-${scene.id}.mp4`);
      await encodeFramesToVideo(sceneFrameDir, manifest.compositionFps, outputPath);
      fs.rmSync(sceneFrameDir, { recursive: true, force: true });
      sceneResults.push({
        id: scene.id,
        durationSec: scene.durationSec,
        outputPath
      });
    }

    monitor.assertNoNewIssues(snapshot, `${orientation} promo-film`);
    return sceneResults;
  } finally {
    await context.close();
  }
}

function computeUiAnalytics(scenes, assetResults) {
  const assetMap = Object.fromEntries(assetResults.map((asset) => [asset.id, asset]));
  let uiLandscape = 0;
  let uiVertical = 0;
  let staticLandscape = 0;
  let staticVertical = 0;
  const totalDurationSec = scenes.at(-1)?.endSec || 1;

  for (const scene of scenes) {
    for (const card of getSceneCards(scene)) {
      if (!card.assetId) continue;
      const asset = assetMap[card.assetId];
      if (!asset) continue;
      const duration = Math.max(0, (card.endSec || 0) - (card.startSec || 0));
      const landscapeArea = (card.landscape?.w || 0) * (card.landscape?.h || 0);
      const verticalArea = (card.vertical?.w || 0) * (card.vertical?.h || 0);
      uiLandscape += duration * landscapeArea;
      uiVertical += duration * verticalArea;
      if (asset.mode !== 'capture') {
        staticLandscape += duration * landscapeArea;
        staticVertical += duration * verticalArea;
      }
    }
  }

  return {
    uiShareActual: Number((((uiLandscape / totalDurationSec) + (uiVertical / totalDurationSec)) / 2).toFixed(3)),
    staticFallbackRatio: Number((((staticLandscape / totalDurationSec) + (staticVertical / totalDurationSec)) / 2).toFixed(3))
  };
}

async function generateAmbientTrack(durationSec, manifest, outputPath, previewMode) {
  const fadeStart = Math.max(0, durationSec - 2.5);
  const targetGain = previewMode ? Math.max(manifest.audio.musicGainDb ?? -18, -16) : manifest.audio.musicGainDb ?? -18;
  const filter = [
    '[0:a]highpass=f=180,lowpass=f=5600,volume=-26dB,apulsator=hz=0.11:width=0.78[n]',
    '[1:a]volume=-24dB,chorus=0.5:0.9:50:0.3:0.22:2[s1]',
    '[2:a]volume=-23dB,chorus=0.5:0.9:65:0.35:0.28:3,lowpass=f=4200[s2]',
    '[3:a]volume=-27dB,apulsator=hz=0.07:width=0.84,highpass=f=240[s3]',
    `[n][s1][s2][s3]amix=inputs=4:normalize=0,highshelf=f=2400:g=4,lowpass=f=11000,volume=${targetGain}dB,afade=t=in:st=0:d=2.5,afade=t=out:st=${fadeStart.toFixed(2)}:d=2.5,loudnorm=I=-20:LRA=7:TP=-2[a]`
  ].join(';');

  await runCommand(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-t',
      durationSec.toFixed(3),
      '-i',
      'anoisesrc=color=pink:amplitude=0.28:sample_rate=48000',
      '-f',
      'lavfi',
      '-t',
      durationSec.toFixed(3),
      '-i',
      'sine=frequency=220:sample_rate=48000',
      '-f',
      'lavfi',
      '-t',
      durationSec.toFixed(3),
      '-i',
      'sine=frequency=330:sample_rate=48000',
      '-f',
      'lavfi',
      '-t',
      durationSec.toFixed(3),
      '-i',
      'sine=frequency=494:sample_rate=48000',
      '-filter_complex',
      filter,
      '-map',
      '[a]',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-c:a',
      'pcm_s16le',
      outputPath
    ],
    { quiet: true }
  );
}

async function prepareMusicTrack(musicPath, durationSec, outputPath) {
  await runCommand(
    'ffmpeg',
    [
      '-y',
      '-i',
      musicPath,
      '-af',
      `highpass=f=50,lowpass=f=12000,loudnorm=I=-21:LRA=7:TP=-2,aresample=48000,apad=pad_dur=${durationSec.toFixed(3)},atrim=0:${durationSec.toFixed(3)}`,
      '-ar',
      '48000',
      '-ac',
      '2',
      '-c:a',
      'pcm_s16le',
      outputPath
    ],
    { quiet: true }
  );
}

async function prepareVoiceTrack(voiceoverPath, durationSec, outputPath) {
  await runCommand(
    'ffmpeg',
    [
      '-y',
      '-i',
      voiceoverPath,
      '-af',
      `highpass=f=80,lowpass=f=12000,acompressor=threshold=-18dB:ratio=2.2:attack=20:release=200,loudnorm=I=-16:LRA=7:TP=-1.5,aresample=48000,apad=pad_dur=${durationSec.toFixed(3)},atrim=0:${durationSec.toFixed(3)}`,
      '-ar',
      '48000',
      '-ac',
      '2',
      '-c:a',
      'pcm_s16le',
      outputPath
    ],
    { quiet: true }
  );
}

async function mixAudio(musicPath, voicePath, outputPath, manifest) {
  if (!voicePath) {
    await runCommand(
      'ffmpeg',
      ['-y', '-i', musicPath, '-af', 'loudnorm=I=-20:LRA=7:TP=-2', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', outputPath],
      { quiet: true }
    );
    return;
  }

  const duckGain = manifest.audio.voiceoverDuckDb ?? -9;
  await runCommand(
    'ffmpeg',
    [
      '-y',
      '-i',
      musicPath,
      '-i',
      voicePath,
      '-filter_complex',
      `[0:a]volume=${duckGain}dB[m];[1:a]volume=1.2[v];[m][v]amix=inputs=2:weights='1.0 1.0':normalize=0,loudnorm=I=-16:LRA=7:TP=-1.5[a]`,
      '-map',
      '[a]',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-c:a',
      'pcm_s16le',
      outputPath
    ],
    { quiet: true }
  );
}

async function muxVideoWithAudio(videoPath, audioPath, outputPath) {
  await runCommand(
    'ffmpeg',
    [
      '-y',
      '-i',
      videoPath,
      '-i',
      audioPath,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      '-movflags',
      '+faststart',
      outputPath
    ],
    { quiet: true }
  );
}

async function verifyDurationRange(filePath, label) {
  const duration = await getMediaDuration(filePath);
  if (duration < 58 || duration > 62) {
    throw new Error(`${label} duration is out of range: ${duration.toFixed(2)}s`);
  }
  return duration;
}

async function legacyWriteDocs(manifest, shots, paths, buildMode) {
  ensureDir(paths.docsDir);
  const totalDurationSec = shots.at(-1)?.endSec || 0;
  const voiceoverExpected = manifest.audio.voiceoverPath;
  const voiceoverDocPath = path.join(paths.docsDir, 'voiceover.zh-CN.md');
  const subtitlesPath = path.join(paths.docsDir, 'subtitles.srt');
  const subtitlesAliasPath = path.join(paths.docsDir, 'subtitles.zh-CN.srt');
  const shotListPath = path.join(paths.docsDir, 'shot-list.md');

  const voiceoverLines = [
    '# AetherGuard 品牌片旁白稿',
    '',
    `目标时长：${totalDurationSec} 秒`,
    `标准音轨路径：${voiceoverExpected}`,
    `当前构建模式：${buildMode === 'final-voiceover' ? '使用外部真人感配音' : '无配音预览版，仅保留音乐与字幕参考'}`,
    `包装主题：${manifest.theme}`,
    `浅色作用范围：${manifest.lightScope}`,
    `真实 UI 占比目标：${manifest.uiShareTarget.min}-${manifest.uiShareTarget.max}`,
    '',
    '## 分镜旁白',
    ''
  ];

  for (const shot of shots) {
    voiceoverLines.push(`### ${shot.startLabel}-${shot.endLabel} ${shot.headline}`);
    voiceoverLines.push(shot.caption);
    voiceoverLines.push('');
  }

  const subtitlesBlocks = shots.map(
    (shot, index) =>
      `${index + 1}
${secondsToSrtTimestamp(shot.startSec)} --> ${secondsToSrtTimestamp(shot.endSec)}
${wrapSubtitleText(shot.caption)}
`
  );

  const shotListLines = [
    '# AetherGuard 品牌片镜头清单',
    '',
    '## 复用说明',
    '',
    '- 主入口使用 ffmpeg 原生合成 scene master，不再录制浏览器场景。',
    '- 真实 UI 只作为局部证据卡片出现，包装层维持浅色玻璃感。',
    '- 横版与竖版分别独立构图，真实 UI 不做整屏停留。',
    '- 若实时采集失败，仅允许局部卡片回退到静态截图。',
    '',
    '## 分镜',
    ''
  ];

  for (const shot of shots) {
    const cardLines = (shot.uiCards || []).length
      ? (shot.uiCards || []).map((card) => `${card.label} ${card.startSec}-${card.endSec}s`).join(' / ')
      : '无';
    shotListLines.push(`### ${shot.startLabel}-${shot.endLabel} ${shot.headline}`);
    shotListLines.push(`- 布局：${shot.layout}`);
    shotListLines.push(`- Kicker：${shot.kicker}`);
    shotListLines.push(`- 背景：${shot.backgroundPreset}`);
    shotListLines.push(`- 动效：${shot.motionPreset}`);
    shotListLines.push(`- 屏幕文案：${shot.subcopy}`);
    shotListLines.push(`- 字幕：${shot.caption}`);
    shotListLines.push(`- UI 卡片：${cardLines}`);
    shotListLines.push(`- 时长：${shot.durationSec} 秒`);
    shotListLines.push('');
  }

  await fsp.writeFile(voiceoverDocPath, `${voiceoverLines.join('\n')}\n`, 'utf8');
  await fsp.writeFile(subtitlesPath, `${subtitlesBlocks.join('\n')}\n`, 'utf8');
  await fsp.writeFile(subtitlesAliasPath, `${subtitlesBlocks.join('\n')}\n`, 'utf8');
  await fsp.writeFile(shotListPath, `${shotListLines.join('\n')}\n`, 'utf8');

  return {
    voiceoverDocPath,
    subtitlesPath,
    subtitlesAliasPath,
    shotListPath
  };
}

async function writeDocs(manifest, scenes, paths, buildMode) {
  ensureDir(paths.docsDir);
  const totalDurationSec = scenes.at(-1)?.endSec || 0;
  const voiceoverExpected = manifest.audio.voiceoverPath;
  const musicExpected = manifest.audio.musicOverridePath;
  const voiceoverDocPath = path.join(paths.docsDir, 'voiceover.zh-CN.md');
  const subtitlesPath = path.join(paths.docsDir, 'subtitles.srt');
  const subtitlesAliasPath = path.join(paths.docsDir, 'subtitles.zh-CN.srt');
  const shotListPath = path.join(paths.docsDir, 'shot-list.md');

  const voiceoverLines = [
    '# AetherGuard 字幕与可选旁白',
    '',
    `目标时长：${totalDurationSec} 秒`,
    `构建模式：${buildMode === 'final-voiceover' ? '音乐 + 外部旁白' : '音乐优先，无旁白预览版'}`,
    `主题：${manifest.theme}`,
    `标准旁白路径：${voiceoverExpected}`,
    `可选音乐覆盖路径：${musicExpected}`,
    `真实 UI 占比目标：${manifest.uiShareTarget.min}-${manifest.uiShareTarget.max}`,
    '',
    '## 分镜字幕',
    ''
  ];

  for (const scene of scenes) {
    voiceoverLines.push(`### ${scene.startLabel}-${scene.endLabel} ${scene.headline}`);
    voiceoverLines.push(scene.caption);
    voiceoverLines.push('');
  }

  const subtitlesBlocks = scenes.map(
    (scene, index) =>
      `${index + 1}
${secondsToSrtTimestamp(scene.startSec)} --> ${secondsToSrtTimestamp(scene.endSec)}
${wrapSubtitleText(scene.caption)}
`
  );

  const shotListLines = [
    '# AetherGuard 品牌片镜头清单',
    '',
    '## 复用说明',
    '',
    '- 最终成片由 ffmpeg 原生合成 scene master，不再录制浏览器场景页。',
    '- 真实 UI 仅作为对象卡片中的证据层，不承担整页演示职责。',
    '- 横版与竖版分别独立构图，同一分镜使用不同卡片窗口。',
    '- 若某个页面采集失败，仅允许对象卡片退回静态图，不放大成整屏替代。',
    '',
    '## 分镜',
    ''
  ];

  for (const scene of scenes) {
    const cardLines = getSceneCards(scene).length
      ? getSceneCards(scene).map((card) => `${card.label} ${card.startSec}-${card.endSec}s / ${card.variant}`).join(' | ')
      : '无';
    shotListLines.push(`### ${scene.startLabel}-${scene.endLabel} ${scene.headline}`);
    shotListLines.push(`- 布局：${scene.layout}`);
    shotListLines.push(`- Kicker：${scene.kicker}`);
    shotListLines.push(`- 背景：${scene.backgroundPreset}`);
    shotListLines.push(`- 动效：${scene.motionPreset}`);
    shotListLines.push(`- 屏幕文案：${scene.subcopy}`);
    shotListLines.push(`- 字幕：${scene.caption}`);
    shotListLines.push(`- 对象卡片：${cardLines}`);
    shotListLines.push(`- 时长：${scene.durationSec} 秒`);
    shotListLines.push('');
  }

  await fsp.writeFile(voiceoverDocPath, `${voiceoverLines.join('\n')}\n`, 'utf8');
  await fsp.writeFile(subtitlesPath, `${subtitlesBlocks.join('\n')}\n`, 'utf8');
  await fsp.writeFile(subtitlesAliasPath, `${subtitlesBlocks.join('\n')}\n`, 'utf8');
  await fsp.writeFile(shotListPath, `${shotListLines.join('\n')}\n`, 'utf8');

  return {
    voiceoverDocPath,
    subtitlesPath,
    subtitlesAliasPath,
    shotListPath
  };
}

async function copyDocsToArtifacts(docPaths, artifactsDir) {
  const copies = [
    [docPaths.voiceoverDocPath, path.join(artifactsDir, 'voiceover.zh-CN.md')],
    [docPaths.subtitlesPath, path.join(artifactsDir, 'subtitles.srt')],
    [docPaths.subtitlesAliasPath, path.join(artifactsDir, 'subtitles.zh-CN.srt')],
    [docPaths.shotListPath, path.join(artifactsDir, 'shot-list.md')]
  ];

  for (const [source, target] of copies) {
    await fsp.copyFile(source, target);
  }
}

async function writePromoDocs(manifest, scenes, paths, buildMode) {
  ensureDir(paths.docsDir);
  const totalDurationSec = scenes.at(-1)?.endSec || 0;
  const voiceoverDocPath = path.join(paths.docsDir, 'voiceover.zh-CN.md');
  const subtitlesPath = path.join(paths.docsDir, 'subtitles.srt');
  const subtitlesAliasPath = path.join(paths.docsDir, 'subtitles.zh-CN.srt');
  const shotListPath = path.join(paths.docsDir, 'shot-list.md');

  const voiceoverLines = [
    '# AetherGuard 宣传片文案',
    '',
    `目标时长：${totalDurationSec} 秒`,
    `构建模式：${buildMode === 'final-voiceover' ? '音乐 + 外部旁白' : '音乐优先，无旁白预览版'}`,
    `渲染方式：${manifest.renderMode}`,
    `主题：${manifest.theme}`,
    `浅色作用范围：${manifest.lightScope}`,
    `标准旁白路径：${manifest.audio.voiceoverPath}`,
    `可选音乐覆盖路径：${manifest.audio.musicOverridePath}`,
    '',
    '## 分镜字幕',
    ''
  ];

  for (const scene of scenes) {
    voiceoverLines.push(`### ${scene.startLabel}-${scene.endLabel} ${scene.headline}`);
    voiceoverLines.push(scene.caption);
    voiceoverLines.push('');
  }

  const subtitleBlocks = scenes.map(
    (scene, index) =>
      `${index + 1}
${secondsToSrtTimestamp(scene.startSec)} --> ${secondsToSrtTimestamp(scene.endSec)}
${formatSubtitleText(scene.caption)}
`
  );

  const shotListLines = [
    '# AetherGuard 宣传片镜头清单',
    '',
    '## 复用说明',
    '',
    '- 最终成片由浏览器动画页逐帧渲染，再由 ffmpeg 编码为 60fps。',
    '- `/promo-film` 只承担宣传片采集职责，不参与普通产品页面布局。',
    '- 真实 UI 仅作为证据卡片嵌入浅色包装层，采集时统一强制 light mode。',
    '- 横版与竖版复用同一时间线，但页面内部分别做响应式构图。',
    '',
    '## 分镜',
    ''
  ];

  for (const scene of scenes) {
    const cards = getSceneCards(scene);
    shotListLines.push(`### ${scene.startLabel}-${scene.endLabel} ${scene.headline}`);
    shotListLines.push(`- 布局：${scene.layout}`);
    shotListLines.push(`- Kicker：${scene.kicker}`);
    shotListLines.push(`- 背景：${scene.backgroundPreset}`);
    shotListLines.push(`- 动效：${scene.motionPreset || 'custom'}`);
    shotListLines.push(`- 屏幕文案：${scene.subcopy}`);
    shotListLines.push(`- 字幕：${scene.caption}`);
    shotListLines.push(`- 证据卡片：${cards.length ? cards.map((card) => `${card.label} ${card.startSec}-${card.endSec}s`).join(' | ') : '无'}`);
    shotListLines.push(`- 时长：${scene.durationSec} 秒`);
    shotListLines.push('');
  }

  await fsp.writeFile(voiceoverDocPath, `${voiceoverLines.join('\n')}\n`, 'utf8');
  await fsp.writeFile(subtitlesPath, `${subtitleBlocks.join('\n')}\n`, 'utf8');
  await fsp.writeFile(subtitlesAliasPath, `${subtitleBlocks.join('\n')}\n`, 'utf8');
  await fsp.writeFile(shotListPath, `${shotListLines.join('\n')}\n`, 'utf8');

  return {
    voiceoverDocPath,
    subtitlesPath,
    subtitlesAliasPath,
    shotListPath
  };
}

async function main() {
  const manifest = loadManifest();
  const scenes = computeScenes(manifest);
  const totalDurationSec = scenes.at(-1)?.endSec || 0;
  const envMap = loadEnvMap();
  const credentialsCandidates = resolveCredentialCandidates(manifest, envMap);
  const paths = buildPaths(manifest);

  if (credentialsCandidates.length === 0) {
    throw new Error('No usable login credentials were resolved for video capture.');
  }

  resetDir(paths.artifactsDir);
  ensureDir(paths.stagingDir);
  ensureDir(paths.rawAssetDir);
  ensureDir(paths.renderedSceneDir);
  ensureDir(paths.sceneClipDir);
  ensureDir(paths.frameDir);
  ensureDir(paths.audioDir);
  ensureDir(paths.capturedDir);
  ensureDir(paths.brandDir);
  ensureDir(paths.filterDir);
  ensureDir(paths.runtimeDir);

  log('prep', 'checking ffmpeg and ffprobe');
  await ensurePrerequisites();

  log('prep', 'verifying local stack');
  await verifyLocalStack(manifest);

  const credentials = await findWorkingCredentials(manifest, credentialsCandidates);
  log('prep', `using verified login ${credentials.email}`);

  const browser = await chromium.launch({ headless: true });

  try {
    log('auth', 'creating authenticated browser state');
    await loginAndSaveState(browser, manifest, credentials, paths.authStatePath);

    log('capture', 'collecting reusable UI assets');
    const assetResults = [];
    for (const asset of manifest.assets || []) {
      const result = await captureAsset(browser, manifest, asset, paths);
      assetResults.push(result);
      const mode = result.mode === 'capture' ? 'recorded' : 'fallback';
      log('capture', `${asset.id} -> ${mode}`);
    }

    log('scene', 'rendering browser-driven promo film compositions');
    const sceneResults = {
      landscape: await renderOrientationFilm(browser, manifest, scenes, assetResults, paths, 'landscape'),
      vertical: await renderOrientationFilm(browser, manifest, scenes, assetResults, paths, 'vertical')
    };

    log('docs', 'writing voiceover, subtitles, and shot list');
    const voiceoverSourcePath = resolveFromRoot(manifest.audio.voiceoverPath);
    const musicOverrideSourcePath = manifest.audio.musicOverridePath ? resolveFromRoot(manifest.audio.musicOverridePath) : null;
    const voiceoverExists = fs.existsSync(voiceoverSourcePath);
    const musicOverrideExists = Boolean(musicOverrideSourcePath && fs.existsSync(musicOverrideSourcePath));
    const buildMode = voiceoverExists ? 'final-voiceover' : 'preview-no-voiceover';
    const docPaths = await writePromoDocs(manifest, scenes, paths, buildMode);

    log(
      'audio',
      musicOverrideExists
        ? 'using local music.final.wav override'
        : manifest.audio.proceduralMusic === false
          ? 'procedural music disabled'
          : 'building procedural ambient bed'
    );
    const musicPath = path.join(paths.audioDir, 'music-bed.wav');
    const preparedVoicePath = voiceoverExists ? path.join(paths.audioDir, 'voiceover-prepared.wav') : null;
    const masterAudioPath = path.join(paths.audioDir, 'master-audio.wav');
    if (musicOverrideExists) {
      await prepareMusicTrack(musicOverrideSourcePath, totalDurationSec, musicPath);
    } else if (manifest.audio.proceduralMusic === false) {
      throw new Error('No music.final.wav found and proceduralMusic is disabled.');
    } else {
      await generateAmbientTrack(totalDurationSec, manifest, musicPath, !voiceoverExists);
    }
    if (preparedVoicePath) {
      await prepareVoiceTrack(voiceoverSourcePath, totalDurationSec, preparedVoicePath);
    }
    await mixAudio(musicPath, preparedVoicePath, masterAudioPath, manifest);

    log('render', 'concatenating scene clips');
    const landscapeMasterPath = path.join(paths.stagingDir, 'landscape.master.mp4');
    const verticalMasterPath = path.join(paths.stagingDir, 'vertical.master.mp4');
    await concatVideoClips(
      sceneResults.landscape.map((scene) => scene.outputPath),
      landscapeMasterPath
    );
    await concatVideoClips(
      sceneResults.vertical.map((scene) => scene.outputPath),
      verticalMasterPath
    );

    log('render', 'muxing final outputs');
    const landscapeOutputPath = path.join(paths.artifactsDir, 'landscape.mp4');
    const verticalOutputPath = path.join(paths.artifactsDir, 'vertical.mp4');
    await muxVideoWithAudio(landscapeMasterPath, masterAudioPath, landscapeOutputPath);
    await muxVideoWithAudio(verticalMasterPath, masterAudioPath, verticalOutputPath);

    const landscapeCompatibilityPath = path.join(paths.artifactsDir, `${manifest.id}.landscape.mp4`);
    const verticalCompatibilityPath = path.join(paths.artifactsDir, `${manifest.id}.vertical.mp4`);
    await fsp.copyFile(landscapeOutputPath, landscapeCompatibilityPath);
    await fsp.copyFile(verticalOutputPath, verticalCompatibilityPath);

    const landscapeDuration = await verifyDurationRange(landscapeOutputPath, 'Landscape video');
    const verticalDuration = await verifyDurationRange(verticalOutputPath, 'Vertical video');
    await copyDocsToArtifacts(docPaths, paths.artifactsDir);

    const analytics = computeUiAnalytics(scenes, assetResults);

    const buildReport = {
      generatedAt: new Date().toISOString(),
      mode: buildMode,
      renderMode: manifest.renderMode,
      theme: manifest.theme,
      credentialsEmail: credentials.email,
      totalDurationSec,
      voiceover: {
        expectedPath: manifest.audio.voiceoverPath,
        used: voiceoverExists,
        originalDurationSec: voiceoverExists ? Number((await getMediaDuration(voiceoverSourcePath)).toFixed(2)) : null
      },
      music: {
        expectedPath: manifest.audio.musicOverridePath,
        usedOverride: musicOverrideExists,
        source: musicOverrideExists ? 'override' : 'procedural'
      },
      outputs: {
        landscape: landscapeOutputPath,
        vertical: verticalOutputPath,
        landscapeCompatibility: landscapeCompatibilityPath,
        verticalCompatibility: verticalCompatibilityPath,
        voiceoverDoc: path.join(paths.artifactsDir, 'voiceover.zh-CN.md'),
        subtitles: path.join(paths.artifactsDir, 'subtitles.srt'),
        shotList: path.join(paths.artifactsDir, 'shot-list.md')
      },
      qa: {
        landscapeDurationSec: Number(landscapeDuration.toFixed(2)),
        verticalDurationSec: Number(verticalDuration.toFixed(2)),
        captureFps: manifest.captureFps,
        compositionFps: manifest.compositionFps,
        uiShareActual: analytics.uiShareActual,
        uiShareTarget: manifest.uiShareTarget,
        staticFallbackRatio: analytics.staticFallbackRatio,
        fullScreenUiRatio: 0,
        musicSource: musicOverrideExists ? 'override' : 'procedural'
      },
      assets: assetResults,
      scenes: sceneResults
    };

    await fsp.writeFile(path.join(paths.artifactsDir, 'build-report.json'), JSON.stringify(buildReport, null, 2), 'utf8');

    log('done', `landscape -> ${landscapeOutputPath}`);
    log('done', `vertical -> ${verticalOutputPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
