import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const playwrightEntry = pathToFileURL(
  path.join(repoRoot, 'frontend', 'node_modules', 'playwright', 'index.mjs'),
).href;
const { chromium } = await import(playwrightEntry);

function parseArgs(argv) {
  const values = {
    landscape: false,
    scale: 1,
  };

  for (const arg of argv) {
    if (arg === '--landscape') {
      values.landscape = true;
      continue;
    }

    if (arg.startsWith('--scale=')) {
      values.scale = Number(arg.slice('--scale='.length));
      continue;
    }

    if (!values.input) {
      values.input = arg;
      continue;
    }

    if (!values.output) {
      values.output = arg;
      continue;
    }
  }

  if (!values.input || !values.output) {
    throw new Error('Usage: node scripts/legal/render-html-to-pdf.mjs <input-html> <output-pdf> [--landscape] [--scale=1]');
  }

  values.input = path.resolve(repoRoot, values.input);
  values.output = path.resolve(repoRoot, values.output);
  return values;
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

async function waitForAssets(page) {
  await page.evaluate(async () => {
    const images = Array.from(document.images);
    await Promise.all(
      images.map(
        (image) =>
          image.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                image.addEventListener('load', () => resolve(), { once: true });
                image.addEventListener('error', () => resolve(), { once: true });
              }),
      ),
    );

    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(pathToFileURL(options.input).href, { waitUntil: 'domcontentloaded' });
    await waitForAssets(page);
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: options.output,
      printBackground: true,
      preferCSSPageSize: true,
      landscape: options.landscape,
      scale: options.scale,
      margin: {
        top: '0',
        right: '0',
        bottom: '0',
        left: '0',
      },
    });
    console.log(`Generated PDF: ${options.output}`);
  } finally {
    await page.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
