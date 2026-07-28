import type { DetectionOutput } from '../detection-contract';
import type {
  RiskFusionEntry,
  RiskFusionResult,
  RiskFusionSource
} from './risk-fusion.types';

export interface FuseRiskInput {
  /** Authoritative verdict from the existing detection pipeline (rule engine / Final Defense). */
  formalVerdict: 'allow' | 'monitor' | 'block';
  formalSource: Exclude<RiskFusionSource, 'aetherargus_shadow'>;
  /** Optional advisory model output (shadow only — never executed). */
  modelOutput?: DetectionOutput | null;
  extraEntries?: RiskFusionEntry[];
}

function modelVerdictToActionBucket(verdict: DetectionOutput['verdict']): 'allow' | 'monitor' | 'block' {
  if (verdict === 'malicious') {
    return 'block';
  }
  if (verdict === 'suspicious' || verdict === 'unknown') {
    return 'monitor';
  }
  return 'allow';
}

/**
 * Fuse the authoritative rule/Final-Defense verdict with the advisory
 * AetherArgus shadow output. The fusion NEVER upgrades or downgrades the
 * formal verdict: the returned `finalVerdict` is always the input
 * `formalVerdict`. The model verdict is carried alongside for telemetry
 * and disagreement analysis only.
 *
 * Hard guarantee: `executable` is always `false`. There is no code path in
 * this module that triggers a block, allow, hardware command, or any other
 * externally visible action.
 */
export function fuseRisk(input: FuseRiskInput): RiskFusionResult {
  const entries: RiskFusionEntry[] = [
    {
      source: input.formalSource,
      verdict: input.formalVerdict,
      detail: 'authoritative pipeline verdict'
    }
  ];

  if (input.extraEntries) {
    entries.push(...input.extraEntries);
  }

  if (input.modelOutput) {
    entries.push({
      source: 'aetherargus_shadow',
      verdict: input.modelOutput.verdict,
      confidence: input.modelOutput.confidence,
      detail: 'advisory only; never executed'
    });
  }

  const disagreement = input.modelOutput
    ? modelVerdictToActionBucket(input.modelOutput.verdict) !== input.formalVerdict
    : false;

  return {
    executable: false,
    finalVerdict: input.formalVerdict,
    finalSource: input.formalSource,
    modelVerdict: input.modelOutput?.verdict,
    modelRecommendedAction: input.modelOutput?.recommendedAction,
    modelConfidence: input.modelOutput?.confidence,
    disagreement,
    entries
  };
}
