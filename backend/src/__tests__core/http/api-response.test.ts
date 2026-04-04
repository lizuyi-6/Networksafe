/**
 * API Response Tests
 */

import { Request, Response } from 'express';
import { sendSuccess, sendError } from '../../core/http/api-response';

function createMockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
  return res as Response;
}

describe('sendSuccess', () => {
  it('returns correct envelope', () => {
    const res = createMockRes();

    sendSuccess(res, { id: 1 });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: { id: 1 }, error: null })
    );
  });

  it('includes meta when provided', () => {
    const res = createMockRes();

    sendSuccess(res, {}, { meta: { page: 1, total: 100 } });

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { page: 1, total: 100 } })
    );
  });

  it('includes legacy fields when provided', () => {
    const res = createMockRes();

    sendSuccess(res, {}, { legacy: { legacy_field: true } });

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ legacy_field: true })
    );
  });

  it('uses custom statusCode', () => {
    const res = createMockRes();

    sendSuccess(res, { created: true }, { statusCode: 201 });

    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('sendError', () => {
  it('returns correct error envelope', () => {
    const res = createMockRes();

    sendError(res, 400, { code: 'bad_request', message: 'Invalid input' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        data: null,
        code: 'bad_request',
        message: 'Invalid input'
      })
    );
  });

  it('includes code and message at top level', () => {
    const res = createMockRes();

    sendError(res, 500, { code: 'server_error', message: 'Internal error' });

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'server_error', message: 'Internal error' })
    );
  });

  it('includes meta when provided', () => {
    const res = createMockRes();

    sendError(res, 429, { code: 'rate_limit', message: 'Too many requests' }, { meta: { retryAfter: 60 } });

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { retryAfter: 60 } })
    );
  });
});
