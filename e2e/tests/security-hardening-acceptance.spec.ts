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

const mockSession = async (
    page: Page,
    role: 'admin' | 'viewer' = 'admin',
    authProvider: 'local' | 'oidc' = 'local',
) => {
    await page.route('**/api/auth/me', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    user: {
                        userId: `e2e-${role}`,
                        email: `${role}@example.test`,
                        username: `e2e-${role}`,
                        role,
                        plan: role === 'admin' ? 'ultra' : 'starter',
                        authProvider,
                    },
                },
                error: null,
            }),
        });
    });
    await page.route('**/api/stats/badges', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ agents: 0, alerts: 0, devices: 0, agentMonitor: 0, traffic: 0, scanner: 0 }),
        });
    });
    await page.route(/\/api\/stats(?:\?.*)?$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.route('**/api/logs', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/api/dashboard/rules/summary', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: { totalRules: 0, activeRules: 0, topRules: [] }, error: null }),
        });
    });
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
        const localScanResponsePromise = page.waitForResponse((response) => (
            response.request().method() === 'POST'
            && new URL(response.url()).pathname === '/api/scanner/tasks'
        ));
        await page.getByTestId('scanner-start-task').click();
        const localScanResponse = await localScanResponsePromise;
        if (!localScanResponse.ok()) {
        await expect(page.locator('main')).toContainText(/Internal host scan|SCANNER_ALLOW_INTERNAL_TARGETS|INVALID_TARGETS|内部/i);

        } else {
            expect([200, 201, 202]).toContain(localScanResponse.status());
            const localScanPayload = await localScanResponse.json();
            const localScanData = localScanPayload?.data || localScanPayload;
            expect(typeof (localScanData?.task?.id || localScanData?.taskId || localScanData?.id)).toBe('string');
        }

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

        const liveness = await page.request.get('/health/live');
        expect(liveness.status()).toBe(200);
        expect(await liveness.json()).toEqual({ status: 'alive' });

        const readiness = await page.request.get('/health/ready');
        expect([200, 503]).toContain(readiness.status());
        const readinessPayload = await readiness.json();
        expect(Object.keys(readinessPayload)).toEqual(['status']);
        expect(['ready', 'not_ready']).toContain(readinessPayload.status);

        await expectErrorEnvelope(page.request.get('/api/health'), 401, 'AUTH_TOKEN_MISSING');
        await expectErrorEnvelope(page.request.get('/api/health/live'), 401, 'AUTH_TOKEN_MISSING');
        await expectErrorEnvelope(page.request.get('/api/health/ready'), 401, 'AUTH_TOKEN_MISSING');
        await expectErrorEnvelope(page.request.get('/api/health/dependencies'), 401, 'AUTH_TOKEN_MISSING');
        await expectErrorEnvelope(page.request.get('/api/stats'), 401, 'AUTH_TOKEN_MISSING');

        await captureEvidence(page, 'public-boundaries');
        await monitor.assertNoNewIssues(snapshot, 'public boundary flow', {
            allowPatterns: [
                /response: GET \/api\/health -> 401/,
                /response: GET \/api\/health\/live -> 401/,
                /response: GET \/api\/health\/ready -> 401/,
                /response: GET \/api\/health\/dependencies -> 401/,
                /response: GET \/api\/stats -> 401/,
            ],
        });
    });

    test('header health indicator fails closed on not-ready and unreachable readiness checks', async ({ page }) => {
        await mockSession(page);

        await page.route('**/health/ready', async (route) => {
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({ status: 'not_ready' }),
            });
        });
        await page.goto('/dashboard');
        const indicator = page.getByTestId('system-health-indicator');
        await expect(indicator).toHaveAttribute('data-status', 'not_ready');
        await expect(indicator).not.toHaveClass(/border-emerald-500/);

        await page.unroute('**/health/ready');
        await page.route('**/health/ready', async (route) => route.abort('connectionfailed'));
        await page.reload();
        await expect(indicator).toHaveAttribute('data-status', 'not_ready');
        await expect(indicator).not.toHaveClass(/border-emerald-500/);
    });

    test('tenant dashboard marks platform-scoped telemetry unavailable instead of healthy', async ({ page }) => {
        await mockSession(page, 'viewer');
        await page.route('**/health/ready', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ status: 'ready' }),
            });
        });
        await page.unroute(/\/api\/stats(?:\?.*)?$/);
        await page.route(/\/api\/stats(?:\?.*)?$/, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        telemetryAvailable: false,
                        totalRequests: 0,
                        blockedRequests: 0,
                        activeConnections: 0,
                        successRate: 0,
                        history: [],
                        threats: [],
                        securityOperations: {},
                    },
                    error: null,
                }),
            });
        });

        await page.goto('/dashboard');
        const warning = page.getByTestId('tenant-telemetry-unavailable');
        await expect(warning).toBeVisible();
        await expect(warning).toContainText(/tenant-scoped|按租户隔离/i);
        await expect(page.getByText(/Tenant telemetry unavailable|租户遥测不可用/i).first()).toBeVisible();
    });

    test('devices page marks Final Defense state unknown when status verification fails', async ({ page }) => {
        await mockSession(page);
        await page.route('**/health/ready', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ status: 'ready' }),
            });
        });
        await page.route('**/api/devices', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, total: 0, online: 0, devices: [] }) });
        });
        await page.route('**/api/final-defense/status', async (route) => {
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({ success: false, error: { code: 'E2E_STATUS_UNAVAILABLE' } }),
            });
        });
        await page.goto('/devices');
        await expect(page.locator('main [role="alert"]')).toContainText(/could not be verified|state is unknown/i);
        await expect(page.locator('main')).toContainText(/Root-Resistant Final Defense Degraded/i);
        await expect(page.locator('main')).not.toContainText(/Root-Resistant Final Defense Active/i);
    });

    test('non-governance sessions cannot open enterprise hardware and deployment routes', async ({ page }) => {
        await mockSession(page, 'viewer');
        await page.route('**/health/ready', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ status: 'ready' }),
            });
        });

        for (const route of ['/hardware-gates', '/deployment-runs', '/deployment-evidence']) {
            await page.goto(route);
            await expect(page).toHaveURL(/\/dashboard$/);
        }
        await expect(page.locator('aside a[href="/hardware-gates"]')).toHaveCount(0);
        await expect(page.locator('aside a[href="/deployment-runs"]')).toHaveCount(0);
        await expect(page.locator('aside a[href="/deployment-evidence"]')).toHaveCount(0);
    });

    test('logout invalidates browser session and protected pages redirect back to login', async ({ page, baseURL }) => {
        const monitor = createIssueMonitor(page, baseURL!);
        const snapshot = monitor.snapshot();

        await loginAsAdmin(page);
        await page.goto('/settings');
        await assertRenderedPage(page, 'Settings before logout');
        await assertNoLayoutOrCopyIssues(page, 'Settings before logout');

        const refreshRequests: string[] = [];
        page.on('request', (request) => {
            if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/refresh') {
                refreshRequests.push(request.url());
            }
        });
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
        expect(refreshRequests).toEqual([]);

        await captureEvidence(page, 'logout-session-boundary');
        await monitor.assertNoNewIssues(snapshot, 'logout session boundary', {
            allowPatterns: [
                /response: GET \/api\/auth\/me -> 401/,
                /response: GET \/api\/stats\/badges -> 401/,
                /console\.error: Failed to load resource: the server responded with a status of 401/,
            ],
        });
    });

    test('OIDC logout uses the dedicated API and follows the configured IdP end-session URL', async ({ page, baseURL }) => {
        const origin = baseURL || 'http://127.0.0.1:8080';
        const logoutRequests: string[] = [];
        await mockSession(page, 'admin', 'oidc');
        await page.route('**/health/ready', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ status: 'ready' }),
            });
        });
        await page.route('**/api/config', async (route) => {
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: false,
                    data: null,
                    error: { code: 'CONFIG_UNAVAILABLE', message: 'Configuration unavailable during logout test' },
                    code: 'CONFIG_UNAVAILABLE',
                    message: 'Configuration unavailable during logout test',
                }),
            });
        });
        await page.route('**/api/config/**', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], error: null }) });
        });
        await page.route('**/api/ai-endpoints**', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], error: null }) });
        });
        await page.route('**/api/auth/oidc/logout', async (route) => {
            logoutRequests.push(new URL(route.request().url()).pathname);
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        message: 'backend.logout_successful',
                        endSessionUrl: `${origin}/__e2e_oidc_logout_complete__`,
                    },
                    error: null,
                }),
            });
        });
        await page.route('**/__e2e_oidc_logout_complete__', async (route) => {
            await route.fulfill({ status: 200, contentType: 'text/html', body: '<main>OIDC logout complete</main>' });
        });

        await page.goto('/settings');
        await page.getByTestId('settings-logout').click();

        await expect(page).toHaveURL(/__e2e_oidc_logout_complete__$/);
        await expect(page.getByText('OIDC logout complete')).toBeVisible();
        expect(logoutRequests).toEqual(['/api/auth/oidc/logout']);
    });
});
