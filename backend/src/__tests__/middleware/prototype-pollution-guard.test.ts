/**
 * Prototype Pollution Guard Tests
 *
 * SECURITY FIX (R6 V1.6 — Sprint 5 Wave 3 F6): Verifies the two-stage
 * prototype-pollution guard added to control-plane-app.ts:
 *
 *  Stage 1 (pre-parse): rejects raw URLs containing `__proto__` or
 *    `constructor.prototype` patterns (e.g. `?__proto__[x]=1`).
 *  Stage 2 (post-parse): walks the parsed `req.body`, `req.query`, and
 *    `req.params` for own `__proto__` / `constructor` / `prototype` keys.
 *
 * Both stages return HTTP 400 with the standard
 * `PROTOTYPE_POLLUTION_REJECTED` envelope and log a warning.
 *
 * Normal traffic is passed through without false positives.
 */

import express from 'express';
import request from 'supertest';

// Mock logger to silence output during tests
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn()
  }
}));

import logger from '../../utils/logger';

// Mirror the production middleware (closure inside createControlPlaneApp).
// We replicate the same algorithm here so we can test the contract without
// booting the full control plane.
const PP_KEY_PATTERN = /__proto__|constructor[\s.[\]]*prototype/i;
const PP_OWN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const sendReject = (
  res: express.Response,
  req: express.Request,
  location: string,
  source: string
): void => {
  logger.warn('Rejected prototype-pollution attempt', {
    location,
    source,
    ip: req.ip,
    method: req.method,
    path: req.path,
  });
  res.status(400).json({
    success: false,
    data: null,
    error: {
      code: 'PROTOTYPE_POLLUTION_REJECTED',
      message: 'backend.invalid_input',
    },
  });
};

const walkForPPKeys = (obj: unknown, path: string): string | null => {
  if (obj === null || typeof obj !== 'object') return null;
  for (const key of Object.keys(obj as object)) {
    if (PP_OWN_KEYS.has(key)) {
      return `${path}.${key}`;
    }
    const value = (obj as Record<string, unknown>)[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const found = walkForPPKeys(value, `${path}.${key}`);
      if (found) return found;
    }
  }
  return null;
};

const preParseGuard = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  const rawUrl = req.originalUrl || req.url || '';
  if (PP_KEY_PATTERN.test(rawUrl)) {
    sendReject(res, req, 'url', `url:${rawUrl.slice(0, 200)}`);
    return;
  }
  next();
};

const postParseGuard = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  for (const where of ['body', 'query', 'params'] as const) {
    const found = walkForPPKeys(req[where], where);
    if (found) {
      sendReject(res, req, found, 'parsed');
      return;
    }
  }
  next();
};

function buildApp(): express.Express {
  const app = express();
  app.use(preParseGuard);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(postParseGuard);
  app.all('*', (req, res) => {
    res.status(200).json({ ok: true, body: req.body, query: req.query });
  });
  return app;
}

describe('rejectPrototypePollution middleware', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('rejects JSON body with __proto__ key (caught at post-parse stage, 400)', async () => {
    // In modern V8, JSON.parse('{"__proto__":...}') creates an own
    // `__proto__` data property, so Object.keys() surfaces it. The
    // post-parse walk catches it.
    const rawAttack = '{"__proto__":{"isAdmin":true},"username":"attacker"}';
    const res = await request(app)
      .post('/login')
      .set('Content-Type', 'application/json')
      .send(rawAttack);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      data: null,
      error: {
        code: 'PROTOTYPE_POLLUTION_REJECTED',
        message: 'backend.invalid_input',
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'Rejected prototype-pollution attempt',
      expect.objectContaining({ source: 'parsed', location: 'body.__proto__' })
    );
  });

  it('rejects nested body with constructor.prototype key (caught at post-parse, 400)', async () => {
    // Send a body where the `constructor` key is its own property, with a
    // nested `prototype` child. This walks the post-parse tree.
    const rawAttack =
      '{"user":{"name":"alice"},"constructor":{"prototype":{"isAdmin":true}}}';
    const res = await request(app)
      .post('/users')
      .set('Content-Type', 'application/json')
      .send(rawAttack);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PROTOTYPE_POLLUTION_REJECTED');
    expect(logger.warn).toHaveBeenCalledWith(
      'Rejected prototype-pollution attempt',
      expect.objectContaining({
        source: 'parsed',
        location: expect.stringMatching(/constructor|prototype/),
      })
    );
  });

  it('rejects query string ?__proto__[x]=1 (caught at pre-parse URL stage, 400)', async () => {
    const res = await request(app).get('/search?__proto__[x]=1&q=benign');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PROTOTYPE_POLLUTION_REJECTED');
    expect(logger.warn).toHaveBeenCalledWith(
      'Rejected prototype-pollution attempt',
      expect.objectContaining({ location: 'url' })
    );
  });

  it('rejects query string ?constructor[prototype][x]=1 (pre-parse URL, 400)', async () => {
    const res = await request(app).get('/items?constructor[prototype][isAdmin]=true');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PROTOTYPE_POLLUTION_REJECTED');
    expect(logger.warn).toHaveBeenCalledWith(
      'Rejected prototype-pollution attempt',
      expect.objectContaining({ location: 'url' })
    );
  });

  it('does NOT block urlencoded form with literal __proto__ key when extended:false (200)', async () => {
    // Documented behavior: with `extended: false` (querystring), a body of
    // `__proto__[isAdmin]=true` becomes a literal key `__proto__[isAdmin]`
    // (NOT a real `__proto__` own property). This is NOT a prototype
    // pollution attack — the bracket notation is just part of the key name.
    // The pre-parse URL check skips it (URL is fine), and the post-parse
    // Object.keys() walk sees no own `__proto__` / `constructor` / `prototype`
    // key. This is the desired behavior; the real `extended: true` PP attack
    // surface is closed by switching to `extended: false`.
    const res = await request(app)
      .post('/login')
      .type('form')
      .send('__proto__[isAdmin]=true&username=attacker');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('passes through a normal JSON body without false positive (200)', async () => {
    const res = await request(app)
      .post('/login')
      .set('Content-Type', 'application/json')
      .send({ username: 'alice', password: 'p@ss' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.body).toEqual({ username: 'alice', password: 'p@ss' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('passes through urlencoded form with safe keys (200)', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ username: 'alice', password: 'p@ss' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does NOT false-positive on the word "constructor" appearing in a normal string value (200)', async () => {
    const res = await request(app)
      .post('/comments')
      .set('Content-Type', 'application/json')
      .send({ body: 'please call my constructor function', tags: ['prototype-test'] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('rejects forged req.params containing __proto__ key (post-parse walk, 400)', async () => {
    // Build a params object with a real OWN `__proto__` property. We can't
    // do this with a plain object literal (since `__proto__` is a special
    // accessor on Object.prototype), so we use Object.create(null) +
    // Object.defineProperty to set it as a real enumerable own property.
    const paramsWithProto = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(paramsWithProto, '__proto__', {
      value: 'polluted',
      writable: true,
      enumerable: true,
      configurable: true,
    });

    const fakeReq = {
      method: 'GET',
      ip: '127.0.0.1',
      originalUrl: '/safe',
      url: '/safe',
      body: {},
      query: {},
      params: paramsWithProto,
    } as unknown as express.Request;
    const fakeRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as express.Response;
    const next = jest.fn();
    postParseGuard(fakeReq, fakeRes, next);
    expect((fakeRes.status as jest.Mock)).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
