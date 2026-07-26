import { expect, test } from '@playwright/test';
import { ensureDemoMode, loginAsAdmin } from './helpers/site-health';

test.describe('Agents Management Functional Tests', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await ensureDemoMode(page, true);
        await page.goto('/agents');
    });

    test('Agents page loads and displays header', async ({ page }) => {
        await expect(page.locator('main')).toContainText('Agents');
        await expect(page.getByText('Fleet')).toBeVisible();
    });

    test('Stats cards are visible', async ({ page }) => {
        await expect(page.getByText('Total Agents')).toBeVisible();
        await expect(page.getByText('Online Nodes', { exact: true })).toBeVisible();
        await expect(page.getByText('Recent Threats', { exact: true })).toBeVisible();
    });

    test('Refresh button interaction', async ({ page }) => {
        const refreshButton = page.getByTestId('agents-refresh');
        await expect(refreshButton).toBeVisible();
        await expect(refreshButton).toBeEnabled();
        await refreshButton.click();
        await expect(page.locator('main')).toContainText('Agents');
    });

    test('Agent cards are displayed', async ({ page }) => {
        await expect(page.locator('[data-testid^="agent-detail-"]').first()).toBeVisible({ timeout: 10000 });
    });

    test('Scan button interaction on online agent', async ({ page }) => {
        const scanButton = page.locator('[data-testid^="agent-scan-"]:not([disabled])').first();
        await expect(scanButton).toBeVisible({ timeout: 10000 });
        await scanButton.click();
        await expect(page.locator('main')).toContainText(/Simulated scan queued/i);
    });
});
