import { expect, test } from '@playwright/test';
import { ensureDemoMode, loginAsAdmin, visitSidebarPage } from './helpers/site-health';

test.describe('Scanner run detail', () => {
    test('keeps findings visible after opening the latest scan detail page in demo mode', async ({ page }) => {
        test.setTimeout(120000);

        await loginAsAdmin(page);
        await ensureDemoMode(page, true);
        await visitSidebarPage(page, '/scanner', 'scanner');

        await page.locator('textarea').fill('https://example.com\nhttps://api.example.com');
        await page.getByRole('button', { name: '启动扫描' }).click();

        await expect(page.locator('main')).toContainText('已完成 / 已结束', { timeout: 20000 });
        await expect(page.locator('main')).toContainText('发现总数');
        await expect(page.locator('main')).toContainText('Reflected input path', { timeout: 20000 });

        await page.getByRole('link', { name: '查看详情' }).first().click();

        await expect(page).toHaveURL(/\/scanner\/runs\//, { timeout: 15000 });
        await expect(page.locator('main')).toContainText('Reflected input path', { timeout: 15000 });
        await expect(page.locator('main')).not.toContainText('暂无发现项');
        await expect(page.locator('main')).not.toContainText('暂无处置建议');
    });
});
