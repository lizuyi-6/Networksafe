import { randomUUID } from 'crypto';
import logger from '../../utils/logger';
import metrics from '../../observability/metrics';
import type { DetectionDecision } from '../../services/detection-pipeline.service';
import type { DetectionSignal } from '../../services/detection-engine';
import { SecurityDetectionEngine } from './security-detection-engine';
import type { DetectionInput, DetectionInvocationResult } from './detection-contract';
import type { SecurityDetectionConfig } from './detection-config';
import { resolveSecurityDetectionConfig, createDetectionProvider, resolveModelIdentity } from './detection-config';
import { DetectionTelemetryService, buildReviewRecord } from './telemetry/detection-telemetry.service';
import {
  METRIC_DROPPED,
  METRIC_QUEUE_DEPTH
} from './telemetry/detection-telemetry.types';

export interface ShadowRequestSnapshot {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  body: string;
  sourceContext?: Record<string, unknown>;
}

export interface ShadowSubmission {
  requestId: string;
  snapshot: ShadowRequestSnapshot;
  decision: Pick<DetectionDecision, 'verdict' | 'matchedRuleIds' | 'riskScore' | 'signals' | 'decisionSource' | 'aiVerdict'>;
}

interface ShadowRuntime {
  config: SecurityDetectionConfig;
  engine: SecurityDetectionEngine;
  telemetry: DetectionTelemetryService;
  engineProviderName(): string;
  engineModelName(): string;
}

interface QueueEntry extends ShadowSubmission {
  enqueuedAt: number;
}

type ShadowRuntimeWithAccessors = ShadowRuntime;

/**
 * Fire-and-forget queue: bounded length, bounded concurrency, never throws.
 * The model engine is strictly read-only telemetry here — its output never
 * re-enters the detection decision path.
 */
class SecurityDetectionShadowQueue {
  private readonly queue: QueueEntry[] = [];
  private inFlight = 0;

  constructor(private readonly runtime: ShadowRuntime) {}

  get depth(): number {
    return this.queue.length;
  }

  enqueue(entry: QueueEntry): 'enqueued' | 'dropped' {
    if (this.queue.length >= this.runtime.config.queueMaxLength) {
      metrics.incCounter(METRIC_DROPPED, {
        provider: this.runtime.engineProviderName(),
        model: this.runtime.engineModelName(),
        mode: this.runtime.config.mode
      });
      return 'dropped';
    }
    this.queue.push(entry);
    metrics.observeHistogram(METRIC_QUEUE_DEPTH, this.queue.length, {
      mode: this.runtime.config.mode
    });
    this.drain();
    return 'enqueued';
  }

  private drain(): void {
    while (this.inFlight < this.runtime.config.queueConcurrency && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      this.inFlight += 1;
      void this.process(entry)
        .catch((error) => {
          logger.warn('security_detection.shadow_unhandled_error', {
            requestId: entry.requestId,
            error: (error as Error)?.message
          });
        })
        .finally(() => {
          this.inFlight -= 1;
          this.drain();
        });
    }
  }

  private async process(entry: QueueEntry): Promise<void> {
    const { snapshot, decision, requestId } = entry;
    const ruleSignals = mapSignalsToRuleSignals(decision.signals || []);
    const input = {
      method: snapshot.method as DetectionInput['method'],
      path: snapshot.path,
      query: snapshot.query,
      headers: snapshot.headers,
      body: snapshot.body,
      // Snapshot arrives as an open bag; engine normalization drops unknown keys
      // to satisfy additionalProperties=false on the schema. Cast through unknown
      // because the snapshot type is intentionally wider than the schema shape.
      sourceContext: snapshot.sourceContext as unknown as DetectionInput['sourceContext'],
      ruleSignals
    };

    const result: DetectionInvocationResult = await this.runtime.engine.detect(input, {
      requestId,
      ruleVerdict: decision.verdict,
      formalVerdict: decision.verdict
    });

    if (result.metadata.disagreement === true) {
      const record = buildReviewRecord({
        inputFingerprint: result.metadata.inputFingerprint,
        redactedInput: {
          method: input.method,
          path: input.path,
          queryLength: (input.query || '').length,
          headerNames: Object.keys(input.headers || {}).sort(),
          bodyLength: (input.body || '').length,
          sourceContext: input.sourceContext,
          ruleSignals
        },
        ruleDecision: {
          verdict: decision.verdict,
          matchedRuleIds: decision.matchedRuleIds,
          riskScore: decision.riskScore,
          decisionSource: decision.decisionSource,
          aiVerdict: decision.aiVerdict ?? null
        },
        modelOutput: result.output,
        modelMetadata: result.metadata,
        finalDecision: {
          verdict: decision.verdict,
          executed: true,
          note: 'formal pipeline verdict executed; shadow output never overrides'
        }
      });
      this.runtime.telemetry.exportDisagreement(record);
    }
  }
}

function mapSignalsToRuleSignals(signals: DetectionSignal[]): DetectionInput['ruleSignals'] {
  return (signals || []).slice(0, 100).map((signal) => ({
    ruleId: String(signal.key || 'unknown'),
    field: String(signal.source || 'unknown'),
    description: String(signal.description || 'signal').slice(0, 500),
    score: Math.min(1, Math.max(0, Number(signal.score) || 0))
  }));
}

function buildRuntime(env: NodeJS.ProcessEnv = process.env): ShadowRuntime | null {
  const config = resolveSecurityDetectionConfig(env);
  if (!config.enabled || config.mode === 'disabled') {
    return null;
  }
  const identity = resolveModelIdentity(config);
  const provider = createDetectionProvider(config);
  const telemetry = new DetectionTelemetryService({ reviewExportDir: config.reviewExportDir });
  const engine = new SecurityDetectionEngine(provider, { config, telemetry });
  return {
    config,
    engine,
    telemetry,
    engineProviderName: () => provider.name,
    engineModelName: () => identity.name
  };
}

/**
 * Module-level singleton: resolved lazily so tests can construct their own
 * engine instances without touching env. `enabled=false` ⇒ zero work.
 */
export class SecurityDetectionShadowService {
  private runtime: ShadowRuntime | null = null;
  private queue: SecurityDetectionShadowQueue | null = null;
  private initialized = false;

  /** For tests: force a specific runtime instead of env resolution. */
  static createForTests(runtime: ShadowRuntime): SecurityDetectionShadowService {
    const svc = new SecurityDetectionShadowService();
    svc.runtime = runtime;
    svc.queue = new SecurityDetectionShadowQueue(runtime);
    svc.initialized = true;
    return svc;
  }

  isEnabled(): boolean {
    return this.queue !== null;
  }

  submit(submission: ShadowSubmission): void {
    if (!this.initialized) {
      this.initialized = true;
      try {
        this.runtime = buildRuntime();
        this.queue = this.runtime ? new SecurityDetectionShadowQueue(this.runtime) : null;
      } catch (error) {
        logger.warn('security_detection.shadow_init_failed', {
          error: (error as Error)?.message
        });
        this.runtime = null;
        this.queue = null;
      }
    }
    if (!this.queue || !this.runtime) {
      return;
    }
    if (this.runtime.config.sampleRate < 1 && Math.random() > this.runtime.config.sampleRate) {
      return;
    }
    this.queue.enqueue({ ...submission, enqueuedAt: Date.now() });
  }
}

export const securityDetectionShadowService = new SecurityDetectionShadowService();
