import { test, expect } from '@playwright/test';

const presets = [
    {
        id: 'admin',
        email: 'dev-admin@aetherguard.local',
        password: 'DevAdmin!2026',
    },
    {
        id: 'starter',
        email: 'starter@aetherguard.local',
        password: 'DevStarter!2026',
    },
    {
        id: 'pro',
        email: 'pro@aetherguard.local',
        password: 'DevPro!2026',
    },
    {
        id: 'ultra',
        email: 'ultra@aetherguard.local',
        password: 'DevUltra!2026',
    },
];

test.describe('Dev login presets', () => {
    test('fills all local preset credentials from the dev mode panel', async ({ page, baseURL }) => {
        const hostname = new URL(baseURL || 'http://127.0.0.1:8080').hostname;
        test.skip(!(hostname === '127.0.0.1' || hostname === 'localhost'), 'dev login presets are only shown on local hosts');

        await page.goto('/login');
        await expect(page.getByTestId('dev-login-toggle')).toBeVisible();

        await page.getByTestId('dev-login-toggle').click();

        for (const preset of presets) {
            await page.getByTestId(`dev-preset-${preset.id}`).click();
            await expect(page.locator('input[name="email"]')).toHaveValue(preset.email);
            await expect(page.locator('input[name="password"]')).toHaveValue(preset.password);
        }
    });
});
