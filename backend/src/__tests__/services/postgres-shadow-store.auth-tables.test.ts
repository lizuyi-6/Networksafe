describe('postgres shadow store auth table coverage', () => {
  let queries: string[];

  beforeEach(() => {
    jest.resetModules();
    queries = [];
    process.env.SHADOW_DATABASE_URL = 'postgres://user:pw@localhost:5432/shadow_test';
    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        query: jest.fn(async (sql: string) => {
          queries.push(String(sql));
          return { rows: [], rowCount: 1 };
        }),
        end: jest.fn(async () => undefined)
      }))
    }));
  });

  afterEach(() => {
    delete process.env.SHADOW_DATABASE_URL;
    jest.dontMock('pg');
  });

  it('creates login_history with its user binding and lookup index', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { postgresShadowStoreService } = require('../../services/postgres-shadow-store.service');

    await postgresShadowStoreService.init();

    const ddl = queries.find((sql) => sql.includes('CREATE TABLE IF NOT EXISTS login_history'));
    expect(ddl).toBeDefined();
    expect(ddl).toContain('user_id TEXT NOT NULL');
    expect(ddl).toContain("status TEXT DEFAULT 'success'");
    expect(ddl).toContain('REFERENCES users(id) ON DELETE CASCADE');
    expect(ddl).toContain('idx_shadow_login_history_user_time');
  });
});
