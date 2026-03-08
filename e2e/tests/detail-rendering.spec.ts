import { expect, test } from '@playwright/test';
import { assertRenderedPage, loginAsAdmin } from './helpers/site-health';

test.describe('Detail rendering', () => {
    test('renders detail pages without raw JSON placeholders or invalid labels', async ({ page }) => {
        await loginAsAdmin(page);

        await page.goto('/sites/site-alpha');
        await expect(page.locator('main')).toBeVisible();
        await expect(page.locator('body')).not.toContainText('"flows"');
        await expect(page.locator('body')).not.toContainText('"overview"');

        await page.goto('/history/scan-demo-001');
        await expect(page.locator('main')).toBeVisible();
        await expect(page.locator('body')).not.toContainText('"remediated"');
        await expect(page.locator('body')).not.toContainText('"acceptedRisk"');

        await page.goto('/admin?tab=overview&tenant=tenant-alpha');
        await expect(page.locator('body')).not.toContainText('Invalid Date');

        await page.goto('/super-admin');
        await assertRenderedPage(page, 'super-admin');
        const userActivityLink = page.locator('[data-testid^="admin-user-activity-"]').first();
        if (await userActivityLink.count()) {
            await userActivityLink.click();
            await page.waitForURL(/\/admin\?/, { timeout: 15000 });
            const detailButton = page.locator('[data-testid="oversight-timeline-detail"]').first();
            if (await detailButton.count()) {
                await detailButton.click();
                await expect(page.getByTestId('oversight-detail-panel')).toBeVisible();
                await expect(page.locator('body')).not.toContainText('"category"');
                await expect(page.locator('body')).not.toContainText('"actor"');
            }
        }

        await page.goto('/settings');
        await expect(page.locator('body')).not.toContainText('settings.desc');
    });
});
