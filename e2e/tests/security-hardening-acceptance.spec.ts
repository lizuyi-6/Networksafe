import { expect, Page, test } from '@playwright/test';
import { assertRenderedPage, createIssueMonitor, loginAsAdmin } from './helpers/site-health';
import { assertConsoleDataHygiene } from './helpers/console-contracts';

const settle = async (page: Page) => {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
};

const evidenceName = (label: string) => `security-hardening/${label.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.png`;

const captureEvidence = async (page: Page, label: string) => {
    const { height, dpr } = await page.evaluate(() => ({
        height: document.documentElement.scrollHeight,
        dpr: window.devicePixelRatio || 1,
    }));
    await page.screenshot({
        path: test.info().outputPath(evidenceName(label)),
        fullPage: height * dpr <= 30000,
    });
};

const assertNoLayoutOrCopyIssues = async (page: Page, label: string) => {
    await assertConsoleDataHygiene(page, label);

    const issues = await page.locator('body').evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const visible = (element: Element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };

        const overflowers = Array.from(document.querySelectorAll('main, header, button, a, input, textarea, select'))
            .filter(visible)
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    tag: element.tagName.toLowerCase(),
                    text: (element.textContent || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 100),
                    testId: element.getAttribute('data-testid') || '',
                    rightOverflow: Math.ceil(rect.right - viewportWidth),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                };
            })
            .filter((item) => item.rightOverflow > 2)
            .slice(0, 10);

        const tinyControls = Array.from(document.querySelectorAll('button, a[href], input, select, textarea'))
            .filter(visible)
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    tag: element.tagName.toLowerCase(),
                    text: (element.textContent || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80),
                    testId: element.getAttribute('data-testid') || '',
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    type: element.getAttribute('type') || '',
                };
            })
            .filter((item) => item.type !== 'checkbox')
            .filter((item) => item.width < 24 || item.height < 24)
            .slice(0, 10);

        return { overflowers, tinyControls };
    });

    expect(issues.overflowers, `${label} should not overflow horizontally`).toEqual([]);
    expect(issues.tinyControls, `${label} should not have unusably small controls`).toEqual([]);
};

const expectErrorEnvelope = async (responsePromise: Promise<any>, expectedStatus: number, expectedCode: string) => {
    const response = await responsePromise;
    expect(response.status()).toBe(expectedStatus);
    const payload = await response.json();
    expect(payload).toMatchObject({ success: false });
    expect(payload.error?.code || payload.code).toBe(expectedCode);
    return payload;
};

test.describe('Security hardening acceptance flows', () => {
    test.setTimeout(180000);

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('aetherguard-live-mode', 'false');
        });
    });

    test('production SSO-only login removes password recovery shortcuts and keeps mobile layout usable', async ({ page, baseURL }) => {
        const origin = baseURL || 'http://127.0.0.1:8080';
        const modeResponse = await page.request.get(`${origin}/api/system/mode`);
        const modePayload = await modeResponse.json().catch(() => ({}));
        const mode = modePayload?.data || modePayload || {};

        await page.goto('/login');
        await assertRenderedPage(page, 'SSO login', 'body');
        await assertNoLayoutOrCopyIssues(page, 'SSO login');

        if (mode.adminPasswordLoginEnabled === false && mode.passwordRecoveryMode === 'sso_or_offline') {
            await expect(page.locator('input[name="email"]')).toHaveCount(0);
            await expect(page.locator('input[name="password"]')).toHaveCount(0);
            await expect(page.getByText(/Forgot password/i)).toHaveCount(0);
            await expect(page.getByText(/Enterprise SSO required|SSO/i)).toBeVisible();
            if (mode.oidcEnabled) {
                await expect(page.getByTestId('login-sso')).toBeVisible();
            }
        } else {
            await expect(page.locator('input[name="email"]')).toBeVisible();
            await expect(page.locator('input[name="password"]')).toBeVisible();
        }

        await captureEvidence(page, 'sso-only-login');
    });

    test('scanner URL-only flow and internal target rejection stay coherent in UI and API', async ({ page, baseURL }) => {
        const monitor = createIssueMonitor(page, baseURL!);
        await loginAsAdmin(page);

        const snapshot = monitor.snapshot();
        await page.goto('/scanner');
        await assertRenderedPage(page, 'Scanner hardening');

        await expect(page.getByTestId('scanner-include-local-host')).not.toBeChecked();
        await expect(page.getByTestId('scanner-include-system')).toBeDisabled();
        await expect(page.getByTestId('scanner-include-web')).toBeDisabled();
        await expect(page.getByTestId('scanner-include-ports')).toBeDisabled();

        await page.getByTestId('scanner-targets').fill('http://127.0.0.1:3005/api/health');
        await page.getByTestId('scanner-start-task').click();
        await expect(page.locator('main')).toContainText(/SSRF|private|loopback|metadata|INVALID_TARGETS|目标|内部/i);
        await expect(page.locator('main')).not.toContainText(/\[object Object\]/);

        await page.getByTestId('scanner-targets').fill('https://93.184.216.34/');
        await page.getByTestId('scanner-start-task').click();
        await expect(page.locator('main')).toContainText(/Task created|created|任务/i, { timeout: 15000 });

        await page.getByTestId('scanner-include-local-host').check();
        await expect(page.getByTestId('scanner-include-system')).toBeEnabled();
        await page.getByTestId('scanner-include-system').check();
        await page.getByTestId('scanner-include-web').check();
        await page.getByTestId('scanner-include-ports').check();
        await page.getByTestId('scanner-targets').fill('');
        await page.getByTestId('scanner-start-task').click();
        await expect(page.locator('main')).toContainText(/Internal host scan|SCANNER_ALLOW_INTERNAL_TARGETS|INVALID_TARGETS|内部/i);

        await assertNoLayoutOrCopyIssues(page, 'Scanner hardening');
        await captureEvidence(page, 'scanner-hardening');
        await monitor.assertNoNewIssues(snapshot, 'scanner hardening flow', {
            allowPatterns: [
                /response: POST \/api\/scanner\/tasks -> 400/,
                /console\.error: Failed to load resource: the server responded with a status of 400/,
            ],
        });
    });

    test('public health stays minimal while protected runtime APIs require session', async ({ page, baseURL }) => {
        const monitor = createIssueMonitor(page, baseURL!);
        const snapshot = monitor.snapshot();

        await page.goto('/');
        await assertRenderedPage(page, 'Public landing');
        await assertNoLayoutOrCopyIssues(page, 'Public landing');

        const health = await page.request.get('/api/health');
        expect(health.status()).toBe(200);
        const healthPayload = await health.json();
        expect(JSON.stringify(healthPayload)).not.toMatch(/redis|postgres|minio|dependency|JWT_SECRET|password/i);

        await expectErrorEnvelope(page.request.get('/api/health/ready'), 401, 'AUTH_TOKEN_MISSING');
        await expectErrorEnvelope(page.request.get('/api/health/dependencies'), 401, 'AUTH_TOKEN_MISSING');
        await expectErrorEnvelope(page.request.get('/api/stats'), 401, 'AUTH_TOKEN_MISSING');

        await captureEvidence(page, 'public-boundaries');
        await monitor.assertNoNewIssues(snapshot, 'public boundary flow', {
            allowPatterns: [
                /response: GET \/api\/health\/ready -> 401/,
                /response: GET \/api\/health\/dependencies -> 401/,
                /response: GET \/api\/stats -> 401/,
            ],
        });
    });

    test('logout invalidates browser session and protected pages redirect back to login', async ({ page, baseURL }) => {
        const monitor = createIssueMonitor(page, baseURL!);
        const snapshot = monitor.snapshot();

        await loginAsAdmin(page);
        await page.goto('/settings');
        await assertRenderedPage(page, 'Settings before logout');
        await assertNoLayoutOrCopyIssues(page, 'Settings before logout');

        await page.getByTestId('settings-logout').click();
        await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
        await settle(page);
        const modeResponse = await page.request.get('/api/system/mode');
        const modePayload = await modeResponse.json().catch(() => ({}));
        const mode = modePayload?.data || modePayload || {};
        if (mode.adminPasswordLoginEnabled === false && mode.passwordRecoveryMode === 'sso_or_offline') {
            await expect(page.locator('form')).toHaveCount(0);
            await expect(page.getByText(/Enterprise SSO required|SSO/i)).toBeVisible();
        } else {
            await expect(page.locator('form')).toBeVisible();
        }

        await page.goto('/dashboard');
        await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
        await expectErrorEnvelope(page.request.get('/api/auth/me'), 401, 'AUTH_TOKEN_MISSING');

        await captureEvidence(page, 'logout-session-boundary');
        await monitor.assertNoNewIssues(snapshot, 'logout session boundary', {
            allowPatterns: [
                /response: GET \/api\/auth\/me -> 401/,
                /console\.error: Failed to load resource: the server responded with a status of 401/,
            ],
        });
    });
});
