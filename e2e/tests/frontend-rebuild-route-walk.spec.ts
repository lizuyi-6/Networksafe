import { expect, type Page, test } from '@playwright/test';
import { CONSOLE_ROUTES } from './helpers/console-contracts';

const permissions = [
    'gate.read',
    'gate.enroll',
    'deployment.run.read',
    'deployment.run.create',
    'deployment.run.approve',
    'deployment.evidence.read',
    'deployment.evidence.export',
];

const installControlPlaneMocks = async (page: Page) => {
    await page.route('**/api/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: {}, error: null }),
    }));
    await page.route('**/api/ai-system/agents/stats', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            orchestrator: { activeTasks: 0, registeredAgents: 0 },
            messageBus: { queueSize: 0, subscriptionCount: 0, pendingRequests: 0 },
            synthesis: { totalCaseFiles: 0, totalLessons: 0, totalPolicyUpdates: 0, topPatterns: [] },
            operations: { activeAlerts: 0, runningScans: 0, pendingActions: 0, failedValidations: 0, assetsAtRisk: 0 },
            detectionPipeline: {
                asyncReview: { queueDepth: 0, queued: 0, running: 0, completed: 0, failed: 0, completionRate: 0, debateCompletionRate: 0, avgLatencyMs: 0 },
                blockingDiscussion: { count: 0, failClosed: 0, avgLatencyMs: 0 },
                classificationLevel: 'standard',
            },
            health: { status: 'healthy', details: {} },
            agents: [],
        }),
    }));
    await page.route('**/api/ai-system/agents/health', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'healthy', details: {} }),
    }));
    await page.route('**/api/sites', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [], error: null }),
    }));
    await page.route('**/api/deployments/history/list?**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [], error: null }),
    }));
    await page.route('**/api/scanner/tasks/history?**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [], error: null }),
    }));
    await page.route('**/api/config', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            success: true,
            data: {
                antiBot: { enabled: true, requestThreshold: 100, fastRequestThreshold: 10, blockDuration: 3600 },
                rateLimit: { requestsPerMinute: 60, windowSeconds: 60 },
                notifications: { enabled: false, dedupeWindowSeconds: 300, retryDelaysSeconds: [30, 120], channels: [] },
                aiRouting: { mode: 'local_preferred', localEndpointId: null, localHotPathEndpointId: null, cloudEndpointId: null, fallbackAllowed: false, redactionEnabled: true },
                privacyMode: 'strict',
                auditArchive: { bucket: '', retentionDays: 365, objectLockRequired: true, verifyIntervalMinutes: 60 },
                fastpath: { enabled: false, baseUrl: 'http://127.0.0.1:9071', transport: 'tcp', socketPath: null, timeoutMs: 500, fallbackEnabled: false, trafficShadowEnabled: false, trafficShadowSampleRatePct: 0, trafficMaxBodyBytes: 1048576, configCacheTtlMs: 30000 },
                detectionPipeline: { ruleFirstEnabled: true, aiEscalationMode: 'high_risk_allowed_only', classificationLevel: 'standard', blockingDiscussionTimeoutMs: 3000, hotPathRouteMode: 'local_preferred', asyncReviewEnabled: true, blockingReviewForHighRiskActions: true, enableHttpApi: true, enablePacketInterceptor: true, enableAgentAsyncReview: true, aiEscalationThreshold: 0.8, candidateMinConfidence: 0.9, learningMode: 'malicious_review_queue' },
                deploymentDefaults: { serverType: 'docker_compose', profileTemplates: {} },
                deviceGateway: { primaryPath: 'gateway-appliance', aliases: [], syncMaskApiKeys: true, firmwareLocalHost: '127.0.0.1', wifiSSID: '', localPort: 3005, firmwareChannel: 'stable', firmwareRetentionDays: 30, statusAliasEnabled: false },
            },
            error: null,
        }),
    }));
    await page.route('**/api/config/notifications/deliveries?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ deliveries: [] }) }));
    await page.route('**/api/ai-endpoints/models?**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, plan: 'ultra', canCustomize: true, models: [], defaultModelId: '' }),
    }));
    await page.route('**/api/ai-endpoints', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ endpoints: [] }) }));
    await page.route('**/api/health/ready', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ready' }),
    }));
    await page.route('**/api/auth/me', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            success: true,
            data: { user: { userId: 'route-walk-admin', email: 'route-walk@example.test', username: 'Route Walk', role: 'platform_admin', plan: 'ultra', permissions } },
            error: null,
        }),
    }));
    await page.route('**/api/system/mode', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            success: true,
            data: { appMode: 'production', demoEnabled: false, attackSimEnabled: false, passwordLoginEnabled: true, oidcEnabled: false },
            error: null,
        }),
    }));
};

const inspectRoute = async (page: Page, path: string, pageErrors: string[]) => {
    const errorOffset = pageErrors.length;
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?.*)?$`));
    await expect(page.locator('body'), `${path} should render a page body`).toBeVisible();
    await expect(page.getByTestId('route-loading')).toHaveCount(0);

    const result = await page.locator('body').evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const text = document.body.innerText.replace(/\s+/g, ' ').trim();
        const visible = (element: Element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        };
        const overflowers = Array.from(document.querySelectorAll('main, header, button, a, input, textarea, select, table, pre'))
            .filter(visible)
            .map((element) => ({ element, rect: element.getBoundingClientRect() }))
            .filter(({ rect }) => rect.right > viewportWidth + 2 || rect.left < -2)
            .map(({ element, rect }) => ({
                tag: element.tagName.toLowerCase(),
                text: (element.textContent || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80),
                left: Math.round(rect.left),
                right: Math.round(rect.right),
            }))
            .slice(0, 10);
        return { textLength: text.length, overflowers };
    });

    expect(result.textLength, `${path} should render meaningful copy`).toBeGreaterThan(40);
    expect(result.overflowers, `${path} should stay inside the viewport`).toEqual([]);
    expect(pageErrors.slice(errorOffset), `${path} should not throw a page error`).toEqual([]);
    await expect(page.locator('body')).not.toContainText(/FG-[A-Z]+(?:-[A-Z0-9]+)+|\[object Object\]|Invalid Date|\bundefined\b/);
};

test.describe('frontend rebuild route walk', () => {
    test.setTimeout(180000);
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('aetherguard-live-mode', 'false');
            window.localStorage.setItem('aetherguard-demo-mode', 'false');
        });
        await installControlPlaneMocks(page);
    });

    for (const viewport of [
        { name: 'desktop', width: 1440, height: 900 },
        { name: 'mobile', width: 390, height: 844 },
    ]) {
        test(`${viewport.name} renders every public and console route without horizontal overflow`, async ({ page }) => {
            const pageErrors: string[] = [];
            page.on('pageerror', (error) => pageErrors.push(error.message));
            await page.setViewportSize({ width: viewport.width, height: viewport.height });

            for (const path of ['/', '/login', '/privacy', '/terms']) {
                await inspectRoute(page, path, pageErrors);
            }
            for (const { path } of CONSOLE_ROUTES) {
                await inspectRoute(page, path, pageErrors);
            }
        });
    }
});
