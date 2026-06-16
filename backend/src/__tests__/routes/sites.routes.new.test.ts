/**
 * Sites Routes Tests (Refactored)
 *
 * Tests for site management API endpoints with SSRF protection
 * Uses real test database instead of mocks
 */

import request from 'supertest';
import express from 'express';
import sitesRouter from '../../api/routes/sites.routes';
import { authenticate } from '../../middleware/auth.middleware';
import dns from 'dns';
import {
  createTestContext,
  destroyTestContext,
  TestContext,
  TestDataFixtures
} from '../../testing';

let currentDb: any = null;

function toRouteDbAdapter(sqlDb: any): any {
  return {
    run: (sql: string, params?: any[]) => {
      if (params && params.length > 0) {
        sqlDb.run(sql, params);
      } else {
        sqlDb.run(sql);
      }
    },
    exec: (sql: string) => {
      sqlDb.run(sql);
    },
    prepare: (sql: string) => ({
      all: (...params: any[]) => {
        const stmt = sqlDb.prepare(sql);
        if (params.length > 0) {
          stmt.bind(params);
        }
        const rows: any[] = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
      },
      get: (...params: any[]) => {
        const stmt = sqlDb.prepare(sql);
        if (params.length > 0) {
          stmt.bind(params);
        }
        const row = stmt.step() ? stmt.getAsObject() : null;
        stmt.free();
        return row;
      },
      run: (...params: any[]) => {
        if (params.length > 0) {
          sqlDb.run(sql, params);
        } else {
          sqlDb.run(sql);
        }
        const changes = typeof sqlDb.getRowsModified === 'function' ? sqlDb.getRowsModified() : 0;
        return { changes };
      }
    })
  };
}

// Mock only the modules that are external dependencies or have side effects
jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = {
      userId: 'test-user',
      email: 'test@example.com',
      role: 'admin',
      tenantId: 'tenant-001'
    };
    next();
  }),
  requireTenantAccess: jest.fn(() => (req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../middleware/plan.middleware', () => ({
  requirePlanQuota: jest.fn(() => (req: any, _res: any, next: any) => next())
}));

jest.mock('../../config/database', () => ({
  getDatabase: jest.fn(() => {
    if (!currentDb) {
      throw new Error('Test database not initialized');
    }
    return currentDb;
  })
}));

// Mock DNS for SSRF tests
jest.mock('dns', () => ({
  ...jest.requireActual('dns'),
  lookup: jest.fn((hostname: string, callback: any) => {
    if (hostname === 'example.com') {
      callback(null, { address: '93.184.216.34' });
    } else if (hostname === 'localhost') {
      callback(null, { address: '127.0.0.1' });
    } else if (hostname === 'private.local') {
      callback(null, { address: '192.168.1.1' });
    } else if (hostname === 'newsite.com') {
      callback(null, { address: '104.16.132.229' });
    } else if (hostname === 'updated.com') {
      callback(null, { address: '104.16.133.229' });
    } else if (hostname === 'backend.newsite.com') {
      callback(null, { address: '104.16.132.229' });
    } else if (hostname === 'backend.updated.com') {
      callback(null, { address: '104.16.133.229' });
    } else {
      callback(new Error('DNS lookup failed'), null);
    }
  })
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  }
}));

describe('Sites Routes', () => {
  let ctx: TestContext;
  let app: express.Application;

  beforeAll(async () => {
    // Create test context with real database
    ctx = await createTestContext({
      seedData: {
        sites: 1,
        tenantId: 'tenant-001'
      }
    });
    currentDb = toRouteDbAdapter(ctx.db);

    // Create Express app
    app = express();
    app.use(express.json());
    app.use('/api/sites', sitesRouter);
  });

  afterAll(() => {
    currentDb = null;
    destroyTestContext(ctx);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/sites', () => {
    it('should return list of sites', async () => {
      const response = await request(app).get('/api/sites');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('GET /api/sites/:id', () => {
    it('should return site by ID', async () => {
      // Get the seeded site ID
      const stmt = ctx.db.prepare('SELECT id FROM sites LIMIT 1');
      const result = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();

      if (result) {
        const response = await request(app).get(`/api/sites/${result.id}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
      }
    });

    it('should return 404 for non-existent site', async () => {
      const response = await request(app).get('/api/sites/99999');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/sites', () => {
    it('should create a new site', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          domain: 'newsite.com',
          target: 'https://backend.newsite.com',
          sslEnabled: true
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      // Verify site was created in database
      const stmt = ctx.db.prepare('SELECT * FROM sites WHERE domain = ?');
      stmt.bind(['newsite.com']);
      const site = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();

      expect(site).toBeDefined();
      expect(site?.domain).toBe('newsite.com');
    });

    it('should return 400 if domain is missing', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          target: 'https://backend.example.com'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 if target is missing', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          domain: 'example.com'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject localhost target (SSRF protection)', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          domain: 'evil.com',
          target: 'http://localhost:8080'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject 127.0.0.1 target (SSRF protection)', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          domain: 'evil.com',
          target: 'http://127.0.0.1:8080'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject metadata endpoint (SSRF protection)', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          domain: 'evil.com',
          target: 'http://metadata.google.internal'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject private IP range targets (SSRF protection)', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          domain: 'evil.com',
          target: 'https://private.local'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should reject non-HTTP protocols', async () => {
      const response = await request(app)
        .post('/api/sites')
        .send({
          domain: 'evil.com',
          target: 'ftp://internal.server.com'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/sites/:id', () => {
    it('should update site', async () => {
      // Get the seeded site ID
      const stmt = ctx.db.prepare('SELECT id FROM sites LIMIT 1');
      const result = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();

      if (result) {
        const response = await request(app)
          .put(`/api/sites/${result.id}`)
          .send({
            domain: 'updated.com',
            target: 'https://backend.updated.com'
          });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      }
    });

    it('should return 404 for non-existent site', async () => {
      const response = await request(app)
        .put('/api/sites/99999')
        .send({
          domain: 'updated.com'
        });

      expect(response.status).toBe(404);
    });

    it('should validate new target URL for SSRF', async () => {
      // Get the seeded site ID
      const stmt = ctx.db.prepare('SELECT id FROM sites LIMIT 1');
      const result = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();

      if (result) {
        const response = await request(app)
          .put(`/api/sites/${result.id}`)
          .send({
            target: 'http://localhost:8080'
          });

        expect(response.status).toBe(400);
      }
    });
  });

  describe('DELETE /api/sites/:id', () => {
    it('should delete site', async () => {
      // Create a site to delete
      const site = TestDataFixtures.createTestSite({
        domain: 'to-delete.com'
      });
      ctx.db.run(
        `INSERT INTO sites (domain, target, sslEnabled, antiBotEnabled, rateLimitEnabled, rateLimitRequests, concurrencyEnabled, concurrencyMax, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          site.domain,
          site.target,
          site.sslEnabled ? 1 : 0,
          site.antiBotEnabled ? 1 : 0,
          site.rateLimitEnabled ? 1 : 0,
          site.rateLimitRequests,
          site.concurrencyEnabled ? 1 : 0,
          site.concurrencyMax,
          site.tenant_id ?? null
        ]
      );

      // Get the ID
      const stmt = ctx.db.prepare('SELECT id FROM sites WHERE domain = ?');
      stmt.bind(['to-delete.com']);
      const result = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();

      if (result) {
        const response = await request(app).delete(`/api/sites/${result.id}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        // Verify site was deleted
        const checkStmt = ctx.db.prepare('SELECT * FROM sites WHERE id = ?');
        checkStmt.bind([result.id]);
        const deleted = checkStmt.step() ? checkStmt.getAsObject() : null;
        checkStmt.free();

        expect(deleted).toBeNull();
      }
    });

    it('should return 404 for non-existent site', async () => {
      const response = await request(app).delete('/api/sites/99999');

      expect(response.status).toBe(404);
    });
  });
});
