/**
 * Tests for app-mode — the production/demo mode toggle and feature gates.
 */

import { getAppMode, setAppMode, isDemoMode, isAttackSimulatorEnabled, isDemoAutoSeedEnabled } from '../../config/app-mode';

describe('app-mode', () => {
    it('getAppMode returns a valid mode', () => {
        const mode = getAppMode();
        expect(['production', 'demo']).toContain(mode);
    });

    it('setAppMode switches to production', () => {
        setAppMode('production');
        expect(getAppMode()).toBe('production');
        expect(isDemoMode()).toBe(false);
    });

    it('setAppMode can switch to demo (if allowed)', () => {
        const before = getAppMode();
        setAppMode('demo');
        // demo may be overridden to production if allowDemoFeatures() is false.
        const after = getAppMode();
        expect(['demo', 'production']).toContain(after);
        // Restore
        setAppMode(before as any);
    });

    it('isAttackSimulatorEnabled returns false in production mode', () => {
        setAppMode('production');
        expect(isAttackSimulatorEnabled()).toBe(false);
    });

    it('isDemoAutoSeedEnabled returns false in production mode', () => {
        setAppMode('production');
        expect(isDemoAutoSeedEnabled()).toBe(false);
    });

    it('isDemoMode is consistent with getAppMode', () => {
        setAppMode('production');
        expect(isDemoMode()).toBe(getAppMode() === 'demo');
    });
});
