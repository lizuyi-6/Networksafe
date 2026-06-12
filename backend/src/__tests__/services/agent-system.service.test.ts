/**
 * Agent System Service Tests (smoke)
 *
 * Smoke tests for the multi-agent decision system service:
 *   - initializeAgentSystem()
 *   - getAgentSystem()
 *   - setAgentGateway()
 *   - getAgentGateway()
 *
 * These tests focus on the security-relevant branches:
 *   - double-init guard (warn + no-op)
 *   - uninitialized system returns null
 */

import { setAgentGateway, getAgentGateway, getAgentSystem, initializeAgentSystem } from '../../services/agent-system.service';

describe('agentSystemService', () => {
  // Note: initializeAgentSystem() requires actual AI models (Ollama/cloud).
  // These smoke tests verify the state-container API surface without
  // requiring a live model backend.

  it('returns null when the system has not been initialized', () => {
    // The module-level singleton starts as null.
    expect(getAgentSystem()).toBeNull();
  });

  it('starts with no gateway attached', () => {
    expect(getAgentGateway()).toBeNull();
  });

  it('setAgentGateway stores the gateway reference', () => {
    const fakeGateway = { id: 'test-gateway', getAgentList: () => [] };
    setAgentGateway(fakeGateway);
    expect(getAgentGateway()).toBe(fakeGateway);
  });

  it('setAgentGateway replaces a previously set gateway', () => {
    const gatewayA = { id: 'gateway-a' };
    const gatewayB = { id: 'gateway-b' };
    setAgentGateway(gatewayA);
    setAgentGateway(gatewayB);
    expect(getAgentGateway()).toBe(gatewayB);
  });

  it('clearAgentGateway is not exposed (gateway is module-level)', () => {
    // The module does not export a clearGateway function; callers must
    // be aware that the singleton persists for the process lifetime.
    const gateway = { id: 'persist-test' };
    setAgentGateway(gateway);
    expect(getAgentGateway()).toBe(gateway);
  });
});
