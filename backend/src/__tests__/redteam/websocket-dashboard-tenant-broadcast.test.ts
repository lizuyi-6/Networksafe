import { PLATFORM_TENANT_ID } from '../../core/tenant/tenant-context';
import { AgentGateway } from '../../websocket/agent-gateway';

describe('AgentGateway dashboard broadcast tenant boundary', () => {
  function harness() {
    const emitted: Array<{ socketId: string; event: string; data: unknown }> = [];
    const gateway = Object.create(AgentGateway.prototype) as AgentGateway;

    (gateway as any).dashboardClients = new Map([
      ['socket-a', { socketId: 'socket-a', tenantId: 'tenant-a' }],
      ['socket-b', { socketId: 'socket-b', tenantId: 'tenant-b' }],
      ['socket-platform', { socketId: 'socket-platform', tenantId: PLATFORM_TENANT_ID }]
    ]);
    (gateway as any).io = {
      to: (socketId: string) => ({
        emit: (event: string, data: unknown) => emitted.push({ socketId, event, data })
      })
    };

    return { gateway, emitted };
  }

  it('drops a broadcast with no tenant instead of sending it to every dashboard', () => {
    const { gateway, emitted } = harness();

    gateway.broadcastToDashboards('agent:log', { message: 'scope missing' });

    expect(emitted).toEqual([]);
  });

  it('sends a tenant event only to that tenant and the platform tenant', () => {
    const { gateway, emitted } = harness();

    gateway.broadcastToDashboards('agent:log', { tenantId: 'tenant-a', message: 'tenant-a only' });

    expect(emitted.map((entry) => entry.socketId)).toEqual(['socket-a', 'socket-platform']);
    expect(emitted.every((entry) => (entry.data as any).tenantId === 'tenant-a')).toBe(true);
  });

  it('uses the explicit tenant option as the authoritative scope', () => {
    const { gateway, emitted } = harness();

    gateway.broadcastToDashboards(
      'agent:log',
      { tenantId: 'tenant-b', message: 'payload tenant is not authoritative' },
      { tenantId: 'tenant-a' }
    );

    expect(emitted.map((entry) => entry.socketId)).toEqual(['socket-a', 'socket-platform']);
  });
});
