import { expect, test } from '@playwright/test';
import { assertRenderedPage, createIssueMonitor, loginAsAdmin } from './helpers/site-health';
import { assertConsoleDataHygiene, assertControlContracts, CONSOLE_ROUTES, readJson, unwrapRows } from './helpers/console-contracts';

test.describe('console route coverage', () => {
    test.setTimeout(180000);

    test('renders every console route and reachable detail screen without browser or API errors', async ({ page, baseURL }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('aetherguard-live-mode', 'false');
        });
        await loginAsAdmin(page);
        const monitor = createIssueMonitor(page, baseURL!);

        const gotoAuthenticated = async (route: string) => {
            await page.goto(route);
            if (page.url().includes('/login')) {
                await loginAsAdmin(page);
                await page.goto(route);
            }
            await expect(page, `${route} should stay authenticated`).not.toHaveURL(/\/login/);
        };

        for (const route of CONSOLE_ROUTES) {
            const snapshot = monitor.snapshot();
            await gotoAuthenticated(route.path);
            await assertRenderedPage(page, route.label);
            await assertConsoleDataHygiene(page, route.label);
            await assertControlContracts(page, route.label);
            await monitor.assertNoNewIssues(snapshot, route.label);
        }

        const attackSimLink = page.locator('aside a[href="/attack-sim"]').first();
        if (await attackSimLink.count()) {
            const snapshot = monitor.snapshot();
            await gotoAuthenticated('/attack-sim');
            await assertRenderedPage(page, 'Attack Simulation');
            await assertConsoleDataHygiene(page, 'Attack Simulation');
            await assertControlContracts(page, 'Attack Simulation');
            await monitor.assertNoNewIssues(snapshot, 'Attack Simulation');
        }

        const detailSources = [
            { api: '/api/agents', label: 'Agent Detail', route: (row: any) => `/agents/${encodeURIComponent(row.agentId || row.id)}` },
            { api: '/api/devices', label: 'Device Detail', route: (row: any) => `/devices/board-status/${encodeURIComponent(row.deviceId || row.id)}` },
            { api: '/api/sites', label: 'Site Detail', route: (row: any) => `/sites/${encodeURIComponent(row.id)}` },
            { api: '/api/traffic/flows', label: 'Traffic Session Detail', route: (row: any) => `/traffic/sessions/${encodeURIComponent(row.id)}` },
            { api: '/api/scanner/tasks/history?limit=1', label: 'Scanner Run Detail', route: (row: any) => `/scanner/runs/${encodeURIComponent(row.id || row.taskId)}` },
            { api: '/api/alerts', label: 'Alert Detail', route: (row: any) => `/alerts/${encodeURIComponent(row.id)}` },
            { api: '/api/fix-history?limit=1', label: 'Fix History Detail', route: (row: any) => `/history/${encodeURIComponent(row.id)}` },
            { api: '/api/attack/history', label: 'Attack Run Detail', route: (row: any) => `/attack-sim/runs/${encodeURIComponent(row.id || row.runId || row.startTime)}` },
            { api: '/api/admin/users', label: 'Admin User Detail', route: (row: any) => `/super-admin/users/${encodeURIComponent(row.id)}` },
        ];

        for (const source of detailSources) {
            const { payload } = await readJson(page.request, source.api);
            const row = unwrapRows(payload).find((item) => item && (item.id || item.agentId || item.deviceId || item.taskId || item.runId || item.startTime));
            if (!row) continue;

            const snapshot = monitor.snapshot();
            await gotoAuthenticated(source.route(row));
            await assertRenderedPage(page, source.label);
            await assertConsoleDataHygiene(page, source.label);
            await assertControlContracts(page, source.label);
            await monitor.assertNoNewIssues(snapshot, source.label);
        }
    });
});
