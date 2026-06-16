import { expect, test } from '@playwright/test';
import { assertRenderedPage, createIssueMonitor, ensureDemoMode, loginAsAdmin } from './helpers/site-health';
import { assertConsoleDataHygiene, cleanupE2EArtifacts } from './helpers/console-contracts';

test.describe('cognition topology interactions', () => {
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

    test('clicking a layer opens its audit trail, and a role node switches it', async ({ page, baseURL }) => {
        const monitor = createIssueMonitor(page, baseURL!);

        await page.goto('/cognition');
        await assertRenderedPage(page, 'Cognition');

        // The page always renders 7 layer cards (backend data or static fallback).
        const layer1 = page.getByTestId('cognition-layer-1');
        await expect(layer1).toBeVisible();
        await expect(page.getByTestId('cognition-layer-7')).toBeVisible();

        // Audit rail is present but in its empty state until a node is selected.
        await expect(page.getByTestId('cognition-audit-rail')).toBeVisible();
        await expect(page.getByText(/Select a layer or agent node/i)).toBeVisible();

        // Click a layer -> audit rail shows layer config + telemetry.
        let snapshot = monitor.snapshot();
        await layer1.click();
        await expect(page.getByText('Layer Config')).toBeVisible();
        await monitor.assertNoNewIssues(snapshot, 'layer select');

        // Click a role node -> audit rail switches to the role view.
        snapshot = monitor.snapshot();
        const socrates = page.getByTestId('cognition-role-socrates');
        if (await socrates.count()) {
            await socrates.click();
            await expect(page.getByText('Capabilities')).toBeVisible();
        }
        await monitor.assertNoNewIssues(snapshot, 'role select');

        await assertConsoleDataHygiene(page, 'Cognition interactions');
    });
});
