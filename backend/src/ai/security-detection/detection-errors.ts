export type DetectionErrorCode =
  | 'input_schema_invalid'
  | 'input_normalization_failed'
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'provider_http_error'
  | 'provider_response_empty'
  | 'provider_response_too_large'
  | 'model_call_failed'
  | 'output_json_invalid'
  | 'output_schema_invalid'
  | 'output_semantic_invalid'
  | 'engine_disabled';

export class DetectionError extends Error {
  constructor(
    public readonly code: DetectionErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'DetectionError';
  }
}

export function toDetectionErrorCode(error: unknown): DetectionErrorCode {
  if (error instanceof DetectionError) {
    return error.code;
  }
  return 'model_call_failed';
}
