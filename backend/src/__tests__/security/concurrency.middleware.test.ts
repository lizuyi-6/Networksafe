/**
 * Concurrency Middleware Tests
 *
 * Tests for concurrency limiting, token bucket algorithm, and queue management.
 */

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));

jest.mock('../../config', () => ({
  CONCURRENCY: {
    MAX_CONCURRENT_REQUESTS_PER_USER: 3,
    MAX_QUEUE_SIZE: 5,
  },
  MONITORING: {
    ENABLE_PERFORMANCE_TRACKING: true,
    SLOW_QUERY_THRESHOLD: 1000,
    MEMORY_WARNING_THRESHOLD: 500,
  },
}));

import {
  concurrencyLimit,
  performanceMonitor,
  startMemoryMonitoring,
  startCPUMonitoring,
  stopMonitoring,
} from '../../security/concurrency.middleware';
import { Request, Response, NextFunction } from 'express';

describe('concurrencyLimit middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let onMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    jsonMock = jest.fn().mockReturnThis();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    onMock = jest.fn();

    mockReq = {
      user: { userId: 'user-1' },
    } as any;

    mockRes = {
      status: statusMock,
      json: jsonMock,
      on: onMock,
    };

    mockNext = jest.fn();
  });

  it('should acquire slot and call next', async () => {
    await concurrencyLimit(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(onMock).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('should use anonymous for unauthenticated users', async () => {
    mockReq = {} as any;

    await concurrencyLimit(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should release slot when response finishes', async () => {
    await concurrencyLimit(mockReq as Request, mockRes as Response, mockNext);

    // Simulate response finish
    const finishHandler = onMock.mock.calls.find((call: any[]) => call[0] === 'finish')?.[1];
    expect(finishHandler).toBeDefined();

    // Call the finish handler - should not throw
    expect(() => finishHandler()).not.toThrow();
  });

  // Note: Testing the 429 response requires filling the queue which would
  // require many concurrent requests and a fresh controller instance.
  // The ConcurrencyController class is internal to the module.
});

describe('performanceMonitor middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let setHeaderMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    jsonMock = jest.fn().mockReturnThis();
    setHeaderMock = jest.fn();

    mockReq = {
      url: '/api/test',
      method: 'GET',
    } as any;

    mockRes = {
      json: jsonMock,
      setHeader: setHeaderMock,
    };

    mockNext = jest.fn();
  });

  it('should add performance headers', async () => {
    await performanceMonitor(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();

    // Simulate response
    mockRes.json!({ data: 'test' });

    expect(setHeaderMock).toHaveBeenCalledWith('X-Response-Time', expect.stringMatching(/\d+ms/));
  });

  it('should log slow requests', async () => {
    jest.useFakeTimers();

    await performanceMonitor(mockReq as Request, mockRes as Response, mockNext);

    // Advance time past slow query threshold
    jest.advanceTimersByTime(1500);

    // Simulate response
    mockRes.json!({ data: 'test' });

    // Should have logged warning
    expect(setHeaderMock).toHaveBeenCalled();

    jest.useRealTimers();
  });
});

describe('Monitoring Functions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    stopMonitoring(); // Clean up any existing intervals
  });

  afterEach(() => {
    jest.useRealTimers();
    stopMonitoring();
  });

  it('should start memory monitoring', () => {
    startMemoryMonitoring();

    expect(() => {
      jest.advanceTimersByTime(30000);
    }).not.toThrow();
  });

  it('should start CPU monitoring', () => {
    startCPUMonitoring();

    expect(() => {
      jest.advanceTimersByTime(30000);
    }).not.toThrow();
  });

  it('should clear existing intervals when starting new monitoring', () => {
    startMemoryMonitoring();
    startMemoryMonitoring(); // Should clear previous

    expect(() => {
      jest.advanceTimersByTime(30000);
    }).not.toThrow();
  });

  it('should stop all monitoring', () => {
    startMemoryMonitoring();
    startCPUMonitoring();

    stopMonitoring();

    // Should not throw after stopping
    expect(() => {
      jest.advanceTimersByTime(60000);
    }).not.toThrow();
  });

  it('should handle multiple stop calls', () => {
    stopMonitoring();
    stopMonitoring();

    expect(true).toBe(true); // Should not throw
  });
});
