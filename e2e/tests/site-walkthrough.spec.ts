import { expect, test } from '@playwright/test';
import {
    assertNoDemoAuxiliaryCopy,
    assertFooterLegalLinks,
    assertRenderedPage,
    createIssueMonitor,
    ensureDemoMode,
    loginAsAdmin,
    openFirstBoardStatusPage,
    visitPublicPage,
    visitSidebarPage,
} from './helpers/site-health';
import { DEFAULT_PUBLIC_ROUTE_CONTRACT } from '../../frontend/src/config/public-route-contract';
import { PITCH_PUBLIC_ROUTE_CONTRACT } from '../../frontend/src/config/public-route-contract';

test.describe('Site walkthrough', () => {
    test('pitch-disabled build keeps every feature-flagged route out of production', async ({ page }) => {
        test.skip(process.env.E2E_EXPECT_PITCH_ROUTES_DISABLED !== 'true', 'Requires the default frontend build');
        await loginAsAdmin(page);

        for (const routeContract of PITCH_PUBLIC_ROUTE_CONTRACT) {
            await page.goto(routeContract.path);
            await expect(page).toHaveURL(/\/dashboard$/);
            await expect(page.getByTestId('dashboard-page')).toBeVisible();
            await expect(page.getByTestId(routeContract.landmarkTestId)).toHaveCount(0);
        }
    });

    test('pitch-enabled build walks every feature-flagged public route landmark', async ({ page }) => {
        test.skip(process.env.E2E_EXPECT_PITCH_ROUTES !== 'true', 'Requires a pitch-enabled frontend build');

        for (const routeContract of PITCH_PUBLIC_ROUTE_CONTRACT) {
            await page.goto(routeContract.path);
            if (routeContract.redirectsTo) {
                await expect(page).toHaveURL(new RegExp(`${routeContract.redirectsTo}$`));
            } else {
                await expect(page).toHaveURL(new RegExp(`${routeContract.path}$`));
            }
            await expect(page.getByTestId(routeContract.landmarkTestId)).toBeVisible();

            const horizontalOverflow = await page.evaluate(() => Math.ceil(
                document.documentElement.scrollWidth - document.documentElement.clientWidth,
            ));
            expect(horizontalOverflow, `${routeContract.path} should not overflow horizontally`).toBeLessThanOrEqual(2);
        }
    });

    test('browses public pages, protected pages, and demo pages without display issues', async ({ page, baseURL }) => {
        test.setTimeout(240000);
        const resolvedBaseUrl = baseURL || 'http://127.0.0.1:8080';
        const monitor = createIssueMonitor(page, resolvedBaseUrl);

        for (const publicPage of DEFAULT_PUBLIC_ROUTE_CONTRACT) {
            const snapshot = monitor.snapshot();
            await visitPublicPage(
                page,
                publicPage.path,
                `[data-testid="${publicPage.landmarkTestId}"]`,
            );
            if (publicPage.path === '/') {
                await assertFooterLegalLinks(page);
            }
            await monitor.assertNoNewIssues(snapshot, publicPage.path);
        }

        {
            const snapshot = monitor.snapshot();
            await loginAsAdmin(page);
            await monitor.assertNoNewIssues(snapshot, 'login');
        }
        await ensureDemoMode(page, false);
        await assertRenderedPage(page, '/dashboard');

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
