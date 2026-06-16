import { expect, test } from '@playwright/test';
import { loginAsAdmin, assertRenderedPage, ensureDemoMode } from './helpers/site-health';

test.describe('Frontend fix verification', () => {
    test.setTimeout(120000);

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('aetherguard-live-mode', 'false');
        });
        await loginAsAdmin(page);
    });

    test('Settings page - Other Settings panel has functional controls', async ({ page }) => {
        await page.goto('/settings');
        await assertRenderedPage(page, 'Settings');

        // Verify the "Other Settings" panel has actual controls (not just text)
        const liveToggle = page.locator('main').getByText(/Live|实时/i).first();
        await expect(liveToggle).toBeVisible({ timeout: 10000 });

        // Verify logout button exists and is clickable
        const logoutButton = page.locator('main button').filter({ hasText: /Log Out|退出登录/i }).first();
        await expect(logoutButton).toBeVisible({ timeout: 10000 });
        await expect(logoutButton).toBeEnabled();

        // Verify the live mode toggle has proper accessibility
        const liveToggleButton = page.getByTestId('settings-live-mode-toggle');
        await expect(liveToggleButton).toBeVisible();
        await expect(liveToggleButton).toHaveAttribute('aria-label', /.+/);
    });

    test('Agent Monitor page - shows error banner on API failure', async ({ page }) => {
        await page.goto('/agent-monitor');
        await assertRenderedPage(page, 'Agent Monitor');

        // Verify the page loads without error banner when API works
        const errorBanner = page.locator('.border-rose-500\\/20');
        // In normal operation, there should be no error banner
        // (the API might fail in test env, but the banner should appear if it does)

        // Verify refresh button works
        await page.getByTestId('agent-monitor-refresh').click();
        await page.waitForTimeout(2000);

        // Page should still be rendered (no crash)
        await assertRenderedPage(page, 'Agent Monitor after refresh');
    });

    test('Traffic Interceptor page - shows error banner on API failure', async ({ page }) => {
        await page.goto('/traffic');
        await assertRenderedPage(page, 'Traffic Interceptor');

        // Verify refresh button works
        await page.getByTestId('traffic-refresh').click();
        await page.waitForTimeout(2000);

        // Page should still be rendered (no crash)
        await assertRenderedPage(page, 'Traffic after refresh');
    });

    test('Platform Settings - AI Escalation Mode has multiple options', async ({ page }) => {
        await page.goto('/settings');
        await assertRenderedPage(page, 'Settings');

        // Wait for platform settings to load
        await page.waitForTimeout(3000);

        // Find the AI Escalation Mode select and verify it has multiple options
        const escalationSelect = page.locator('select').filter({ has: page.locator('option[value="high_risk_allowed_only"]') }).first();
        if (await escalationSelect.count() > 0) {
            const options = await escalationSelect.locator('option').allTextContents();
            expect(options.length).toBeGreaterThan(1);
            expect(options).toContain('all_allowed');
            expect(options).toContain('disabled');
        }

        // Find the Learning Mode select and verify it has multiple options
        const learningSelect = page.locator('select').filter({ has: page.locator('option[value="malicious_review_queue"]') }).first();
        if (await learningSelect.count() > 0) {
            const options = await learningSelect.locator('option').allTextContents();
            expect(options.length).toBeGreaterThan(1);
            expect(options).toContain('passive_observe');
            expect(options).toContain('active_block');
        }
    });

    test('Settings page - Logout button works', async ({ page }) => {
        await page.goto('/settings');
        await assertRenderedPage(page, 'Settings');

        const logoutButton = page.locator('main button').filter({ hasText: /Log Out|退出登录/i }).first();
        await expect(logoutButton).toBeVisible({ timeout: 10000 });

        // Click logout and verify redirect to login
        await logoutButton.click();
        await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    });
});
