import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/site-health';

test.describe('Dashboard Navigation', () => {

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test('Sidebar contains all main navigation items', async ({ page }) => {
        // Navigate to dashboard
        await page.goto('/dashboard');

        // Check main navigation items
        const navItems = [
            '/dashboard',
            '/agents',
            '/sites',
            '/deploy',
            '/scanner',
            '/settings'
        ];

        for (const path of navItems) {
            await expect(page.locator(`aside a[href="${path}"]`).first()).toBeVisible();
        }
    });

    test('Dashboard page has expected sections', async ({ page }) => {
        await page.goto('/dashboard');

        // Check for "Overview" or header
        await expect(page.locator('main')).toContainText(/Overview|Dashboard/i);

        // Check if stats are visible (assuming there are stat cards)
        // Based on App.tsx, Dashboard is a component. We expect it to load without error.
        // A generic check for the main content area
        await expect(page.locator('main')).toBeVisible();
    });

});
