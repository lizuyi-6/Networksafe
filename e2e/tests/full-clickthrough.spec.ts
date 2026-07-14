import { expect, Locator, Page, test } from '@playwright/test';
import { assertRenderedPage, createIssueMonitor, ensureDemoMode, loginAsAdmin } from './helpers/site-health';
import { assertConsoleDataHygiene, assertControlContracts, cleanupE2EArtifacts, readJson, unwrapRows } from './helpers/console-contracts';

type IssueMonitor = ReturnType<typeof createIssueMonitor>;

const settle = async (page: Page) => {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
};

const gotoAuthenticated = async (page: Page, route: string, label: string) => {
    await page.goto(route);
    if (page.url().includes('/login')) {
        await loginAsAdmin(page);
        await page.goto(route);
    }

    await expect(page, `${label} should remain authenticated`).not.toHaveURL(/\/login/);
    await assertRenderedPage(page, label);
    await assertConsoleDataHygiene(page, label);
};

const monitoredStep = async (
    page: Page,
    monitor: IssueMonitor,
    label: string,
    action: () => Promise<void>,
    checkControls = false,
    allowPatterns: RegExp[] = [],
) => {
    const snapshot = monitor.snapshot();
    await action();
    await settle(page);
    await assertConsoleDataHygiene(page, label);
    if (checkControls) {
        await assertControlContracts(page, label);
    }
    await monitor.assertNoNewIssues(snapshot, label, { allowPatterns });
};

const clickIfUsable = async (locator: Locator) => {
    const count = await locator.count();
    if (count === 0) return false;

    const target = locator.first();
    if (!(await target.isVisible()) || !(await target.isEnabled())) return false;
    await target.click();
    return true;
};

const isAttackSimulatorAvailable = async (page: Page) => {
    const { payload } = await readJson(page.request, '/api/system/mode');
    const mode = (payload as any)?.data ?? payload;
    expect(typeof mode?.attackSimEnabled, 'system mode should expose the attack simulator capability').toBe('boolean');
    return mode.attackSimEnabled === true;
};

const openFirstDetailLink = async (page: Page, locator: Locator, expectedUrl: RegExp, label: string) => {
    if (!(await clickIfUsable(locator))) return false;

    await page.waitForURL(expectedUrl, { timeout: 15000 });
    await assertRenderedPage(page, label);
    await assertConsoleDataHygiene(page, label);
    return true;
};

test.describe('full clickthrough巡检', () => {
    test.setTimeout(300000);

    test('covers public entry points and client-side login validation', async ({ page, baseURL }) => {
        const monitor = createIssueMonitor(page, baseURL!);

        await monitoredStep(page, monitor, 'landing', async () => {
            await page.goto('/');
            await assertRenderedPage(page, 'landing', '[data-testid="landing-main"]');
            await page.getByTestId('landing-lang-en').click();
            await page.getByTestId('landing-lang-zh').click();
            await page.getByTestId('landing-primary-cta').click();
            await expect(page.getByTestId('landing-product-surfaces')).toBeVisible();
        });

        await monitoredStep(page, monitor, 'login validation', async () => {
            await page.goto('/login');
            await expect(page.locator('input[name="email"]')).toBeVisible();
            await expect(page.locator('input[name="password"]')).toBeVisible();
            await page.locator('button[type="submit"]').click();
            await expect(page).toHaveURL(/\/login/);
        });
    });

    test.describe('authenticated console', () => {
        test.beforeEach(async ({ page }) => {
            await page.addInitScript(() => {
                window.localStorage.setItem('aetherguard-live-mode', 'false');
                window.prompt = () => 'e2e full-clickthrough review note';
            });
            await loginAsAdmin(page);
            await cleanupE2EArtifacts(page.request);
            await ensureDemoMode(page, false);
        });

        test.afterEach(async ({ page }) => {
            await cleanupE2EArtifacts(page.request);
        });

        test('covers shell toggles, dashboards, list pages, and reachable detail links', async ({ page, baseURL }) => {
            const monitor = createIssueMonitor(page, baseURL!);

            await monitoredStep(page, monitor, 'shell toggles', async () => {
                await page.getByTitle('Light Mode').click();
                await page.getByTitle('System').click();
                await page.getByTitle('Dark Mode').click();

                const liveToggle = page.getByTestId('live-mode-toggle');
                const initialLive = await liveToggle.getAttribute('aria-pressed');
                await liveToggle.click();
                await expect(liveToggle).toHaveAttribute('aria-pressed', initialLive === 'true' ? 'false' : 'true');
                await liveToggle.click();
                await expect(liveToggle).toHaveAttribute('aria-pressed', initialLive || 'false');

                await ensureDemoMode(page, true);
                const attackSimLink = page.locator('aside a[href="/attack-sim"]').first();
                if (await isAttackSimulatorAvailable(page)) {
                    await expect(attackSimLink).toBeVisible();
                } else {
                    await expect(attackSimLink).toHaveCount(0);
                }
                await ensureDemoMode(page, false);
            });

            await monitoredStep(page, monitor, 'dashboard controls', async () => {
                await gotoAuthenticated(page, '/dashboard', 'Dashboard');
                await page.getByTestId('dashboard-range-24h').click();
                await page.getByTestId('dashboard-range-1h').click();
                await page.getByTestId('dashboard-log-filter').fill('GET');
                await page.getByTestId('dashboard-log-pause').click();
                await page.getByTestId('dashboard-log-pause').click();
                await page.getByTestId('dashboard-export-json').click();
                await expect(page.locator('body')).toContainText(/JSON/i);
                await page.getByTestId('dashboard-export-csv').click();
                await expect(page.locator('body')).toContainText(/CSV/i);
            }, true);

            await monitoredStep(page, monitor, 'agents controls and detail', async () => {
                await gotoAuthenticated(page, '/agents', 'Agents');
                await page.getByTestId('agents-refresh').click();
                await clickIfUsable(page.locator('[data-testid^="agent-scan-"]'));
                await openFirstDetailLink(page, page.locator('[data-testid^="agent-detail-"]'), /\/agents\/[^/]+$/, 'Agent Detail');
            }, true);

            await monitoredStep(page, monitor, 'agent monitor controls', async () => {
                await gotoAuthenticated(page, '/agent-monitor', 'Agent Monitor');
                await page.getByTestId('agent-monitor-auto-refresh').uncheck();
                await page.getByTestId('agent-monitor-auto-refresh').check();
                await page.getByTestId('agent-monitor-refresh').click();
            }, true);

            await monitoredStep(page, monitor, 'traffic controls and detail', async () => {
                await gotoAuthenticated(page, '/traffic', 'Traffic');
                await page.getByTestId('traffic-auto-refresh').uncheck();
                await page.getByTestId('traffic-auto-refresh').check();
                await page.getByTestId('traffic-refresh').click();
                await openFirstDetailLink(page, page.locator('main a[href^="/traffic/sessions/"]'), /\/traffic\/sessions\/[^/]+$/, 'Traffic Session Detail');
            }, true);

            await monitoredStep(page, monitor, 'site and device details', async () => {
                await gotoAuthenticated(page, '/sites', 'Sites');
                await openFirstDetailLink(page, page.locator('main a[href^="/sites/"]'), /\/sites\/[^/]+$/, 'Site Detail');
                await gotoAuthenticated(page, '/devices', 'Devices');
                await openFirstDetailLink(page, page.locator('main a[href^="/devices/board-status/"]'), /\/devices\/board-status\/[^/]+$/, 'Board Status Detail');
            }, true);

            await monitoredStep(page, monitor, 'alerts and history details', async () => {
                await gotoAuthenticated(page, '/alerts', 'Alerts');
                await page.getByTestId('alerts-severity-critical').click();
                await page.getByTestId('alerts-severity-all').click();
                await page.getByTestId('alerts-status-open').click();
                await page.getByTestId('alerts-status-all').click();
                await openFirstDetailLink(page, page.locator('[data-testid^="alert-detail-"]'), /\/alerts\/[^/]+$/, 'Alert Detail');

                await gotoAuthenticated(page, '/history', 'History');
                await openFirstDetailLink(page, page.locator('main a[href^="/history/"]'), /\/history\/[^/]+$/, 'Fix History Detail');
            }, true);
        });

        test('covers settings, admin writes, deployment generation, and hardware gate fallback', async ({ page, baseURL }) => {
            const monitor = createIssueMonitor(page, baseURL!);
            const { payload: platformConfigPayload } = await readJson(page.request, '/api/config');
            const basePlatformConfig: any = (platformConfigPayload as any)?.data ?? platformConfigPayload;
            const deploymentFriendlyConfig = {
                ...basePlatformConfig,
                detectionPipeline: {
                    ...basePlatformConfig.detectionPipeline,
                    ruleFirstEnabled: false,
                },
            };
            const restoredPlatformConfig = {
                ...basePlatformConfig,
                detectionPipeline: {
                    ...basePlatformConfig.detectionPipeline,
                    ruleFirstEnabled: true,
                },
            };

            try {
            await monitoredStep(page, monitor, 'settings AI endpoint controls', async () => {
                await gotoAuthenticated(page, '/settings', 'Settings');

                const enableDeploymentSave = await page.request.post('/api/config', { data: deploymentFriendlyConfig });
                expect(enableDeploymentSave.ok()).toBe(true);

                    const verifySnapshot = monitor.snapshot();
                    await page.getByTestId('ai-platform-verify').click();
                    await expect(page.locator('main')).toContainText(/401|503|AETHERGUARD_REMOTE_AI_OK/i, { timeout: 20000 });
                    await monitor.assertNoNewIssues(verifySnapshot, 'AI platform verify', {
                        allowPatterns: [
                            /response: POST \/api\/ai-endpoints\/chat -> (401|503)/,
                        /console\.error: Failed to load resource: the server responded with a status of (401|503) \(Unauthorized|Bad Gateway|Service Unavailable\)/,
                    ],
                });

                const endpointName = `e2e-full-endpoint-${Date.now()}`;
                await page.getByTestId('ai-endpoint-add-toggle').click();
                await expect(page.getByTestId('ai-endpoint-submit')).toBeDisabled();
                await page.getByTestId('ai-endpoint-name').fill(endpointName);
                await page.getByTestId('ai-endpoint-type').selectOption('ollama');
                await page.getByTestId('ai-endpoint-purpose').selectOption('deep_analysis');
                await page.getByTestId('ai-endpoint-url').fill('http://127.0.0.1:5173/does-not-exist');
                await page.getByTestId('ai-endpoint-model').fill('e2e-model');
                await page.getByTestId('ai-endpoint-api-key').fill('e2e-secret-redaction-check');
                await page.getByTestId('ai-endpoint-submit').click();

                const endpointRow = page.locator('[data-testid^="ai-endpoint-row-"]').filter({ hasText: endpointName }).first();
                await expect(endpointRow).toBeVisible({ timeout: 10000 });
                await endpointRow.locator('[data-testid^="ai-endpoint-test-"]').click();
                await expect(endpointRow.locator('[data-testid^="ai-endpoint-test-"]')).toBeEnabled({ timeout: 20000 });
                await endpointRow.locator('[data-testid^="ai-endpoint-toggle-"]').click();
                await expect(page.locator('[data-testid^="ai-endpoint-row-"]').filter({ hasText: endpointName }).first()).toBeVisible({ timeout: 10000 });
                await page.locator('[data-testid^="ai-endpoint-row-"]').filter({ hasText: endpointName }).first().locator('[data-testid^="ai-endpoint-delete-"]').click();
                await expect(page.locator('[data-testid^="ai-endpoint-row-"]').filter({ hasText: endpointName })).toHaveCount(0, { timeout: 10000 });
            }, true, [
                /response: POST \/api\/ai-endpoints\/chat -> (401|503)/,
                /console\.error: Failed to load resource: the server responded with a status of (401|503) \(Unauthorized|Bad Gateway|Service Unavailable\)/,
            ]);

            await monitoredStep(page, monitor, 'admin oversight and cleanable writes', async () => {
                await gotoAuthenticated(page, '/admin', 'Admin');
                await page.getByTestId('super-admin-oversight-refresh').click();
                await page.getByTestId('oversight-tab-timeline').click();
                await settle(page);
                await page.getByTestId('oversight-tab-overview').click();
                await settle(page);
                await page.getByTestId('oversight-tab-announcements').click();
                const announcementTitle = `e2e-full-announcement-${Date.now()}`;
                await page.getByTestId('super-admin-announcement-title').fill(announcementTitle);
                await page.getByTestId('super-admin-announcement-content').fill('e2e full clickthrough announcement body');
                await page.getByTestId('super-admin-announcement-type').selectOption('warning');
                await page.getByTestId('super-admin-announcement-submit').click();
                const announcementRow = page.locator('[data-testid^="super-admin-announcement-row-"]').filter({ hasText: announcementTitle }).first();
                await expect(announcementRow).toBeVisible({ timeout: 10000 });
                await announcementRow.locator('[data-testid^="super-admin-announcement-edit-"]').click();
                await page.getByTestId('super-admin-announcement-content').fill('e2e full clickthrough announcement body updated');
                await page.getByTestId('super-admin-announcement-submit').click();
                await expect(announcementRow).toBeVisible({ timeout: 10000 });
                await announcementRow.locator('[data-testid^="super-admin-announcement-publish-"]').click();
                await expect(announcementRow.locator('[data-testid^="super-admin-announcement-archive-"]')).toBeVisible({ timeout: 10000 });
                await announcementRow.locator('[data-testid^="super-admin-announcement-archive-"]').click();
                await expect(announcementRow).toBeVisible({ timeout: 10000 });
                await announcementRow.locator('[data-testid^="super-admin-announcement-delete-"]').click();
                await expect(page.locator('[data-testid^="super-admin-announcement-row-"]').filter({ hasText: announcementTitle })).toHaveCount(0, { timeout: 10000 });

                await page.getByTestId('oversight-tab-overview').click();
                await page.getByTestId('super-admin-onboarding-hostname').fill(`e2e-agent-${Date.now()}.local`);
                await page.getByTestId('super-admin-onboarding-ttl').fill('5');
                await page.getByTestId('super-admin-onboarding-max-uses').fill('1');
                await page.getByTestId('super-admin-generate-code').click();
                await expect(page.getByTestId('super-admin-copy-onboarding-code')).toBeVisible({ timeout: 10000 });

                const keyName = `e2e-full-key-${Date.now()}`;
                await page.getByTestId('super-admin-api-key-name').fill(keyName);
                await page.getByTestId('super-admin-create-api-key').click();
                await expect(page.getByTestId('super-admin-created-api-key')).toBeVisible({ timeout: 10000 });
                await page.getByTestId('super-admin-copy-created-api-key').click();
                await page.getByTestId('super-admin-dismiss-created-api-key').click();
                await expect(page.getByTestId('super-admin-created-api-key')).toHaveCount(0);
                const keyRow = page.locator('[data-testid^="super-admin-api-key-row-"]').filter({ hasText: keyName }).first();
                await expect(keyRow).toBeVisible({ timeout: 10000 });
                await keyRow.locator('[data-testid^="super-admin-delete-api-key-"]').click();
                await expect(page.locator('[data-testid^="super-admin-api-key-row-"]').filter({ hasText: keyName })).toHaveCount(0, { timeout: 10000 });
            }, true);

            await monitoredStep(page, monitor, 'deployment wizard and hardware gate fallback', async () => {
                await gotoAuthenticated(page, '/deploy', 'Deploy');
                await expect(page.getByTestId('deploy-next')).toBeDisabled();
                await page.getByTestId('deploy-target-nginx').click();
                await expect(page.getByTestId('deploy-next')).toBeEnabled();
                await page.getByTestId('deploy-next').click();
                await page.getByTestId('deploy-port').fill('8088');
                await page.getByTestId('deploy-server-name').fill(`e2e-${Date.now()}.local`);
                await page.getByTestId('deploy-rate-limit').fill('25');
                await page.getByTestId('deploy-upstream').fill('http://backend:3005');
                await page.getByTestId('deploy-next').click();
                await expect(page.getByTestId('deploy-save-version')).toBeVisible({ timeout: 10000 });
                await page.getByTestId('deploy-save-version').click();
                await expect(page.getByTestId('deploy-preview-download-bundle')).not.toHaveAttribute('href', '#', { timeout: 10000 });

                const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
                await page.getByTestId('deploy-preview-download-bundle').click();
                await downloadPromise;

                await page.getByTestId('deploy-start-over').click();
                await expect(page.getByTestId('deploy-next')).toBeDisabled();
            }, true);
            } finally {
                const restoreDeploymentBlocking = await page.request.post('/api/config', { data: restoredPlatformConfig });
                expect(restoreDeploymentBlocking.ok()).toBe(true);
            }
        });

        test('covers scanner, rule review surfaces, alert actions, and attack simulator controls', async ({ page, baseURL }) => {
            const monitor = createIssueMonitor(page, baseURL!);

            await monitoredStep(page, monitor, 'scanner controls and selections', async () => {
                await gotoAuthenticated(page, '/scanner', 'Scanner');
                await page.getByTestId('scanner-targets').fill('http://127.0.0.1:8080/e2e-full-clickthrough');
                await page.getByTestId('scanner-include-local-host').check();
                await page.getByTestId('scanner-include-system').uncheck();
                await page.getByTestId('scanner-include-web').check();
                await page.getByTestId('scanner-include-ports').uncheck();
                await expect(page.getByTestId('scanner-start-task')).toBeEnabled();
                await clickIfUsable(page.locator('[data-testid^="scanner-history-"]'));
                await clickIfUsable(page.locator('[data-testid^="scanner-asset-"]'));
                await clickIfUsable(page.locator('[data-testid^="scanner-finding-"]'));
                await clickIfUsable(page.getByTestId('scanner-create-action'));
            }, true);

            await monitoredStep(page, monitor, 'rules filters and candidate detail', async () => {
                await gotoAuthenticated(page, '/rules', 'Rules');
                await page.getByTestId('rules-refresh').click();
                await page.getByTestId('rules-status-pending').click();
                await page.getByTestId('rules-status-all').click();
                await page.getByTestId('rules-channel-http_api').click();
                await page.getByTestId('rules-channel-all').click();
                await page.getByTestId('rules-family-filter').selectOption('all');
                await clickIfUsable(page.locator('[data-testid^="rules-candidate-"]'));

                const candidatePayload = await readJson(page.request, '/api/rules/candidates');
                const pendingCandidate = unwrapRows(candidatePayload.payload).find((candidate) => candidate?.status === 'pending');
                if (pendingCandidate?.candidateId) {
                    const detail = await readJson(page.request, `/api/rules/candidates/${encodeURIComponent(pendingCandidate.candidateId)}`);
                    expect(detail.response.ok()).toBeTruthy();
                }
            }, true);

            await monitoredStep(page, monitor, 'alert filters and safe action surfaces', async () => {
                await gotoAuthenticated(page, '/alerts', 'Alerts');
                for (const severity of ['critical', 'high', 'medium', 'low', 'all']) {
                    await page.getByTestId(`alerts-severity-${severity}`).click();
                }
                for (const status of ['open', 'acknowledged', 'investigating', 'resolved', 'suppressed', 'all']) {
                    await page.getByTestId(`alerts-status-${status}`).click();
                }

                const actionButton = page.locator('[data-testid^="alert-acknowledge-"]').first();
                if (await actionButton.count()) {
                    await expect(actionButton).toBeVisible();
                    await expect(page.locator('[data-testid^="alert-investigate-"]').first()).toBeVisible();
                    await expect(page.locator('[data-testid^="alert-resolve-"]').first()).toBeVisible();
                    await expect(page.locator('[data-testid^="alert-suppress-"]').first()).toBeVisible();
                }
            }, true);

            await monitoredStep(page, monitor, 'attack simulator controls and detail history', async () => {
                await ensureDemoMode(page, true);
                if (!(await isAttackSimulatorAvailable(page))) {
                    await expect(page.locator('aside a[href="/attack-sim"]')).toHaveCount(0);
                    await page.goto('/attack-sim');
                    await page.waitForURL(/\/dashboard$/, { timeout: 15000 });
                    await assertRenderedPage(page, 'Attack Simulator disabled route');
                    await ensureDemoMode(page, false);
                    return;
                }

                await page.goto('/attack-sim');
                await expect(page.getByTestId('attack-select-all')).toBeVisible({ timeout: 20000 });
                await page.waitForTimeout(1000);
                await assertConsoleDataHygiene(page, 'Attack Simulator');
                await clickIfUsable(page.getByTestId('attack-category-sql_injection'));
                await clickIfUsable(page.getByTestId('attack-category-sql_injection'));
                await clickIfUsable(page.locator('[data-testid^="attack-toggle-"]').first());
                await page.getByTestId('attack-run-simulation').click();
                await expect(page.getByTestId('attack-run-simulation')).toBeEnabled({ timeout: 30000 });
                await openFirstDetailLink(page, page.locator('[data-testid^="attack-run-detail-"]'), /\/attack-sim\/runs\/[^/]+$/, 'Attack Run Detail');
                await ensureDemoMode(page, false);
            }, true);
        });
    });
});
