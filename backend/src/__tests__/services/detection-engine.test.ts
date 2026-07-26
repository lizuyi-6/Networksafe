import {
  buildSeedDetectionRules,
  evaluateDetectionRules,
  collectInvalidMatcherPatterns,
  matcherDeclaresCriteria,
  type DetectionRequest,
  type DetectionRuleRecord
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

  it('a malformed regex in one rule does not disable the other rules (blast-radius isolation)', () => {
    // Regression: compilePattern used to `new RegExp(pattern)` unguarded, so a
    // single misconfigured rule threw out of evaluateDetectionRules' .filter()
    // and took every OTHER rule — including legitimate block rules — with it.
    const brokenRule: DetectionRuleRecord = {
      ruleId: 'broken-regex-rule',
      tenantId: 'tenant-a',
      name: 'Broken pattern',
      scope: 'all',
      action: 'block',
      priority: 999,
      severity: 'critical',
      matcher: { pathPatterns: ['('] }, // unbalanced group -> invalid regex
      source: 'dynamic',
      enabled: true,
      version: 1
    };

    const request = buildRequest({
      path: '/api/rules?q=union%20select%201',
      decodedPath: '/api/rules?q=union select 1',
      query: 'q=union%20select%201',
      decodedQuery: 'q=union select 1',
      parsedQuery: 'q=union select 1\nunion select 1',
      rawPayload: '/api/rules?q=union%20select%201\nq=union select 1\nunion select 1'
    });

    // The broken rule is first in the list; evaluation must not throw and the
    // real SQLi seed rule must still fire.
    const rules = [brokenRule, ...buildSeedDetectionRules()];
    expect(() => evaluateDetectionRules(request, rules)).not.toThrow();

    const result = evaluateDetectionRules(request, rules);
    expect(result.ruleVerdict).toBe('block');
    expect(result.matchedRuleIds).toContain('seed-sqli-union');
    // The broken rule itself is inert (never matches), not a false positive.
    expect(result.matchedRuleIds).not.toContain('broken-regex-rule');
  });

  it('collectInvalidMatcherPatterns flags malformed regexes across matcher fields', () => {
    expect(collectInvalidMatcherPatterns({ pathPatterns: ['union\\s+select', 'ok'] })).toEqual([]);
    expect(collectInvalidMatcherPatterns({ pathPatterns: ['('] })).toEqual(['(']);
    expect(collectInvalidMatcherPatterns({
      bodyPatterns: ['valid'],
      userAgentPatterns: ['['],
      headerPatterns: { 'x-test': ['a[b'] }
    }).sort()).toEqual(['[', 'a[b'].sort());
    expect(collectInvalidMatcherPatterns({})).toEqual([]);
  });

  it('an empty matcher (e.g. corrupt matcher_json) matches nothing, not everything', () => {
    // Regression: matcherMatchesRequest ANDed all-true anyPatternMatches for a
    // criteria-less matcher and matched EVERY request. A corrupt/missing
    // matcher_json parses to {}, so such a block rule would have blocked all
    // traffic (100% false positive / total outage).
    const matchAllBlock: DetectionRuleRecord = {
      ruleId: 'empty-matcher-block',
      tenantId: 'tenant-a',
      name: 'Empty matcher',
      scope: 'all',
      action: 'block',
      priority: 1000,
      severity: 'critical',
      matcher: {}, // no criteria
      source: 'dynamic',
      enabled: true,
      version: 1
    };

    const benign = buildRequest({ path: '/api/health', method: 'GET' });
    const result = evaluateDetectionRules(benign, [matchAllBlock]);

    expect(result.matchedRuleIds).not.toContain('empty-matcher-block');
    expect(result.ruleVerdict).not.toBe('block');

    // A matcher with a single real criterion still works.
    const realBlock: DetectionRuleRecord = {
      ...matchAllBlock,
      ruleId: 'method-matcher-block',
      matcher: { methodPatterns: ['^GET$'] }
    };
    const withReal = evaluateDetectionRules(benign, [realBlock]);
    expect(withReal.matchedRuleIds).toContain('method-matcher-block');
  });

  it('matcherDeclaresCriteria distinguishes empty from non-empty matchers', () => {
    expect(matcherDeclaresCriteria({})).toBe(false);
    expect(matcherDeclaresCriteria({ pathPatterns: [] })).toBe(false);
    expect(matcherDeclaresCriteria({ headerPatterns: { 'x-foo': [] } })).toBe(false);
    expect(matcherDeclaresCriteria({ methodPatterns: ['^GET$'] })).toBe(true);
    expect(matcherDeclaresCriteria({ headerPatterns: { 'x-foo': ['bar'] } })).toBe(true);
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
