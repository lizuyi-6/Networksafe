import {
  buildSeedDetectionRules,
  evaluateDetectionRules,
  type DetectionRequest
} from '../../services/detection-engine';

function buildRequest(overrides: Partial<DetectionRequest>): DetectionRequest {
  return {
    tenantId: 'tenant-a',
    channel: 'http_api',
    requestId: 'request-1',
    timestamp: '2026-03-18T00:00:00.000Z',
    method: 'GET',
    path: '/api/search',
    headers: {},
    body: '',
    userAgent: 'jest',
    evidence: '',
    protocol: 'HTTP/1.1',
    rawPayload: '',
    ...overrides
  };
}

describe('detection-engine', () => {
  it('blocks URL-encoded SQLi delivered through query normalization', () => {
    const request = buildRequest({
      path: '/api/rules?q=union%20select%201',
      decodedPath: '/api/rules?q=union select 1',
      query: 'q=union%20select%201',
      decodedQuery: 'q=union select 1',
      parsedQuery: 'q=union select 1\nunion select 1',
      rawPayload: '/api/rules?q=union%20select%201\nq=union select 1\nunion select 1'
    });

    const result = evaluateDetectionRules(request, buildSeedDetectionRules());

    expect(result.ruleVerdict).toBe('block');
    expect(result.matchedRuleIds).toContain('seed-sqli-union');
  });

  it('blocks URL-encoded auth-bypass payloads in form bodies', () => {
    const request = buildRequest({
      method: 'POST',
      body: 'username=%27+or+1%3D1&password=test',
      normalizedBody: "username=' or 1=1&password=test",
      parsedBody: "username=' or 1=1\n' or 1=1\npassword=test\ntest",
      rawPayload: "username=%27+or+1%3D1&password=test\nusername=' or 1=1\n' or 1=1"
    });

    const result = evaluateDetectionRules(request, buildSeedDetectionRules());

    expect(result.ruleVerdict).toBe('block');
    expect(result.matchedRuleIds).toContain('seed-sqli-auth-bypass');
  });

  it('keeps review-only automation traffic out of block verdicts', () => {
    const request = buildRequest({
      headers: {
        'user-agent': 'sqlmap/1.8'
      },
      userAgent: 'sqlmap/1.8'
    });

    const result = evaluateDetectionRules(request, buildSeedDetectionRules());

    expect(result.ruleVerdict).toBe('monitor');
    expect(result.matchedRuleIds).toContain('seed-automation-review');
  });
});
