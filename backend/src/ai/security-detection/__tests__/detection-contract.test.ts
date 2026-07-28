import {
  DETECTION_ATTACK_FAMILIES,
  DETECTION_RECOMMENDED_ACTIONS,
  DETECTION_SEVERITIES,
  DETECTION_VERDICTS,
  createUnknownDetectionOutput,
  getDetectionInputSchema,
  getDetectionOutputSchema,
  resetDetectionSchemaCacheForTests
} from '../detection-contract';

describe('detection contract', () => {
  beforeEach(() => {
    resetDetectionSchemaCacheForTests();
  });

  it('exposes enum constants mirroring the JSON schemas', () => {
    expect(DETECTION_VERDICTS).toEqual(['safe', 'suspicious', 'malicious', 'unknown']);
    expect(DETECTION_SEVERITIES).toEqual(['low', 'medium', 'high', 'critical']);
    expect(DETECTION_RECOMMENDED_ACTIONS).toEqual(['allow', 'monitor', 'challenge', 'block']);
    expect(DETECTION_ATTACK_FAMILIES).toContain('sqli');
    expect(DETECTION_ATTACK_FAMILIES).toContain('other');
  });

  it('createUnknownDetectionOutput returns the fail-safe shape', () => {
    const fallback = createUnknownDetectionOutput('test reason');
    expect(fallback.verdict).toBe('unknown');
    expect(fallback.confidence).toBe(0);
    expect(fallback.recommendedAction).toBe('monitor');
    expect(fallback.attackFamily).toBe('other');
    expect(fallback.evidence).toEqual([]);
    expect(fallback.reasoning).toBe('test reason');
  });

  it('loads the JSON schemas from ml/schemas', () => {
    const inputSchema = getDetectionInputSchema() as any;
    const outputSchema = getDetectionOutputSchema() as any;
    expect(inputSchema.type).toBe('object');
    expect(inputSchema.additionalProperties).toBe(false);
    expect(inputSchema.required).toEqual(expect.arrayContaining([
      'method', 'path', 'query', 'headers', 'body', 'sourceContext', 'ruleSignals'
    ]));
    expect(outputSchema.additionalProperties).toBe(false);
    expect(outputSchema.required).toEqual(expect.arrayContaining([
      'verdict', 'confidence', 'attackFamily', 'severity', 'reasoning', 'evidence', 'recommendedAction'
    ]));
  });
});
