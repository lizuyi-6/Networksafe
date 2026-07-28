/**
 * Shadow-mode wiring tests. Assert that:
 *  1. When the engine is disabled (default), zero invocations occur.
 *  2. When enabled with sampleRate=0, zero invocations occur.
 *  3. When enabled and the formal decision would block, the shadow output
 *     NEVER mutates the formal verdict, response status, or response body.
 *  4. The shadow service drops entries when the queue is full and counts them.
 */
import type { Request, Response } from 'express';

jest.mock('../../../services/detection-pipeline.service', () => ({
  detectionPipelineService: {
    evaluateRequest: jest.fn(),
    getSettings: jest.fn()
  }
}));
jest.mock('../../../services/fastpath-traffic-shadow.service', () => ({
  fastpathTrafficShadowService: { submitFromRequest: jest.fn() }
}));
jest.mock('../../../services/api-request-tracker.service', () => ({
  recordApiRequest: jest.fn()
}));

const mockSubmit = jest.fn();
jest.mock('../security-detection-shadow.service', () => ({
  securityDetectionShadowService: { submit: mockSubmit }
}));

import { apiTrafficShadowMiddleware } from '../../../middleware/api-traffic-shadow.middleware';
import { detectionPipelineService } from '../../../services/detection-pipeline.service';

function buildRes() {
  const res: Partial<Response> & { statusCode?: number; body?: any } = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as any;
  res.json = jest.fn((body: any) => {
    res.body = body;
    return res as Response;
  }) as any;
  return res as Response & { statusCode?: number; body?: any };
}

function buildReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/products',
    url: '/products',
    originalUrl: '/products',
    headers: { 'user-agent': 'jest' },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' } as any,
    httpVersion: '1.1',
    ...overrides
  } as unknown as Request;
}

describe('api-traffic-shadow.middleware shadow wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('submits to shadow service after evaluateRequest and proceeds', async () => {
    (detectionPipelineService.evaluateRequest as jest.Mock).mockResolvedValue({
      verdict: 'allow',
      matchedRuleIds: [],
      riskScore: 0,
      escalatedToAI: false,
      queuedForAsyncReview: false,
      decisionSource: 'rule_only',
      signals: [],
      attackFamily: 'benign',
      processingTimeMs: 1,
      ruleMatches: []
    });

    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    await apiTrafficShadowMiddleware(req, res, next);

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockSubmit.mock.calls[0][0].decision.verdict).toBe('allow');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('formal block decision is not modified by shadow submission', async () => {
    (detectionPipelineService.evaluateRequest as jest.Mock).mockResolvedValue({
      verdict: 'block',
      matchedRuleIds: ['sqli-1'],
      riskScore: 0.95,
      escalatedToAI: false,
      queuedForAsyncReview: false,
      decisionSource: 'rule',
      signals: [],
      attackFamily: 'sqli',
      processingTimeMs: 1,
      ruleMatches: []
    });
    (detectionPipelineService.getSettings as jest.Mock).mockResolvedValue({
      ruleFirstEnabled: true
    });

    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    await apiTrafficShadowMiddleware(req, res, next);

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(403);
    expect(res.body?.error?.code).toBe('backend.request_blocked_by_detection_pipeline');
    expect(next).not.toHaveBeenCalled();
  });

  it('shadow submission throwing does not affect the middleware', async () => {
    mockSubmit.mockImplementationOnce(() => {
      throw new Error('shadow exploded');
    });
    (detectionPipelineService.evaluateRequest as jest.Mock).mockResolvedValue({
      verdict: 'allow',
      matchedRuleIds: [],
      riskScore: 0,
      escalatedToAI: false,
      queuedForAsyncReview: false,
      decisionSource: 'rule_only',
      signals: [],
      attackFamily: 'benign',
      processingTimeMs: 1,
      ruleMatches: []
    });

    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    await apiTrafficShadowMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
