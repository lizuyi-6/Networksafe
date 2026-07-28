import type { DetectionInvocationMetadata, DetectionVerdict } from '../detection-contract';

export interface DetectionTelemetryEvent extends DetectionInvocationMetadata {
  eventType: 'security_detection_invocation';
}

export interface DetectionMetricsSink {
  incCounter(name: string, labels: Record<string, string>, value?: number): void;
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void;
}

export interface DetectionReviewRecord {
  recordId: string;
  inputFingerprint: string;
  redactedInput: Record<string, unknown>;
  ruleDecision: Record<string, unknown>;
  modelDecision: Record<string, unknown>;
  finalDecision: Record<string, unknown>;
  humanReview: null;
  eligibleForTraining: false;
}

export interface DetectionTelemetrySink {
  record(event: DetectionTelemetryEvent): void;
  exportDisagreement?(record: DetectionReviewRecord): void;
}

export const METRIC_INVOCATIONS = 'security_detection_invocations_total';
export const METRIC_SUCCESS = 'security_detection_success_total';
export const METRIC_TIMEOUT = 'security_detection_timeout_total';
export const METRIC_ERROR = 'security_detection_error_total';
export const METRIC_SCHEMA_FAILURE = 'security_detection_schema_failure_total';
export const METRIC_UNKNOWN = 'security_detection_unknown_total';
export const METRIC_DISAGREEMENT = 'security_detection_disagreement_total';
export const METRIC_DROPPED = 'security_detection_dropped_total';
export const METRIC_LATENCY = 'security_detection_latency_ms';
export const METRIC_QUEUE_DEPTH = 'security_detection_queue_depth';

export function metricLabelsFor(event: DetectionTelemetryEvent): Record<string, string> {
  return {
    provider: event.provider,
    model: event.modelName,
    mode: event.engineMode,
    verdict: event.modelVerdict || 'none',
    error_code: event.errorCode || 'none'
  };
}
