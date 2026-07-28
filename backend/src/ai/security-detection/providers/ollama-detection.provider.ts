import { DetectionError } from '../detection-errors';
import type { DetectionInput, DetectionModelIdentity } from '../detection-contract';
import type {
  DetectionProvider,
  DetectionProviderContext,
  DetectionProviderHealth,
  DetectionProviderResponse
} from './detection-provider.interface';

export interface OllamaDetectionProviderOptions {
  baseUrl: string;
  model: string;
  version?: string;
  quantization?: string;
  datasetVersion?: string;
  /** Max one safety retry for transient failures; the retry reuses the same strict prompt. */
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

interface OllamaChatResponse {
  message?: { role?: string; content?: string };
  model?: string;
  error?: string;
}

const DEFAULT_MAX_RETRIES = 1;

function isTransient(error: unknown): boolean {
  const anyError = error as any;
  if (anyError?.name === 'AbortError') {
    return false;
  }
  if (error instanceof DetectionError) {
    return error.code === 'provider_unavailable' || error.code === 'provider_http_error';
  }
  return true;
}

/**
 * Ollama-backed detector provider. Deterministic decoding (temperature=0,
 * no sampling), strict abortable timeouts, bounded response size, and at
 * most one safety retry that never relaxes the prompt.
 */
export class OllamaDetectionProvider implements DetectionProvider {
  readonly name = 'ollama';
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly identity: DetectionModelIdentity;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaDetectionProviderOptions) {
    if (!options.baseUrl) {
      throw new DetectionError('provider_unavailable', 'ollama baseUrl is required');
    }
    if (!options.model) {
      throw new DetectionError('provider_unavailable', 'ollama model is required');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.identity = {
      name: options.model,
      version: options.version || 'unversioned',
      baseModel: options.model.split(':')[0],
      quantization: options.quantization,
      schemaVersion: 1,
      datasetVersion: options.datasetVersion || 'unknown'
    };
  }

  getModelIdentity(): DetectionModelIdentity {
    return { ...this.identity };
  }

  private async invokeOnce(input: DetectionInput, context: DetectionProviderContext): Promise<DetectionProviderResponse> {
    const controller = new AbortController();
    const outerSignal = context.signal;
    const onOuterAbort = () => controller.abort();
    if (outerSignal) {
      if (outerSignal.aborted) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      outerSignal.addEventListener('abort', onOuterAbort, { once: true });
    }
    const timeoutMs = Math.max(100, context.timeoutMs);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const startedAt = Date.now();
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [
            { role: 'system', content: context.systemPrompt },
            { role: 'user', content: JSON.stringify(input) }
          ],
          options: {
            temperature: 0,
            num_ctx: context.numCtx,
            seed: 0
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new DetectionError(
          'provider_http_error',
          `ollama responded HTTP ${response.status}`
        );
      }

      const rawText = await response.text();
      if (Buffer.byteLength(rawText, 'utf8') > context.maxResponseBytes) {
        throw new DetectionError(
          'provider_response_too_large',
          `ollama response exceeded ${context.maxResponseBytes} bytes`
        );
      }

      let payload: OllamaChatResponse;
      try {
        payload = JSON.parse(rawText) as OllamaChatResponse;
      } catch {
        throw new DetectionError('provider_unavailable', 'ollama returned non-JSON envelope');
      }
      if (payload.error) {
        throw new DetectionError('provider_http_error', `ollama error: ${payload.error}`);
      }
      const content = payload.message?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new DetectionError('provider_response_empty', 'ollama returned empty content');
      }

      return {
        rawOutput: content,
        modelName: payload.model || this.model,
        modelVersion: this.identity.version,
        latencyMs: Date.now() - startedAt
      };
    } catch (error: any) {
      if (error instanceof DetectionError) {
        throw error;
      }
      if (error?.name === 'AbortError') {
        if (outerSignal?.aborted) {
          throw error;
        }
        throw new DetectionError('provider_timeout', `ollama call exceeded ${timeoutMs}ms`, error);
      }
      throw new DetectionError('provider_unavailable', error?.message || 'ollama request failed', error);
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', onOuterAbort);
    }
  }

  async detect(input: DetectionInput, context: DetectionProviderContext): Promise<DetectionProviderResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.invokeOnce(input, context);
      } catch (error) {
        lastError = error;
        if (attempt >= this.maxRetries || !isTransient(error)) {
          break;
        }
      }
    }
    throw lastError;
  }

  async healthCheck(): Promise<DetectionProviderHealth> {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      // /api/tags lists local models — no inference is triggered.
      const response = await this.fetchImpl(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      if (!response.ok) {
        return {
          healthy: false,
          latencyMs: Date.now() - startedAt,
          detail: `HTTP ${response.status}`,
          errorCode: 'provider_http_error',
          checkedAt
        };
      }
      return { healthy: true, latencyMs: Date.now() - startedAt, checkedAt };
    } catch (error: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - startedAt,
        detail: error?.name === 'AbortError' ? 'health check timed out' : (error?.message || 'unreachable'),
        errorCode: error?.name === 'AbortError' ? 'provider_timeout' : 'provider_unavailable',
        checkedAt
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
