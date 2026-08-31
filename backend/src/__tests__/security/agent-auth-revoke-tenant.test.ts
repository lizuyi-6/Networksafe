/**
 * SECURITY regression tests (audit 2026-08, P0): AgentAuth.revokeAgent is
 * tenant-scoped. A tenant-scoped caller must not be able to revoke another
 * tenant's agent; unknown and cross-tenant IDs are indistinguishable to the
 * caller (both return false, surfaced as HTTP 404). Only a platform-level
 * caller (no tenantId option) may revoke across tenants.
 */

import { initDatabase } from '../../config/database';
import agentAuthService from '../../security/agent-auth.service';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

describe('agentAuth.revokeAgent — tenant scoping', () => {
  const runTag = Date.now();
  const tenantA = `tenant-revoke-a-${runTag}`;
  const tenantB = `tenant-revoke-b-${runTag}`;
  let agentAId = '';
  let agentBId = '';

  beforeAll(async () => {
    await initDatabase();
    const a = agentAuthService.registerAgent({
      hostname: `revoke-a-${runTag}.test`,
      platform: 'linux',
      tenantId: tenantA
    });
    const b = agentAuthService.registerAgent({
      hostname: `revoke-b-${runTag}.test`,
      platform: 'linux',
      tenantId: tenantB
    });
    agentAId = a.agentId;
    agentBId = b.agentId;
  });

  it('refuses a cross-tenant revoke and leaves the agent active', () => {
    expect(agentAuthService.revokeAgent(agentAId, { tenantId: tenantB })).toBe(false);
    expect(agentAuthService.getAgentStatus(agentAId)).not.toBe('revoked');
  });

  it('returns false for an unknown agent id (indistinguishable from cross-tenant)', () => {
    expect(agentAuthService.revokeAgent('agent-never-registered', { tenantId: tenantA })).toBe(false);
  });

  it('allows the owning tenant to revoke its own agent', () => {
    expect(agentAuthService.revokeAgent(agentBId, { tenantId: tenantB })).toBe(true);
    expect(agentAuthService.getAgentStatus(agentBId)).toBe('revoked');
  });

  it('keeps returning true (idempotent) when the agent is already revoked', () => {
    expect(agentAuthService.revokeAgent(agentBId, { tenantId: tenantB })).toBe(true);
    expect(agentAuthService.getAgentStatus(agentBId)).toBe('revoked');
  });

  it('allows a platform-level override (no tenant scoping) to revoke across tenants', () => {
    expect(agentAuthService.revokeAgent(agentAId)).toBe(true);
    expect(agentAuthService.getAgentStatus(agentAId)).toBe('revoked');
  });
});
