import { expect, test } from '@playwright/test';
import { assertFooterLegalLinks, assertRenderedPage } from './helpers/site-health';

test.describe('FluxGuard Pro Smoke Tests', () => {
    test('landing page loads successfully', async ({ page }) => {
        await page.goto('/');

        await expect(page).toHaveTitle(/FluxGuard|Security/i);
        await expect(page.locator('body')).toContainText('FluxGuard');
        await assertRenderedPage(page, 'landing', '[data-testid="landing-main"]');
        await assertFooterLegalLinks(page);
    });

    test('login page loads', async ({ page }) => {
        await page.goto('/login');
        await expect(page.locator('input[name="email"]')).toBeVisible();
        await expect(page.locator('input[name="password"]')).toBeVisible();
        await expect(page.getByRole('button', { name: /Secure Login/i })).toBeVisible();
    });

    test('terms page loads', async ({ page }) => {
        await page.goto('/terms');
        await assertRenderedPage(page, 'terms', 'main');
        await expect(page.locator('body')).toContainText(/Terms of Service/i);
    });
});
