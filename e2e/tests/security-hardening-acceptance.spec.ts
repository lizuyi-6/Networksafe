import { expect, Page, test } from '@playwright/test';
import { assertRenderedPage, createIssueMonitor, loginAsAdmin } from './helpers/site-health';
import { assertConsoleDataHygiene } from './helpers/console-contracts';

const settle = async (page: Page) => {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);
};

const evidenceName = (label: string) => `security-hardening/${label.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.png`;

const captureEvidence = async (page: Page, label: string) => {
    const { height, dpr } = await page.evaluate(() => ({
        height: document.documentElement.scrollHeight,
        dpr: window.devicePixelRatio || 1,
    }));
    await page.screenshot({
        path: test.info().outputPath(evidenceName(label)),
        fullPage: height * dpr <= 30000,
    });
};

const assertNoLayoutOrCopyIssues = async (page: Page, label: string) => {
    await assertConsoleDataHygiene(page, label);

    const issues = await page.locator('body').evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const visible = (element: Element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };

        const overflowers = Array.from(document.querySelectorAll('main, header, button, a, input, textarea, select'))
            .filter(visible)
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    tag: element.tagName.toLowerCase(),
                    text: (element.textContent || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 100),
                    testId: element.getAttribute('data-testid') || '',
                    rightOverflow: Math.ceil(rect.right - viewportWidth),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                };
            })
            .filter((item) => item.rightOverflow > 2)
            .slice(0, 10);

        const tinyControls = Array.from(document.querySelectorAll('button, a[href], input, select, textarea'))
            .filter(visible)
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    tag: element.tagName.toLowerCase(),
                    text: (element.textContent || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80),
                    testId: element.getAttribute('data-testid') || '',
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    type: element.getAttribute('type') || '',
                };
            })
            .filter((item) => item.type !== 'checkbox')
            .filter((item) => item.width < 24 || item.height < 24)
            .slice(0, 10);

        return { overflowers, tinyControls };
    });

    expect(issues.overflowers, `${label} should not overflow horizontally`).toEqual([]);
    expect(issues.tinyControls, `${label} should not have unusably small controls`).toEqual([]);
};

const expectErrorEnvelope = async (responsePromise: Promise<any>, expectedStatus: number, expectedCode: string) => {
    const response = await responsePromise;
    expect(response.status()).toBe(expectedStatus);
    const payload = await response.json();
    expect(payload).toMatchObject({ success: false });
    expect(payload.error?.code || payload.code).toBe(expectedCode);
    return payload;
};

const mockReadySession = async (page: Page, role: string) => {
    const permissionByRole: Record<string, string[]> = {
        platform_admin: ['gate.read', 'gate.enroll', 'deployment.run.read', 'deployment.run.create', 'deployment.run.approve', 'deployment.evidence.read', 'deployment.evidence.export'],
        tenant_admin: ['gate.read', 'gate.enroll', 'deployment.run.read', 'deployment.run.create', 'deployment.run.approve', 'deployment.evidence.read', 'deployment.evidence.export'],
        tenant_operator: ['gate.read', 'deployment.run.read', 'deployment.run.create', 'deployment.evidence.read'],
        tenant_viewer: ['deployment.run.read', 'deployment.evidence.read'],
        viewer: ['deployment.run.read', 'deployment.evidence.read'],
        auditor: ['deployment.run.read', 'deployment.evidence.read', 'deployment.evidence.export'],
    };
    await page.route('**/api/health/ready', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ready' }) });
    });
    await page.route('**/api/auth/me', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    user: {
                        userId: `e2e-${role}`,
                        email: `${role}@example.test`,
                        username: role,
                        role,
                        plan: 'ultra',
                        permissions: permissionByRole[role] || [],
                    },
                },
                error: null,
            }),
        });
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
                    passwordLoginEnabled: true,
                    oidcEnabled: false,
                },
                error: null,
            }),
        });
    });
};

const mockGovernanceData = async (page: Page) => {
    const run = {
        id: 'run-e2e-001', tenantId: 'tenant-e2e', helperId: 'helper-e2e', gateId: 'gate-e2e',
        requestType: 'install', serverType: 'docker_compose', status: 'backup_completed',
        bundleChecksum: 'abc123', checksumShortCode: 'abc123', requestedBy: 'operator@example.test',
        evidenceStatus: 'ready', createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
    };
    await page.route('**/api/**', (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/api/auth/me' || pathname === '/api/health/ready' || pathname === '/api/system/mode') {
            return route.fallback();
        }
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: {}, error: null }),
        });
    });
    await page.route('**/api/stats/badges', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {}, error: null }) }));
    await page.route('**/api/hardware-gates', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { gates: [] }, error: null }) }));
    await page.route('**/api/helpers', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { helpers: [] }, error: null }) }));
    await page.route('**/api/deployment-runs', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { runs: [run] }, error: null }) }));
    await page.route('**/api/deployment-runs/*/evidence', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { run, payload: { outcome: 'isolated' } }, error: null }) }));
};

const mockDeviceData = async (page: Page, finalDefense: Record<string, unknown>) => {
    const device = {
        deviceId: 'appliance-gw-e2e-01',
        version: '2.0.0',
        chipModel: 'STM32H563',
        flashSize: 16_777_216,
        freeHeap: 310_000,
        sdkVersion: 'Zephyr RTOS v3.5',
        mode: 'online',
        isOnline: true,
        lastHeartbeat: '2026-07-12T00:00:00.000Z',
        connectedAgents: ['agent-e2e-01'],
        status: { cpuUsage: 28, memoryUsage: 41, uptime: 172_800, wifiRssi: -48 },
        config: {
            displayName: 'E2E Gateway Appliance',
            group: 'e2e',
            site: 'lab',
            networkProfile: 'fail-closed-bridge',
            scanProfile: 'balanced',
            notes: '',
            commandPermissions: ['collect', 'reboot'],
            tags: ['gateway-appliance'],
        },
    };

    await page.route('**/api/stats/badges', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { agents: 1, alerts: 0, devices: 1, agentMonitor: 1, traffic: 0, scanner: 0 }, error: null }),
    }));
    await page.route('**/api/devices', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, total: 1, online: 1, devices: [device] }),
    }));
    await page.route('**/api/final-defense/status', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: finalDefense, error: null }),
    }));
};

test.describe('Security hardening acceptance flows', () => {
    test.setTimeout(180000);

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('aetherguard-live-mode', 'false');
        });
    });

    test('production SSO-only login removes password recovery shortcuts and keeps mobile layout usable', async ({ page, baseURL }) => {
        const origin = baseURL || 'http://127.0.0.1:8080';
        const modeResponse = await page.request.get(`${origin}/api/system/mode`);
        const modePayload = await modeResponse.json().catch(() => ({}));
        const mode = modePayload?.data || modePayload || {};

        await page.goto('/login');
        await assertRenderedPage(page, 'SSO login', 'body');
        await assertNoLayoutOrCopyIssues(page, 'SSO login');

        if (mode.adminPasswordLoginEnabled === false && mode.passwordRecoveryMode === 'sso_or_offline') {
            await expect(page.locator('input[name="email"]')).toHaveCount(0);
            await expect(page.locator('input[name="password"]')).toHaveCount(0);
            await expect(page.getByText(/Forgot password/i)).toHaveCount(0);
            await expect(page.getByText(/Enterprise SSO required|SSO/i)).toBeVisible();
            if (mode.oidcEnabled) {
                await expect(page.getByTestId('login-sso')).toBeVisible();
            }
        } else {
            await expect(page.locator('input[name="email"]')).toBeVisible();
            await expect(page.locator('input[name="password"]')).toBeVisible();
        }

        await captureEvidence(page, 'sso-only-login');
    });

    test('cached identity cannot authorize a protected route when session verification is unavailable', async ({ page }) => {
        await page.addInitScript(() => {
            window.sessionStorage.setItem('aetherguard:session-user', JSON.stringify({
                userId: 'cached-admin',
                email: 'cached-admin@example.test',
                username: 'cached-admin',
                role: 'platform_admin',
            }));
        });
        await page.route('**/api/health/ready', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ready' }) });
        });
        await page.route('**/api/auth/me', async (route) => {
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: false,
                    error: { code: 'AUTH_BLACKLIST_UNAVAILABLE' },
                    code: 'AUTH_BLACKLIST_UNAVAILABLE',
                    retryable: true,
                }),
            });
        });

        await page.goto('/dashboard');

        await expect(page).toHaveURL(/\/login$/);
        await expect(page.getByTestId('session-unverified-banner')).toHaveCount(0);
        await expect(page.locator('main')).not.toContainText(/Overview|Dashboard/i);
    });

    test('unknown login capabilities keep every interactive sign-in method closed', async ({ page }) => {
        await page.route('**/api/system/mode', async (route) => {
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({ success: false, error: { code: 'MODE_UNAVAILABLE' } }),
            });
        });

        await page.goto('/login');

        await expect(page.locator('input[name="email"]')).toHaveCount(0);
        await expect(page.locator('input[name="password"]')).toHaveCount(0);
        await expect(page.getByTestId('login-sso')).toHaveCount(0);
        await expect(page.getByTestId('dev-login-toggle')).toHaveCount(0);
        await expect(page.getByRole('alert')).toContainText(/could not be verified|无法确认/i);
    });

    test('admin routes follow backend role normalization and reject tenant administrators', async ({ page }) => {
        await mockReadySession(page, 'platform_admin');
        await page.route('**/api/stats/badges', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: { agents: 0, alerts: 0, devices: 0, agentMonitor: 0, traffic: 0, scanner: 0 },
                    error: null,
                }),
            });
        });
        await page.route('**/api/admin/**', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], error: null }) });
        });

        await page.goto('/super-admin');
        await expect(page).toHaveURL(/\/super-admin$/);

        await page.unroute('**/api/auth/me');
        await page.route('**/api/auth/me', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: { user: { userId: 'e2e-tenant-admin', email: 'tenant@example.test', username: 'tenant-admin', role: 'tenant_admin', plan: 'ultra' } },
                    error: null,
                }),
            });
        });

        await page.goto('/super-admin');
        await expect(page).toHaveURL(/\/dashboard$/);
    });

    test('explicit session permissions override role-derived access', async ({ page }) => {
        await mockReadySession(page, 'platform_admin');
        await page.unroute('**/api/auth/me');
        await page.route('**/api/auth/me', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: { user: { userId: 'restricted-admin', email: 'restricted@example.test', username: 'restricted', role: 'platform_admin', permissions: [] } },
                error: null,
            }),
        }));

        await page.goto('/deployment-evidence');
        await expect(page).toHaveURL(/\/dashboard$/);
        await expect(page.locator('aside a[href="/deployment-evidence"]')).toHaveCount(0);
    });

    test('viewer role keeps deployment governance read-only and cannot read hardware gates', async ({ page }) => {
        await mockReadySession(page, 'viewer');
        await mockGovernanceData(page);

        await page.goto('/hardware-gates');
        await expect(page).toHaveURL(/\/dashboard$/);

        await page.goto('/deployment-runs');
        await expect(page).toHaveURL(/\/deployment-runs$/, { timeout: 5000 });
        await expect(page.getByText('Run Timeline')).toBeVisible();
        await expect(page.getByText('Create Run', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Approve', { exact: true })).toHaveCount(0);

        await page.goto('/deployment-evidence');
        await expect(page).toHaveURL(/\/deployment-evidence/);
        await expect(page.getByText('Evidence Lookup')).toBeVisible();
        await expect(page.getByText('Export JSON', { exact: true })).toHaveCount(0);
    });

    test('tenant operator can create runs but cannot approve or export evidence', async ({ page }) => {
        await mockReadySession(page, 'tenant_operator');
        await mockGovernanceData(page);

        await page.goto('/hardware-gates');
        await expect(page).toHaveURL(/\/hardware-gates$/, { timeout: 5000 });
        await expect(page.getByText('Hardware Gates', { exact: true })).toBeVisible();
        await expect(page.getByText('Enroll Gate', { exact: true })).toHaveCount(0);

        await page.goto('/deployment-runs');
        await expect(page).toHaveURL(/\/deployment-runs$/, { timeout: 5000 });
        await expect(page.getByRole('heading', { name: 'Create Run' })).toBeVisible();
        await expect(page.getByText('Approve', { exact: true })).toHaveCount(0);

        await page.goto('/deployment-evidence');
        await expect(page.getByText('Export JSON', { exact: true })).toHaveCount(0);
    });

    test('auditor can export evidence while hardware gates and deployment writes stay closed', async ({ page }) => {
        await mockReadySession(page, 'auditor');
        await mockGovernanceData(page);

        await page.goto('/hardware-gates');
        await expect(page).toHaveURL(/\/dashboard$/);

        await page.goto('/deployment-runs');
        await expect(page).toHaveURL(/\/deployment-runs$/, { timeout: 5000 });
        await expect(page.getByText('Run Timeline')).toBeVisible();
        await expect(page.getByText('Create Run', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Approve', { exact: true })).toHaveCount(0);

        await page.goto('/deployment-evidence');
        await expect(page.getByText('Export JSON', { exact: true })).toBeVisible();
    });

    test('Final Defense summary cannot override a failed gateway detail', async ({ page }) => {
        await mockReadySession(page, 'platform_admin');
        await mockDeviceData(page, {
            active: true,
            rootResistantActive: true,
            hostCompanionActive: true,
            mode: 'active',
            policies: [],
            statuses: [],
            rootResistantGateways: [{
                gatewayProtectionMode: 'external_network_gateway',
                tenantId: 'tenant-e2e',
                gatewayId: 'gateway-e2e',
                policyDigest: 'policy-e2e',
                reportedPolicyDigest: 'policy-e2e',
                firmwareDigest: 'firmware-e2e',
                lastAttestationAt: '2026-07-12T00:00:00.000Z',
                bridgeState: 'isolated',
                serverPortLink: true,
                lanPortLink: true,
                mgmtPath: 'dedicated_mgmt',
                secureElementPresent: false,
                gatewayOnline: true,
                active: true,
                degradedReasons: [],
                createdAt: '2026-07-12T00:00:00.000Z',
                updatedAt: '2026-07-12T00:00:00.000Z',
            }],
        });

        await page.goto('/devices');

        await expect(page.getByText('Root-Resistant Final Defense Degraded', { exact: true })).toBeVisible();
        await expect(page.getByText('Secure element').locator('..')).toContainText('Failed');
        await expect(page.getByText('Root-Resistant Final Defense Active', { exact: true })).toHaveCount(0);
    });

    test('approval-required device command remains amber and never claims execution', async ({ page }) => {
        await mockReadySession(page, 'platform_admin');
        await mockDeviceData(page, {
            active: false,
            rootResistantActive: false,
            hostCompanionActive: false,
            mode: 'degraded',
            policies: [],
            statuses: [],
            rootResistantGateways: [],
        });
        await page.route('**/api/commands/intents', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    success: true,
                    status: 'approval_required',
                    message: 'Hardware approval required.',
                    confirmationSessionId: 'confirm-e2e-01',
                },
                error: null,
            }),
        }));

        await page.goto('/devices');
        await page.getByRole('button', { name: 'Collect', exact: true }).click();

        const notice = page.getByRole('status').filter({ hasText: 'Hardware approval required.' });
        await expect(notice).toContainText('Hardware approval required.');
        await expect(notice).toContainText('confirm-e2e-01');
        await expect(notice).toHaveClass(/border-amber-/);
        await expect(notice).not.toContainText(/completed|executed/i);
    });

    test('missing dashboard metrics render unknown markers instead of synthetic zeroes', async ({ page }) => {
        await mockReadySession(page, 'platform_admin');
        await page.route(/\/api\/stats\?range=/, (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                totalRequests: null,
                currentRPS: null,
                blockedRequests: null,
                activeConnections: null,
                successRate: null,
                history: [],
                threats: [],
            }),
        }));
        await page.route('**/api/logs', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
        await page.route('**/api/dashboard/rules/summary', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ totalRules: 0, topRules: [] }) }));
        await page.route('**/api/admin/api-keys', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], error: null }) }));
        await page.route('**/api/stats/badges', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {}, error: null }) }));

        await page.goto('/dashboard');

        for (const label of ['Total Requests', 'Threats Blocked', 'Success Rate', 'Avg Latency', 'Active Connections', 'High Risk']) {
            await expect(page.getByText(label, { exact: true }).locator('..')).toContainText('--');
        }
    });

    test('admin batch confirmation is a keyboard-usable mobile dialog', async ({ page }) => {
        await mockReadySession(page, 'platform_admin');
        await page.route('**/api/stats/badges', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {}, error: null }) }));
        await page.route('**/api/admin/users', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                users: [{ id: 'user-e2e-01', email: 'user@example.test', role: 'viewer', plan: 'starter', status: 'active', tenant_id: 'tenant-e2e' }],
            }),
        }));
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/super-admin');
        await page.getByRole('button', { name: 'Select user@example.test' }).click();
        await page.getByRole('combobox').first().selectOption('suspend');
        await page.getByRole('button', { name: 'Apply', exact: true }).click();

        const dialog = page.getByRole('dialog', { name: 'Confirm Batch Operation' });
        await expect(dialog).toBeVisible();
        await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
        const overflow = await dialog.evaluate((element) => element.getBoundingClientRect().right - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
    });

    test('scanner URL-only flow and internal target rejection stay coherent in UI and API', async ({ page, baseURL }) => {
        const monitor = createIssueMonitor(page, baseURL!);
        await loginAsAdmin(page);

        const snapshot = monitor.snapshot();
        await page.goto('/scanner');
        await assertRenderedPage(page, 'Scanner hardening');

        await expect(page.getByTestId('scanner-include-local-host')).not.toBeChecked();
        await expect(page.getByTestId('scanner-include-system')).toBeDisabled();
        await expect(page.getByTestId('scanner-include-web')).toBeDisabled();
        await expect(page.getByTestId('scanner-include-ports')).toBeDisabled();

        await page.getByTestId('scanner-targets').fill('http://127.0.0.1:3005/api/health');
        await page.getByTestId('scanner-start-task').click();
        await expect(page.locator('main')).toContainText(/SSRF|private|loopback|metadata|INVALID_TARGETS|目标|内部/i);
        await expect(page.locator('main')).not.toContainText(/\[object Object\]/);

        await page.getByTestId('scanner-targets').fill('https://93.184.216.34/');
        await page.getByTestId('scanner-start-task').click();
        await expect(page.locator('main')).toContainText(/Task created|created|任务/i, { timeout: 15000 });

        await page.getByTestId('scanner-include-local-host').check();
        await expect(page.getByTestId('scanner-include-system')).toBeEnabled();
        await page.getByTestId('scanner-include-system').check();
        await page.getByTestId('scanner-include-web').check();
        await page.getByTestId('scanner-include-ports').check();
        await page.getByTestId('scanner-targets').fill('');
        await page.getByTestId('scanner-start-task').click();
        await expect(page.locator('main')).toContainText(/Internal host scan|SCANNER_ALLOW_INTERNAL_TARGETS|INVALID_TARGETS|内部/i);

        await assertNoLayoutOrCopyIssues(page, 'Scanner hardening');
        await captureEvidence(page, 'scanner-hardening');
        await monitor.assertNoNewIssues(snapshot, 'scanner hardening flow', {
            allowPatterns: [
                /response: POST \/api\/scanner\/tasks -> 400/,
                /console\.error: Failed to load resource: the server responded with a status of 400/,
            ],
        });
    });

    test('public health stays minimal while protected runtime APIs require session', async ({ page, baseURL }) => {
        const monitor = createIssueMonitor(page, baseURL!);
        const snapshot = monitor.snapshot();

        await page.goto('/');
        await assertRenderedPage(page, 'Public landing');
        await assertNoLayoutOrCopyIssues(page, 'Public landing');

        const health = await page.request.get('/api/health');
        expect(health.status()).toBe(200);
        const healthPayload = await health.json();
        expect(JSON.stringify(healthPayload)).not.toMatch(/redis|postgres|minio|dependency|JWT_SECRET|password/i);

        await expectErrorEnvelope(page.request.get('/api/health/ready'), 401, 'AUTH_TOKEN_MISSING');
        await expectErrorEnvelope(page.request.get('/api/health/dependencies'), 401, 'AUTH_TOKEN_MISSING');
        await expectErrorEnvelope(page.request.get('/api/stats'), 401, 'AUTH_TOKEN_MISSING');

        await captureEvidence(page, 'public-boundaries');
        await monitor.assertNoNewIssues(snapshot, 'public boundary flow', {
            allowPatterns: [
                /response: GET \/api\/health\/ready -> 401/,
                /response: GET \/api\/health\/dependencies -> 401/,
                /response: GET \/api\/stats -> 401/,
            ],
        });
    });

    test('logout invalidates browser session and protected pages redirect back to login', async ({ page, baseURL }) => {
        const monitor = createIssueMonitor(page, baseURL!);
        const snapshot = monitor.snapshot();

        await loginAsAdmin(page);
        await page.goto('/settings');
        await assertRenderedPage(page, 'Settings before logout');
        await assertNoLayoutOrCopyIssues(page, 'Settings before logout');

        await page.getByTestId('settings-logout').click();
        await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
        await settle(page);
        const modeResponse = await page.request.get('/api/system/mode');
        const modePayload = await modeResponse.json().catch(() => ({}));
        const mode = modePayload?.data || modePayload || {};
        if (mode.adminPasswordLoginEnabled === false && mode.passwordRecoveryMode === 'sso_or_offline') {
            await expect(page.locator('form')).toHaveCount(0);
            await expect(page.getByText(/Enterprise SSO required|SSO/i)).toBeVisible();
        } else {
            await expect(page.locator('form')).toBeVisible();
        }

        await page.goto('/dashboard');
        await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
        await expectErrorEnvelope(page.request.get('/api/auth/me'), 401, 'AUTH_TOKEN_MISSING');

        await captureEvidence(page, 'logout-session-boundary');
        await monitor.assertNoNewIssues(snapshot, 'logout session boundary', {
            allowPatterns: [
                /response: GET \/api\/auth\/me -> 401/,
                /console\.error: Failed to load resource: the server responded with a status of 401/,
            ],
        });
    });
});
