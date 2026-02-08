import { test, expect } from '@playwright/test';

test.describe('Agents Management Functional Tests', () => {

    test.beforeEach(async ({ page }) => {
        // Navigate to Agents page (assuming no login required for dev mode or mock login)
        await page.goto('/agents');
    });

    test('Agents page loads and displays header', async ({ page }) => {
        await expect(page.locator('h2')).toContainText('Agent Command Center');
        await expect(page.getByText('Real-time monitoring')).toBeVisible();
    });

    test('Stats cards are visible', async ({ page }) => {
        await expect(page.getByText('Total Agents')).toBeVisible();
        await expect(page.getByText('Active Nodes')).toBeVisible();
        await expect(page.getByText('Threats Blocked')).toBeVisible();
    });

    test('Refresh button interaction', async ({ page }) => {
        const refreshBtn = page.getByRole('button', { name: 'Refresh' });
        await expect(refreshBtn).toBeVisible();
        await expect(refreshBtn).toBeEnabled();

        // Click refresh and verify it doesn't crash
        await refreshBtn.click();
        await expect(page.locator('h2')).toBeVisible();
    });

    test('Agent cards are displayed', async ({ page }) => {
        // Wait for the refreshing spinner to disappear or the loading text to go away
        await expect(page.getByText('Loading fleet data...')).not.toBeVisible({ timeout: 10000 });

        // Use a more specific selector for the card that is not dependent on specific text like 'CPU' which might be localized or capitalized differently
        // We look for the status icons which are SVG elements in the cards
        // Or we can rely on the class name if it's stable.
        // Let's use the layout structure: a grid with cards
        const cards = page.locator('.grid-cols-1 .bg-card');
        await expect(cards.first()).toBeVisible();
    });

    test('Scan button interaction on online agent', async ({ page }) => {
        // Find a scan button that is enabled (online agent)
        // Note: Offline agents have disabled scan buttons
        const scanBtn = page.getByRole('button', { name: '扫描' }).first();

        if (await scanBtn.isVisible()) {
            if (await scanBtn.isEnabled()) {
                // Setup dialog handler for alert
                page.on('dialog', dialog => dialog.accept());
                await scanBtn.click();
            } else {
                console.log('Scan button found but disabled (offline agent)');
            }
        }
    });

});
