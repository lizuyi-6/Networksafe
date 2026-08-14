import {
  checkSemanticConsistency,
  extractStrictJsonObject,
  resetDetectionValidatorsForTests,
  validateDetectionInput,
  validateModelRawOutput
} from '../detection-validator';
import { resetDetectionSchemaCacheForTests, type DetectionInput, type DetectionOutput } from '../detection-contract';

const VALID_INPUT: DetectionInput = {
  method: 'GET',
  path: '/products',
  query: { id: '1' },
  headers: { accept: 'application/json' },
  body: '',
  sourceContext: {
    requestsLastMinute: 1,
    distinctPathsLastMinute: 1,
    recentFailureCount: 0
  },
  ruleSignals: []
};

const VALID_OUTPUT: DetectionOutput = {
  verdict: 'safe',
  confidence: 0.9,
  attackFamily: 'benign',
  severity: 'low',
  reasoning: 'normal request',
  evidence: [],
  recommendedAction: 'allow'
};

beforeEach(() => {
  resetDetectionSchemaCacheForTests();
  resetDetectionValidatorsForTests();
});

describe('validateDetectionInput', () => {
  it('accepts a schema-valid input', () => {
    expect(validateDetectionInput(VALID_INPUT).ok).toBe(true);
  });

  it('rejects sourceContext with extra keys (additionalProperties=false)', () => {
    const result = validateDetectionInput({
      ...VALID_INPUT,
      sourceContext: { ...VALID_INPUT.sourceContext, sourceIp: '1.2.3.4' }
    });
    expect(result.ok).toBe(false);
  });

  it('rejects negative count fields', () => {
    const result = validateDetectionInput({
      ...VALID_INPUT,
      sourceContext: { ...VALID_INPUT.sourceContext, requestsLastMinute: -1 }
    });
    expect(result.ok).toBe(false);
  });

  it('rejects invalid method enum', () => {
    const result = validateDetectionInput({ ...VALID_INPUT, method: 'FOO' as any });
    expect(result.ok).toBe(false);
  });
});

describe('extractStrictJsonObject', () => {
  it('parses a plain JSON object', () => {
    expect(extractStrictJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('rejects markdown code fences', () => {
    expect(() => extractStrictJsonObject('```json\n{"a":1}\n```')).toThrow(/markdown/);
  });

  it('rejects leading prose', () => {
    expect(() => extractStrictJsonObject('Here is the answer: {"a":1}')).toThrow();
  });

  it('rejects arrays', () => {
    expect(() => extractStrictJsonObject('[{"a":1}]')).toThrow(/not a JSON object/);
  });

  it('rejects empty content', () => {
    expect(() => extractStrictJsonObject('')).toThrow(/empty/);
    expect(() => extractStrictJsonObject('   ')).toThrow(/empty/);
  });
});

describe('checkSemanticConsistency', () => {
  it('passes the canonical safe output', () => {
    expect(checkSemanticConsistency(VALID_OUTPUT).ok).toBe(true);
  });

  it('rejects safe + block', () => {
    const result = checkSemanticConsistency({ ...VALID_OUTPUT, recommendedAction: 'block' });
    expect(result.ok).toBe(false);
    expect(result.violated).toContain('safe_must_not_block');
  });

  it('rejects malicious + allow', () => {
    const result = checkSemanticConsistency({
      ...VALID_OUTPUT,
      verdict: 'malicious',
      recommendedAction: 'allow'
    });
    expect(result.violated).toContain('malicious_must_not_allow');
  });

  it('rejects unknown verdict with confidence above 0.5', () => {
    const result = checkSemanticConsistency({
      ...VALID_OUTPUT,
      verdict: 'unknown',
      confidence: 0.9,
      recommendedAction: 'monitor'
    });
    expect(result.violated).toContain('unknown_confidence_bounded');
  });

  it('rejects empty reasoning', () => {
    const result = checkSemanticConsistency({ ...VALID_OUTPUT, reasoning: '   ' });
    expect(result.violated).toContain('reasoning_non_empty');
  });
});

describe('validateModelRawOutput', () => {
  it('returns ok=true with the parsed output for a valid response', () => {
    const result = validateModelRawOutput(JSON.stringify(VALID_OUTPUT));
    expect(result.ok).toBe(true);
    expect(result.output).toEqual(VALID_OUTPUT);
    expect(result.jsonSyntaxValid).toBe(true);
    expect(result.schemaValid).toBe(true);
    expect(result.semanticValid).toBe(true);
    expect(result.errorCode).toBeNull();
  });

  it('returns unknown when JSON is invalid — never safe', () => {
    const result = validateModelRawOutput('not json');
    expect(result.ok).toBe(false);
    expect(result.output.verdict).toBe('unknown');
    expect(result.output.recommendedAction).toBe('monitor');
    expect(result.errorCode).toBe('output_json_invalid');
  });

  it('returns unknown when output has extra fields', () => {
    const result = validateModelRawOutput(JSON.stringify({ ...VALID_OUTPUT, command: 'block-host' }));
    expect(result.ok).toBe(false);
    expect(result.output.verdict).toBe('unknown');
    expect(result.errorCode).toBe('output_schema_invalid');
    expect(result.output).not.toHaveProperty('command');
  });

  it('returns unknown when verdict is an illegal enum', () => {
    const result = validateModelRawOutput(JSON.stringify({ ...VALID_OUTPUT, verdict: 'definitely-safe' }));
    expect(result.ok).toBe(false);
    expect(result.output.verdict).toBe('unknown');
    expect(result.errorCode).toBe('output_schema_invalid');
  });

  it('returns unknown when semantics are violated (safe + block)', () => {
    const result = validateModelRawOutput(JSON.stringify({
      ...VALID_OUTPUT,
      recommendedAction: 'block'
    }));
    expect(result.ok).toBe(false);
    expect(result.output.verdict).toBe('unknown');
    expect(result.errorCode).toBe('output_semantic_invalid');
  });
});
