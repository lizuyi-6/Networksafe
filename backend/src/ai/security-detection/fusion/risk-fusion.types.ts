import type { DetectionVerdict, DetectionRecommendedAction } from '../detection-contract';

export type RiskFusionSource = 'rule_engine' | 'final_defense' | 'hardware_authorization' | 'aetherargus_shadow';

export interface RiskFusionEntry {
  source: RiskFusionSource;
  verdict?: string;
  confidence?: number;
  detail?: string;
}

export interface RiskFusionResult {
  /**
   * Always `false` for shadow-phase AetherArgus entries. The fusion layer is
   * a read-only projection of rule/final-defense outcomes plus the advisory
   * model verdict; it never triggers an action itself.
   */
  executable: false;
  finalVerdict: 'allow' | 'monitor' | 'block';
  finalSource: Exclude<RiskFusionSource, 'aetherargus_shadow'>;
  modelVerdict?: DetectionVerdict;
  modelRecommendedAction?: DetectionRecommendedAction;
  modelConfidence?: number;
  disagreement: boolean;
  entries: RiskFusionEntry[];
}
