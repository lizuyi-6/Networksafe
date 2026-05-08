import { expect, test } from '@playwright/test';
import { assertRenderedPage, createIssueMonitor, ensureDemoMode, loginAsAdmin } from './helpers/site-health';
import { assertConsoleDataHygiene, cleanupE2EArtifacts } from './helpers/console-contracts';

test.describe('console control coverage', () => {
    test.setTimeout(120000);

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('aetherguard-live-mode', 'false');
        });
        await loginAsAdmin(page);
        await cleanupE2EArtifacts(page.request);
        await ensureDemoMode(page, false);
    });

    test.afterEach(async ({ page }) => {
        await cleanupE2EArtifacts(page.request);
    });

    test('exercises navigation, filters, refreshes, exports, and safe write controls', async ({ page, baseURL }) => {
        const monitor = createIssueMonitor(page, baseURL!);

        let snapshot = monitor.snapshot();
        await page.getByTitle('Light Mode').click();
        await page.getByTitle('System').click();
        await page.getByTitle('Dark Mode').click();
        if ((await page.getByTestId('live-mode-toggle').getAttribute('aria-pressed')) === 'true') {
            await page.getByTestId('live-mode-toggle').click();
        }
        await expect(page.getByTestId('live-mode-toggle')).toHaveAttribute('aria-pressed', 'false');
        await monitor.assertNoNewIssues(snapshot, 'header toggles');

        snapshot = monitor.snapshot();
        await expect(page.getByTestId('demo-mode-toggle')).toBeVisible();
        await expect(page.getByTestId('demo-mode-toggle')).toHaveAttribute('aria-pressed', 'false');
        await ensureDemoMode(page, false);
        await monitor.assertNoNewIssues(snapshot, 'demo toggle');

        snapshot = monitor.snapshot();
        await page.goto('/dashboard');
        await assertRenderedPage(page, 'Dashboard');
        await page.getByTestId('dashboard-range-24h').click();
        await page.getByTestId('dashboard-range-1h').click();
        await page.getByTestId('dashboard-log-filter').fill('GET');
        await page.getByTestId('dashboard-log-pause').click();
        await page.getByTestId('dashboard-log-pause').click();
        await page.getByTestId('dashboard-export-json').click();
        await expect(page.locator('body')).toContainText(/JSON/i);
        await page.getByTestId('dashboard-export-csv').click();
        await expect(page.locator('body')).toContainText(/CSV/i);
        await assertConsoleDataHygiene(page, 'Dashboard controls');
        await monitor.assertNoNewIssues(snapshot, 'dashboard controls');

        snapshot = monitor.snapshot();
        await page.goto('/agents');
        await assertRenderedPage(page, 'Agents');
        await page.getByTestId('agents-refresh').click();
        const firstScan = page.locator('[data-testid^="agent-scan-"]').first();
        if (await firstScan.count()) {
            await expect(firstScan).toBeVisible();
        }
        await assertConsoleDataHygiene(page, 'Agents controls');
        await monitor.assertNoNewIssues(snapshot, 'agents controls');

        snapshot = monitor.snapshot();
        await page.goto('/agent-monitor');
        await assertRenderedPage(page, 'Agent Monitor');
        await page.getByTestId('agent-monitor-auto-refresh').uncheck();
        await page.getByTestId('agent-monitor-auto-refresh').check();
        await page.getByTestId('agent-monitor-refresh').click();
        await assertConsoleDataHygiene(page, 'Agent Monitor controls');
        await monitor.assertNoNewIssues(snapshot, 'agent monitor controls');

        snapshot = monitor.snapshot();
        await page.goto('/traffic');
        await assertRenderedPage(page, 'Traffic');
        await page.getByTestId('traffic-auto-refresh').uncheck();
        await page.getByTestId('traffic-auto-refresh').check();
        await page.getByTestId('traffic-refresh').click();
        await assertConsoleDataHygiene(page, 'Traffic controls');
        await monitor.assertNoNewIssues(snapshot, 'traffic controls');

        snapshot = monitor.snapshot();
        await page.goto('/scanner');
        await assertRenderedPage(page, 'Scanner');
        await page.getByTestId('scanner-targets').fill('http://127.0.0.1:8080/e2e-console-control');
        await page.getByTestId('scanner-include-system').uncheck();
        await page.getByTestId('scanner-include-web').check();
        await page.getByTestId('scanner-include-ports').uncheck();
        await expect(page.getByTestId('scanner-start-task')).toBeEnabled();
        await assertConsoleDataHygiene(page, 'Scanner controls');
        await monitor.assertNoNewIssues(snapshot, 'scanner controls');

        snapshot = monitor.snapshot();
        await page.goto('/settings');
        await assertRenderedPage(page, 'Settings');
        const endpointName = `e2e-ui-endpoint-${Date.now()}`;
        await page.getByTestId('ai-endpoint-add-toggle').click();
        await page.getByTestId('ai-endpoint-name').fill(endpointName);
        await page.getByTestId('ai-endpoint-type').selectOption('ollama');
        await page.getByTestId('ai-endpoint-purpose').selectOption('deep_analysis');
        await page.getByTestId('ai-endpoint-url').fill('http://127.0.0.1:65535/e2e');
        await page.getByTestId('ai-endpoint-model').fill('e2e-model');
        await page.getByTestId('ai-endpoint-api-key').fill('e2e-secret-redaction-check');
        await page.getByTestId('ai-endpoint-submit').click();
        await expect(page.locator('[data-testid^="ai-endpoint-row-"]').filter({ hasText: endpointName }).first()).toBeVisible({ timeout: 10000 });
        await page.getByTestId('platform-settings-save').click();
        await assertConsoleDataHygiene(page, 'Settings controls');
        await monitor.assertNoNewIssues(snapshot, 'settings controls');

        snapshot = monitor.snapshot();
        await page.goto('/admin');
        await assertRenderedPage(page, 'Admin');
        const keyName = `e2e-ui-key-${Date.now()}`;
        await page.getByTestId('super-admin-api-key-name').fill(keyName);
        await page.getByTestId('super-admin-create-api-key').click();
        const keyRow = page.locator('[data-testid^="super-admin-api-key-row-"]').filter({ hasText: keyName }).first();
        await expect(keyRow).toBeVisible({ timeout: 10000 });
        await keyRow.locator('[data-testid^="super-admin-delete-api-key-"]').click();
        await expect(keyRow).toHaveCount(0, { timeout: 10000 });
        await assertConsoleDataHygiene(page, 'Admin controls');
        await monitor.assertNoNewIssues(snapshot, 'admin controls');
    });
});
