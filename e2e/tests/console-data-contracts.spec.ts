import { expect, test } from '@playwright/test';
import { assertRenderedPage, loginAsAdmin } from './helpers/site-health';
import { assertApiContract, cleanupE2EArtifacts, CONSOLE_API_ENDPOINTS, readJson, unwrapRows } from './helpers/console-contracts';

test.describe('console API data contracts', () => {
    test.setTimeout(90000);

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('aetherguard-live-mode', 'false');
        });
        await loginAsAdmin(page);
        await cleanupE2EArtifacts(page.request);
    });

    test.afterEach(async ({ page }) => {
        await cleanupE2EArtifacts(page.request);
    });

    test('validates console API schema, health degradation, tenant references, and sensitive fields', async ({ page }) => {
        const payloads = new Map<string, any>();
        for (const endpoint of CONSOLE_API_ENDPOINTS) {
            payloads.set(endpoint.path, await assertApiContract(page.request, endpoint));
        }

        const tenants = unwrapRows(payloads.get('/api/admin/tenant-oversight/tenants'));
        const users = unwrapRows(payloads.get('/api/admin/users'));
        const tenantIds = new Set(tenants.map((tenant) => tenant.tenantId || tenant.id).filter(Boolean));
        const mixedTenantUsers = users
            .filter((user) => user.tenant_id || user.tenantId)
            .filter((user) => !tenantIds.has(user.tenant_id || user.tenantId))
            .map((user) => ({ id: user.id, tenant: user.tenant_id || user.tenantId }));
        expect(mixedTenantUsers, 'admin user rows should reference known tenant ids').toEqual([]);
    });

    test('creates and removes e2e data without leaking raw secrets or executing payloads', async ({ page }) => {
        const suffix = Date.now();
        const apiKeyName = `e2e-contract-key-${suffix}`;
        const endpointName = `e2e-xss-endpoint-${suffix}<img src=x onerror="window.__e2eXss=1">`;
        const endpointSecret = `e2e-secret-${suffix}-must-not-leak`;

        const createdKey = await page.request.post('/api/admin/api-keys', { data: { name: apiKeyName } });
        expect(createdKey.ok(), 'admin API key creation should succeed').toBeTruthy();

        const createdEndpoint = await page.request.post('/api/ai-endpoints', {
            data: {
                name: endpointName,
                url: 'http://127.0.0.1:65535/e2e-contract',
                modelName: 'e2e-model',
                apiKey: endpointSecret,
                type: 'ollama',
                purpose: 'deep_analysis',
                priority: 50,
                timeout: 1000,
            },
        });
        expect(createdEndpoint.ok(), 'AI endpoint creation should succeed').toBeTruthy();

        const keys = await readJson(page.request, '/api/admin/api-keys');
        const keyRow = unwrapRows(keys.payload).find((row) => row.name === apiKeyName);
        expect(keyRow, 'created e2e admin key should be listed for cleanup').toBeTruthy();
        expect(JSON.stringify(keyRow), 'admin key list should only show a prefix or masked key').not.toMatch(/apiKey|secret|hash/i);

        const endpoints = await readJson(page.request, '/api/ai-endpoints');
        const endpointRow = unwrapRows(endpoints.payload).find((row) => row.name === endpointName);
        expect(endpointRow, 'created e2e endpoint should be listed for cleanup').toBeTruthy();
        expect(JSON.stringify(endpointRow), 'AI endpoint list should not leak stored API key').not.toContain(endpointSecret);

        await page.goto('/settings');
        await assertRenderedPage(page, 'Settings XSS contract');
        expect(await page.evaluate(() => (window as any).__e2eXss === true), 'stored endpoint names must not execute HTML event handlers').toBe(false);
    });
});
