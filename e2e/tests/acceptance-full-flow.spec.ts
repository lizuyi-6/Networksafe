import { expect, Locator, Page, test } from '@playwright/test';
import {
    assertRenderedPage,
    createIssueMonitor,
    ensureDemoMode,
    loginAsAdmin,
} from './helpers/site-health';
import {
    assertApiContract,
    assertConsoleDataHygiene,
    assertControlContracts,
    cleanupE2EArtifacts,
    CONSOLE_API_ENDPOINTS,
    readJson,
    unwrapRows,
} from './helpers/console-contracts';

type Monitor = ReturnType<typeof createIssueMonitor>;

const evidencePath = (name: string) => `acceptance/${name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.png`;

const settle = async (page: Page) => {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
};

const isMobileViewport = (page: Page) => {
    const viewport = page.viewportSize();
    return Boolean(viewport && viewport.width < 768);
};

const gotoProtected = async (page: Page, route: string, label: string) => {
    await page.goto(route);
    if (page.url().includes('/login')) {
        await loginAsAdmin(page);
        await page.goto(route);
    }
    await expect(page, `${label} should stay authenticated`).not.toHaveURL(/\/login/);
    await assertRenderedPage(page, label);
};

const assertVisualIntegrity = async (page: Page, label: string) => {
    await assertConsoleDataHygiene(page, label);

    const issues = await page.locator('body').evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        const visible = (element: Element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };

        const overflowers = Array.from(document.querySelectorAll('main, header, button, a, input, textarea, select, table, pre, code'))
            .filter(visible)
            .map((element) => {
                const rect = element.getBoundingClientRect();
                const tag = element.tagName.toLowerCase();
                const text = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
                const testId = element.getAttribute('data-testid') || '';
                return {
                    tag,
                    text,
                    testId,
                    rightOverflow: Math.ceil(rect.right - viewportWidth),
                    bottomOverflow: Math.ceil(rect.bottom - viewportHeight),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                };
            })
            .filter((item) => item.rightOverflow > 2)
            .filter((item) => !(item.tag === 'pre' || item.tag === 'code' || item.tag === 'table'));

        const tinyControls = Array.from(document.querySelectorAll('button, a[href], input, select, textarea'))
            .filter(visible)
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    tag: element.tagName.toLowerCase(),
                    text: (element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 80),
                    testId: element.getAttribute('data-testid') || '',
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                };
            })
            .filter((item) => item.width < 24 || item.height < 24)
            .filter((item) => !/^input$/.test(item.tag));

        return { overflowers: overflowers.slice(0, 10), tinyControls: tinyControls.slice(0, 10) };
    });

    expect(issues.overflowers, `${label} should not horizontally overflow visible viewport`).toEqual([]);
    expect(issues.tinyControls, `${label} should not expose unusably small visible controls`).toEqual([]);
};

const step = async (
    page: Page,
    monitor: Monitor,
    label: string,
    action: () => Promise<void>,
    options: { checkControls?: boolean; screenshot?: boolean; allowIssuePatterns?: RegExp[] } = {},
) => {
    const snapshot = monitor.snapshot();
    await action();
    await settle(page);
    await assertVisualIntegrity(page, label);
    if (options.checkControls) {
        await assertControlContracts(page, label);
    }
    if (options.screenshot) {
        await page.screenshot({ path: test.info().outputPath(evidencePath(label)), fullPage: true });
    }
    await monitor.assertNoNewIssues(snapshot, label, { allowPatterns: options.allowIssuePatterns });
};

const clickIfUsable = async (locator: Locator) => {
    if ((await locator.count()) === 0) return false;
    const first = locator.first();
    if (!(await first.isVisible()) || !(await first.isEnabled())) return false;
    await first.click();
    return true;
};

const expectErrorResponse = async (responsePromise: Promise<any>, statuses: number[], label: string) => {
    const response = await responsePromise;
    expect(statuses, `${label} returned status ${response.status()}`).toContain(response.status());
    const payload = await response.json().catch(() => ({}));
    expect(payload, `${label} should return an error payload`).toMatchObject({ success: false });
    return payload;
};

test.describe('AetherGuard full acceptance flows', () => {
    test.setTimeout(300000);

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('aetherguard-live-mode', 'false');
            window.prompt = () => 'acceptance review note';
        });
    });

    test.afterEach(async ({ page }) => {
        await cleanupE2EArtifacts(page.request).catch(() => undefined);
    });

    test('public, auth, shell, dashboard, and API contracts', async ({ page, baseURL }) => {
        const monitor = createIssueMonitor(page, baseURL!);

        await step(page, monitor, 'public landing language and CTA', async () => {
            await page.goto('/');
            await assertRenderedPage(page, 'Landing', '[data-testid="landing-main"]');
            await page.getByTestId('landing-lang-en').click();
            await page.getByTestId('landing-lang-zh').click();
            await page.getByTestId('landing-primary-cta').click();
        }, { screenshot: true });

        await step(page, monitor, 'public legal pages', async () => {
            for (const route of ['/privacy', '/terms']) {
                await page.goto(route);
                await assertRenderedPage(page, route);
            }
        });

        await step(page, monitor, 'login validation and protected redirect', async () => {
            await page.goto('/dashboard');
            await expect(page).toHaveURL(/\/login/);
            await page.locator('button[type="submit"]').click();
            await expect(page).toHaveURL(/\/login/);
            await page.locator('input[name="email"]').fill('invalid-admin@example.test');
            await page.locator('input[name="password"]').fill('WrongPassword!2026');
            await page.locator('button[type="submit"]').click();
            await expect(page.locator('body')).toContainText(/incorrect|invalid|credentials|密码|凭据|backend/i);
        }, {
            allowIssuePatterns: [
                /response: POST \/api\/auth\/login -> 401/,
                /console\.error: Failed to load resource: the server responded with a status of 401/,
            ],
        });

        await step(page, monitor, 'authenticated dashboard and shell controls', async () => {
            await loginAsAdmin(page);
            await cleanupE2EArtifacts(page.request);
            await gotoProtected(page, '/dashboard', 'Dashboard');
            if (!isMobileViewport(page)) {
                await page.getByTitle('Light Mode').click();
                await page.getByTitle('System').click();
                await page.getByTitle('Dark Mode').click();
                const liveToggle = page.getByTestId('live-mode-toggle');
                if ((await liveToggle.getAttribute('aria-pressed')) === 'true') {
                    await liveToggle.click();
                }
                await expect(liveToggle).toHaveAttribute('aria-pressed', 'false');
                await ensureDemoMode(page, false);
            }
            await page.getByTestId('dashboard-range-24h').click();
            await page.getByTestId('dashboard-range-1h').click();
            await page.getByTestId('dashboard-log-filter').fill('GET /api');
            await page.getByTestId('dashboard-log-pause').click();
            await page.getByTestId('dashboard-log-pause').click();
            await page.getByTestId('dashboard-export-json').click();
            await expect(page.locator('body')).toContainText(/JSON/i);
            await page.getByTestId('dashboard-export-csv').click();
            await expect(page.locator('body')).toContainText(/CSV/i);
        }, { checkControls: !isMobileViewport(page), screenshot: true });

        await step(page, monitor, 'console API envelope and leakage contracts', async () => {
            for (const endpoint of CONSOLE_API_ENDPOINTS) {
                await assertApiContract(page.request, endpoint);
            }
        });
    });

    test('agents, traffic, scanner, alerts, rules, and abnormal detail routes', async ({ page, baseURL }) => {
        const monitor = createIssueMonitor(page, baseURL!);
        await loginAsAdmin(page);
        await cleanupE2EArtifacts(page.request);

        await step(page, monitor, 'agent normal and missing detail flow', async () => {
            await gotoProtected(page, '/agents', 'Agents');
            await page.getByTestId('agents-refresh').click();
            await clickIfUsable(page.locator('[data-testid^="agent-scan-"]'));
            await clickIfUsable(page.locator('[data-testid^="agent-detail-"]'));
            if (page.url().includes('/agents/')) {
                await assertRenderedPage(page, 'Agent Detail');
            }
            await gotoProtected(page, '/agents/not-a-real-agent', 'Missing Agent Detail');
            await expect(page.locator('main')).toContainText(/not|404|missing|unavailable|未找到|不可用|FG-AGENT/i);
        }, { checkControls: !isMobileViewport(page), screenshot: true });

        await step(page, monitor, 'traffic normal and missing session flow', async () => {
            await gotoProtected(page, '/traffic', 'Traffic');
            await page.getByTestId('traffic-auto-refresh').uncheck().catch(() => undefined);
            await page.getByTestId('traffic-auto-refresh').check().catch(() => undefined);
            await page.getByTestId('traffic-refresh').click();
            await clickIfUsable(page.locator('main a[href^="/traffic/sessions/"]'));
            if (page.url().includes('/traffic/sessions/')) {
                await assertRenderedPage(page, 'Traffic Session Detail');
            }
            await gotoProtected(page, '/traffic/sessions/not-a-real-session', 'Missing Traffic Session');
            await expect(page.locator('main')).toContainText(/not|404|missing|unavailable|未找到|不可用|FG-TRAFFIC/i);
        }, { checkControls: !isMobileViewport(page), screenshot: true });

        await step(page, monitor, 'scanner normal and invalid target flow', async () => {
            await gotoProtected(page, '/scanner', 'Scanner');
            await page.getByTestId('scanner-targets').fill('http://example.com\nhttps://example.org/security');
            await page.getByTestId('scanner-include-system').uncheck();
            await page.getByTestId('scanner-include-web').check();
            await page.getByTestId('scanner-include-ports').uncheck();
            await expect(page.getByTestId('scanner-start-task')).toBeEnabled();

            await expectErrorResponse(
                page.request.post('/api/scanner/tasks', {
                    data: { targets: { urls: ['ftp://invalid.example.test', 'http://127.0.0.1/admin'] } },
                }),
                [400],
                'scanner invalid target rejection',
            );
            await expectErrorResponse(page.request.get('/api/scanner/tasks/not-a-real-task'), [404], 'scanner missing task');
        }, { checkControls: !isMobileViewport(page), screenshot: true });

        await step(page, monitor, 'alerts filters actions and missing alert flow', async () => {
            await gotoProtected(page, '/alerts', 'Alerts');
            for (const severity of ['critical', 'high', 'medium', 'low', 'all']) {
                await page.getByTestId(`alerts-severity-${severity}`).click();
            }
            for (const status of ['open', 'acknowledged', 'investigating', 'resolved', 'suppressed', 'all']) {
                await page.getByTestId(`alerts-status-${status}`).click();
            }

            const alertsPayload = await readJson(page.request, '/api/alerts');
            const alert = unwrapRows(alertsPayload.payload).find((row) => row?.id);
            if (alert?.id) {
                for (const action of ['acknowledge', 'investigate', 'resolve', 'suppress']) {
                    const response = await page.request.post(`/api/alerts/${encodeURIComponent(alert.id)}/${action}`);
                    expect(response.ok(), `alert ${action} should succeed`).toBeTruthy();
                }
                await gotoProtected(page, `/alerts/${encodeURIComponent(alert.id)}`, 'Alert Detail');
            }
            await expectErrorResponse(page.request.get('/api/alerts/not-a-real-alert'), [404], 'missing alert detail');
            await expectErrorResponse(page.request.post('/api/alerts/not-a-real-alert/acknowledge'), [404], 'missing alert action');
        }, { checkControls: !isMobileViewport(page), screenshot: true });

        await step(page, monitor, 'rules filters candidate detail and abnormal ids', async () => {
            await gotoProtected(page, '/rules', 'Rules');
            await page.getByTestId('rules-refresh').click();
            await page.getByTestId('rules-status-pending').click();
            await page.getByTestId('rules-status-all').click();
            await page.getByTestId('rules-channel-http_api').click();
            await page.getByTestId('rules-channel-all').click();
            await page.getByTestId('rules-family-filter').selectOption('all');
            await clickIfUsable(page.locator('[data-testid^="rules-candidate-"]'));
            await expectErrorResponse(page.request.get('/api/rules/candidates/not-a-real-candidate'), [404], 'missing rule candidate');
        }, { checkControls: !isMobileViewport(page), screenshot: true });
    });

    test('devices, hardware gates, deployment, settings, and admin write flows', async ({ page, baseURL }) => {
        const monitor = createIssueMonitor(page, baseURL!);
        await loginAsAdmin(page);
        await cleanupE2EArtifacts(page.request);

        await step(page, monitor, 'devices and final defense hardware gate boundaries', async () => {
            await gotoProtected(page, '/devices', 'Devices');
            await clickIfUsable(page.locator('main a[href^="/devices/board-status/"]'));
            if (page.url().includes('/devices/board-status/')) {
                await assertRenderedPage(page, 'Board Status');
            }
            await expectErrorResponse(page.request.get('/api/devices/not-a-real-device'), [404], 'missing device');
            await expectErrorResponse(
                page.request.post('/api/commands/intents', {
                    data: { scope: 'device', targetId: 'not-a-real-device', commandType: 'wipe_data', payload: {} },
                }),
                [400, 403, 503],
                'dangerous device command requires gate or valid target',
            );
            await page.request.get('/api/final-defense/status').then(async (response) => {
                expect([200, 403], `final defense status returned ${response.status()}`).toContain(response.status());
            });
        }, { checkControls: !isMobileViewport(page), screenshot: true });

        await step(page, monitor, 'deployment wizard normal and serial fallback flow', async () => {
            await gotoProtected(page, '/deploy', 'Deploy');
            await expect(page.getByTestId('deploy-next')).toBeDisabled();
            await page.getByTestId('deploy-target-nginx').click();
            await expect(page.getByTestId('deploy-next')).toBeEnabled();
            await page.getByTestId('deploy-next').click();
            await page.getByTestId('deploy-port').fill('8088');
            await page.getByTestId('deploy-server-name').fill(`acceptance-${Date.now()}.local`);
            await page.getByTestId('deploy-rate-limit').fill('25');
            await page.getByTestId('deploy-upstream').fill('http://backend:3005');
            await page.getByTestId('deploy-next').click();
            await expect(page.getByTestId('deploy-save-version')).toBeVisible({ timeout: 15000 });
            await page.getByTestId('deploy-save-version').click();
            await expect(page.getByTestId('deploy-preview-download-bundle')).not.toHaveAttribute('href', '#', { timeout: 15000 });
            await page.getByTestId('deploy-go-device-write').click();
            await expect(page.getByTestId('deploy-connect-serial')).toBeVisible();
            if (!(await page.getByTestId('deploy-connect-serial').isEnabled())) {
                await expect(page.locator('main')).toContainText(/serial|unsupported|not supported|串口|不支持/i);
            }
            await page.getByTestId('deploy-start-over').click();
            await expect(page.getByTestId('deploy-next')).toBeDisabled();
        }, { checkControls: !isMobileViewport(page), screenshot: true });

        await step(page, monitor, 'settings AI endpoint masked CRUD boundaries', async () => {
            await gotoProtected(page, '/settings', 'Settings');
            const endpointName = `e2e-acceptance-endpoint-${Date.now()}`;
            const endpointSecret = `e2e-secret-${Date.now()}-must-not-leak`;
            await page.getByTestId('ai-endpoint-add-toggle').click();
            await expect(page.getByTestId('ai-endpoint-submit')).toBeDisabled();
            await page.getByTestId('ai-endpoint-name').fill(endpointName);
            await page.getByTestId('ai-endpoint-type').selectOption('ollama');
            await page.getByTestId('ai-endpoint-purpose').selectOption('deep_analysis');
            await page.getByTestId('ai-endpoint-url').fill('http://127.0.0.1:65535/acceptance');
            await page.getByTestId('ai-endpoint-model').fill('acceptance-model');
            await page.getByTestId('ai-endpoint-api-key').fill(endpointSecret);
            await page.getByTestId('ai-endpoint-submit').click();
            const endpointRow = page.locator('[data-testid^="ai-endpoint-row-"]').filter({ hasText: endpointName }).first();
            await expect(endpointRow).toBeVisible({ timeout: 10000 });
            await expect(page.locator('body')).not.toContainText(endpointSecret);
            await endpointRow.locator('[data-testid^="ai-endpoint-test-"]').click();
            await expect(endpointRow.locator('[data-testid^="ai-endpoint-test-"]')).toBeEnabled({ timeout: 20000 });
            await endpointRow.locator('[data-testid^="ai-endpoint-toggle-"]').click();
            await endpointRow.locator('[data-testid^="ai-endpoint-delete-"]').click();
            await expect(page.locator('[data-testid^="ai-endpoint-row-"]').filter({ hasText: endpointName })).toHaveCount(0, { timeout: 10000 });
        }, {
            checkControls: !isMobileViewport(page),
            screenshot: true,
            allowIssuePatterns: [
                /response: POST \/api\/ai-endpoints\/[^/]+\/test -> 200/,
            ],
        });

        await step(page, monitor, 'admin API key announcement and onboarding writes', async () => {
            await gotoProtected(page, '/admin', 'Admin');
            await page.getByTestId('super-admin-oversight-refresh').click();
            await page.getByTestId('oversight-tab-announcements').click();
            const title = `e2e-acceptance-announcement-${Date.now()}`;
            await page.getByTestId('super-admin-announcement-title').fill(title);
            await page.getByTestId('super-admin-announcement-content').fill('Acceptance announcement body with no secrets.');
            await page.getByTestId('super-admin-announcement-type').selectOption('warning');
            await page.getByTestId('super-admin-announcement-submit').click();
            const announcementRow = page.locator('[data-testid^="super-admin-announcement-row-"]').filter({ hasText: title }).first();
            await expect(announcementRow).toBeVisible({ timeout: 10000 });
            await announcementRow.locator('[data-testid^="super-admin-announcement-edit-"]').click();
            await page.getByTestId('super-admin-announcement-content').fill('Acceptance announcement body updated.');
            await page.getByTestId('super-admin-announcement-submit').click();
            await announcementRow.locator('[data-testid^="super-admin-announcement-publish-"]').click();
            await expect(announcementRow.locator('[data-testid^="super-admin-announcement-archive-"]')).toBeVisible({ timeout: 10000 });
            await announcementRow.locator('[data-testid^="super-admin-announcement-archive-"]').click();
            await announcementRow.locator('[data-testid^="super-admin-announcement-delete-"]').click();
            await expect(page.locator('[data-testid^="super-admin-announcement-row-"]').filter({ hasText: title })).toHaveCount(0, { timeout: 10000 });

            await page.getByTestId('oversight-tab-overview').click();
            await page.getByTestId('super-admin-onboarding-hostname').fill(`acceptance-agent-${Date.now()}.local`);
            await page.getByTestId('super-admin-onboarding-ttl').fill('5');
            await page.getByTestId('super-admin-onboarding-max-uses').fill('1');
            await page.getByTestId('super-admin-generate-code').click();
            await expect(page.getByTestId('super-admin-copy-onboarding-code')).toBeVisible({ timeout: 10000 });

            const keyName = `e2e-acceptance-key-${Date.now()}`;
            await page.getByTestId('super-admin-api-key-name').fill(keyName);
            await page.getByTestId('super-admin-create-api-key').click();
            const keyRow = page.locator('[data-testid^="super-admin-api-key-row-"]').filter({ hasText: keyName }).first();
            await expect(keyRow).toBeVisible({ timeout: 10000 });
            await keyRow.locator('[data-testid^="super-admin-copy-api-key-"]').click();
            await expect(keyRow).not.toContainText(/secret|token|hash|password/i);
            await keyRow.locator('[data-testid^="super-admin-delete-api-key-"]').click();
            await expect(page.locator('[data-testid^="super-admin-api-key-row-"]').filter({ hasText: keyName })).toHaveCount(0, { timeout: 10000 });
        }, { checkControls: !isMobileViewport(page), screenshot: true });
    });
});
