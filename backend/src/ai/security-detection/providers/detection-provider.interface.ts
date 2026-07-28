import type { DetectionInput, DetectionModelIdentity } from '../detection-contract';
import type { DetectionErrorCode } from '../detection-errors';

export interface DetectionProviderContext {
  requestId: string;
  systemPrompt: string;
  timeoutMs: number;
  numCtx: number;
  maxResponseBytes: number;
  signal?: AbortSignal;
}

export interface DetectionProviderResponse {
  rawOutput: string;
  modelName: string;
  modelVersion?: string;
  latencyMs: number;
  providerRequestId?: string;
}

export interface DetectionProviderHealth {
  healthy: boolean;
  latencyMs: number;
  detail?: string;
  errorCode?: DetectionErrorCode;
  checkedAt: string;
}

export interface DetectionProvider {
  readonly name: string;

  detect(
    input: DetectionInput,
    context: DetectionProviderContext
  ): Promise<DetectionProviderResponse>;

  /** Lightweight reachability probe — must NOT trigger a full security inference. */
  healthCheck(): Promise<DetectionProviderHealth>;

  /** Best-effort model identity for version tracking; may be static config. */
  getModelIdentity(): DetectionModelIdentity;
}
