import { expect, Page, test } from '@playwright/test';

type LoginCapabilities = {
    oidcEnabled: boolean;
    passwordLoginEnabled: boolean;
};

const configureLoginCapabilities = async (page: Page, capabilities: LoginCapabilities) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('i18nextLng', 'en');
    });

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
                    devLoginEnabled: false,
                    ...capabilities,
                },
                error: null,
            }),
        });
    });
};

test.describe('Login access recovery controls', () => {
    test('local login removes the non-functional remember-device control and exposes honest recovery guidance', async ({ page }) => {
        await configureLoginCapabilities(page, {
            oidcEnabled: false,
            passwordLoginEnabled: true,
        });

        await page.goto('/login');

        await expect(page.locator('input[name="email"]')).toBeVisible();
        await expect(page.locator('input[name="password"]')).toBeVisible();
        await expect(page.getByText('Remember this device', { exact: true })).toHaveCount(0);
        await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);

        const helpToggle = page.getByTestId('login-access-help-toggle');
        await expect(helpToggle).toHaveAttribute('aria-expanded', 'false');
        await helpToggle.click();

        const helpPanel = page.getByTestId('login-access-help-panel');
        await expect(helpToggle).toHaveAttribute('aria-expanded', 'true');
        await expect(helpPanel).toBeVisible();
        await expect(helpPanel).toContainText('Self-service password reset is not configured in this console.');
        await expect(helpPanel).toContainText('This console does not send reset emails.');
        await expect(page.getByTestId('login-access-help-sso')).toHaveCount(0);

        await helpToggle.click();
        await expect(helpToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(helpPanel).toBeHidden();
    });

    test('OIDC recovery guidance calls the configured SSO endpoint and follows its authorization URL', async ({ page, baseURL }) => {
        const origin = baseURL || 'http://127.0.0.1:8080';
        const targetUrl = `${origin}/__e2e_oidc_recovery_target__`;
        let oidcLoginCalls = 0;

        await configureLoginCapabilities(page, {
            oidcEnabled: true,
            passwordLoginEnabled: true,
        });
        await page.route('**/api/auth/oidc/login', async (route) => {
            oidcLoginCalls += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: { authorizationUrl: targetUrl },
                    error: null,
                }),
            });
        });
        await page.route('**/__e2e_oidc_recovery_target__', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: '<!doctype html><title>OIDC recovery target</title><h1>Identity provider</h1>',
            });
        });

        await page.goto('/login');
        await page.getByTestId('login-access-help-toggle').click();

        const helpPanel = page.getByTestId('login-access-help-panel');
        await expect(helpPanel).toContainText('Enterprise accounts recover access through the identity provider.');
        await page.getByTestId('login-access-help-sso').click();

        await expect(page).toHaveURL(targetUrl);
        expect(oidcLoginCalls).toBe(1);
    });

    test('SSO-only mode omits local recovery controls and keeps the real SSO action', async ({ page }) => {
        await configureLoginCapabilities(page, {
            oidcEnabled: true,
            passwordLoginEnabled: false,
        });

        await page.goto('/login');

        await expect(page.locator('input[name="email"]')).toHaveCount(0);
        await expect(page.locator('input[name="password"]')).toHaveCount(0);
        await expect(page.getByTestId('login-access-help-toggle')).toHaveCount(0);
        await expect(page.getByTestId('login-sso')).toBeVisible();
        await expect(page.getByText('Local password login is disabled in this runtime.')).toBeVisible();
    });
});
