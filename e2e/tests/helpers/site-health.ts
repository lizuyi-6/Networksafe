import fs from 'node:fs';
import path from 'node:path';
import { expect, Page } from '@playwright/test';

type IssueBuckets = {
    consoleErrors: string[];
    consoleWarnings: string[];
    pageErrors: string[];
    responseErrors: string[];
    requestFailures: string[];
};

type Snapshot = {
    consoleErrors: number;
    consoleWarnings: number;
    pageErrors: number;
    responseErrors: number;
    requestFailures: number;
};

type Credentials = {
    email: string;
    password: string;
};

type DevPreset = 'admin' | 'starter' | 'pro' | 'ultra';

const DEFAULT_EMAIL = 'dev-admin@aetherguard.local';
const DEFAULT_PASSWORD = 'DevAdmin!2026';
const DEMO_AUXILIARY_TEXT = /Demo Data|demo data|演示数据|Data Source|demonstration data|本地沙箱写入/i;
const DEV_PRESET_CREDENTIALS: Record<DevPreset, Credentials> = {
    admin: {
        email: 'dev-admin@aetherguard.local',
        password: 'DevAdmin!2026',
    },
    starter: {
        email: 'starter@aetherguard.local',
        password: 'DevStarter!2026',
    },
    pro: {
        email: 'pro@aetherguard.local',
        password: 'DevPro!2026',
    },
    ultra: {
        email: 'ultra@aetherguard.local',
        password: 'DevUltra!2026',
    },
};

const envFileCandidates = [
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '../backend/.env'),
];

const parseEnvFile = (filePath: string): Record<string, string> => {
    if (!fs.existsSync(filePath)) return {};

    return fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .reduce<Record<string, string>>((acc, line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return acc;

            const separator = trimmed.indexOf('=');
            if (separator <= 0) return acc;

            const key = trimmed.slice(0, separator).trim();
            const rawValue = trimmed.slice(separator + 1).trim();
            const value = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
            acc[key] = value;
            return acc;
        }, {});
};

const resolveValue = (key: string): string | undefined => {
    if (process.env[key]) return process.env[key];

    for (const filePath of envFileCandidates) {
        const envMap = parseEnvFile(filePath);
        if (envMap[key]) return envMap[key];
    }

    return undefined;
};

export const resolveAdminCredentials = (): Credentials => ({
    email: resolveValue('E2E_ADMIN_EMAIL') || resolveValue('ADMIN_EMAIL') || DEFAULT_EMAIL,
    password: resolveValue('E2E_ADMIN_PASSWORD') || resolveValue('ADMIN_PASSWORD') || DEFAULT_PASSWORD,
});

export const resolveDevPresetCredentials = (preset: DevPreset): Credentials => DEV_PRESET_CREDENTIALS[preset];

export const createIssueMonitor = (page: Page, baseUrl: string) => {
    const issues: IssueBuckets = {
        consoleErrors: [],
        consoleWarnings: [],
        pageErrors: [],
        responseErrors: [],
        requestFailures: [],
    };

    const origin = new URL(baseUrl).origin;

    page.on('console', (message) => {
        const text = message.text();
        if (message.type() === 'error') {
            issues.consoleErrors.push(text);
            return;
        }

        if (message.type() === 'warning' && /width\(-1\)|height\(-1\)/i.test(text)) {
            issues.consoleWarnings.push(text);
        }
    });

    page.on('pageerror', (error) => {
        issues.pageErrors.push(error.message);
    });

    page.on('response', (response) => {
        const url = response.url();
        if (!url.startsWith(origin)) return;
        const pathname = new URL(url).pathname;
        const resourceType = response.request().resourceType();
        if (!pathname.startsWith('/api/') && !pathname.startsWith('/socket.io/') && resourceType !== 'document') return;
        if (response.status() < 400) return;
        issues.responseErrors.push(`${response.request().method()} ${pathname} -> ${response.status()}`);
    });

    page.on('requestfailed', (request) => {
        const url = request.url();
        if (!url.startsWith(origin)) return;
        const pathname = new URL(url).pathname;
        const resourceType = request.resourceType();
        if (!pathname.startsWith('/api/') && !pathname.startsWith('/socket.io/') && resourceType !== 'document') return;

        const failureText = request.failure()?.errorText || 'request failed';
        if (/ERR_ABORTED|NS_BINDING_ABORTED|Request was cancelled/i.test(failureText)) return;
        issues.requestFailures.push(`${request.method()} ${pathname} -> ${failureText}`);
    });

    return {
        snapshot(): Snapshot {
            return {
                consoleErrors: issues.consoleErrors.length,
                consoleWarnings: issues.consoleWarnings.length,
                pageErrors: issues.pageErrors.length,
                responseErrors: issues.responseErrors.length,
                requestFailures: issues.requestFailures.length,
            };
        },
        async assertNoNewIssues(snapshot: Snapshot, label: string) {
            const newIssues = [
                ...issues.consoleErrors.slice(snapshot.consoleErrors).map((value) => `console.error: ${value}`),
                ...issues.consoleWarnings.slice(snapshot.consoleWarnings).map((value) => `console.warn: ${value}`),
                ...issues.pageErrors.slice(snapshot.pageErrors).map((value) => `pageerror: ${value}`),
                ...issues.responseErrors.slice(snapshot.responseErrors).map((value) => `response: ${value}`),
                ...issues.requestFailures.slice(snapshot.requestFailures).map((value) => `requestfailed: ${value}`),
            ];

            expect(newIssues, `${label} should not produce browser or API errors`).toEqual([]);
        },
    };
};

export const loginWithCredentials = async (page: Page, credentials: Credentials) => {
    await page.goto('/login');
    await expect(page.locator('input[name="email"]')).toBeVisible();

    await page.locator('input[name="email"]').fill(credentials.email);
    await page.locator('input[name="password"]').fill(credentials.password);
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20000 });
    await expect(page.locator('header').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 15000 });
};

export const loginAsAdmin = async (page: Page) => loginWithCredentials(page, resolveAdminCredentials());

export const loginAsDevPreset = async (page: Page, preset: DevPreset) => loginWithCredentials(page, resolveDevPresetCredentials(preset));

export const assertNoDemoAuxiliaryCopy = async (page: Page) => {
    await expect(page.locator('body')).not.toContainText(DEMO_AUXILIARY_TEXT);
};

export const assertRenderedPage = async (page: Page, label: string, selector: string = 'main') => {
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator(selector).first(), `${label} should render its main container`).toBeVisible({ timeout: 15000 });

    await page.waitForTimeout(500);

    const bodyText = (await page.locator('body').textContent())?.replace(/\s+/g, ' ').trim() || '';
    expect(bodyText.length, `${label} should render visible content`).toBeGreaterThan(40);

    await expect(page.locator('body'), `${label} should not expose internal error markers`).not.toContainText(/FG-[A-Z]+(?:-[A-Z0-9]+)+/);
    await expect(page.locator('body'), `${label} should not render explicit error displays`).not.toContainText(/Error Loading Data|Error Loading Dashboard/i);
};

export const visitPublicPage = async (page: Page, route: string, selector: string) => {
    await page.goto(route);
    await assertRenderedPage(page, route, selector);
};

export const assertFooterLegalLinks = async (page: Page) => {
    const privacyLink = page.locator('footer a[href="/privacy"]').first();
    const termsLink = page.locator('footer a[href="/terms"]').first();

    await expect(privacyLink, 'footer should expose privacy policy').toBeVisible();
    await expect(termsLink, 'footer should expose terms of service').toBeVisible();
    await expect(privacyLink).not.toHaveAttribute('href', '#');
    await expect(termsLink).not.toHaveAttribute('href', '#');
};

export const visitSidebarPage = async (page: Page, route: string, label: string) => {
    await page.locator(`aside a[href="${route}"]`).first().click();
    await page.waitForURL(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), { timeout: 15000 });
    await assertRenderedPage(page, label);
};

export const openFirstBoardStatusPage = async (page: Page, label: string, required: boolean = true) => {
    await page.locator('aside a[href="/devices"]').first().click();
    await page.waitForURL(/\/devices$/, { timeout: 15000 });
    await assertRenderedPage(page, 'devices');

    const detailsLink = page.locator('a[href^="/devices/board-status/"]').first();
    if (await detailsLink.count() === 0) {
        if (required) {
            await expect(detailsLink, 'devices page should expose at least one board status link').toBeVisible({ timeout: 15000 });
        }
        return false;
    }

    await expect(detailsLink, 'devices page should expose at least one board status link').toBeVisible({ timeout: 15000 });
    await detailsLink.click();

    await page.waitForURL(/\/devices\/board-status\//, { timeout: 15000 });
    await assertRenderedPage(page, label);
    return true;
};

export const toggleDemoMode = async (page: Page) => {
    const toggleButton = page.getByTestId('demo-mode-toggle');
    await expect(toggleButton, 'demo toggle should be visible in the header').toBeVisible({ timeout: 15000 });

    const currentValue = await toggleButton.getAttribute('aria-pressed');
    const targetValue = currentValue === 'true' ? 'false' : 'true';

    await toggleButton.click();
    await expect(toggleButton).toHaveAttribute('aria-pressed', targetValue, { timeout: 5000 });
};

export const ensureDemoMode = async (page: Page, enabled: boolean) => {
    const current = await page.getByTestId('demo-mode-toggle').getAttribute('aria-pressed');

    if ((current === 'true') !== enabled) {
        await toggleDemoMode(page);
    }
};
