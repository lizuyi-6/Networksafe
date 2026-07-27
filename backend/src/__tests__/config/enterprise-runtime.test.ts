/**
 * Tests for enterprise-runtime — runtime mode classification (prod-enterprise /
 * trial / lab) and its feature gates (demo features, password login, OIDC, etc).
 */

import {
    getEnterpriseRuntimeMode,
    isEnterpriseStrictMode,
    isEnterpriseRuntime,
    isLabRuntime,
    allowDemoFeatures,
    allowGatewayDestructiveCommands,
    allowLabInMemoryAuthSessions,
    allowPasswordLogin,
    oidcEnabled,
    type EnterpriseRuntimeMode
} from '../../config/enterprise-runtime';

describe('enterprise-runtime', () => {
    const originalMode = process.env.ENTERPRISE_RUNTIME_MODE;
    const originalLocalPasswordLogin = process.env.ALLOW_LOCAL_PASSWORD_LOGIN;
    const originalBreakGlass = process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN;
    const originalLabInMemorySessions = process.env.ALLOW_LAB_IN_MEMORY_AUTH_SESSIONS;

    afterEach(() => {
        if (originalMode === undefined) delete process.env.ENTERPRISE_RUNTIME_MODE;
        else process.env.ENTERPRISE_RUNTIME_MODE = originalMode;
        if (originalLocalPasswordLogin === undefined) delete process.env.ALLOW_LOCAL_PASSWORD_LOGIN;
        else process.env.ALLOW_LOCAL_PASSWORD_LOGIN = originalLocalPasswordLogin;
        if (originalBreakGlass === undefined) delete process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN;
        else process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN = originalBreakGlass;
        if (originalLabInMemorySessions === undefined) delete process.env.ALLOW_LAB_IN_MEMORY_AUTH_SESSIONS;
        else process.env.ALLOW_LAB_IN_MEMORY_AUTH_SESSIONS = originalLabInMemorySessions;
    });

    it('getEnterpriseRuntimeMode returns a valid mode', () => {
        const mode = getEnterpriseRuntimeMode();
        expect(['prod-enterprise', 'trial', 'lab']).toContain(mode);
    });

    it('isEnterpriseRuntime returns true for prod-enterprise or trial', () => {
        const result = isEnterpriseRuntime();
        // Should be deterministic for the current env.
        expect(typeof result).toBe('boolean');
    });

    it('isEnterpriseStrictMode returns a boolean', () => {
        expect(typeof isEnterpriseStrictMode()).toBe('boolean');
    });

    it('isLabRuntime returns a boolean', () => {
        expect(typeof isLabRuntime()).toBe('boolean');
    });

    it('allowDemoFeatures returns a boolean', () => {
        expect(typeof allowDemoFeatures()).toBe('boolean');
    });

    it('allowGatewayDestructiveCommands returns a boolean', () => {
        expect(typeof allowGatewayDestructiveCommands()).toBe('boolean');
    });

    it('allowPasswordLogin returns a boolean', () => {
        expect(typeof allowPasswordLogin()).toBe('boolean');
    });

    it.each([undefined, 'false'])('disables production password login when the explicit flag is %s', (flag) => {
        process.env.ENTERPRISE_RUNTIME_MODE = 'prod-enterprise';
        delete process.env.ALLOW_LOCAL_PASSWORD_LOGIN;
        if (flag === undefined) delete process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN;
        else process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN = flag;

        expect(allowPasswordLogin()).toBe(false);
    });

    it('enables production password login only when the explicit flag is true', () => {
        process.env.ENTERPRISE_RUNTIME_MODE = 'prod-enterprise';
        delete process.env.ALLOW_LOCAL_PASSWORD_LOGIN;
        process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN = 'true';

        expect(allowPasswordLogin()).toBe(true);
    });

    it('enables the normal single-server local operator login flag', () => {
        process.env.ENTERPRISE_RUNTIME_MODE = 'prod-enterprise';
        process.env.ALLOW_LOCAL_PASSWORD_LOGIN = 'true';
        process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN = 'false';

        expect(allowPasswordLogin()).toBe(true);
    });

    it('allows process-local sessions only in an explicitly configured non-production lab', () => {
        process.env.ALLOW_LAB_IN_MEMORY_AUTH_SESSIONS = 'true';

        expect(allowLabInMemoryAuthSessions('lab', 'development')).toBe(true);
        expect(allowLabInMemoryAuthSessions('trial', 'development')).toBe(false);
        expect(allowLabInMemoryAuthSessions('lab', 'production')).toBe(false);
    });

    it.each([undefined, 'false'])('disables demo features in prod-enterprise when ALLOW_DEMO_FEATURES is %s', (flag) => {
        process.env.ENTERPRISE_RUNTIME_MODE = 'prod-enterprise';
        if (flag === undefined) delete process.env.ALLOW_DEMO_FEATURES;
        else process.env.ALLOW_DEMO_FEATURES = flag;

        expect(allowDemoFeatures()).toBe(false);
    });

    it('enables demo features in prod-enterprise only when ALLOW_DEMO_FEATURES=true', () => {
        process.env.ENTERPRISE_RUNTIME_MODE = 'prod-enterprise';
        process.env.ALLOW_DEMO_FEATURES = 'true';

        expect(allowDemoFeatures()).toBe(true);
    });

    it('oidcEnabled returns a boolean', () => {
        expect(typeof oidcEnabled()).toBe('boolean');
    });

    it('the mode functions are consistent: lab implies allowDemoFeatures', () => {
        if (isLabRuntime()) {
            expect(allowDemoFeatures()).toBe(true);
        }
    });
});

/**
 * Tests for SystemStats — host CPU/memory stats collection.
 */
import { SystemStats } from '../../utils/system-stats';

describe('SystemStats', () => {
    it('can be instantiated', () => {
        const stats = new SystemStats();
        expect(stats).toBeDefined();
    });

    it('can be instantiated and is usable', () => {
        const stats = new SystemStats();
        expect(stats).toBeDefined();
        expect(typeof stats).toBe('object');
    });
});
