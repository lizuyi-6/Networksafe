import { test, expect } from '@playwright/test';

test.describe('FluxGuard Pro Smoke Tests', () => {

    test('Landing page loads successfully', async ({ page }) => {
        await page.goto('/');

        // Check for main title or specific text on landing page
        await expect(page).toHaveTitle(/FluxGuard|Security/i);
        // Check for "FluxGuard" text which should be present
        await expect(page.locator('body')).toContainText('FluxGuard');
    });

    test('Login page loads', async ({ page }) => {
        await page.goto('/login');
        // Check for login inputs using specific placeholders
        await expect(page.getByPlaceholder('name@company.com')).toBeVisible();
        await expect(page.getByPlaceholder('••••••••')).toBeVisible();
        // Check for login button
        await expect(page.getByRole('button', { name: /安全登录|Login/i })).toBeVisible();
    });

});
