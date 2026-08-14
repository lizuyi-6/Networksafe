import {
  DETECTION_ATTACK_FAMILIES,
  DETECTION_RECOMMENDED_ACTIONS,
  DETECTION_SEVERITIES,
  DETECTION_VERDICTS,
  getDetectionInputSchema,
  getDetectionOutputSchema,
  resetDetectionSchemaCacheForTests
} from '../detection-contract';

/**
 * Parity test: TypeScript enum constants must match the JSON schemas verbatim.
 * Catches drift between ml/schemas/*.schema.json and detection-contract.ts.
 */
describe('detection schema parity', () => {
  beforeEach(() => {
    resetDetectionSchemaCacheForTests();
  });

  it('verdict enum matches the output schema', () => {
    const schema = getDetectionOutputSchema() as any;
    expect([...DETECTION_VERDICTS].sort()).toEqual([...schema.properties.verdict.enum].sort());
  });

  it('attackFamily enum matches the output schema', () => {
    const schema = getDetectionOutputSchema() as any;
    expect([...DETECTION_ATTACK_FAMILIES].sort()).toEqual([...schema.properties.attackFamily.enum].sort());
  });

  it('severity enum matches both schemas', () => {
    const outputSchema = getDetectionOutputSchema() as any;
    const inputSchema = getDetectionInputSchema() as any;
    expect([...DETECTION_SEVERITIES].sort()).toEqual([...outputSchema.properties.severity.enum].sort());
    expect([...DETECTION_SEVERITIES].sort()).toEqual(
      [...inputSchema.properties.sourceContext.properties.endpointSensitivity.enum].sort()
    );
  });

  it('recommendedAction enum matches the output schema', () => {
    const schema = getDetectionOutputSchema() as any;
    expect([...DETECTION_RECOMMENDED_ACTIONS].sort()).toEqual(
      [...schema.properties.recommendedAction.enum].sort()
    );
  });

  it('sourceContext keys are closed under additionalProperties=false', () => {
    const schema = getDetectionInputSchema() as any;
    expect(schema.properties.sourceContext.additionalProperties).toBe(false);
    const allowed = Object.keys(schema.properties.sourceContext.properties).sort();
    expect(allowed).toEqual([
      'accountPrivilege',
      'assetType',
      'authenticated',
      'distinctPathsLastMinute',
      'distinctUsernamesLastMinute',
      'endpointSensitivity',
      'geoConsistency',
      'historicalRiskScore',
      'internalService',
      'openApiMatched',
      'recentFailureCount',
      'requestsLastMinute',
      'sessionAgeSeconds',
      'statusCodeHistory'
    ]);
  });

  it('query stays the structured v0.3 object shape (drift here broke the engine contract once)', () => {
    const schema = getDetectionInputSchema() as any;
    const query = schema.properties.query;
    expect(query.type).toBe('object');
    expect(query.maxProperties).toBe(100);
    expect(Array.isArray(query.additionalProperties.type)).toBe(true);
    expect(query.additionalProperties.type.sort()).toEqual(['boolean', 'number', 'string']);
  });
});
