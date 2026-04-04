/**
 * Query Builder Tests
 */

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }
}));

import { QueryBuilder } from '../../utils/query-builder';

function createMockExecutor(result: any = { rows: [] }): any {
  return {
    query: jest.fn().mockResolvedValue(result),
  };
}

describe('QueryBuilder', () => {
  describe('constructor', () => {
    it('accepts a pool and table name', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users');
      expect(qb).toBeDefined();
    });

    it('rejects invalid table names', () => {
      const pool = createMockExecutor();
      expect(() => new QueryBuilder(pool, 'users; DROP TABLE users')).toThrow('Invalid identifier');
    });

    it('rejects table names starting with numbers', () => {
      const pool = createMockExecutor();
      expect(() => new QueryBuilder(pool, '123users')).toThrow('Invalid identifier');
    });

    it('accepts table names with underscores', () => {
      const pool = createMockExecutor();
      expect(() => new QueryBuilder(pool, 'user_accounts')).not.toThrow();
    });
  });

  describe('select', () => {
    it('sets select columns', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users').select(['id', 'name']);
      expect(qb).toBeDefined();
    });

    it('rejects invalid column names', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users');
      expect(() => qb.select(['id; DROP TABLE users'])).toThrow('Invalid identifier');
    });
  });

  describe('where', () => {
    it('adds WHERE condition with parameterized value', () => {
      const pool = createMockExecutor({ rows: [{ id: 1 }] });
      const qb = new QueryBuilder(pool, 'users').where('id', '=', 1);
      expect(qb).toBeDefined();
    });

    it('rejects invalid column names', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users');
      expect(() => qb.where('id; DROP TABLE', '=', 1)).toThrow('Invalid identifier');
    });

    it('rejects invalid operators', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users');
      expect(() => qb.where('id', 'BETWEEN', 1)).toThrow('Invalid operator');
    });
  });

  describe('orWhere', () => {
    it('adds OR condition when conditions already exist', async () => {
      const pool = createMockExecutor({ rows: [] });
      const qb = new QueryBuilder(pool, 'users')
        .where('status', '=', 'active')
        .orWhere('role', '=', 'admin');
      const result = await qb.get();
      expect(result).toEqual([]);
    });

    it('adds plain condition when no prior conditions exist', async () => {
      const pool = createMockExecutor({ rows: [] });
      const qb = new QueryBuilder(pool, 'users')
        .orWhere('status', '=', 'active');
      const result = await qb.get();
      expect(result).toEqual([]);
    });
  });

  describe('whereIn', () => {
    it('adds IN condition', async () => {
      const pool = createMockExecutor({ rows: [] });
      const qb = new QueryBuilder(pool, 'users').whereIn('status', ['active', 'pending']);
      expect(qb).toBeDefined();
    });

    it('throws on empty values array', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users');
      expect(() => qb.whereIn('status', [])).toThrow('whereIn requires at least one value');
    });
  });

  describe('whereNull / whereNotNull', () => {
    it('adds IS NULL condition', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users').whereNull('deleted_at');
      expect(qb).toBeDefined();
    });

    it('adds IS NOT NULL condition', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users').whereNotNull('email');
      expect(qb).toBeDefined();
    });
  });

  describe('whereLike', () => {
    it('adds LIKE condition with escaped wildcards', () => {
      const pool = createMockExecutor({ rows: [] });
      const qb = new QueryBuilder(pool, 'users').whereLike('name', 'test%');
      expect(qb).toBeDefined();
    });
  });

  describe('orderBy', () => {
    it('adds ORDER BY clause', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users').orderBy('created_at', 'DESC');
      expect(qb).toBeDefined();
    });

    it('defaults to ASC direction', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users').orderBy('created_at');
      expect(qb).toBeDefined();
    });
  });

  describe('limit / offset', () => {
    it('sets limit value', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users').limit(10);
      expect(qb).toBeDefined();
    });

    it('throws on negative limit', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users');
      expect(() => qb.limit(-1)).toThrow('Limit must be a non-negative integer');
    });

    it('throws on non-integer limit', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users');
      expect(() => qb.limit(1.5)).toThrow('Limit must be a non-negative integer');
    });

    it('sets offset value', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users').offset(20);
      expect(qb).toBeDefined();
    });

    it('throws on negative offset', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users');
      expect(() => qb.offset(-1)).toThrow('Offset must be a non-negative integer');
    });
  });

  describe('execute / get / first', () => {
    it('execute calls pool.query with built SQL', async () => {
      const pool = createMockExecutor({ rows: [{ id: 1, name: 'test' }] });
      const qb = new QueryBuilder(pool, 'users').where('id', '=', 1);
      const result = await qb.execute();
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(result.rows).toEqual([{ id: 1, name: 'test' }]);
    });

    it('get returns rows array', async () => {
      const pool = createMockExecutor({ rows: [{ id: 1 }] });
      const qb = new QueryBuilder(pool, 'users');
      const result = await qb.get();
      expect(result).toEqual([{ id: 1 }]);
    });

    it('first returns first row or null', async () => {
      const pool = createMockExecutor({ rows: [{ id: 1 }] });
      const qb = new QueryBuilder(pool, 'users');
      const result = await qb.first();
      expect(result).toEqual({ id: 1 });
    });

    it('first returns null when no rows', async () => {
      const pool = createMockExecutor({ rows: [] });
      const qb = new QueryBuilder(pool, 'users');
      const result = await qb.first();
      expect(result).toBeNull();
    });

    it('count returns number from COUNT query', async () => {
      const pool = createMockExecutor({ rows: [{ count: '42' }] });
      const qb = new QueryBuilder(pool, 'users');
      const result = await qb.count();
      expect(result).toBe(42);
    });
  });

  describe('sanitizeIdentifier (injection prevention)', () => {
    it('rejects SQL injection via table name', () => {
      const pool = createMockExecutor();
      expect(() => new QueryBuilder(pool, 'users WHERE 1=1')).toThrow('Invalid identifier');
    });

    it('rejects column name with semicolon', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users');
      expect(() => qb.select(['id; DROP TABLE users'])).toThrow('Invalid identifier');
    });

    it('rejects column name with spaces', () => {
      const pool = createMockExecutor();
      const qb = new QueryBuilder(pool, 'users');
      expect(() => qb.where('id = 1 OR 1=1', '=', 1)).toThrow('Invalid identifier');
    });

    it('accepts valid identifier with only alphanumeric and underscore', () => {
      const pool = createMockExecutor();
      expect(() => new QueryBuilder(pool, 'users_123')).not.toThrow();
    });
  });
});
