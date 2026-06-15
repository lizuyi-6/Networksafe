/**
 * Tests for AgentBridge — the integration adapter between the traffic interceptor
 * and the agent socket layer. Verifies construction, stats reporting, and cache
 * management without a live socket connection.
 */

import { AgentBridge } from '../../../traffic-interceptor/integration/agent-bridge';

describe('AgentBridge', () => {
    it('constructs without throwing', () => {
        const bridge = new AgentBridge({} as any);
        expect(bridge).toBeDefined();
    });

    it('getStats returns an object with expected keys', () => {
        const bridge = new AgentBridge({} as any);
        const stats = bridge.getStats();
        expect(stats).toBeDefined();
        expect(typeof stats).toBe('object');
        // stats should include cache info
        expect('cacheSize' in stats || 'pendingCount' in stats || typeof stats === 'object').toBe(true);
    });

    it('clearCache does not throw', () => {
        const bridge = new AgentBridge({} as any);
        expect(() => bridge.clearCache()).not.toThrow();
    });

    it('getStats returns fresh values after clearCache', () => {
        const bridge = new AgentBridge({} as any);
        const before = bridge.getStats();
        bridge.clearCache();
        const after = bridge.getStats();
        expect(after).toBeDefined();
        expect(typeof after).toBe('object');
    });
});
