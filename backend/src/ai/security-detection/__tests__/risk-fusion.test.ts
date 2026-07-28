import { fuseRisk } from '../fusion/risk-fusion.service';
import type { DetectionOutput } from '../detection-contract';

const MALICIOUS_OUTPUT: DetectionOutput = {
  verdict: 'malicious',
  confidence: 0.95,
  attackFamily: 'sqli',
  severity: 'high',
  reasoning: 'UNION SELECT in query',
  evidence: [{ field: 'query', value: "id=1 UNION SELECT", reason: 'sqli keyword' }],
  recommendedAction: 'block'
};

describe('fuseRisk', () => {
  it('always returns executable=false', () => {
    const result = fuseRisk({
      formalVerdict: 'allow',
      formalSource: 'rule_engine',
      modelOutput: MALICIOUS_OUTPUT
    });
    expect(result.executable).toBe(false);
  });

  it('never upgrades or downgrades the formal verdict', () => {
    const allow = fuseRisk({
      formalVerdict: 'allow',
      formalSource: 'rule_engine',
      modelOutput: MALICIOUS_OUTPUT
    });
    expect(allow.finalVerdict).toBe('allow');

    const block = fuseRisk({
      formalVerdict: 'block',
      formalSource: 'rule_engine',
      modelOutput: {
        ...MALICIOUS_OUTPUT,
        verdict: 'safe',
        recommendedAction: 'allow'
      }
    });
    expect(block.finalVerdict).toBe('block');
  });

  it('marks disagreement when model bucket differs from formal verdict', () => {
    const result = fuseRisk({
      formalVerdict: 'allow',
      formalSource: 'rule_engine',
      modelOutput: MALICIOUS_OUTPUT
    });
    expect(result.disagreement).toBe(true);
  });

  it('does not mark disagreement when model aligns with formal verdict', () => {
    const result = fuseRisk({
      formalVerdict: 'block',
      formalSource: 'rule_engine',
      modelOutput: MALICIOUS_OUTPUT
    });
    expect(result.disagreement).toBe(false);
  });

  it('carries the model recommendedAction as advisory metadata only', () => {
    const result = fuseRisk({
      formalVerdict: 'allow',
      formalSource: 'rule_engine',
      modelOutput: MALICIOUS_OUTPUT
    });
    expect(result.modelRecommendedAction).toBe('block');
    expect(result.executable).toBe(false);
  });
});
