/**
 * Tests for the RBAC permission module — role normalization, role→permission
 * mapping, and permission queries. Security-critical: these decisions gate every
 * privileged action (gate manage, final-defense execute, deployment approve, etc).
 */

import {
    normalizeRole,
    getRolePermissions,
    hasPermission,
    isPlatformAdminRole,
    isBreakGlassRole,
    type EnterpriseRole,
    type Permission
} from '../../security/permissions';

describe('permissions (RBAC)', () => {
    describe('normalizeRole', () => {
        it('maps legacy aliases to canonical enterprise roles', () => {
            expect(normalizeRole('admin')).toBe<EnterpriseRole>('platform_admin');
            expect(normalizeRole('tenant')).toBe<EnterpriseRole>('tenant_admin');
            expect(normalizeRole('viewer')).toBe<EnterpriseRole>('tenant_viewer');
        });
        it('passes canonical roles through', () => {
            for (const r of ['platform_admin', 'tenant_admin', 'tenant_operator', 'tenant_viewer', 'auditor']) {
                expect(normalizeRole(r)).toBe<EnterpriseRole>(r as EnterpriseRole);
            }
        });
        it('is case-insensitive and trims whitespace', () => {
            expect(normalizeRole('  PLATFORM_ADMIN ')).toBe('platform_admin');
            expect(normalizeRole('Tenant_Admin')).toBe('tenant_admin');
        });
        it('defaults unknown / missing roles to tenant_viewer (least privilege)', () => {
            expect(normalizeRole('superuser')).toBe<EnterpriseRole>('tenant_viewer');
            expect(normalizeRole('')).toBe<EnterpriseRole>('tenant_viewer');
            expect(normalizeRole(null)).toBe<EnterpriseRole>('tenant_viewer');
            expect(normalizeRole(undefined)).toBe<EnterpriseRole>('tenant_viewer');
        });
    });

    describe('privilege ordering (platform_admin >= tenant_admin > operator > viewer)', () => {
        it('platform_admin has every permission tenant_admin has (superset)', () => {
            const platform = new Set(getRolePermissions('platform_admin'));
            const tenant = getRolePermissions('tenant_admin');
            for (const p of tenant) {
                expect(platform.has(p)).toBe(true);
            }
        });
        it('tenant_viewer (least privilege) cannot manage anything', () => {
            expect(hasPermission('tenant_viewer', 'gate.manage')).toBe(false);
            expect(hasPermission('tenant_viewer', 'final_defense.manage')).toBe(false);
            expect(hasPermission('tenant_viewer', 'final_defense.execute')).toBe(false);
            expect(hasPermission('tenant_viewer', 'deployment.run.approve')).toBe(false);
            expect(hasPermission('tenant_viewer', 'tenant.admin')).toBe(false);
        });
        it('only platform_admin can break glass and act as tenant admin', () => {
            expect(hasPermission('platform_admin', 'auth.break_glass')).toBe(true);
            expect(hasPermission('platform_admin', 'tenant.admin')).toBe(true);
            expect(hasPermission('tenant_admin', 'auth.break_glass')).toBe(false);
            expect(hasPermission('tenant_admin', 'tenant.admin')).toBe(false);
        });
    });

    describe('sensitive permissions are scoped to the right roles', () => {
        const cases: Array<[Permission, EnterpriseRole[], EnterpriseRole[]]> = [
            // permission,            roles that HAVE it,                sample roles that DON'T
            ['final_defense.execute', ['platform_admin', 'tenant_admin', 'tenant_operator'], ['tenant_viewer', 'auditor']],
            ['deployment.run.approve', ['platform_admin', 'tenant_admin'], ['tenant_operator', 'tenant_viewer', 'auditor']],
            ['deployment.evidence.export', ['platform_admin', 'tenant_admin', 'auditor'], ['tenant_operator', 'tenant_viewer']],
            ['gate.manage', ['platform_admin'], ['tenant_admin', 'tenant_operator', 'tenant_viewer', 'auditor']],
            ['audit.read', ['platform_admin', 'tenant_admin', 'auditor'], ['tenant_operator', 'tenant_viewer']]
        ];
        for (const [perm, allowed, denied] of cases) {
            it(`${perm} granted to ${allowed.join('/')}`, () => {
                for (const r of allowed) expect(hasPermission(r, perm)).toBe(true);
            });
            it(`${perm} denied to ${denied.join('/')}`, () => {
                for (const r of denied) expect(hasPermission(r, perm)).toBe(false);
            });
        }
    });

    describe('query helpers', () => {
        it('getRolePermissions returns a deduplicated array', () => {
            const perms = getRolePermissions('platform_admin');
            expect(new Set(perms).size).toBe(perms.length);
            expect(perms.length).toBeGreaterThan(0);
        });
        it('isPlatformAdminRole is true only for platform_admin (and admin alias)', () => {
            expect(isPlatformAdminRole('platform_admin')).toBe(true);
            expect(isPlatformAdminRole('admin')).toBe(true); // alias
            expect(isPlatformAdminRole('tenant_admin')).toBe(false);
            expect(isPlatformAdminRole('auditor')).toBe(false);
            expect(isPlatformAdminRole('unknown')).toBe(false);
        });
        it('isBreakGlassRole mirrors the auth.break_glass permission', () => {
            expect(isBreakGlassRole('platform_admin')).toBe(true);
            expect(isBreakGlassRole('admin')).toBe(true); // alias -> platform_admin
            expect(isBreakGlassRole('tenant_admin')).toBe(false);
            expect(isBreakGlassRole('auditor')).toBe(false);
        });
    });

    describe('every viewer still has the baseline oidc login', () => {
        it('all normalized roles can oidc-login', () => {
            for (const r of ['platform_admin', 'tenant_admin', 'tenant_operator', 'tenant_viewer', 'auditor']) {
                expect(hasPermission(r, 'auth.oidc_login')).toBe(true);
            }
        });
    });
});
