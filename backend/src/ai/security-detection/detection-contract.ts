import { readFileSync } from 'fs';
import path from 'path';

/**
 * Detection contract types mirroring ml/schemas/detection-{input,output}.schema.json.
 * The JSON Schema files are the single source of truth; these interfaces exist for
 * compile-time ergonomics only. Schema-parity tests assert the enums/required fields
 * here never drift from the JSON files.
 */

export const DETECTION_VERDICTS = ['safe', 'suspicious', 'malicious', 'unknown'] as const;
export const DETECTION_ATTACK_FAMILIES = [
  'benign',
  'sqli',
  'xss',
  'command_injection',
  'path_traversal',
  'ssrf',
  'authentication',
  'automation',
  'api_abuse',
  'deserialization',
  'file_upload',
  'protocol_attack',
  'business_logic',
  'other'
] as const;
export const DETECTION_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const DETECTION_RECOMMENDED_ACTIONS = ['allow', 'monitor', 'challenge', 'block'] as const;

export type DetectionVerdict = typeof DETECTION_VERDICTS[number];
export type DetectionAttackFamily = typeof DETECTION_ATTACK_FAMILIES[number];
export type DetectionSeverity = typeof DETECTION_SEVERITIES[number];
export type DetectionRecommendedAction = typeof DETECTION_RECOMMENDED_ACTIONS[number];
export type DetectionMethod =
  | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'CONNECT' | 'TRACE' | 'EVENT';

export interface RuleSignal {
  ruleId: string;
  score: number;
  field: string;
  description: string;
}

export interface DetectionSourceContext {
  requestsLastMinute: number;
  distinctPathsLastMinute: number;
  recentFailureCount: number;
  historicalRiskScore?: number;
  authenticated?: boolean;
  accountPrivilege?: string;
  internalService?: boolean;
  endpointSensitivity?: DetectionSeverity;
  openApiMatched?: boolean;
  assetType?: string;
  distinctUsernamesLastMinute?: number;
  sessionAgeSeconds?: number;
  geoConsistency?: boolean;
  statusCodeHistory?: number[];
}

export interface DetectionInput {
  method: DetectionMethod;
  path: string;
  query: string;
  headers: Record<string, string>;
  body: string;
  sourceContext: DetectionSourceContext;
  ruleSignals: RuleSignal[];
}

export interface DetectionEvidenceItem {
  field: string;
  value: unknown;
  reason: string;
}

export interface DetectionOutput {
  verdict: DetectionVerdict;
  confidence: number;
  attackFamily: DetectionAttackFamily;
  severity: DetectionSeverity;
  reasoning: string;
  evidence: DetectionEvidenceItem[];
  recommendedAction: DetectionRecommendedAction;
}

export interface DetectionModelIdentity {
  name: string;
  version: string;
  baseModel: string;
  adapterRevision?: string;
  quantization?: string;
  schemaVersion: number;
  datasetVersion: string;
  modelHash?: string;
}

export interface DetectionInvocationMetadata {
  requestId: string;
  traceId?: string;
  timestamp: string;
  engineMode: 'disabled' | 'shadow' | 'advisory' | 'enforced';
  provider: string;
  modelName: string;
  modelVersion?: string;
  schemaVersion: number;
  datasetVersion?: string;
  quantization?: string;
  latencyMs: number;
  timedOut: boolean;
  jsonSyntaxValid: boolean;
  schemaValid: boolean;
  semanticValid: boolean;
  modelVerdict: DetectionVerdict | null;
  modelConfidence: number | null;
  ruleVerdict?: string;
  formalVerdict?: string;
  disagreement?: boolean;
  shadowMode: boolean;
  inputFingerprint: string;
  errorCode: string | null;
}

export interface DetectionInvocationResult {
  output: DetectionOutput;
  metadata: DetectionInvocationMetadata;
}

export const DETECTION_SCHEMA_VERSION = 1;

const FALLBACK_UNKNOWN_REASONING = '模型输出无法通过严格校验';

export function createUnknownDetectionOutput(reasoning: string = FALLBACK_UNKNOWN_REASONING): DetectionOutput {
  return {
    verdict: 'unknown',
    confidence: 0,
    attackFamily: 'other',
    severity: 'medium',
    reasoning,
    evidence: [],
    recommendedAction: 'monitor'
  };
}

export type JsonSchema = Record<string, unknown>;

function resolveSchemaDir(): string {
  // backend/src/ai/security-detection -> repo root is four levels up.
  return path.resolve(__dirname, '..', '..', '..', '..', 'ml', 'schemas');
}

let cachedInputSchema: JsonSchema | null = null;
let cachedOutputSchema: JsonSchema | null = null;

export function getDetectionInputSchema(): JsonSchema {
  if (!cachedInputSchema) {
    cachedInputSchema = JSON.parse(
      readFileSync(path.join(resolveSchemaDir(), 'detection-input.schema.json'), 'utf8')
    ) as JsonSchema;
  }
  return cachedInputSchema;
}

export function getDetectionOutputSchema(): JsonSchema {
  if (!cachedOutputSchema) {
    cachedOutputSchema = JSON.parse(
      readFileSync(path.join(resolveSchemaDir(), 'detection-output.schema.json'), 'utf8')
    ) as JsonSchema;
  }
  return cachedOutputSchema;
}

/** Test hook: drop cached schemas so edits to ml/schemas are picked up. */
export function resetDetectionSchemaCacheForTests(): void {
  cachedInputSchema = null;
  cachedOutputSchema = null;
}
