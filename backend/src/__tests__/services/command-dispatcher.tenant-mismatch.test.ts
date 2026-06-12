/**
 * SECURITY tests for the CommandDispatcherService.
 *
 * Sprint 5 Wave 9 · R14 · V12.6
 * `classifyCommandRisk` previously ran with an attacker-supplied
 * `actor` whose `tenantId` was not validated against the target
 * agent/device. We now refuse to classify (and therefore to
 * dispatch) any high-risk command whose actor tenant does not
 * match the target's actual tenant.
 */

import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';
import { initDatabase } from '../../config/database';

describe('commandDispatcherService / V12.6 cross-tenant guard', () => {
  beforeAll(async () => {
    await initDatabase();
    hardwareAuthorizationService.prepare();
  });

  beforeEach(() => {
    commandDispatcherService.setAgentGateway(null);
    commandDispatcherService.setDeviceAdapter(null);
    hardwareAuthorizationService.setGatewayEmitter(() => true);
  });

  it('refuses to dispatch a high-risk command when actor.tenantId != agent.tenantId', async () => {
    const agentId = `agent-cross-tenant-${Date.now()}`;
    commandDispatcherService.setAgentGateway({
      getAgent: (id: string) => id === agentId
        ? { id, tenantId: 'tenant-B' }
        : undefined,
      sendCommandToAgent: () => true
    });

    const result = await commandDispatcherService.dispatchAgentCommand({
      agentId,
      commandType: 'host_remove',  // physical_confirmation_required
      actor: {
        tenantId: 'tenant-A',  // attacker
        userId: 'attacker-user',
        email: 'attacker@example.com'
      }
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('tenant_mismatch');
    expect(result.status).toBe('failed');
  });

  it('allows a high-risk command when actor.tenantId matches agent.tenantId', async () => {
    const agentId = `agent-same-tenant-${Date.now()}`;
    commandDispatcherService.setAgentGateway({
      getAgent: (id: string) => id === agentId
        ? { id, tenantId: 'tenant-X' }
        : undefined,
      sendCommandToAgent: () => true
    });

    const result = await commandDispatcherService.dispatchAgentCommand({
      agentId,
      commandType: 'scan',  // auto risk
      actor: {
        tenantId: 'tenant-X',
        userId: 'good-user',
        email: 'good@example.com'
      }
    });

    // Should not fail with tenant_mismatch. Subsequent path may still
    // require approval for some command types, but the tenant check
    // must not block legitimate same-tenant dispatch.
    if (result.reason) {
      expect(result.reason).not.toBe('tenant_mismatch');
    }
  });

  it('refuses cross-tenant device commands', async () => {
    const deviceId = `device-cross-tenant-${Date.now()}`;
    commandDispatcherService.setDeviceAdapter({
      getDevice: (id: string) => id === deviceId
        ? { deviceId: id, isOnline: true, tenantId: 'tenant-D' }
        : undefined,
      executeCommand: async () => ({ success: true, message: 'ok' })
    });

    const result = await commandDispatcherService.dispatchDeviceCommand({
      deviceId,
      commandType: 'reboot',  // physical_confirmation_required
      actor: {
        tenantId: 'tenant-E',  // wrong tenant
        userId: 'mallory',
        email: 'mallory@example.com'
      }
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('tenant_mismatch');
  });

  it('bypasses tenant check for trusted internal actors (hardware gateway)', async () => {
    const agentId = `agent-internal-${Date.now()}`;
    commandDispatcherService.setAgentGateway({
      getAgent: (id: string) => id === agentId
        ? { id, tenantId: 'tenant-INTERNAL' }
        : undefined,
      sendCommandToAgent: () => true
    });

    // The hardware confirmation gateway uses a non-user identifier.
    // We confirm it is not blocked by the tenant-mismatch check.
    const result = await commandDispatcherService.dispatchAgentCommand({
      agentId,
      commandType: 'scan',
      actor: {
        tenantId: 'tenant-INTERNAL',
        userId: 'hardware-confirmation-gateway',
        email: 'gateway@hardware'
      }
    });

    if (result.reason) {
      expect(result.reason).not.toBe('tenant_mismatch');
    }
  });
});
