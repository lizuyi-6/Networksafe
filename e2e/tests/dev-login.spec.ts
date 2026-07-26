import { test, expect } from '@playwright/test';

test.describe('Login credential hygiene', () => {
    test('does not expose credential autofill controls or development passwords', async ({ page }) => {
        await page.goto('/login');

        await expect(page.getByTestId('dev-login-toggle')).toHaveCount(0);
        await expect(page.locator('[data-testid^="dev-preset-"]')).toHaveCount(0);

        const scriptUrls = await page.locator('script[src]').evaluateAll((scripts) =>
            scripts.map((script) => (script as HTMLScriptElement).src)
        );
        const scriptBodies = await Promise.all(
            scriptUrls.map(async (url) => (await page.request.get(url)).text())
        );

        expect(scriptBodies.join('\n')).not.toMatch(/Dev(?:Admin|Starter|Pro|Ultra)!2026/);
    });
});
