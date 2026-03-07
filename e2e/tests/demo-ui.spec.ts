import { test, expect } from '@playwright/test';
import { ensureDemoMode, loginAsAdmin, loginAsDevPreset, toggleDemoMode } from './helpers/site-health';

const demoAuxiliaryCopy = /Demo Data|demo data|演示数据|Data Source|demonstration data|本地沙箱写入/i;

test.describe('Demo UI parity', () => {
    test('shows the demo toggle for all users and keeps demo mode isolated per account', async ({ page }) => {
        const demoToggle = page.getByTestId('demo-mode-toggle');

        await loginAsAdmin(page);
        await ensureDemoMode(page, false);

        await expect(demoToggle).toBeVisible();
        await expect(page.locator('body')).not.toContainText(demoAuxiliaryCopy);

        await toggleDemoMode(page);
        await expect(demoToggle).toHaveAttribute('aria-pressed', 'true');

        const adminStorage = await page.evaluate(() => ({
            adminMode: localStorage.getItem('demo-mode:admin@aetherguard.local'),
            starterMode: localStorage.getItem('demo-mode:starter@aetherguard.local'),
        }));

        expect(adminStorage.adminMode).toBe('true');
        expect(adminStorage.starterMode).toBeNull();

        await page.context().clearCookies();
        await loginAsDevPreset(page, 'starter');

        await expect(demoToggle).toBeVisible();
        await expect(demoToggle).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('body')).not.toContainText(demoAuxiliaryCopy);
        await expect(page).toHaveURL(/\/dashboard$/);

        const isolatedStorage = await page.evaluate(() => ({
            adminMode: localStorage.getItem('demo-mode:admin@aetherguard.local'),
            starterMode: localStorage.getItem('demo-mode:starter@aetherguard.local'),
        }));

        expect(isolatedStorage.adminMode).toBe('true');
        expect(isolatedStorage.starterMode === null || isolatedStorage.starterMode === 'false').toBeTruthy();
    });
});
