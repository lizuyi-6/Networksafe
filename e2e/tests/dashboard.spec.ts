import { test, expect } from '@playwright/test';

test.describe('Dashboard Navigation', () => {

    test('Sidebar contains all main navigation items', async ({ page }) => {
        // Navigate to dashboard
        await page.goto('/dashboard');

        // Check main navigation items
        const navItems = [
            'Dashboard',
            'Agents',
            'Sites',
            'Deployment',
            'Monitoring',
            'Settings'
        ];

        for (const item of navItems) {
            await expect(page.getByRole('link', { name: item })).toBeVisible();
        }
    });

    test('Dashboard page has expected sections', async ({ page }) => {
        await page.goto('/dashboard');

        // Check for "Overview" or header
        await expect(page.locator('header')).toContainText('Dashboard');

        // Check if stats are visible (assuming there are stat cards)
        // Based on App.tsx, Dashboard is a component. We expect it to load without error.
        // A generic check for the main content area
        await expect(page.locator('main')).toBeVisible();
    });

});
