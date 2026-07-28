import type { DetectionModelIdentity } from './detection-contract';
import type { DetectionProvider } from './providers/detection-provider.interface';
import { MockDetectionProvider } from './providers/mock-detection.provider';
import { OllamaDetectionProvider } from './providers/ollama-detection.provider';
import { DetectionError } from './detection-errors';

export type DetectionEngineMode = 'disabled' | 'shadow' | 'advisory' | 'enforced';

export interface SecurityDetectionConfig {
  enabled: boolean;
  mode: DetectionEngineMode;
  provider: 'ollama' | 'mock';
  model: string;
  modelVersion: string;
  quantization: string;
  datasetVersion: string;
  ollamaBaseUrl: string;
  timeoutMs: number;
  numCtx: number;
  maxBodyBytes: number;
  maxQueryBytes: number;
  maxHeaderCount: number;
  maxHeaderValueBytes: number;
  maxResponseBytes: number;
  sampleRate: number;
  failMode: 'unknown';
  queueMaxLength: number;
  queueConcurrency: number;
  reviewExportDir: string;
}

const DEFAULTS: SecurityDetectionConfig = {
  enabled: false,
  mode: 'disabled',
  provider: 'ollama',
  model: 'aetherargus-detector',
  modelVersion: 'Preview-0.1',
  quantization: 'Q4_K_M',
  datasetVersion: 'v01',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  timeoutMs: 3000,
  numCtx: 2048,
  maxBodyBytes: 65536,
  maxQueryBytes: 8192,
  maxHeaderCount: 64,
  maxHeaderValueBytes: 4096,
  maxResponseBytes: 16384,
  sampleRate: 1.0,
  failMode: 'unknown',
  queueMaxLength: 256,
  queueConcurrency: 2,
  reviewExportDir: 'runtime-data/security-detection-review'
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSampleRate(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, parsed));
}

function parseMode(value: string | undefined, enabled: boolean): DetectionEngineMode {
  if (!enabled) {
    return 'disabled';
  }
  const normalized = String(value || '').toLowerCase();
  // Only disabled/shadow are wired this phase; advisory/enforced parse but
  // stay inert (treated as shadow-never-execute) until a later rollout.
  if (normalized === 'shadow' || normalized === 'advisory' || normalized === 'enforced') {
    return normalized;
  }
  return 'disabled';
}

/**
 * Resolve engine config from environment. Missing/invalid config always
 * degrades to `disabled` — the engine is opt-in, never opt-out.
 */
export function resolveSecurityDetectionConfig(env: NodeJS.ProcessEnv = process.env): SecurityDetectionConfig {
  const enabled = env.SECURITY_DETECTION_ENGINE_ENABLED === 'true';
  return {
    ...DEFAULTS,
    enabled,
    mode: parseMode(env.SECURITY_DETECTION_ENGINE_MODE, enabled),
    provider: env.SECURITY_DETECTION_PROVIDER === 'mock' ? 'mock' : 'ollama',
    model: env.SECURITY_DETECTION_MODEL || DEFAULTS.model,
    modelVersion: env.SECURITY_DETECTION_MODEL_VERSION || DEFAULTS.modelVersion,
    quantization: env.SECURITY_DETECTION_QUANTIZATION || DEFAULTS.quantization,
    datasetVersion: env.SECURITY_DETECTION_DATASET_VERSION || DEFAULTS.datasetVersion,
    ollamaBaseUrl: env.SECURITY_DETECTION_OLLAMA_BASE_URL || DEFAULTS.ollamaBaseUrl,
    timeoutMs: parsePositiveInt(env.SECURITY_DETECTION_TIMEOUT_MS, DEFAULTS.timeoutMs),
    numCtx: parsePositiveInt(env.SECURITY_DETECTION_NUM_CTX, DEFAULTS.numCtx),
    maxBodyBytes: parsePositiveInt(env.SECURITY_DETECTION_MAX_BODY_BYTES, DEFAULTS.maxBodyBytes),
    maxQueryBytes: parsePositiveInt(env.SECURITY_DETECTION_MAX_QUERY_BYTES, DEFAULTS.maxQueryBytes),
    maxHeaderCount: parsePositiveInt(env.SECURITY_DETECTION_MAX_HEADER_COUNT, DEFAULTS.maxHeaderCount),
    maxHeaderValueBytes: parsePositiveInt(env.SECURITY_DETECTION_MAX_HEADER_VALUE_BYTES, DEFAULTS.maxHeaderValueBytes),
    maxResponseBytes: parsePositiveInt(env.SECURITY_DETECTION_MAX_RESPONSE_BYTES, DEFAULTS.maxResponseBytes),
    sampleRate: parseSampleRate(env.SECURITY_DETECTION_SAMPLE_RATE, DEFAULTS.sampleRate),
    queueMaxLength: parsePositiveInt(env.SECURITY_DETECTION_QUEUE_MAX_LENGTH, DEFAULTS.queueMaxLength),
    queueConcurrency: parsePositiveInt(env.SECURITY_DETECTION_QUEUE_CONCURRENCY, DEFAULTS.queueConcurrency),
    reviewExportDir: env.SECURITY_DETECTION_REVIEW_DIR || DEFAULTS.reviewExportDir
  };
}

export function createDetectionProvider(config: SecurityDetectionConfig): DetectionProvider {
  if (config.provider === 'mock') {
    return new MockDetectionProvider();
  }
  if (config.provider === 'ollama') {
    return new OllamaDetectionProvider({
      baseUrl: config.ollamaBaseUrl,
      model: config.model,
      version: config.modelVersion,
      quantization: config.quantization,
      datasetVersion: config.datasetVersion
    });
  }
  throw new DetectionError('provider_unavailable', `unknown detection provider: ${String(config.provider)}`);
}

export function resolveModelIdentity(config: SecurityDetectionConfig): DetectionModelIdentity {
  return {
    name: config.model,
    version: config.modelVersion,
    baseModel: config.model.split(':')[0],
    quantization: config.quantization,
    schemaVersion: 1,
    datasetVersion: config.datasetVersion
  };
}
