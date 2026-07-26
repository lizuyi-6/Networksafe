import { expect, APIRequestContext, Page } from '@playwright/test';

type EndpointContract = {
    path: string;
    label: string;
    allowRaw?: boolean;
    allowStatuses?: number[];
    healthCheck?: boolean;
};

export const CONSOLE_ROUTES = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/agents', label: 'Agents' },
    { path: '/agent-monitor', label: 'Agent Monitor' },
    { path: '/traffic', label: 'Traffic' },
    { path: '/devices', label: 'Devices' },
    { path: '/hardware-gates', label: 'Hardware Gates' },
    { path: '/deployment-runs', label: 'Deployment Runs' },
    { path: '/deployment-evidence', label: 'Deployment Evidence' },
    { path: '/sites', label: 'Sites' },
    { path: '/deploy', label: 'Deploy' },
    { path: '/scanner', label: 'Scanner' },
    { path: '/settings', label: 'Settings' },
    { path: '/admin', label: 'Admin' },
    { path: '/super-admin', label: 'Super Admin' },
    { path: '/history', label: 'History' },
    { path: '/rules', label: 'Rules' },
    { path: '/alerts', label: 'Alerts' },
    { path: '/cognition', label: 'Cognition' },
];

export const CONSOLE_API_ENDPOINTS: EndpointContract[] = [
    { path: '/api/health', label: 'health', allowRaw: true, allowStatuses: [200, 503], healthCheck: true },
    { path: '/api/health/ready', label: 'health ready', allowRaw: true, allowStatuses: [200, 503], healthCheck: true },
    { path: '/api/system/mode', label: 'system mode' },
    { path: '/api/auth/me', label: 'current user' },
    { path: '/api/stats', label: 'dashboard stats', allowRaw: true },
    { path: '/api/stats/badges', label: 'system badges', allowRaw: true },
    { path: '/api/logs', label: 'logs', allowRaw: true },
    { path: '/api/dashboard/rules/summary', label: 'dashboard rules summary' },
    { path: '/api/agents', label: 'agents' },
    { path: '/api/agents/threats/recent', label: 'agent threats' },
    { path: '/api/ai-system/agents/stats', label: 'ai agent stats', allowRaw: true },
    { path: '/api/ai-system/agents/health', label: 'ai agent health', allowRaw: true },
    { path: '/api/ai-system/agents/topology', label: 'ai agent topology', allowRaw: true },
    { path: '/api/traffic/stats', label: 'traffic stats', allowRaw: true },
    { path: '/api/traffic/flows', label: 'traffic flows', allowRaw: true },
    { path: '/api/traffic/protocols', label: 'traffic protocols', allowRaw: true },
    { path: '/api/traffic/threats', label: 'traffic threats', allowRaw: true },
    { path: '/api/devices', label: 'devices' },
    { path: '/api/sites', label: 'sites' },
    { path: '/api/deployments/history/list?limit=10', label: 'deployment history' },
    { path: '/api/scanner/tasks/history?limit=10', label: 'scanner history' },
    { path: '/api/alerts', label: 'alerts' },
    { path: '/api/admin/errors', label: 'admin errors', allowRaw: true },
    { path: '/api/admin/performance', label: 'admin performance', allowRaw: true },
    { path: '/api/admin/api-keys', label: 'admin api keys' },
    { path: '/api/admin/users', label: 'admin users' },
    { path: '/api/admin/tenant-oversight/tenants', label: 'tenant oversight tenants' },
    { path: '/api/agent-onboarding/codes?limit=20', label: 'agent onboarding codes' },
    { path: '/api/config', label: 'platform config' },
    { path: '/api/config/notifications/deliveries?limit=10', label: 'notification deliveries' },
    { path: '/api/ai-endpoints', label: 'ai endpoints' },
    { path: '/api/ai-endpoints/models', label: 'ai endpoint models' },
    { path: '/api/rules', label: 'rules' },
    { path: '/api/rules/events', label: 'rule events' },
    { path: '/api/rules/candidates', label: 'rule candidates' },
    { path: '/api/fix-history?limit=10', label: 'fix history' },
    { path: '/api/pipeline/health', label: 'pipeline health' },
    { path: '/api/pipeline/verify', label: 'pipeline verification' },
];

const VISIBLE_TEXT_BLOCKLIST = [
    /\bundefined\b/i,
    /\bNaN\b/,
    /Invalid Date/i,
    /\[object Object\]/i,
    /\uFFFD/,
    /锛|婕旂|鏁版嵁|鐨勭|閿/i,
    /\bnull\b/i,
];

const SENSITIVE_TEXT_BLOCKLIST = [
    /JWT_SECRET/i,
    /AUDIT_LOG_SECRET/i,
    /REDIS_PASSWORD/i,
    /ADMIN_PASSWORD/i,
    /DEVICE_COMMAND_SECRET/i,
    /LocalJwtSecret/i,
    /LocalAuditSecret/i,
    /AdminLocal!2026/i,
    /DevAdmin!2026/i,
    /AetherGuardArtifactSecret2026/i,
    /AetherGuardPgShadow2026/i,
];

const sensitiveKeyPattern = /(password|secret|token|authorization|hash)/i;
const apiKeyPattern = /^api[-_]?key$/i;
const safeSensitiveKeys = /^(hasApiKey|apiKeyConfigured|keyPrefix|prefix|apiKeyPrefix|tokenUsage|tokenCount|maxTokens)$/i;

const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();

export const assertConsoleDataHygiene = async (page: Page, label: string) => {
    const text = await page.locator('body').evaluate((body) => {
        const clone = body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('script,style,pre,code').forEach((node) => node.remove());
        return clone.innerText || clone.textContent || '';
    });

    const normalized = normalizeText(text);
    for (const pattern of VISIBLE_TEXT_BLOCKLIST) {
        expect(normalized, `${label} should not render polluted placeholder text matching ${pattern}`).not.toMatch(pattern);
    }

    for (const pattern of SENSITIVE_TEXT_BLOCKLIST) {
        expect(normalized, `${label} should not render sensitive configuration material`).not.toMatch(pattern);
    }
};

export const assertControlContracts = async (page: Page, label: string) => {
    const offenders = await page.locator('main').evaluate((root) => {
        const isVisible = (element: Element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };

        return Array.from(root.querySelectorAll('button, a[href]'))
            .filter(isVisible)
            .map((element) => {
                const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
                const href = element instanceof HTMLAnchorElement ? element.getAttribute('href') || '' : '';
                return {
                    tag: element.tagName.toLowerCase(),
                    text,
                    aria: element.getAttribute('aria-label') || '',
                    title: element.getAttribute('title') || '',
                    testId: element.getAttribute('data-testid') || '',
                    href,
                };
            })
            .filter((item) => {
                if (item.tag === 'a' && (!item.href || item.href === '#')) return true;
                if (item.tag === 'button' && !item.text && !item.aria && !item.title && !item.testId) return true;
                return false;
            })
            .slice(0, 20);
    });

    expect(offenders, `${label} should expose stable, accessible contracts for visible controls`).toEqual([]);
};

export const readJson = async (request: APIRequestContext, path: string) => {
    const response = await request.get(path);
    const body = await response.text();
    let payload: unknown;
    try {
        payload = body ? JSON.parse(body) : null;
    } catch (error) {
        throw new Error(`${path} did not return JSON: ${String(error)}\n${body.slice(0, 500)}`);
    }
    return { response, payload };
};

const unwrapRows = (payload: any): any[] => {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];

    for (const key of ['data', 'items', 'rows', 'agents', 'devices', 'sites', 'alerts', 'tasks', 'history', 'rules', 'candidates', 'endpoints', 'keys', 'codes', 'users', 'tenants']) {
        const value = payload[key];
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object') {
            const nested = unwrapRows(value);
            if (nested.length > 0) return nested;
        }
    }
    return [];
};

export { unwrapRows };

const assertPayloadEnvelope = (payload: any, endpoint: EndpointContract) => {
    if (endpoint.allowRaw) return;
    expect(payload && typeof payload === 'object' && !Array.isArray(payload), `${endpoint.label} should return an object`).toBeTruthy();
    expect(payload, `${endpoint.label} should follow the API envelope`).toHaveProperty('success');
    expect(typeof payload.success, `${endpoint.label} success should be boolean`).toBe('boolean');
    if (payload.success === false) {
        expect(payload.error, `${endpoint.label} failed envelope should include error`).toBeTruthy();
    }
};

const collectSensitiveLeaks = (value: unknown, path: string = '$', leaks: string[] = []): string[] => {
    if (value === null || value === undefined) return leaks;
    if (typeof value === 'string') {
        for (const pattern of SENSITIVE_TEXT_BLOCKLIST) {
            if (pattern.test(value)) leaks.push(`${path} contains sensitive value`);
        }
        if (/\uFFFD|锛|婕旂|鏁版嵁|鐨勭|閿/i.test(value)) {
            leaks.push(`${path} contains mojibake`);
        }
        return leaks;
    }
    if (typeof value !== 'object') return leaks;

    if (Array.isArray(value)) {
        value.slice(0, 100).forEach((item, index) => collectSensitiveLeaks(item, `${path}[${index}]`, leaks));
        return leaks;
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const childPath = `${path}.${key}`;
        if (!safeSensitiveKeys.test(key) && (sensitiveKeyPattern.test(key) || apiKeyPattern.test(key))) {
            const raw = typeof child === 'string' ? child.trim() : child;
            if (raw && raw !== '***' && raw !== '********' && raw !== '[redacted]') {
                leaks.push(`${childPath} exposes sensitive field`);
            }
        }
        collectSensitiveLeaks(child, childPath, leaks);
    }
    return leaks;
};

const assertAllowedHealthDegradation = (payload: any, endpoint: EndpointContract) => {
    if (!endpoint.healthCheck) return;
    const data = payload?.data || payload || {};
    const dependencies = data.dependencies || payload.dependencies || {};
    const nonAiDegraded = Object.entries(dependencies)
        .filter(([, value]: [string, any]) => /degraded|unhealthy/i.test(String(value?.status || '')))
        .map(([key]) => key)
        .filter((key) => !/ai|provider|platform/i.test(key));

    const blockers = [
        ...(data.readiness?.blockers || []),
        ...(payload.readiness?.blockers || []),
    ].filter((blocker: unknown) => !/ai|provider|platform/i.test(String(blocker)));

    expect(nonAiDegraded, `${endpoint.label} may only degrade for missing platform AI credentials`).toEqual([]);
    expect(blockers, `${endpoint.label} should not report non-AI readiness blockers`).toEqual([]);
};

export const assertApiContract = async (request: APIRequestContext, endpoint: EndpointContract) => {
    const { response, payload } = await readJson(request, endpoint.path);
    const allowedStatuses = endpoint.allowStatuses || [200];
    expect(allowedStatuses, `${endpoint.label} returned unexpected status ${response.status()}`).toContain(response.status());
    assertPayloadEnvelope(payload, endpoint);
    assertAllowedHealthDegradation(payload, endpoint);

    const leaks = collectSensitiveLeaks(payload);
    expect(leaks, `${endpoint.label} should not leak secrets, hashes, mojibake, or raw credentials`).toEqual([]);
    return payload;
};

export const cleanupE2EArtifacts = async (request: APIRequestContext) => {
    const apiKeys = await readJson(request, '/api/admin/api-keys').catch(() => null);
    for (const key of unwrapRows(apiKeys?.payload)) {
        if (String(key.name || '').startsWith('e2e-') && key.id) {
            await request.delete(`/api/admin/api-keys/${encodeURIComponent(key.id)}`);
        }
    }

    const endpoints = await readJson(request, '/api/ai-endpoints').catch(() => null);
    for (const endpoint of unwrapRows(endpoints?.payload)) {
        if (String(endpoint.name || '').startsWith('e2e-') && endpoint.id) {
            await request.delete(`/api/ai-endpoints/${encodeURIComponent(endpoint.id)}`);
        }
    }

    const announcements = await readJson(request, '/api/admin/announcements').catch(() => null);
    for (const announcement of unwrapRows(announcements?.payload)) {
        if (String(announcement.title || '').startsWith('e2e-') && announcement.id) {
            await request.delete(`/api/admin/announcements/${encodeURIComponent(announcement.id)}`);
        }
    }
};
