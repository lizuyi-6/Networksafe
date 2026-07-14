import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/site-health';

test.describe('console navigation boundaries', () => {
    test('unknown routes redirect unauthenticated users to login', async ({ page, context }) => {
        await context.clearCookies();
        await page.addInitScript(() => {
            window.localStorage.clear();
            window.sessionStorage.clear();
        });

        await page.goto('/route-that-does-not-exist');

        await expect(page).toHaveURL(/\/login$/, { timeout: 15000 });
        await expect(page.getByTestId('not-found-page')).toHaveCount(0);
        await expect(page.locator('input[name="email"]')).toBeVisible();
    });

    test('unknown routes show an explicit 404 to authenticated users', async ({ page }) => {
        await loginAsAdmin(page);

        await page.goto('/route-that-does-not-exist');

        await expect(page).toHaveURL(/\/route-that-does-not-exist$/);
        const notFound = page.getByTestId('not-found-page');
        await expect(notFound).toBeVisible();
        await expect(notFound.getByRole('heading', { level: 1 })).toContainText(/Page not found|页面未找到/);
        await expect(notFound.locator('code')).toHaveText('/route-that-does-not-exist');
        await expect(notFound.locator('a[href="/dashboard"]')).toBeVisible();
        await expect(page.locator('header')).toContainText(/Page not found|页面未找到/);
    });

    test('mobile operators can open, use, and dismiss console navigation', async ({ page }) => {
        await loginAsAdmin(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/dashboard');

        const trigger = page.getByTestId('mobile-nav-trigger');
        await expect(trigger).toBeVisible();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');

        await trigger.click();
        const drawer = page.getByTestId('mobile-navigation');
        await expect(drawer).toBeVisible();
        await expect(page.locator('aside')).toHaveCount(1);
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await expect(drawer.getByRole('button', { name: /Language|语言/ })).toBeVisible();
        await expect(drawer.getByRole('button', { name: /Demo Mode|演示模式/ })).toBeVisible();
        await expect(drawer.getByRole('button', { name: /Live|实时/ })).toBeVisible();

        await drawer.locator('a[href="/agents"]').click();
        await expect(page).toHaveURL(/\/agents$/);
        await expect(drawer).toHaveCount(0);

        await trigger.click();
        await expect(drawer).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(drawer).toHaveCount(0);
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');

        const horizontalOverflow = await page.evaluate(() => (
            document.documentElement.scrollWidth - document.documentElement.clientWidth
        ));
        expect(horizontalOverflow).toBeLessThanOrEqual(1);
    });
});
