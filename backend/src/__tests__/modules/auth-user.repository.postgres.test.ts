describe('auth-user repository Postgres path', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../../config/platform-runtime');
    jest.dontMock('../../services/postgres-shadow-store.service');
    jest.dontMock('../../config/database');
  });

  function loadRepository(executeResult = 1) {
    const execute = jest.fn().mockResolvedValue(executeResult);

    jest.doMock('../../config/platform-runtime', () => ({
      getDatabaseMode: () => 'postgres',
      isSqliteFallbackEnabled: () => false
    }));
    jest.doMock('../../services/postgres-shadow-store.service', () => ({
      postgresShadowStoreService: {
        canServeReads: jest.fn(() => true),
        queryOne: jest.fn(),
        execute
      }
    }));
    jest.doMock('../../config/database', () => ({
      getDatabase: jest.fn(() => {
        throw new Error('SQLite fallback should not be used in this test');
      })
    }));

    const repository = require('../../modules/auth/auth-user.repository') as typeof import('../../modules/auth/auth-user.repository');
    return { repository, execute };
  }

  it('uses a portable timestamp parameter for Postgres login_history writes', async () => {
    const { repository, execute } = loadRepository();

    await repository.recordLoginHistory({
      id: 'hist-pg-1',
      userId: 'user-pg-1',
      ipAddress: '203.0.113.10',
      userAgent: 'jest',
      status: 'success'
    });

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain('VALUES ($1, $2, $3, $4, $5, $6)');
    expect(sql).not.toContain("datetime('now')");
    expect(params).toHaveLength(6);
    expect(params.slice(0, 5)).toEqual(['hist-pg-1', 'user-pg-1', '203.0.113.10', 'jest', 'success']);
    expect(Number.isNaN(new Date(params[5]).getTime())).toBe(false);
  });

  it('fails closed when an authoritative Postgres auth write affects zero rows', async () => {
    const { repository } = loadRepository(0);

    await expect(repository.createAuthUser({
      id: 'user-pg-zero',
      email: 'zero@example.com',
      username: 'Zero',
      password_hash: '$2a$10$hash',
      role: 'platform_admin',
      tenant_id: 'tenant-pg'
    })).rejects.toThrow('Postgres auth write failed: createAuthUser affected 0 rows');
  });
});
