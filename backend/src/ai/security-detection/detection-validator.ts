import Ajv2020 from 'ajv/dist/2020';
import type { ValidateFunction } from 'ajv';
import {
  createUnknownDetectionOutput,
  getDetectionInputSchema,
  getDetectionOutputSchema,
  type DetectionInput,
  type DetectionOutput,
  type JsonSchema
} from './detection-contract';
import { DetectionError, type DetectionErrorCode } from './detection-errors';

export interface DetectionValidationResult {
  ok: boolean;
  output: DetectionOutput;
  jsonSyntaxValid: boolean;
  schemaValid: boolean;
  semanticValid: boolean;
  errorCode: DetectionErrorCode | null;
  errorDetail?: string;
}

const UNKNOWN_CONFIDENCE_CEILING = 0.5;

let inputValidator: ValidateFunction | null = null;
let outputValidator: ValidateFunction | null = null;

function getInputValidator(): ValidateFunction {
  if (!inputValidator) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    inputValidator = ajv.compile(getDetectionInputSchema() as JsonSchema);
  }
  return inputValidator;
}

function getOutputValidator(): ValidateFunction {
  if (!outputValidator) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    outputValidator = ajv.compile(getDetectionOutputSchema() as JsonSchema);
  }
  return outputValidator;
}

/** Test hook: recompile validators after schemas change. */
export function resetDetectionValidatorsForTests(): void {
  inputValidator = null;
  outputValidator = null;
}

export function validateDetectionInput(input: unknown): { ok: boolean; errors: string[] } {
  const validate = getInputValidator();
  const ok = validate(input) === true;
  const errors = (validate.errors || []).map((err) => `${err.instancePath || '/'} ${err.message || ''}`.trim());
  return { ok, errors };
}

/**
 * Strictly extract a single JSON object from raw model output.
 * Rejects Markdown fences, leading/trailing prose, arrays, and multi-object streams.
 */
export function extractStrictJsonObject(raw: string): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new DetectionError('output_json_invalid', 'model output is empty');
  }
  const trimmed = raw.trim();
  if (trimmed.includes('```')) {
    throw new DetectionError('output_json_invalid', 'model output contains markdown code fences');
  }
  const parsed: unknown = JSON.parse(trimmed);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DetectionError('output_json_invalid', 'model output is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

interface SemanticRule {
  code: string;
  applies: (output: DetectionOutput) => boolean;
}

const SEMANTIC_RULES: SemanticRule[] = [
  {
    code: 'safe_must_not_block',
    applies: (output) => !(output.verdict === 'safe' && output.recommendedAction === 'block')
  },
  {
    code: 'malicious_must_not_allow',
    applies: (output) => !(output.verdict === 'malicious' && output.recommendedAction === 'allow')
  },
  {
    code: 'unknown_confidence_bounded',
    applies: (output) => !(output.verdict === 'unknown' && output.confidence > UNKNOWN_CONFIDENCE_CEILING)
  },
  {
    code: 'evidence_is_array',
    applies: (output) => Array.isArray(output.evidence)
  },
  {
    code: 'confidence_in_range',
    applies: (output) => (
      typeof output.confidence === 'number'
      && Number.isFinite(output.confidence)
      && output.confidence >= 0
      && output.confidence <= 1
    )
  },
  {
    code: 'reasoning_non_empty',
    applies: (output) => typeof output.reasoning === 'string' && output.reasoning.trim().length > 0
  }
];

export function checkSemanticConsistency(output: DetectionOutput): { ok: boolean; violated: string[] } {
  const violated = SEMANTIC_RULES.filter((rule) => !rule.applies(output)).map((rule) => rule.code);
  return { ok: violated.length === 0, violated };
}

/**
 * Validate raw model text into a DetectionOutput. Any failure returns a fixed
 * unknown verdict — never a silent safe.
 */
export function validateModelRawOutput(raw: string): DetectionValidationResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = extractStrictJsonObject(raw);
  } catch (error: any) {
    return {
      ok: false,
      output: createUnknownDetectionOutput(),
      jsonSyntaxValid: false,
      schemaValid: false,
      semanticValid: false,
      errorCode: 'output_json_invalid',
      errorDetail: error?.message || 'json_parse_failed'
    };
  }

  const validate = getOutputValidator();
  if (validate(parsed) !== true) {
    const detail = (validate.errors || [])
      .map((err) => `${err.instancePath || '/'} ${err.message || ''}`.trim())
      .join('; ');
    return {
      ok: false,
      output: createUnknownDetectionOutput(),
      jsonSyntaxValid: true,
      schemaValid: false,
      semanticValid: false,
      errorCode: 'output_schema_invalid',
      errorDetail: detail || 'schema_validation_failed'
    };
  }

  const output = parsed as unknown as DetectionOutput;
  const semantic = checkSemanticConsistency(output);
  if (!semantic.ok) {
    return {
      ok: false,
      output: createUnknownDetectionOutput(),
      jsonSyntaxValid: true,
      schemaValid: true,
      semanticValid: false,
      errorCode: 'output_semantic_invalid',
      errorDetail: semantic.violated.join(',')
    };
  }

  return {
    ok: true,
    output,
    jsonSyntaxValid: true,
    schemaValid: true,
    semanticValid: true,
    errorCode: null
  };
}

export type { DetectionInput };
