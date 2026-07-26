import { expect, test } from '@playwright/test';

test.describe('Development login boundary', () => {
    test('does not expose credential presets in the browser when the development capability is enabled', async ({ page }) => {
        await page.route('**/api/system/mode', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        appMode: 'production',
                        demoEnabled: false,
                        attackSimEnabled: false,
                        devLoginEnabled: true,
                        passwordLoginEnabled: true,
                        oidcEnabled: false,
                    },
                    error: null,
                }),
            });
        });

        await page.goto('/login');

        await expect(page.locator('input[name="email"]')).toBeVisible();
        await expect(page.locator('input[name="password"]')).toBeVisible();
        await expect(page.getByTestId('dev-login-toggle')).toHaveCount(0);
        await expect(page.locator('[data-testid^="dev-preset-"]')).toHaveCount(0);
        await expect(page.locator('input[name="email"]')).toHaveValue('');
        await expect(page.locator('input[name="password"]')).toHaveValue('');
    });
});
