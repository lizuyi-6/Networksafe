import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import logger from '../../../utils/logger';
import metrics from '../../../observability/metrics';
import type { DetectionInvocationMetadata, DetectionOutput } from '../detection-contract';
import {
  METRIC_DISAGREEMENT,
  METRIC_ERROR,
  METRIC_INVOCATIONS,
  METRIC_LATENCY,
  METRIC_SCHEMA_FAILURE,
  METRIC_SUCCESS,
  METRIC_TIMEOUT,
  METRIC_UNKNOWN,
  metricLabelsFor,
  type DetectionReviewRecord,
  type DetectionTelemetryEvent,
  type DetectionTelemetrySink
} from './detection-telemetry.types';

/**
 * Telemetry sink for security-detection invocations. Emits:
 *  - Prometheus-style counters/histograms via the shared metrics registry
 *  - a sanitized structured log line (no raw body/headers/tokens)
 *  - optional disagreement export files for offline human review
 *
 * Privacy rule: raw request content NEVER leaves the engine. Events carry
 * only fingerprints (SHA-256), lengths, and schema/verdict fields.
 */
export class DetectionTelemetryService implements DetectionTelemetrySink {
  private readonly reviewDir: string | null;

  constructor(options: { reviewExportDir?: string | null } = {}) {
    this.reviewDir = options.reviewExportDir ?? null;
  }

  record(event: DetectionTelemetryEvent): void {
    const labels = metricLabelsFor(event);
    metrics.incCounter(METRIC_INVOCATIONS, labels);
    if (event.errorCode === null && event.semanticValid) {
      metrics.incCounter(METRIC_SUCCESS, labels);
    } else {
      metrics.incCounter(METRIC_ERROR, labels);
    }
    if (event.timedOut) {
      metrics.incCounter(METRIC_TIMEOUT, labels);
    }
    if (!event.schemaValid) {
      metrics.incCounter(METRIC_SCHEMA_FAILURE, labels);
    }
    if (event.modelVerdict === 'unknown') {
      metrics.incCounter(METRIC_UNKNOWN, labels);
    }
    if (event.disagreement === true) {
      metrics.incCounter(METRIC_DISAGREEMENT, labels);
    }
    metrics.observeHistogram(METRIC_LATENCY, event.latencyMs, {
      provider: event.provider,
      model: event.modelName,
      mode: event.engineMode
    });

    // Sanitized structured log: the event contract contains no raw request
    // content by construction (fingerprints + lengths only).
    logger.info('security_detection.invocation', {
      requestId: event.requestId,
      traceId: event.traceId,
      engineMode: event.engineMode,
      provider: event.provider,
      modelName: event.modelName,
      modelVersion: event.modelVersion,
      schemaVersion: event.schemaVersion,
      latencyMs: event.latencyMs,
      timedOut: event.timedOut,
      jsonSyntaxValid: event.jsonSyntaxValid,
      schemaValid: event.schemaValid,
      semanticValid: event.semanticValid,
      modelVerdict: event.modelVerdict,
      modelConfidence: event.modelConfidence,
      ruleVerdict: event.ruleVerdict,
      formalVerdict: event.formalVerdict,
      disagreement: event.disagreement,
      shadowMode: event.shadowMode,
      inputFingerprint: event.inputFingerprint,
      errorCode: event.errorCode
    });
  }

  exportDisagreement(record: DetectionReviewRecord): void {
    if (!this.reviewDir) {
      return;
    }
    try {
      const dir = path.isAbsolute(this.reviewDir)
        ? this.reviewDir
        : path.resolve(process.cwd(), this.reviewDir);
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${record.recordId}.json`);
      appendFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    } catch (error: any) {
      logger.warn('security_detection.disagreement_export_failed', {
        recordId: record.recordId,
        error: error?.message
      });
    }
  }
}

export function buildReviewRecord(input: {
  inputFingerprint: string;
  redactedInput: Record<string, unknown>;
  ruleDecision: Record<string, unknown>;
  modelOutput: DetectionOutput;
  modelMetadata: DetectionInvocationMetadata;
  finalDecision: Record<string, unknown>;
}): DetectionReviewRecord {
  return {
    recordId: randomUUID(),
    inputFingerprint: input.inputFingerprint,
    redactedInput: input.redactedInput,
    ruleDecision: input.ruleDecision,
    modelDecision: {
      verdict: input.modelOutput.verdict,
      confidence: input.modelOutput.confidence,
      attackFamily: input.modelOutput.attackFamily,
      severity: input.modelOutput.severity,
      recommendedAction: input.modelOutput.recommendedAction,
      reasoning: input.modelOutput.reasoning,
      provider: input.modelMetadata.provider,
      modelName: input.modelMetadata.modelName,
      modelVersion: input.modelMetadata.modelVersion,
      latencyMs: input.modelMetadata.latencyMs,
      errorCode: input.modelMetadata.errorCode
    },
    finalDecision: input.finalDecision,
    humanReview: null,
    eligibleForTraining: false
  };
}

export function fingerprintJson(value: unknown): string {
  const serialized = stableStringify(value);
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
