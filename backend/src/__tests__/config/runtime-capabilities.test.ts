/**
 * Tests for runtime-capabilities — feature flags derived from environment.
 */

import { isDevLoginPresetEnabled, getRuntimeCapabilities } from '../../config/runtime-capabilities';

describe('runtime-capabilities', () => {
    it('isDevLoginPresetEnabled returns a boolean', () => {
        expect(typeof isDevLoginPresetEnabled()).toBe('boolean');
    });

    it('getRuntimeCapabilities returns an object', () => {
        const caps = getRuntimeCapabilities();
        expect(caps).toBeDefined();
        expect(typeof caps).toBe('object');
    });

    it('getRuntimeCapabilities is deterministic across calls', () => {
        const a = getRuntimeCapabilities();
        const b = getRuntimeCapabilities();
        expect(a).toEqual(b);
    });
});
