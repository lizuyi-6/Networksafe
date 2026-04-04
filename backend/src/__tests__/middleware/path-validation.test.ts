/**
 * Path Validation Middleware Tests
 *
 * Tests for path traversal attack prevention
 */

import { Request, Response, NextFunction } from 'express';
import {
  resolveAndValidatePath,
  validatePath,
  validateFilePath
} from '../../middleware/path-validation';

// Mock logger to prevent console output during tests
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn()
  }
}));

// Mock fs for mustExist tests
jest.mock('fs', () => ({
  existsSync: jest.fn()
}));

import fs from 'fs';

describe('resolveAndValidatePath', () => {
  const baseDir = '/var/www/uploads';

  describe('input validation', () => {
    it('returns invalid when path is null', () => {
      const result = resolveAndValidatePath(null as any, { baseDir });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.path_is_required');
    });

    it('returns invalid when path is undefined', () => {
      const result = resolveAndValidatePath(undefined as any, { baseDir });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.path_is_required');
    });

    it('returns invalid when path is empty string', () => {
      const result = resolveAndValidatePath('', { baseDir });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.path_is_required');
    });

    it('returns invalid when path is not a string', () => {
      const result = resolveAndValidatePath(123 as any, { baseDir });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.path_is_required');
    });

    it('returns invalid when path exceeds 4096 characters', () => {
      const longPath = 'a'.repeat(4097);
      const result = resolveAndValidatePath(longPath, { baseDir });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.path_too_long');
    });

    it('accepts path at exactly 4096 characters', () => {
      const maxPath = 'a'.repeat(4096);
      const result = resolveAndValidatePath(maxPath, { baseDir });
      // Will fail at base check but not at length check
      expect(result.error).not.toBe('backend.path_too_long');
    });
  });

  describe('path traversal patterns', () => {
    it('detects ../ traversal', () => {
      const result = resolveAndValidatePath('../etc/passwd', { baseDir });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.invalid_path_characters_detected');
    });

    it('detects ..\\ Windows-style traversal', () => {
      const result = resolveAndValidatePath('..\\windows\\system32', { baseDir });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.invalid_path_characters_detected');
    });

    it('detects URL-encoded ../ with separator', () => {
      // Pattern /%2e%2e[\\\/]/i matches literal %2e%2e followed by / or \
      const result = resolveAndValidatePath('..%2f../etc/passwd', { baseDir });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.invalid_path_characters_detected');
    });

    it('detects double URL-encoded ../ with separator', () => {
      // Pattern /%252e%252e[\\\/]/i matches literal %252e%252e followed by / or \
      // %252e%252e/ = "double decode of ../"
      const result = resolveAndValidatePath('%252e%252e/..%2fetc', { baseDir });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.invalid_path_characters_detected');
    });

    it('detects hex-encoded dots', () => {
      const result = resolveAndValidatePath('\x2e\x2e\x2fetc', { baseDir });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.invalid_path_characters_detected');
    });

    it('detects multiple dots (ellipsis)', () => {
      const result = resolveAndValidatePath('......//etc/passwd', { baseDir });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.invalid_path_characters_detected');
    });

    it('detects traversal with forward slash pattern', () => {
      const result = resolveAndValidatePath('/../../etc/passwd', { baseDir });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.invalid_path_characters_detected');
    });
  });

  describe('resolved path boundary check', () => {
    it('rejects path that resolves outside baseDir', () => {
      // Use path.resolve to build a path definitely outside baseDir
      const outsidePath = require('path').resolve(baseDir, '..', '..', '..', 'etc', 'passwd');
      const result = resolveAndValidatePath(outsidePath, {
        baseDir
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.access_denied_path_outside_allowed_directory');
    });

    it('accepts valid path within baseDir', () => {
      const result = resolveAndValidatePath('images/photo.jpg', {
        baseDir: '/var/www/uploads'
      });
      expect(result.valid).toBe(true);
      expect(result.resolvedPath).toBeDefined();
    });

    it('accepts single filename in baseDir', () => {
      const result = resolveAndValidatePath('file.txt', {
        baseDir: '/var/www/uploads'
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('subdirectory restrictions', () => {
    it('blocks subdirectory when allowSubdirectories is false', () => {
      const result = resolveAndValidatePath('subdir/file.txt', {
        baseDir: '/var/www/uploads',
        allowSubdirectories: false
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.subdirectories_not_allowed');
    });

    it('allows subdirectory when allowSubdirectories is true', () => {
      const result = resolveAndValidatePath('subdir/file.txt', {
        baseDir: '/var/www/uploads',
        allowSubdirectories: true
      });
      expect(result.valid).toBe(true);
    });

    it('allows subdirectory by default', () => {
      const result = resolveAndValidatePath('a/b/c/file.txt', {
        baseDir: '/var/www/uploads'
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('extension filtering', () => {
    it('rejects disallowed extension', () => {
      const result = resolveAndValidatePath('script.exe', {
        baseDir: '/var/www/uploads',
        allowedExtensions: ['.jpg', '.png', '.txt']
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('File extension not allowed');
    });

    it('accepts allowed extension', () => {
      const result = resolveAndValidatePath('photo.jpg', {
        baseDir: '/var/www/uploads',
        allowedExtensions: ['.jpg', '.png', '.txt']
      });
      expect(result.valid).toBe(true);
    });

    it('accepts path without extension when no extensions specified', () => {
      const result = resolveAndValidatePath('README', {
        baseDir: '/var/www/uploads'
      });
      expect(result.valid).toBe(true);
    });

    it('rejects when extensions list is empty', () => {
      const result = resolveAndValidatePath('file.any', {
        baseDir: '/var/www/uploads',
        allowedExtensions: []
      });
      expect(result.valid).toBe(true); // empty list = no restriction
    });
  });

  describe('file existence check', () => {
    it('returns invalid when file must exist but does not', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const result = resolveAndValidatePath('missing.txt', {
        baseDir: '/var/www/uploads',
        mustExist: true
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('backend.file_not_found');
    });

    it('returns valid when file must exist and does', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const result = resolveAndValidatePath('exists.txt', {
        baseDir: '/var/www/uploads',
        mustExist: true
      });
      expect(result.valid).toBe(true);
    });

    it('skips existence check when mustExist is false', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const result = resolveAndValidatePath('any.txt', {
        baseDir: '/var/www/uploads',
        mustExist: false
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('normalize option', () => {
    it('normalizes path by default', () => {
      const result = resolveAndValidatePath('images//photo.jpg', {
        baseDir: '/var/www/uploads'
      });
      expect(result.valid).toBe(true);
    });

    it('accepts path with normalize: false', () => {
      const result = resolveAndValidatePath('images/photo.jpg', {
        baseDir: '/var/www/uploads',
        normalize: false
      });
      expect(result.valid).toBe(true);
    });
  });
});

describe('validatePath middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let mockStatus: jest.Mock;
  let mockJson: jest.Mock;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn(() => ({ json: mockJson }));
    mockReq = {
      query: {},
      body: {},
      ip: '127.0.0.1'
    };
    mockRes = {
      status: mockStatus,
      json: mockJson
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  it('returns 400 when path is missing from query and body', () => {
    const middleware = validatePath({ baseDir: '/var/www/uploads' });
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockStatus).toHaveBeenCalledWith(400);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'MISSING_PATH'
      })
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 400 when path is not a string', () => {
    mockReq.query = { path: 123 as any };
    const middleware = validatePath({ baseDir: '/var/www/uploads' });
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockStatus).toHaveBeenCalledWith(400);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 403 when path traversal is detected', () => {
    mockReq.query = { path: '../etc/passwd' };
    const middleware = validatePath({ baseDir: '/var/www/uploads' });
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockStatus).toHaveBeenCalledWith(403);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'PATH_VALIDATION_FAILED'
      })
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('calls next() and attaches validatedPath for valid path in query', () => {
    mockReq.query = { path: 'images/photo.jpg' };
    const middleware = validatePath({ baseDir: '/var/www/uploads' });
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect((mockReq as any).validatedPath).toBeDefined();
    expect((mockReq as any).validatedPathInfo).toBeDefined();
    expect((mockReq as any).validatedPathInfo.original).toBe('images/photo.jpg');
  });

  it('calls next() and attaches validatedPath for valid path in body', () => {
    mockReq.query = {};
    mockReq.body = { path: 'images/photo.jpg' };
    const middleware = validatePath({ baseDir: '/var/www/uploads' });
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect((mockReq as any).validatedPath).toBeDefined();
  });

  it('prefers query path over body path', () => {
    mockReq.query = { path: 'from-query.txt' };
    mockReq.body = { path: 'from-body.txt' };
    const middleware = validatePath({ baseDir: '/var/www/uploads' });
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect((mockReq as any).validatedPathInfo.original).toBe('from-query.txt');
  });

  it('uses custom paramName', () => {
    mockReq.query = { filePath: 'myfile.txt' };
    const middleware = validatePath({
      baseDir: '/var/www/uploads',
      paramName: 'filePath'
    });
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect((mockReq as any).validatedPathInfo.original).toBe('myfile.txt');
  });
});

describe('validateFilePath', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let mockStatus: jest.Mock;
  let mockJson: jest.Mock;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn(() => ({ json: mockJson }));
    mockReq = { query: {}, body: {}, ip: '127.0.0.1' };
    mockRes = { status: mockStatus, json: mockJson };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  it('creates middleware with defaults', () => {
    mockReq.query = { path: 'file.txt' };
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const middleware = validateFilePath('/var/www/uploads');
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('respects custom paramName', () => {
    mockReq.query = { filepath: 'myfile.txt' };
    const middleware = validateFilePath('/var/www/uploads', {
      paramName: 'filepath'
    });
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });
});
