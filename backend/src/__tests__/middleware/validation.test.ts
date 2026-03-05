/**
 * Validation Middleware Tests
 *
 * Tests for request validation middleware
 */

import { Request, Response, NextFunction } from 'express';
import { validateRequest } from '../../middleware/validation.middleware';

describe('Validation Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let mockStatus: jest.Mock;
  let mockJson: jest.Mock;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn(() => ({ json: mockJson }));
    mockRequest = {
      body: {}
    };
    mockResponse = {
      status: mockStatus,
      json: mockJson
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  describe('validateRequest', () => {
    it('should call next() when all required fields are present', () => {
      mockRequest.body = {
        email: 'test@example.com',
        password: 'password123'
      };

      const middleware = validateRequest({
        body: {
          required: ['email', 'password']
        }
      });

      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockStatus).not.toHaveBeenCalled();
    });

    it('should return 400 when required field is missing', () => {
      mockRequest.body = {
        email: 'test@example.com'
      };

      const middleware = validateRequest({
        body: {
          required: ['email', 'password']
        }
      });

      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        success: false,
        error: 'Missing required field: password'
      });
    });

    it('should return 400 when multiple required fields are missing', () => {
      mockRequest.body = {};

      const middleware = validateRequest({
        body: {
          required: ['email', 'password', 'username']
        }
      });

      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        success: false,
        error: expect.stringContaining('Missing required field')
      });
    });

    it('should handle null values as missing', () => {
      mockRequest.body = {
        email: null,
        password: 'password123'
      };

      const middleware = validateRequest({
        body: {
          required: ['email', 'password']
        }
      });

      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockStatus).toHaveBeenCalledWith(400);
    });

    it('should handle undefined values as missing', () => {
      mockRequest.body = {
        email: undefined,
        password: 'password123'
      };

      const middleware = validateRequest({
        body: {
          required: ['email', 'password']
        }
      });

      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockStatus).toHaveBeenCalledWith(400);
    });

    it('should allow empty strings for non-required fields', () => {
      mockRequest.body = {
        email: 'test@example.com',
        password: '',
        name: ''
      };

      const middleware = validateRequest({
        body: {
          required: ['email']
        }
      });

      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it('should pass when no required fields specified', () => {
      mockRequest.body = {
        optionalField: 'value'
      };

      const middleware = validateRequest({
        body: {}
      });

      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it('should pass when body is empty and no required fields', () => {
      mockRequest.body = {};

      const middleware = validateRequest({});

      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle nested object validation', () => {
      mockRequest.body = {
        user: {
          email: 'test@example.com'
        }
      };

      const middleware = validateRequest({
        body: {
          required: ['user']
        }
      });

      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
    });
  });
});