import {
  httpTrafficBenchmarkFixtures,
  httpTrafficEvaluatorService,
  normalizeThreatSignatures
} from '../../services/http-traffic-evaluator.service';

describe('httpTrafficEvaluatorService', () => {
  it.each(httpTrafficBenchmarkFixtures)('evaluates fixture %s', (fixture) => {
    const result = httpTrafficEvaluatorService.evaluateBaseline(fixture.request);

    expect(result.protocol).toBe('http');
    expect(result.verdict).toBe(fixture.expectedVerdict);
    expect(result.truncated).toBe(fixture.request.truncated);

    if (fixture.expectsCriticalBlock) {
      expect(result.verdict).toBe('block');
      expect(result.matchedRule).toBeTruthy();
    }
  });

  it('normalizes threat signatures for contract comparison', () => {
    const sqliFixture = httpTrafficBenchmarkFixtures.find((fixture) => fixture.name === 'sqli');
    expect(sqliFixture).toBeDefined();

    const result = httpTrafficEvaluatorService.evaluateBaseline(sqliFixture!.request);
    expect(normalizeThreatSignatures(result.threats)).toContain('sql_injection:critical');
  });

  it('keeps header injection as allow-only signal', () => {
    const fixture = httpTrafficBenchmarkFixtures.find((item) => item.name === 'header-injection');
    expect(fixture).toBeDefined();

    const result = httpTrafficEvaluatorService.evaluateBaseline(fixture!.request);
    expect(result.verdict).toBe('allow');
    expect(normalizeThreatSignatures(result.threats)).toContain('header_injection:high');
  });
});
