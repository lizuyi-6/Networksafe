/**
 * REDTEAM SECURITY TEST — Cross-tenant command dispatch via empty userId
 * =====================================================================
 *
 * Threat model: the V12.6 cross-tenant gate in
 * `commandDispatcherService.rejectCrossTenantIfMismatch` is supposed to
 * block any user-initiated command whose `actor.tenantId` does not match
 * the target's tenant. The gate short-circuits to "allow" when the actor
 * looks like an internal trusted actor (hardware-confirmation-gateway,
 * agent acks, etc.) — the check is implemented as:
 *
 *   const isInternalActor = !input.actor.userId
 *     || input.actor.userId === 'hardware-confirmation-gateway'
 *     || input.actor.userId.startsWith('agent:');
 *
 * The `!input.actor.userId` short-circuit means any user-controlled
 * CommandActor with an empty / null / 0 userId is silently classified
 * as a trusted internal actor. The V12.6 cross-tenant check is then
 * skipped entirely.
 *
 * Exploit: a tenant_admin in tenant A whose JSON-deserialized request
 * body has `userId: ''` (or whose upstream code forgot to set the field)
 * dispatches a high-risk command (e.g. `host_remove`, `factory_reset`,
 * `wipe_data`) to a device enrolled in tenant B. The dispatcher sees
 * isInternalActor === true, returns null from rejectCrossTenantIfMismatch,
 * and the command proceeds across the tenant boundary.
 *
 * Fix proposals (Sprint target):
 *   1. Use a typed discriminator on `CommandActor` (e.g.
 *      `kind: 'user' | 'system' | 'agent-ack' | 'hardware-gateway'`) and
 *      base the internal-actor check on `kind`, not on a substring match
 *      against `userId`. A user-facing actor with `userId: ''` should
 *      either be rejected (Zod-validated) or fall through to the strict
 *      tenant-match branch.
 *   2. Validate `actor.userId` at the entry point: an empty / null
 *      `userId` for a user-initiated command is a hard 400.
 *   3. Tighten the type so `userId` cannot be the empty string at
 *      compile time (use a branded `NonEmptyString` type or a runtime
 *      guard).
 */

import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { hardwareAuthorizationService } from '../../services/hardware-authorization.service';
import { initDatabase } from '../../config/database';

describe('REDTEAM cross-tenant command — empty userId V12.6 bypass', () => {
  beforeAll(async () => {
    await initDatabase();
    hardwareAuthorizationService.prepare();
  });

  beforeEach(() => {
    commandDispatcherService.setAgentGateway(null);
    commandDispatcherService.setDeviceAdapter(null);
    hardwareAuthorizationService.setGatewayEmitter(() => true);
  });

  it('bypasses cross-tenant gate when actor.userId is the empty string', async () => {
    // Mock the device adapter so the target device resolves to a
    // DIFFERENT tenant from the actor. The actor's tenantId is 'tenant-A'
    // and the device is enrolled in 'tenant-B' — this MUST be rejected
    // by the V12.6 gate.
    commandDispatcherService.setDeviceAdapter({
      getDevice: (id: string) => ({
        id,
        tenantId: 'tenant-B',
        isOnline: true,
        deviceType: 'control-board',
        physicalAuth: { publicKeyPem: '' }
      }),
      executeCommand: async () => ({ success: true, message: 'dispatched' })
    });

    // The exploit: actor.userId is the empty string. Per the V12.6 code,
    // isInternalActor = !userId === true, the cross-tenant check is
    // skipped, and the command proceeds. Use `block_ip` (an `auto`
    // command) so we hit the cross-tenant branch directly without the
    // hardware-gate pre-emption that high-risk commands trigger.
    const result = await commandDispatcherService.dispatchDeviceCommand({
      deviceId: 'device-in-tenant-B',
      commandType: 'block_ip',
      payload: { ip: '203.0.113.66' },
      actor: {
        tenantId: 'tenant-A',
        userId: '', // <-- the exploit
        email: 'admin@tenant-A',
        ip: '1.2.3.4'
      }
    });

    // After the R2 fix, the dispatcher must reject the cross-tenant
    // dispatch with a non-success result. The specific reason may be
    // either 'actor_userid_required' (the empty userId itself) or
    // 'tenant_mismatch' (the cross-tenant check after the empty
    // userId guard) — both defeat the bypass. We accept either so
    // the test is robust to design choices.
    expect(result.success).toBe(false);
    expect(['actor_userid_required', 'tenant_mismatch']).toContain(result.reason);
    expect(result.status).toBe('failed');
  });

  it('bypasses cross-tenant gate when actor.userId is missing (undefined)', async () => {
    // Same exploit via JSON deserialization: an undefined userId field
    // also short-circuits !userId === true.
    commandDispatcherService.setDeviceAdapter({
      getDevice: (id: string) => ({
        id,
        tenantId: 'tenant-B',
        isOnline: true,
        deviceType: 'control-board',
        physicalAuth: { publicKeyPem: '' }
      }),
      executeCommand: async () => ({ success: true, message: 'dispatched' })
    });

    const actor: any = {
      tenantId: 'tenant-A',
      // userId intentionally omitted
      email: 'admin@tenant-A',
      ip: '1.2.3.4'
    };

    const result = await commandDispatcherService.dispatchDeviceCommand({
      deviceId: 'device-in-tenant-B',
      commandType: 'block_ip',
      payload: { ip: '203.0.113.66' },
      actor
    });

    expect(result.success).toBe(false);
    expect(['actor_userid_required', 'tenant_mismatch']).toContain(result.reason);
  });

  it('still allows legitimate same-tenant dispatch (regression check)', async () => {
    commandDispatcherService.setDeviceAdapter({
      getDevice: (id: string) => ({
        id,
        tenantId: 'tenant-A',
        isOnline: true,
        deviceType: 'control-board',
        physicalAuth: { publicKeyPem: '' }
      }),
      executeCommand: async () => ({ success: true, message: 'dispatched' })
    });

    const result = await commandDispatcherService.dispatchDeviceCommand({
      deviceId: 'device-in-tenant-A',
      commandType: 'block_ip',
      payload: { ip: '203.0.113.66' },
      actor: {
        kind: 'user',
        tenantId: 'tenant-A',
        userId: 'real-admin-uuid',
        email: 'admin@tenant-A',
        ip: '1.2.3.4'
      }
    });

    // The fix must not break the happy path: same-tenant dispatch with
    // a non-empty userId still works.
    expect(result.success).toBe(true);
  });

  it('REFUSES bypass via kind="user" + agent: prefix (R2-deep typed discriminator)', async () => {
    // R2 fix used `userId.startsWith('agent:')` which still let an
    // attacker with userId="agent:foo" bypass the cross-tenant check.
    // R2-deep replaces the string prefix match with a typed kind
    // discriminator. An actor with kind='user' MUST go through the
    // strict cross-tenant check regardless of what the userId string
    // contains.
    commandDispatcherService.setDeviceAdapter({
      getDevice: (id: string) => ({
        id,
        tenantId: 'tenant-B',
        isOnline: true,
        deviceType: 'control-board',
        physicalAuth: { publicKeyPem: '' }
      }),
      executeCommand: async () => ({ success: true, message: 'dispatched' })
    });

    const result = await commandDispatcherService.dispatchDeviceCommand({
      deviceId: 'device-in-tenant-B',
      commandType: 'block_ip',
      payload: { ip: '203.0.113.66' },
      actor: {
        kind: 'user',                     // <-- kind is 'user', so the
                                          //     string userId is irrelevant
        tenantId: 'tenant-A',
        userId: 'agent:fake-prefix',      // <-- the exploit
        email: 'admin@tenant-A',
        ip: '1.2.3.4'
      }
    });

    // R2-deep: the cross-tenant check is now driven by the kind
    // discriminator, not a substring match on userId. The 'agent:'
    // prefix no longer grants internal-actor trust.
    expect(result.success).toBe(false);
    expect(result.reason).toBe('tenant_mismatch');
  });

  it('ALLOWS hardware-gateway kind to dispatch without cross-tenant check (legitimate internal path)', async () => {
    commandDispatcherService.setDeviceAdapter({
      getDevice: (id: string) => ({
        id,
        tenantId: 'tenant-B',                // even cross-tenant, the
        isOnline: true,                       // hardware-gateway is trusted
        deviceType: 'control-board',
        physicalAuth: { publicKeyPem: '' }
      }),
      executeCommand: async () => ({ success: true, message: 'dispatched' })
    });

    const result = await commandDispatcherService.dispatchDeviceCommand({
      deviceId: 'device-in-tenant-B',
      commandType: 'block_ip',
      payload: { ip: '203.0.113.66' },
      actor: {
        kind: 'hardware-gateway',            // <-- typed internal caller
        tenantId: 'tenant-A',
        userId: 'hardware-confirmation-gateway',
        email: 'admin@tenant-A',
        ip: 'gate:some-gate'
      }
    });

    // The hardware-gateway is a trusted internal caller; the
    // cross-tenant check is intentionally bypassed for confirmed grants.
    expect(result.success).toBe(true);
  });
});
