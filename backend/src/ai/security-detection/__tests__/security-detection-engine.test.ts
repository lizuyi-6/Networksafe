import { SecurityDetectionEngine, normalizeDetectionInput } from '../security-detection-engine';
import type { SecurityDetectionConfig } from '../detection-config';
import { MockDetectionProvider } from '../providers/mock-detection.provider';
import type { DetectionTelemetrySink } from '../telemetry/detection-telemetry.types';
import type { DetectionInput } from '../detection-contract';

const BASE_CONFIG: SecurityDetectionConfig = {
  enabled: true,
  mode: 'shadow',
  provider: 'mock',
  model: 'aetherargus-mock',
  modelVersion: 'mock-1',
  quantization: 'none',
  datasetVersion: 'none',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  timeoutMs: 500,
  numCtx: 2048,
  maxBodyBytes: 1024,
  maxQueryBytes: 256,
  maxHeaderCount: 8,
  maxHeaderValueBytes: 128,
  maxResponseBytes: 4096,
  sampleRate: 1,
  failMode: 'unknown',
  queueMaxLength: 16,
  queueConcurrency: 2,
  reviewExportDir: 'runtime-data/security-detection-review'
};

const BASE_INPUT: Partial<DetectionInput> = {
  method: 'GET',
  path: '/products',
  query: 'id=1',
  headers: { Accept: 'application/json' },
  body: '',
  sourceContext: {
    requestsLastMinute: 1,
    distinctPathsLastMinute: 1,
    recentFailureCount: 0
  } as any,
  ruleSignals: []
};

const VALID_OUTPUT_JSON = JSON.stringify({
  verdict: 'safe',
  confidence: 0.92,
  attackFamily: 'benign',
  severity: 'low',
  reasoning: 'normal traffic',
  evidence: [],
  recommendedAction: 'allow'
});

class CapturingTelemetry implements DetectionTelemetrySink {
  events: any[] = [];
  record(event: any): void {
    this.events.push(event);
  }
}

describe('normalizeDetectionInput', () => {
  it('lowercases header names and coerces values to strings', () => {
    const normalized = normalizeDetectionInput({
      ...BASE_INPUT,
      headers: { 'Content-Type': 'application/json', 'X-Foo': 42 as any }
    }, BASE_CONFIG);
    expect(normalized.headers['content-type']).toBe('application/json');
    expect(normalized.headers['x-foo']).toBe('42');
  });

  it('redacts sensitive headers (authorization, cookie, x-api-key)', () => {
    const normalized = normalizeDetectionInput({
      ...BASE_INPUT,
      headers: {
        authorization: 'Bearer abc.def.ghi',
        Cookie: 'session=topsecret',
        'X-API-Key': 'sk_live_12345',
        'user-agent': 'curl/8'
      }
    }, BASE_CONFIG);
    expect(normalized.headers.authorization).toBe('[redacted]');
    expect(normalized.headers.cookie).toBe('[redacted]');
    expect(normalized.headers['x-api-key']).toBe('[redacted]');
    expect(normalized.headers['user-agent']).toBe('curl/8');
  });

  it('caps header count', () => {
    const headers: Record<string, string> = {};
    for (let i = 0; i < 50; i += 1) {
      headers[`x-h-${i}`] = `v${i}`;
    }
    const normalized = normalizeDetectionInput({ ...BASE_INPUT, headers }, BASE_CONFIG);
    expect(Object.keys(normalized.headers).length).toBeLessThanOrEqual(BASE_CONFIG.maxHeaderCount);
  });

  it('truncates body and query at byte limits', () => {
    const big = 'x'.repeat(4096);
    const normalized = normalizeDetectionInput({
      ...BASE_INPUT,
      query: big,
      body: big
    }, BASE_CONFIG);
    expect(Buffer.byteLength(normalized.query, 'utf8')).toBeLessThanOrEqual(BASE_CONFIG.maxQueryBytes);
    expect(Buffer.byteLength(normalized.body, 'utf8')).toBeLessThanOrEqual(BASE_CONFIG.maxBodyBytes);
  });

  it('drops extra sourceContext keys to satisfy additionalProperties=false', () => {
    const normalized = normalizeDetectionInput({
      ...BASE_INPUT,
      sourceContext: {
        requestsLastMinute: 1,
        distinctPathsLastMinute: 1,
        recentFailureCount: 0,
        sourceIp: '10.0.0.1',
        sessionToken: 'should-not-survive'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    }, BASE_CONFIG);
    expect(normalized.sourceContext).not.toHaveProperty('sourceIp');
    expect(normalized.sourceContext).not.toHaveProperty('sessionToken');
  });

  it('drops nested objects from sourceContext (cycle-safe)', () => {
    const cyc: any = { requestsLastMinute: 1, distinctPathsLastMinute: 1, recentFailureCount: 0 };
    cyc.self = cyc;
    const normalized = normalizeDetectionInput({ ...BASE_INPUT, sourceContext: cyc }, BASE_CONFIG);
    expect(normalized.sourceContext).not.toHaveProperty('self');
    expect(() => JSON.stringify(normalized.sourceContext)).not.toThrow();
  });

  it('normalizes invalid method to EVENT', () => {
    const normalized = normalizeDetectionInput({ ...BASE_INPUT, method: 'FOO' as any }, BASE_CONFIG);
    expect(normalized.method).toBe('EVENT');
  });
});

describe('SecurityDetectionEngine', () => {
  it('returns schema-valid output and metadata on the happy path', async () => {
    const provider = new MockDetectionProvider({ rawOutput: VALID_OUTPUT_JSON });
    const telemetry = new CapturingTelemetry();
    const engine = new SecurityDetectionEngine(provider, { config: BASE_CONFIG, telemetry });

    const result = await engine.detect(BASE_INPUT, { requestId: 'r-1', formalVerdict: 'allow' });

    expect(result.output.verdict).toBe('safe');
    expect(result.metadata.requestId).toBe('r-1');
    expect(result.metadata.engineMode).toBe('shadow');
    expect(result.metadata.provider).toBe('mock');
    expect(result.metadata.schemaValid).toBe(true);
    expect(result.metadata.semanticValid).toBe(true);
    expect(result.metadata.errorCode).toBeNull();
    expect(result.metadata.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(provider.detectCalls).toHaveLength(1);
    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.events[0].eventType).toBe('security_detection_invocation');
  });

  it('never returns safe when provider throws', async () => {
    const provider = new MockDetectionProvider({ failWith: new Error('conn refused') });
    const engine = new SecurityDetectionEngine(provider, { config: BASE_CONFIG });

    const result = await engine.detect(BASE_INPUT);
    expect(result.output.verdict).toBe('unknown');
    expect(result.output.recommendedAction).toBe('monitor');
    expect(result.metadata.errorCode).toBe('model_call_failed');
  });

  it('never returns safe on timeout', async () => {
    const provider = new MockDetectionProvider({
      failWith: Object.assign(new Error('aborted'), { name: 'AbortError' })
    });
    const engine = new SecurityDetectionEngine(provider, { config: BASE_CONFIG });
    // MockDetectionProvider returns AbortError → toDetectionErrorCode = model_call_failed
    // (AbortError is not DetectionError). The invariant being asserted: not safe.
    const result = await engine.detect(BASE_INPUT);
    expect(result.output.verdict).not.toBe('safe');
  });

  it('never returns safe on parse failure (markdown fence)', async () => {
    const provider = new MockDetectionProvider({
      rawOutput: '```json\n' + VALID_OUTPUT_JSON + '\n```'
    });
    const engine = new SecurityDetectionEngine(provider, { config: BASE_CONFIG });
    const result = await engine.detect(BASE_INPUT);
    expect(result.output.verdict).toBe('unknown');
    expect(result.metadata.errorCode).toBe('output_json_invalid');
  });

  it('never returns safe when output has extra fields', async () => {
    const provider = new MockDetectionProvider({
      rawOutput: JSON.stringify({ ...JSON.parse(VALID_OUTPUT_JSON), cmd: 'block' })
    });
    const engine = new SecurityDetectionEngine(provider, { config: BASE_CONFIG });
    const result = await engine.detect(BASE_INPUT);
    expect(result.output.verdict).toBe('unknown');
    expect(result.metadata.errorCode).toBe('output_schema_invalid');
  });

  it('never returns safe on illegal verdict enum', async () => {
    const provider = new MockDetectionProvider({
      rawOutput: JSON.stringify({ ...JSON.parse(VALID_OUTPUT_JSON), verdict: 'totally-safe' })
    });
    const engine = new SecurityDetectionEngine(provider, { config: BASE_CONFIG });
    const result = await engine.detect(BASE_INPUT);
    expect(result.output.verdict).toBe('unknown');
  });

  it('never returns safe on semantic violation (safe+block)', async () => {
    const provider = new MockDetectionProvider({
      rawOutput: JSON.stringify({
        ...JSON.parse(VALID_OUTPUT_JSON),
        recommendedAction: 'block'
      })
    });
    const engine = new SecurityDetectionEngine(provider, { config: BASE_CONFIG });
    const result = await engine.detect(BASE_INPUT);
    expect(result.output.verdict).toBe('unknown');
    expect(result.metadata.errorCode).toBe('output_semantic_invalid');
  });

  it('detects disagreement when model verdict bucket differs from formal verdict', async () => {
    const provider = new MockDetectionProvider({
      rawOutput: JSON.stringify({
        verdict: 'malicious',
        confidence: 0.9,
        attackFamily: 'sqli',
        severity: 'high',
        reasoning: 'sql injection pattern',
        evidence: [],
        recommendedAction: 'block'
      })
    });
    const engine = new SecurityDetectionEngine(provider, { config: BASE_CONFIG });
    const result = await engine.detect(BASE_INPUT, { formalVerdict: 'allow' });
    expect(result.metadata.disagreement).toBe(true);
  });

  it('does not mark disagreement when model and formal verdicts align', async () => {
    const provider = new MockDetectionProvider({ rawOutput: VALID_OUTPUT_JSON });
    const engine = new SecurityDetectionEngine(provider, { config: BASE_CONFIG });
    const result = await engine.detect(BASE_INPUT, { formalVerdict: 'allow' });
    expect(result.metadata.disagreement).toBeUndefined();
  });
});
