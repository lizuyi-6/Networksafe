import { getRolePermissions, hasPermission, normalizeRole } from '../../security/permissions';

describe('enterprise permissions', () => {
  it('maps legacy roles to enterprise roles', () => {
    expect(normalizeRole('admin')).toBe('platform_admin');
    expect(normalizeRole('tenant')).toBe('tenant_admin');
    expect(normalizeRole('viewer')).toBe('tenant_viewer');
  });

  it('separates create, approve, and evidence export permissions', () => {
    expect(hasPermission('tenant_operator', 'deployment.run.create')).toBe(true);
    expect(hasPermission('tenant_operator', 'deployment.run.approve')).toBe(false);
    expect(hasPermission('tenant_operator', 'deployment.evidence.export')).toBe(false);

    expect(hasPermission('tenant_admin', 'deployment.run.approve')).toBe(true);
    expect(hasPermission('auditor', 'deployment.run.create')).toBe(false);
    expect(hasPermission('auditor', 'deployment.evidence.export')).toBe(true);
  });

  it('grants platform admins the full M1 permission set', () => {
    const permissions = getRolePermissions('platform_admin');
    expect(permissions).toEqual(expect.arrayContaining([
      'gate.enroll',
      'deployment.run.create',
      'deployment.run.approve',
      'deployment.evidence.export',
      'helper.execute',
      'audit.break_glass.read'
    ]));
  });
});
