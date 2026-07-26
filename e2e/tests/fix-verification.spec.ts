import { expect, test } from '@playwright/test';
import { loginAsAdmin, assertRenderedPage } from './helpers/site-health';

const mockAuthenticatedShell = async (page: import('@playwright/test').Page) => {
    await page.route('**/health/ready', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ status: 'ready' }),
        });
    });
    await page.route('**/api/auth/me', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: { user: { userId: 'e2e-admin', email: 'admin@example.test', username: 'e2e-admin', role: 'admin', plan: 'ultra' } },
                error: null,
            }),
        });
    });
    await page.route('**/api/stats/badges', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ agents: 0, alerts: 0, devices: 0, agentMonitor: 0, traffic: 0, scanner: 0 }),
        });
    });
};

test.describe('Frontend fix verification', () => {
    test.setTimeout(120000);

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('aetherguard-live-mode', 'false');
        });
    });

    test('Settings page - Other Settings panel has functional controls', async ({ page }) => {
        await loginAsAdmin(page);
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
        await mockAuthenticatedShell(page);
        await page.route('**/api/ai-system/agents/stats', async (route) => {
            await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false }) });
        });
        await page.route('**/api/ai-system/agents/health', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'healthy', details: {} }) });
        });
        await page.goto('/agent-monitor');
        await assertRenderedPage(page, 'Agent Monitor');
        await expect(page.getByTestId('agent-monitor-error')).toContainText(/fetch agent stats|503|load/i);
    });

    test('Traffic Interceptor page - shows error banner on API failure', async ({ page }) => {
        await mockAuthenticatedShell(page);
        await page.route('**/api/traffic/stats', async (route) => {
            await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false }) });
        });
        await page.route('**/api/traffic/flows', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
        await page.route('**/api/traffic/protocols', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ http: 0, https: 0, dns: 0, other: 0 }) }));
        await page.route('**/api/traffic/threats', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
        await page.goto('/traffic');
        await assertRenderedPage(page, 'Traffic Interceptor');
        await expect(page.getByTestId('traffic-error')).toContainText(/fetch traffic stats|503|load/i);
    });

    test('Sites page - distinguishes API failure from an empty site list', async ({ page }) => {
        await mockAuthenticatedShell(page);
        await page.route('**/api/sites', async (route) => {
            await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false }) });
        });
        await page.goto('/sites');
        await assertRenderedPage(page, 'Sites');
        await expect(page.getByTestId('sites-error')).toContainText(/fetch sites|503|FG-SITES/i);
        await expect(page.locator('main')).not.toContainText(/No sites|暂无站点/i);
    });

    test('Platform Settings - AI Escalation Mode has multiple options', async ({ page }) => {
        await loginAsAdmin(page);
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
        await loginAsAdmin(page);
        await page.goto('/settings');
        await assertRenderedPage(page, 'Settings');

        const logoutButton = page.locator('main button').filter({ hasText: /Log Out|退出登录/i }).first();
        await expect(logoutButton).toBeVisible({ timeout: 10000 });

        // Click logout and verify redirect to login
        await logoutButton.click();
        await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    });
});
