/**
 * Tests for the HAL (Hardware Abstraction Layer) factory — createCaptureInterface
 * returns the platform-appropriate capture implementation. Verifies the factory
 * dispatches correctly and each platform class can be instantiated.
 */

import { createCaptureInterface, LinuxCapture, WindowsCapture, MacOSCapture } from '../../../traffic-interceptor/core/hal';

describe('HAL (capture interface factory)', () => {
    it('createCaptureInterface returns a LinuxCapture for "linux"', () => {
        const capture = createCaptureInterface('linux');
        expect(capture).toBeDefined();
        expect(capture instanceof LinuxCapture).toBe(true);
    });

    it('createCaptureInterface returns a WindowsCapture for "windows"', () => {
        const capture = createCaptureInterface('windows');
        expect(capture).toBeDefined();
        expect(capture instanceof WindowsCapture).toBe(true);
    });

    it('createCaptureInterface returns a MacOSCapture for "macos"', () => {
        const capture = createCaptureInterface('macos');
        expect(capture).toBeDefined();
        expect(capture instanceof MacOSCapture).toBe(true);
    });

    it('each capture interface has start/stop methods', () => {
        for (const platform of ['linux', 'windows', 'macos'] as const) {
            const capture = createCaptureInterface(platform);
            expect(typeof capture.start).toBe('function');
            expect(typeof capture.stop).toBe('function');
        }
    });

    it('throws for an unsupported platform', () => {
        expect(() => createCaptureInterface('solaris' as any)).toThrow(/Unsupported platform/);
    });
});
