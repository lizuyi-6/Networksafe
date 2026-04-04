/**
 * Tenant Context Tests
 */

import {
  normalizeTenantId,
  buildPlatformTenantContext,
  resolveUserTenantContext,
  resolveAgentTenantContext,
  resolveDeviceTenantContext,
  PLATFORM_TENANT_ID,
} from '../../../core/tenant/tenant-context';

describe('normalizeTenantId', () => {
  it('returns trimmed string for valid input', () => {
    expect(normalizeTenantId('  tenant-123  ')).toBe('tenant-123');
  });

  it('returns undefined for null', () => {
    expect(normalizeTenantId(null as any)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(normalizeTenantId(undefined as any)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(normalizeTenantId('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only string', () => {
    expect(normalizeTenantId('   ')).toBeUndefined();
  });

  it('returns undefined for non-string types', () => {
    expect(normalizeTenantId(123 as any)).toBeUndefined();
    expect(normalizeTenantId({} as any)).toBeUndefined();
  });
});

describe('buildPlatformTenantContext', () => {
  it('returns platform tenant context', () => {
    const ctx = buildPlatformTenantContext('test-reason');
    expect(ctx.tenantId).toBe(PLATFORM_TENANT_ID);
    expect(ctx.source).toBe('platform');
    expect(ctx.reason).toBe('test-reason');
  });
});

describe('resolveUserTenantContext', () => {
  it('returns null when user is undefined', () => {
    expect(resolveUserTenantContext(undefined)).toBeNull();
  });

  it('returns null when user is null', () => {
    expect(resolveUserTenantContext(null as any)).toBeNull();
  });

  it('prefers requestedTenantId over user tenant', () => {
    const user = { tenantId: 'user-tenant', role: 'user' } as any;
    const ctx = resolveUserTenantContext(user, { requestedTenantId: 'requested-tenant' });
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe('requested-tenant');
    expect(ctx!.source).toBe('request');
  });

  it('falls back to user tenantId when no requested', () => {
    const user = { tenantId: 'user-tenant', role: 'user' } as any;
    const ctx = resolveUserTenantContext(user);
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe('user-tenant');
    expect(ctx!.source).toBe('user');
  });

  it('returns platform context for admin with fallback enabled', () => {
    const user = { role: 'admin' } as any;
    const ctx = resolveUserTenantContext(user, { allowAdminPlatformFallback: true });
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe(PLATFORM_TENANT_ID);
    expect(ctx!.source).toBe('platform');
  });

  it('returns null for admin without fallback and no tenant', () => {
    const user = { role: 'admin' } as any;
    const ctx = resolveUserTenantContext(user);
    expect(ctx).toBeNull();
  });

  it('returns null for non-admin without tenant', () => {
    const user = { role: 'user' } as any;
    const ctx = resolveUserTenantContext(user);
    expect(ctx).toBeNull();
  });

  it('normalizes whitespace in requestedTenantId', () => {
    const user = { tenantId: 'x' } as any;
    const ctx = resolveUserTenantContext(user, { requestedTenantId: '  t1  ' });
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe('t1');
  });

  it('ignores empty requestedTenantId and uses user tenant', () => {
    const user = { tenantId: 'user-tenant', role: 'user' } as any;
    const ctx = resolveUserTenantContext(user, { requestedTenantId: '   ' });
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe('user-tenant');
    expect(ctx!.source).toBe('user');
  });
});

describe('resolveAgentTenantContext', () => {
  it('returns agent context with normalized tenant', () => {
    const ctx = resolveAgentTenantContext('  agent-tenant  ');
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe('agent-tenant');
    expect(ctx!.source).toBe('agent');
    expect(ctx!.reason).toBe('agent-connection');
  });

  it('returns agent context with custom reason', () => {
    const ctx = resolveAgentTenantContext('t1', 'custom-reason');
    expect(ctx!.reason).toBe('custom-reason');
  });

  it('returns null for undefined tenant', () => {
    expect(resolveAgentTenantContext(undefined)).toBeNull();
  });

  it('returns null for empty string tenant', () => {
    expect(resolveAgentTenantContext('')).toBeNull();
  });

  it('returns null for whitespace-only tenant', () => {
    expect(resolveAgentTenantContext('   ')).toBeNull();
  });
});

describe('resolveDeviceTenantContext', () => {
  it('returns device context when tenant provided', () => {
    const ctx = resolveDeviceTenantContext('device-tenant');
    expect(ctx.tenantId).toBe('device-tenant');
    expect(ctx.source).toBe('device');
  });

  it('returns platform context when no tenant provided', () => {
    const ctx = resolveDeviceTenantContext();
    expect(ctx.tenantId).toBe(PLATFORM_TENANT_ID);
    expect(ctx.source).toBe('platform');
    expect(ctx.reason).toBe('device-platform-scope');
  });
});
