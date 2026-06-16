/**
 * REDTEAM SECURITY TEST — admin batch self-escalation audit
 * ===========================================================
 *
 * Threat model: a `platform_admin` user attempts to misuse
 * `POST /api/admin/users/batch` to escalate privileges or
 * persist in the admin role.
 *
 * Existing guards (verified in this test):
 *   - `CANNOT_BATCH_SELF` — cannot include own userId in batch
 *   - `CANNOT_BATCH_ADMINS` — cannot batch operate on other admins
 *   - `setRole` restricted to `['tenant', 'viewer']` — no escalation to
 *     `tenant_admin` or `platform_admin`
 *   - `setPlan` restricted to `['starter', 'pro', 'ultra']`
 *
 * Residual risk this test surfaces:
 *   - The body shape is `userIds[]` not a per-user operation list, so
 *     no field-injection vector exists.
 *
 * Outcome: this test exercises the actual route handler against an
 * in-memory Express + auth mock. It asserts each guard rejects the
 * corresponding exploit payload with the documented error code.
 */

import express from 'express';
import request from 'supertest';

describe('REDTEAM admin batch — self-escalation audit', () => {
  let app: express.Express;
  let postedAuditCalls: any[];

  beforeEach(() => {
    jest.resetModules();
    postedAuditCalls = [];

    // Mock the audit logger default export so we can assert the route logged the event
    jest.doMock('../../security/audit-logger.service', () => {
      const fn: any = jest.fn(async (entry: any) => {
        postedAuditCalls.push(entry);
        return 'audit-id';
      });
      fn.log = fn;
      return { default: fn, __esModule: true };
    });

    // Mock the auth middleware to inject a known platform_admin
    jest.doMock('../../middleware/auth.middleware', () => ({
      authenticate: (req: any, _res: any, next: any) => {
        req.user = {
          userId: 'admin-self-id',
          email: 'admin@victim.test',
          role: 'platform_admin',
          tenantId: 'tenant-A',
          permissions: ['*']
        };
        next();
      },
      requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next()
    }));

    // Mock the admin repository to control user list
    jest.doMock('../../modules/admin/admin.repository', () => ({
      listAdminUsers: jest.fn(async () => [
        { id: 'admin-self-id', role: 'admin', email: 'admin@victim.test' },
        { id: 'user-tenant-A', role: 'tenant', email: 'a@victim.test' },
        { id: 'user-tenant-B', role: 'tenant', email: 'b@victim.test' },
        { id: 'other-admin-id', role: 'admin', email: 'other@victim.test' }
      ]),
      updateAdminUserField: jest.fn(async (_id: string, _field: string, _value: any) => true),
      getAdminUserById: jest.fn(),
      getLoginHistory: jest.fn(),
      saveAdminApiKey: jest.fn(),
      listAdminApiKeys: jest.fn(),
      deleteAdminApiKey: jest.fn()
    }));

    // Stub services required by route load
    jest.doMock('../../services/tenant-oversight.service', () => ({ tenantOversightService: {} }));
    jest.doMock('../../services/postgres-shadow-store.service', () => ({ postgresShadowStoreService: { upsert: jest.fn() } }));
    jest.doMock('../../services/audit-segment.service', () => ({ auditSegmentService: {} }));
    jest.doMock('../../services/benchmark.service', () => ({ benchmarkService: {} }));
    jest.doMock('../../services/device-control.service', () => ({ deviceControlService: {} }));
    jest.doMock('../../services/command-dispatcher.service', () => ({ commandDispatcherService: {} }));
    jest.doMock('../../services/device-registry.service', () => ({ getDeviceById: jest.fn() }));

    const adminRoutes = require('../../api/routes/admin.routes').default;
    app = express();
    app.use(express.json());
    app.use('/api/admin', adminRoutes);
  });

  it('REJECTS batch that includes own userId (self-modification guard)', async () => {
    const res = await request(app)
      .post('/api/admin/users/batch')
      .send({
        userIds: ['admin-self-id', 'user-tenant-A'],
        action: 'setRole',
        value: 'tenant'
      });

    expect(res.status).toBe(403);
    expect(res.body?.error?.code || res.body?.code).toBe('CANNOT_BATCH_SELF');
  });

  it('REJECTS batch that targets another platform_admin', async () => {
    const res = await request(app)
      .post('/api/admin/users/batch')
      .send({
        userIds: ['other-admin-id'],
        action: 'suspend'
      });

    expect(res.status).toBe(403);
    expect(res.body?.error?.code || res.body?.code).toBe('CANNOT_BATCH_ADMINS');
  });

  it('REJECTS setRole with value outside [tenant, viewer] allow-list', async () => {
    const res = await request(app)
      .post('/api/admin/users/batch')
      .send({
        userIds: ['user-tenant-A'],
        action: 'setRole',
        value: 'platform_admin'
      });

    expect(res.status).toBe(400);
    expect(res.body?.error?.code || res.body?.code).toBe('INVALID_ROLE');
  });

  it('REJECTS setPlan with value outside [starter, pro, ultra]', async () => {
    const res = await request(app)
      .post('/api/admin/users/batch')
      .send({
        userIds: ['user-tenant-A'],
        action: 'setPlan',
        value: 'enterprise_ultra'
      });

    expect(res.status).toBe(400);
    expect(res.body?.error?.code || res.body?.code).toBe('INVALID_PLAN');
  });

  it('ACCEPTS legitimate batch suspend of tenant users (sanity check)', async () => {
    const res = await request(app)
      .post('/api/admin/users/batch')
      .send({
        userIds: ['user-tenant-A', 'user-tenant-B'],
        action: 'suspend'
      });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.data?.updated).toBe(2);
    const events = postedAuditCalls.map((c) => c.eventType);
    expect(events).toContain('users_batch_updated');
  });
});
