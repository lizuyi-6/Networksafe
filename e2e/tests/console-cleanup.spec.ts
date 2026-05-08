import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/site-health';
import { cleanupE2EArtifacts, readJson, unwrapRows } from './helpers/console-contracts';

test.describe('console e2e cleanup', () => {
    test('removes all known e2e-prefixed console artifacts', async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('aetherguard-live-mode', 'false');
        });
        await loginAsAdmin(page);
        await cleanupE2EArtifacts(page.request);

        const keys = unwrapRows((await readJson(page.request, '/api/admin/api-keys')).payload);
        const endpoints = unwrapRows((await readJson(page.request, '/api/ai-endpoints')).payload);

        expect(keys.filter((row) => String(row.name || '').startsWith('e2e-')), 'admin API keys should not retain e2e artifacts').toEqual([]);
        expect(endpoints.filter((row) => String(row.name || '').startsWith('e2e-')), 'AI endpoints should not retain e2e artifacts').toEqual([]);
    });
});
