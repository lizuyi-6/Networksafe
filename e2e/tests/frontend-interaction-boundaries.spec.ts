import { expect, Locator, Page, test } from '@playwright/test';
import { assertRenderedPage, loginAsAdmin } from './helpers/site-health';
import { DEFAULT_PUBLIC_ROUTE_CONTRACT } from '../../frontend/src/config/public-route-contract';

const expectMinimumTarget = async (locator: Locator, label: string) => {
    await expect(locator, `${label} should be visible`).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `${label} should have a measurable box`).not.toBeNull();
    if (!box) return;

    expect(box.width, `${label} width should be at least 24px`).toBeGreaterThanOrEqual(24);
    expect(box.height, `${label} height should be at least 24px`).toBeGreaterThanOrEqual(24);
};

const expectNoHorizontalOverflow = async (page: Page, label: string) => {
    const overflow = await page.evaluate(() => Math.ceil(
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ));
    expect(overflow, `${label} should not overflow horizontally`).toBeLessThanOrEqual(2);
};

test.describe('Frontend interaction boundaries', () => {
    test('public routes avoid session probes and public controls keep 24px targets', async ({ page }) => {
        test.setTimeout(120000);
        const sessionInitializationRequests: string[] = [];
        await page.route('**/api/system/mode', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        oidcEnabled: false,
                        passwordLoginEnabled: true,
                        adminPasswordLoginEnabled: true,
                        passwordRecoveryMode: 'local',
                    },
                    error: null,
                }),
            });
        });
        page.on('request', (request) => {
            const url = new URL(request.url());
            if (/\/api\/(?:auth\/(?:me|refresh)|system\/mode)$/.test(url.pathname)) {
                sessionInitializationRequests.push(`${request.method()} ${url.pathname}`);
            }
        });

        for (const routeContract of DEFAULT_PUBLIC_ROUTE_CONTRACT) {
            const route = routeContract.path;
            const requestOffset = sessionInitializationRequests.length;
            await page.goto(route);
            await assertRenderedPage(page, route, `[data-testid="${routeContract.landmarkTestId}"]`);
            await page.waitForTimeout(300);
            const routeRequests = sessionInitializationRequests.slice(requestOffset);
            const unexpectedRequests = route === '/login'
                ? routeRequests.filter((request) => !request.endsWith('/api/system/mode'))
                : routeRequests;
            expect(unexpectedRequests, `${route} should not initialize a protected session or runtime mode`).toEqual([]);
            if (route === '/login') {
                expect(
                    routeRequests.some((request) => request.endsWith('/api/system/mode')),
                    '/login should load its public authentication capabilities',
                ).toBe(true);
            }
        }

        await page.goto('/');
        await assertRenderedPage(page, 'landing target measurement', '[data-testid="landing-main"]');
        await expectMinimumTarget(page.locator('header').getByRole('button', { name: /^(Login|登录)$/ }), 'landing login');
        await expectMinimumTarget(page.locator('footer a[href="/privacy"]'), 'landing privacy link');
        await expectMinimumTarget(page.locator('footer a[href="/terms"]'), 'landing terms link');
        await expectNoHorizontalOverflow(page, 'landing');

        await page.goto('/login');
        await assertRenderedPage(page, 'login target measurement', 'form');
        await expectMinimumTarget(page.getByTestId('login-access-help-toggle'), 'login access help');
        await expectMinimumTarget(page.getByRole('button', { name: /Back to home|返回首页/ }), 'login back home');
        await expectNoHorizontalOverflow(page, 'login');
    });

    test('desktop header controls keep 24px targets', async ({ page }) => {
        const adminSession = {
            userId: 'e2e-theme-admin',
            email: 'theme-admin@example.test',
            username: 'e2e-theme-admin',
            role: 'admin',
            plan: 'ultra',
            authProvider: 'local',
        };
        await page.route('**/api/system/mode', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        oidcEnabled: false,
                        passwordLoginEnabled: true,
                        adminPasswordLoginEnabled: true,
                        passwordRecoveryMode: 'local',
                        attackSimEnabled: false,
                    },
                    error: null,
                }),
            });
        });
        await page.route('**/api/auth/login', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, data: { user: adminSession }, error: null }),
            });
        });
        await page.route('**/api/auth/me', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, data: { user: adminSession }, error: null }),
            });
        });
        await loginAsAdmin(page);

        await expectMinimumTarget(page.getByTestId('theme-light'), 'light theme');
        await expectMinimumTarget(page.getByTestId('theme-system'), 'system theme');
        await expectMinimumTarget(page.getByTestId('theme-dark'), 'dark theme');

        await page.getByTestId('theme-dark').click();
        await expect(page.getByTestId('theme-dark')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('html')).toHaveClass(/dark/);
        expect(await page.evaluate(() => localStorage.getItem('aetherguard-theme-v2'))).toBe('dark');

        await page.getByTestId('theme-light').click();
        await expect(page.getByTestId('theme-light')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('html')).toHaveClass(/light/);
        expect(await page.evaluate(() => localStorage.getItem('aetherguard-theme-v2'))).toBe('light');
        await expectMinimumTarget(page.getByTestId('demo-mode-toggle'), 'demo mode');
        await expectMinimumTarget(page.getByTestId('live-mode-toggle'), 'live mode');
        await expectNoHorizontalOverflow(page, 'desktop console');
    });
});
