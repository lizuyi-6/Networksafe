import { expect, test } from '@playwright/test';
import { assertRenderedPage, loginAsAdmin } from './helpers/site-health';

test.describe('Oversight user activity navigation', () => {
    test('opens user activity from user management and keeps oversight query state stable', async ({ page }) => {
        await loginAsAdmin(page);

        await page.goto('/super-admin');
        await assertRenderedPage(page, 'user-management');

        const userActivityLink = page.locator('[data-testid^="admin-user-activity-"]').first();
        await expect(userActivityLink).toBeVisible();
        await userActivityLink.click();

        await page.waitForURL(/\/admin\?/, { timeout: 15000 });
        await expect(page).toHaveURL(/tab=timeline/);
        await expect(page).toHaveURL(/tenant=/);
        await expect(page).toHaveURL(/user=/);
        await expect(page.locator('[data-testid="oversight-timeline-table"]')).toBeVisible();

        await page.reload();
        await page.waitForURL(/\/admin\?/, { timeout: 15000 });
        await expect(page).toHaveURL(/tab=timeline/);
        await expect(page.locator('[data-testid="oversight-timeline-table"]')).toBeVisible();

        const timelineDetailButton = page.locator('[data-testid="oversight-timeline-detail"]').first();
        if (await timelineDetailButton.count()) {
            await timelineDetailButton.click();
            await expect(page.locator('[data-testid="oversight-detail-panel"]')).toBeVisible();
        }

        await page.locator('[data-testid="oversight-tab-overview"]').click();
        await page.waitForURL(/tab=overview/, { timeout: 15000 });

        const oversightUserButton = page.locator('[data-testid^="oversight-user-activity-"]').first();
        await expect(oversightUserButton).toBeVisible();
        await oversightUserButton.click();

        await page.waitForURL(/tab=timeline/, { timeout: 15000 });
        await expect(page).toHaveURL(/user=/);
        await expect(page.locator('[data-testid="oversight-timeline-table"]')).toBeVisible();

        const backToUsers = page.locator('[data-testid="oversight-back-to-users"]').first();
        await expect(backToUsers).toHaveAttribute('href', '/super-admin');
        await backToUsers.click();
        await page.waitForURL(/\/super-admin$/, { timeout: 15000 });
        await assertRenderedPage(page, 'user-management-return');
    });
});
