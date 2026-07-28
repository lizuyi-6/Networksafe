import { createUnknownDetectionOutput, type DetectionModelIdentity } from '../detection-contract';
import type { DetectionInput } from '../detection-contract';
import type {
  DetectionProvider,
  DetectionProviderContext,
  DetectionProviderHealth,
  DetectionProviderResponse
} from './detection-provider.interface';

export interface MockDetectionProviderOptions {
  name?: string;
  rawOutput?: string;
  latencyMs?: number;
  failWith?: Error;
  onDetect?: (input: DetectionInput, context: DetectionProviderContext) => void;
}

/**
 * Deterministic provider for tests and local development. Never performs I/O.
 */
export class MockDetectionProvider implements DetectionProvider {
  readonly name: string;
  private rawOutput: string;
  private latencyMs: number;
  private failWith?: Error;
  private onDetect?: (input: DetectionInput, context: DetectionProviderContext) => void;
  public detectCalls: Array<{ input: DetectionInput; context: DetectionProviderContext }> = [];

  constructor(options: MockDetectionProviderOptions = {}) {
    this.name = options.name || 'mock';
    this.rawOutput = options.rawOutput ?? JSON.stringify(createUnknownDetectionOutput('mock provider default'));
    this.latencyMs = options.latencyMs ?? 1;
    this.failWith = options.failWith;
    this.onDetect = options.onDetect;
  }

  setRawOutput(raw: string): void {
    this.rawOutput = raw;
  }

  setFailure(error?: Error): void {
    this.failWith = error;
  }

  async detect(input: DetectionInput, context: DetectionProviderContext): Promise<DetectionProviderResponse> {
    this.detectCalls.push({ input, context });
    this.onDetect?.(input, context);
    if (context.signal?.aborted) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }
    if (this.failWith) {
      throw this.failWith;
    }
    return {
      rawOutput: this.rawOutput,
      modelName: 'aetherargus-mock',
      modelVersion: 'mock-1',
      latencyMs: this.latencyMs,
      providerRequestId: `mock-${this.detectCalls.length}`
    };
  }

  async healthCheck(): Promise<DetectionProviderHealth> {
    return {
      healthy: !this.failWith,
      latencyMs: 0,
      checkedAt: new Date().toISOString(),
      ...(this.failWith ? { detail: this.failWith.message, errorCode: 'provider_unavailable' as const } : {})
    };
  }

  getModelIdentity(): DetectionModelIdentity {
    return {
      name: 'aetherargus-mock',
      version: 'mock-1',
      baseModel: 'mock',
      schemaVersion: 1,
      datasetVersion: 'none'
    };
  }
}
