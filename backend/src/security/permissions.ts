export type EnterpriseRole =
  | 'admin'
  | 'tenant'
  | 'viewer'
  | 'platform_admin'
  | 'tenant_admin'
  | 'tenant_operator'
  | 'tenant_viewer'
  | 'auditor';

export type Permission =
  | 'auth.break_glass'
  | 'auth.oidc_login'
  | 'gate.read'
  | 'gate.enroll'
  | 'gate.manage'
  | 'deployment.run.read'
  | 'deployment.run.create'
  | 'deployment.run.approve'
  | 'deployment.run.execute'
  | 'deployment.evidence.read'
  | 'deployment.evidence.export'
  | 'helper.register'
  | 'helper.heartbeat'
  | 'helper.execute'
  | 'audit.break_glass.read'
  | 'audit.read'
  | 'tenant.admin';

const ROLE_ALIASES: Record<string, EnterpriseRole> = {
  admin: 'platform_admin',
  tenant: 'tenant_admin',
  viewer: 'tenant_viewer',
  platform_admin: 'platform_admin',
  tenant_admin: 'tenant_admin',
  tenant_operator: 'tenant_operator',
  tenant_viewer: 'tenant_viewer',
  auditor: 'auditor'
};

const ROLE_PERMISSIONS: Record<EnterpriseRole, Permission[]> = {
  admin: [
    'auth.break_glass',
    'auth.oidc_login',
    'gate.read',
    'gate.enroll',
    'gate.manage',
    'deployment.run.read',
    'deployment.run.create',
    'deployment.run.approve',
    'deployment.run.execute',
    'deployment.evidence.read',
    'deployment.evidence.export',
    'helper.register',
    'helper.heartbeat',
    'helper.execute',
    'audit.break_glass.read',
    'audit.read',
    'tenant.admin'
  ],
  tenant: [
    'auth.oidc_login',
    'gate.read',
    'deployment.run.read',
    'deployment.run.create',
    'deployment.evidence.read'
  ],
  viewer: [
    'auth.oidc_login',
    'deployment.run.read'
  ],
  platform_admin: [
    'auth.break_glass',
    'auth.oidc_login',
    'gate.read',
    'gate.enroll',
    'gate.manage',
    'deployment.run.read',
    'deployment.run.create',
    'deployment.run.approve',
    'deployment.run.execute',
    'deployment.evidence.read',
    'deployment.evidence.export',
    'helper.register',
    'helper.heartbeat',
    'helper.execute',
    'audit.break_glass.read',
    'audit.read',
    'tenant.admin'
  ],
  tenant_admin: [
    'auth.oidc_login',
    'gate.read',
    'gate.enroll',
    'deployment.run.read',
    'deployment.run.create',
    'deployment.run.approve',
    'deployment.evidence.read',
    'deployment.evidence.export',
    'audit.read'
  ],
  tenant_operator: [
    'auth.oidc_login',
    'gate.read',
    'deployment.run.read',
    'deployment.run.create',
    'deployment.evidence.read'
  ],
  tenant_viewer: [
    'auth.oidc_login',
    'deployment.run.read',
    'deployment.evidence.read'
  ],
  auditor: [
    'auth.oidc_login',
    'deployment.run.read',
    'deployment.evidence.read',
    'deployment.evidence.export',
    'audit.break_glass.read',
    'audit.read'
  ]
};

export function normalizeRole(role?: string | null): EnterpriseRole {
  const normalized = String(role || '').trim().toLowerCase();
  return ROLE_ALIASES[normalized] || 'tenant_viewer';
}

export function getRolePermissions(role?: string | null): Permission[] {
  const normalized = normalizeRole(role);
  return [...new Set(ROLE_PERMISSIONS[normalized] || [])];
}

export function hasPermission(role: string | null | undefined, permission: Permission): boolean {
  return getRolePermissions(role).includes(permission);
}

export function isPlatformAdminRole(role?: string | null): boolean {
  return normalizeRole(role) === 'platform_admin';
}

export function isBreakGlassRole(role?: string | null): boolean {
  return hasPermission(role, 'auth.break_glass');
}
