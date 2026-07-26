import { expect, test } from '@playwright/test';
import { ensureDemoMode, loginAsAdmin, visitSidebarPage } from './helpers/site-health';

test.describe('Scanner run detail', () => {
    test('keeps findings visible after opening the latest scan detail page in demo mode', async ({ page }) => {
        test.setTimeout(120000);

        await loginAsAdmin(page);
        await ensureDemoMode(page, true);
        await visitSidebarPage(page, '/scanner', 'scanner');

        await page.getByTestId('scanner-targets').fill('https://example.com\nhttps://api.example.com');
        await page.getByTestId('scanner-start-task').click();

        await expect(page.locator('main')).toContainText('Reflected input path', { timeout: 20000 });
        await page.locator('a[href^="/scanner/runs/"]').first().click();

        await expect(page).toHaveURL(/\/scanner\/runs\//, { timeout: 15000 });
        await expect(page.locator('main')).toContainText('Reflected input path', { timeout: 15000 });
        await expect(page.locator('main')).not.toContainText(/No findings|No remediation/i);
    });
});
