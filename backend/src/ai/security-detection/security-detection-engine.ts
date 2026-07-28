import { createHash, randomUUID } from 'crypto';
import type {
  DetectionInput,
  DetectionInvocationMetadata,
  DetectionInvocationResult,
  DetectionMethod,
  DetectionOutput,
  DetectionSourceContext,
  RuleSignal
} from './detection-contract';
import {
  createUnknownDetectionOutput,
  DETECTION_SEVERITIES
} from './detection-contract';
import { toDetectionErrorCode } from './detection-errors';
import { buildDetectorSystemPrompt } from './prompts/detector-system-prompt';
import type { DetectionProvider } from './providers/detection-provider.interface';
import type { DetectionTelemetrySink } from './telemetry/detection-telemetry.types';
import { fingerprintJson } from './telemetry/detection-telemetry.service';
import { validateDetectionInput, validateModelRawOutput } from './detection-validator';
import type { SecurityDetectionConfig } from './detection-config';

const DETECTION_METHODS: readonly DetectionMethod[] = [
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE', 'EVENT'
];

const SOURCE_CONTEXT_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'requestsLastMinute',
  'distinctPathsLastMinute',
  'recentFailureCount',
  'historicalRiskScore',
  'authenticated',
  'accountPrivilege',
  'internalService',
  'endpointSensitivity',
  'openApiMatched',
  'assetType',
  'distinctUsernamesLastMinute',
  'sessionAgeSeconds',
  'geoConsistency',
  'statusCodeHistory'
]);

/** Headers that are replaced with a fixed placeholder before reaching the model. */
const SENSITIVE_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-device-key',
  'x-session-token'
]);

const REDACTED = '[redacted]';

export type RawDetectionInput = Omit<Partial<DetectionInput>, 'sourceContext'> & {
  sourceContext?: Record<string, unknown> | DetectionSourceContext;
};

export interface DetectionExecutionContext {
  requestId?: string;
  traceId?: string;
  ruleVerdict?: string;
  formalVerdict?: string;
  signal?: AbortSignal;
}

export interface SecurityDetectionEngineOptions {
  config: SecurityDetectionConfig;
  telemetry?: DetectionTelemetrySink | null;
  now?: () => string;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return value;
  }
  const buf = Buffer.from(value, 'utf8');
  // Back off to a valid UTF-8 boundary.
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return buf.subarray(0, end).toString('utf8');
}

function sanitizeUnicode(value: string): string {
  // Strip unpaired surrogates and non-characters that break downstream JSON/model parsing.
  return value
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/[◀-﫿-]/g, '');
}

function normalizeHeaderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeHeaderValue(item)).join(', ');
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

export function normalizeDetectionHeaders(
  headers: Record<string, unknown>,
  maxHeaderCount: number,
  maxHeaderValueBytes: number
): Record<string, string> {
  const normalized: Record<string, string> = {};
  const entries = Object.entries(headers || {}).slice(0, Math.max(1, maxHeaderCount));
  for (const [rawName, rawValue] of entries) {
    const name = String(rawName || '').toLowerCase().trim();
    if (!name || /[^a-z0-9!#$%&'*+.^_`|~-]/.test(name)) {
      continue;
    }
    if (SENSITIVE_HEADER_NAMES.has(name)) {
      normalized[name] = REDACTED;
      continue;
    }
    normalized[name] = truncateUtf8(sanitizeUnicode(normalizeHeaderValue(rawValue)), maxHeaderValueBytes);
  }
  return normalized;
}

function normalizeSourceContext(raw: Record<string, unknown> | undefined): DetectionSourceContext {
  const source = raw || {};
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!SOURCE_CONTEXT_ALLOWED_KEYS.has(key)) {
      continue;
    }
    if (value === null || value === undefined) {
      continue;
    }
    if (key === 'statusCodeHistory') {
      if (Array.isArray(value)) {
        filtered[key] = value
          .map((item) => Number(item))
          .filter((item) => Number.isInteger(item) && item >= 100 && item <= 599)
          .slice(0, 100);
      }
      continue;
    }
    if (typeof value === 'object') {
      // No nested objects permitted by the schema — drop rather than serialize cycles.
      continue;
    }
    filtered[key] = value;
  }

  const toCount = (value: unknown): number => {
    const num = Number(value);
    return Number.isInteger(num) && num >= 0 ? num : 0;
  };

  const endpointSensitivity = DETECTION_SEVERITIES.includes(filtered.endpointSensitivity as any)
    ? filtered.endpointSensitivity
    : undefined;

  return {
    requestsLastMinute: toCount(filtered.requestsLastMinute),
    distinctPathsLastMinute: toCount(filtered.distinctPathsLastMinute),
    recentFailureCount: toCount(filtered.recentFailureCount),
    ...(filtered.historicalRiskScore !== undefined
      ? { historicalRiskScore: Math.min(1, Math.max(0, Number(filtered.historicalRiskScore) || 0)) }
      : {}),
    ...(typeof filtered.authenticated === 'boolean' ? { authenticated: filtered.authenticated } : {}),
    ...(typeof filtered.accountPrivilege === 'string'
      ? { accountPrivilege: truncateUtf8(filtered.accountPrivilege, 80) }
      : {}),
    ...(typeof filtered.internalService === 'boolean' ? { internalService: filtered.internalService } : {}),
    ...(endpointSensitivity ? { endpointSensitivity: endpointSensitivity as DetectionSourceContext['endpointSensitivity'] } : {}),
    ...(typeof filtered.openApiMatched === 'boolean' ? { openApiMatched: filtered.openApiMatched } : {}),
    ...(typeof filtered.assetType === 'string' ? { assetType: truncateUtf8(filtered.assetType, 120) } : {}),
    ...(filtered.distinctUsernamesLastMinute !== undefined
      ? { distinctUsernamesLastMinute: toCount(filtered.distinctUsernamesLastMinute) }
      : {}),
    ...(filtered.sessionAgeSeconds !== undefined
      ? { sessionAgeSeconds: toCount(filtered.sessionAgeSeconds) }
      : {}),
    ...(typeof filtered.geoConsistency === 'boolean' ? { geoConsistency: filtered.geoConsistency } : {}),
    ...(Array.isArray(filtered.statusCodeHistory) ? { statusCodeHistory: filtered.statusCodeHistory as number[] } : {})
  };
}

function normalizeRuleSignals(raw: unknown): RuleSignal[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const signals: RuleSignal[] = [];
  for (const item of raw.slice(0, 100)) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const ruleId = String(record.ruleId || '').trim();
    const field = String(record.field || '').trim();
    const description = String(record.description || '').trim();
    const score = Number(record.score);
    if (!ruleId || !field || !description) {
      continue;
    }
    signals.push({
      ruleId: truncateUtf8(ruleId, 160),
      field: truncateUtf8(field, 160),
      description: truncateUtf8(description, 500),
      score: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0
    });
  }
  return signals;
}

function normalizeMethod(raw: unknown): DetectionMethod {
  const method = String(raw || 'GET').toUpperCase() as DetectionMethod;
  return DETECTION_METHODS.includes(method) ? method : 'EVENT';
}

/**
 * Normalize untrusted caller input into a schema-valid DetectionInput.
 * Enforces size limits, header redaction, unicode safety, and the
 * sourceContext whitelist (schema is additionalProperties=false there).
 */
export function normalizeDetectionInput(
  raw: RawDetectionInput,
  config: Pick<SecurityDetectionConfig, 'maxBodyBytes' | 'maxQueryBytes' | 'maxHeaderCount' | 'maxHeaderValueBytes'>
): DetectionInput {
  return {
    method: normalizeMethod(raw.method),
    path: truncateUtf8(sanitizeUnicode(String(raw.path || '/')), 2048) || '/',
    query: truncateUtf8(sanitizeUnicode(String(raw.query || '')), config.maxQueryBytes),
    headers: normalizeDetectionHeaders(
      (raw.headers || {}) as Record<string, unknown>,
      config.maxHeaderCount,
      config.maxHeaderValueBytes
    ),
    body: truncateUtf8(sanitizeUnicode(String(raw.body || '')), config.maxBodyBytes),
    sourceContext: normalizeSourceContext(raw.sourceContext as Record<string, unknown> | undefined),
    ruleSignals: normalizeRuleSignals(raw.ruleSignals)
  };
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * AetherArgus security-verdict engine. Shadow-first: its output is advisory
 * telemetry only and never drives blocking, hardware authorization, or the
 * formal detection verdict.
 */
export class SecurityDetectionEngine {
  private readonly config: SecurityDetectionConfig;
  private readonly provider: DetectionProvider;
  private readonly telemetry: DetectionTelemetrySink | null;
  private readonly now: () => string;
  private readonly systemPrompt: string;

  constructor(
    provider: DetectionProvider,
    options: SecurityDetectionEngineOptions
  ) {
    this.provider = provider;
    this.config = options.config;
    this.telemetry = options.telemetry ?? null;
    this.now = options.now ?? (() => new Date().toISOString());
    this.systemPrompt = buildDetectorSystemPrompt();
  }

  async detect(
    rawInput: RawDetectionInput,
    context: DetectionExecutionContext = {}
  ): Promise<DetectionInvocationResult> {
    const startedAt = Date.now();
    const requestId = context.requestId || randomUUID();
    const identity = this.provider.getModelIdentity();

    const baseMetadata: DetectionInvocationMetadata = {
      requestId,
      traceId: context.traceId,
      timestamp: this.now(),
      engineMode: this.config.mode,
      provider: this.provider.name,
      modelName: identity.name,
      modelVersion: identity.version,
      schemaVersion: identity.schemaVersion,
      datasetVersion: identity.datasetVersion,
      quantization: identity.quantization,
      latencyMs: 0,
      timedOut: false,
      jsonSyntaxValid: false,
      schemaValid: false,
      semanticValid: false,
      modelVerdict: null,
      modelConfidence: null,
      ruleVerdict: context.ruleVerdict,
      formalVerdict: context.formalVerdict,
      shadowMode: this.config.mode === 'shadow',
      inputFingerprint: '',
      errorCode: null
    };

    const finish = (
      output: DetectionOutput,
      overrides: Partial<DetectionInvocationMetadata>
    ): DetectionInvocationResult => {
      const metadata: DetectionInvocationMetadata = {
        ...baseMetadata,
        latencyMs: Date.now() - startedAt,
        ...overrides
      };
      if (
        metadata.formalVerdict !== undefined
        && metadata.modelVerdict !== null
        && verdictToActionBucket(metadata.modelVerdict) !== metadata.formalVerdict
      ) {
        metadata.disagreement = true;
      }
      const result: DetectionInvocationResult = { output, metadata };
      try {
        this.telemetry?.record({ eventType: 'security_detection_invocation', ...metadata });
      } catch {
        // Telemetry must never break detection.
      }
      return result;
    };

    let input: DetectionInput;
    try {
      input = normalizeDetectionInput(rawInput, this.config);
    } catch {
      return finish(createUnknownDetectionOutput('检测输入规范化失败，按 fail-safe 返回 unknown'), {
        errorCode: 'input_normalization_failed'
      });
    }
    baseMetadata.inputFingerprint = fingerprintJson({
      method: input.method,
      path: input.path,
      query: input.query,
      headerNames: Object.keys(input.headers).sort(),
      bodySha256: sha256Hex(input.body),
      sourceContext: input.sourceContext,
      ruleSignals: input.ruleSignals
    });

    const inputValidation = validateDetectionInput(input);
    if (!inputValidation.ok) {
      return finish(createUnknownDetectionOutput('检测输入未通过 JSON Schema 验证，按 fail-safe 返回 unknown'), {
        errorCode: 'input_schema_invalid'
      });
    }

    let providerResponse;
    try {
      providerResponse = await this.provider.detect(input, {
        requestId,
        systemPrompt: this.systemPrompt,
        timeoutMs: this.config.timeoutMs,
        numCtx: this.config.numCtx,
        maxResponseBytes: this.config.maxResponseBytes,
        signal: context.signal
      });
    } catch (error: any) {
      const code = toDetectionErrorCode(error);
      return finish(createUnknownDetectionOutput('安全判定模型调用失败，按 fail-safe 返回 unknown'), {
        errorCode: code,
        timedOut: code === 'provider_timeout'
      });
    }

    const validation = validateModelRawOutput(providerResponse.rawOutput);
    if (!validation.ok) {
      return finish(validation.output, {
        jsonSyntaxValid: validation.jsonSyntaxValid,
        schemaValid: validation.schemaValid,
        semanticValid: validation.semanticValid,
        errorCode: validation.errorCode
      });
    }

    return finish(validation.output, {
      jsonSyntaxValid: true,
      schemaValid: true,
      semanticValid: true,
      modelVerdict: validation.output.verdict,
      modelConfidence: validation.output.confidence,
      modelName: providerResponse.modelName,
      modelVersion: providerResponse.modelVersion || identity.version,
      latencyMs: providerResponse.latencyMs
    });
  }
}

function verdictToActionBucket(verdict: DetectionOutput['verdict']): string {
  if (verdict === 'malicious') {
    return 'block';
  }
  if (verdict === 'suspicious' || verdict === 'unknown') {
    return 'monitor';
  }
  return 'allow';
}
