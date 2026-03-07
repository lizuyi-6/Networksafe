import { test } from '@playwright/test';
import {
    assertNoDemoAuxiliaryCopy,
    assertRenderedPage,
    createIssueMonitor,
    ensureDemoMode,
    loginAsAdmin,
    openFirstBoardStatusPage,
    visitPublicPage,
    visitSidebarPage,
} from './helpers/site-health';

test.describe('Site walkthrough', () => {
    test('browses public pages, protected pages, and demo pages without display issues', async ({ page, baseURL }) => {
        test.setTimeout(240000);

        const publicPages = [
            { route: '/', selector: 'body' },
            { route: '/login', selector: 'form' },
            { route: '/privacy', selector: 'body' },
        ];

        for (const publicPage of publicPages) {
            await visitPublicPage(page, publicPage.route, publicPage.selector);
        }

        await loginAsAdmin(page);
        await ensureDemoMode(page, false);
        await assertRenderedPage(page, '/dashboard');

        const resolvedBaseUrl = baseURL || 'http://127.0.0.1:8080';
        const monitor = createIssueMonitor(page, resolvedBaseUrl);

        const protectedRoutes = [
            { route: '/dashboard', label: 'dashboard' },
            { route: '/agents', label: 'agents' },
            { route: '/agent-monitor', label: 'agent-monitor' },
            { route: '/traffic', label: 'traffic' },
            { route: '/devices', label: 'devices' },
            { route: '/sites', label: 'sites' },
            { route: '/deploy', label: 'deploy' },
            { route: '/scanner', label: 'scanner' },
            { route: '/settings', label: 'settings' },
            { route: '/alerts', label: 'alerts' },
            { route: '/admin', label: 'admin' },
            { route: '/super-admin', label: 'super-admin' },
            { route: '/history', label: 'history' },
        ];

        for (const route of protectedRoutes) {
            const snapshot = monitor.snapshot();
            await visitSidebarPage(page, route.route, route.label);
            await monitor.assertNoNewIssues(snapshot, route.label);
        }

        {
            const snapshot = monitor.snapshot();
            await openFirstBoardStatusPage(page, 'board-status', false);
            await monitor.assertNoNewIssues(snapshot, 'board-status');
        }

        {
            const snapshot = monitor.snapshot();
            await ensureDemoMode(page, true);
            await assertNoDemoAuxiliaryCopy(page);
            await monitor.assertNoNewIssues(snapshot, 'toggle-demo');
        }

        const demoRoutes = [
            { route: '/dashboard', label: 'demo-dashboard' },
            { route: '/agents', label: 'demo-agents' },
            { route: '/agent-monitor', label: 'demo-agent-monitor' },
            { route: '/traffic', label: 'demo-traffic' },
            { route: '/devices', label: 'demo-devices' },
            { route: '/sites', label: 'demo-sites' },
            { route: '/scanner', label: 'demo-scanner' },
            { route: '/alerts', label: 'demo-alerts' },
            { route: '/admin', label: 'demo-admin' },
            { route: '/super-admin', label: 'demo-super-admin' },
        ];

        for (const route of demoRoutes) {
            const snapshot = monitor.snapshot();
            await visitSidebarPage(page, route.route, route.label);
            await assertNoDemoAuxiliaryCopy(page);
            await monitor.assertNoNewIssues(snapshot, route.label);
        }

        {
            const attackSimLink = page.locator('aside a[href="/attack-sim"]').first();
            if (await attackSimLink.count()) {
                const snapshot = monitor.snapshot();
                await attackSimLink.click();
                await page.waitForURL(/\/attack-sim$/, { timeout: 15000 });
                await assertRenderedPage(page, 'demo-attack-sim');
                await assertNoDemoAuxiliaryCopy(page);
                await monitor.assertNoNewIssues(snapshot, 'demo-attack-sim');
            }
        }

        {
            const snapshot = monitor.snapshot();
            await openFirstBoardStatusPage(page, 'demo-board-status');
            await assertNoDemoAuxiliaryCopy(page);
            await monitor.assertNoNewIssues(snapshot, 'demo-board-status');
        }

        await ensureDemoMode(page, false);
    });
});
