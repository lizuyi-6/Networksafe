import { expect, test } from '@playwright/test';
import { assertRenderedPage, loginAsAdmin, openFirstBoardStatusPage } from './helpers/site-health';

const assertNoLegacyShellClasses = async (page: import('@playwright/test').Page, bannedFragments: string[]) => {
    const classNames = await page.locator('[class]').evaluateAll((nodes) =>
        nodes
            .map((node) => (node as HTMLElement).className)
            .filter((value): value is string => typeof value === 'string'),
    );

    for (const fragment of bannedFragments) {
        expect(classNames.some((value) => value.includes(fragment)), `page should not retain legacy shell fragment: ${fragment}`).toBe(false);
    }
};

const assertNoEnglishHelperCopy = async (page: import('@playwright/test').Page, bannedText: RegExp) => {
    await expect(page.locator('body')).not.toContainText(bannedText);
};

test.describe('Visual smoke', () => {
    test('landing renders the new long-form product homepage without legacy shell fragments', async ({ page }) => {
        await page.goto('/');
        await assertRenderedPage(page, 'landing', '[data-testid="landing-main"]');
        await assertNoLegacyShellClasses(page, ['backdrop-blur-xl', 'shadow-2xl', 'bg-slate-900 rounded-[2rem]']);
        await page.getByTestId('landing-lang-en').click();
        await expect(page.locator('body')).toContainText(/Security that can intercept, reason, and execute in one decision loop\./i);
        await expect(page.getByTestId('landing-primary-cta')).toBeVisible();
        await page.getByTestId('landing-primary-cta').click();
        await page.waitForFunction(() => window.scrollY > 300);
        await expect(page.getByTestId('landing-product-surfaces')).toBeVisible();

        await page.getByTestId('landing-lang-zh').click();
        await expect(page.getByTestId('landing-lang-zh')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('body')).toContainText(/把拦截、推理、仲裁与执行收进同一条决策链。/);
        await expect(page.getByTestId('landing-primary-cta')).toBeVisible();
        await expect(page.locator('body')).not.toContainText(/One platform for interception, reasoning, and control\./i);
        await expect(page.locator('body')).not.toContainText(/涓枃|闃插尽|鎶婃嫤鎴/);
        await expect(page.locator('body')).not.toContainText(/\uFFFD/);
    });

    test('login uses the unified console shell', async ({ page }) => {
        await page.goto('/login');
        await assertRenderedPage(page, 'login', 'form');
        await expect(page.locator('.grid-bg')).toHaveCount(0);
        await assertNoLegacyShellClasses(page, ['shadow-2xl', 'bg-gradient-to-br from-red-500/20 to-orange-500/20']);
    });

    test('attack simulator and board status use console panels instead of legacy dark shells', async ({ page }) => {
        await loginAsAdmin(page);

        await page.goto('/attack-sim');
        await page.waitForURL(/\/attack-sim$/, { timeout: 15000 });
        await assertRenderedPage(page, 'attack-sim');
        await assertNoLegacyShellClasses(page, ['bg-gray-900/80', 'bg-black/40', 'shadow-2xl']);

        const openedBoardStatus = await openFirstBoardStatusPage(page, 'board-status', false);
        if (openedBoardStatus) {
            await assertNoLegacyShellClasses(page, ['backdrop-blur-xl', 'shadow-2xl', 'font-display']);
        }
    });

    test('dashboard, monitor, traffic, scanner, and admin pages stay on the unified console shell', async ({ page }) => {
        await loginAsAdmin(page);

        const routes = [
            { path: '/dashboard', label: 'dashboard' },
            { path: '/agent-monitor', label: 'agent-monitor' },
            { path: '/traffic', label: 'traffic' },
            { path: '/scanner', label: 'scanner' },
            { path: '/super-admin', label: 'super-admin' },
        ];

        for (const route of routes) {
            await page.goto(route.path);
            await assertRenderedPage(page, route.label);
            await assertNoLegacyShellClasses(page, ['bg-black/40', 'bg-gray-900/80', 'shadow-2xl', 'backdrop-blur-xl']);
            await assertNoEnglishHelperCopy(
                page,
                /Monitoring active|Seven-layer collaboration pipeline|Current message bus queue depth|Traffic split across observed protocols|Latest detection counters by severity|Live scan tasks with URL \+ host analysis|Administrative controls for onboarding, API credentials, and infrastructure health/i,
            );
        }
    });
});
