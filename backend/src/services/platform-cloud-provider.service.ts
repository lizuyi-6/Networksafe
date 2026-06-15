import axios from 'axios';
import {
  PLATFORM_API_CONFIG,
  PlatformProtocol,
  buildPlatformCloudUrl,
  getPlatformChatPath
} from '../utils/model-access';

export interface PlatformChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PlatformInvocationDiagnostics {
  provider: string;
  protocol: PlatformProtocol;
  upstreamStatus?: number;
  upstreamPath: string;
  requestId?: string;
  baseURL: string;
}

export interface PlatformCloudInvocationResult {
  content: string;
  latency: number;
  usage: any;
  raw: any;
  diagnostics: PlatformInvocationDiagnostics;
}

export class PlatformCloudInvocationError extends Error {
  diagnostics: PlatformInvocationDiagnostics;
  responseBody?: any;

  constructor(message: string, diagnostics: PlatformInvocationDiagnostics, responseBody?: any) {
    super(message);
    this.name = 'PlatformCloudInvocationError';
    this.diagnostics = diagnostics;
    this.responseBody = responseBody;
  }
}

const extractRequestId = (payload: any, headers?: Record<string, any>): string | undefined => {
  return payload?.request_id
    || payload?.requestId
    || headers?.['x-request-id']
    || headers?.['x-dashscope-request-id']
    || undefined;
};

const buildDiagnostics = (status?: number, requestId?: string): PlatformInvocationDiagnostics => ({
  provider: PLATFORM_API_CONFIG.providerId,
  protocol: PLATFORM_API_CONFIG.protocol,
  upstreamStatus: status,
  upstreamPath: getPlatformChatPath(),
  requestId,
  baseURL: PLATFORM_API_CONFIG.baseURL
});

export class PlatformCloudClient {
  constructor(
    private readonly model: string,
    private readonly maxTokens: number = 4000,
    private readonly temperature: number = 0.2
  ) {}

  async generateCompletion(
    prompt: string,
    modelOverride?: string,
    options?: { maxTokens?: number; temperature?: number }
  ): Promise<string> {
    const messages: PlatformChatMessage[] = [];
    messages.push({ role: 'user', content: prompt });
    const model = modelOverride || this.model;
    const response = await invokePlatformCloudModel(model, messages, {
      maxTokens: options?.maxTokens ?? this.maxTokens,
      temperature: options?.temperature ?? this.temperature
    });
    return response.content;
  }
}

export function createPlatformCloudClient(model: string, options?: {
  maxTokens?: number;
  temperature?: number;
}): PlatformCloudClient {
  return new PlatformCloudClient(
    model,
    options?.maxTokens || 4000,
    options?.temperature ?? 0.2
  );
}

function buildAnthropicPayload(
  modelId: string,
  messages: PlatformChatMessage[],
  options?: { maxTokens?: number; temperature?: number }
): Record<string, unknown> {
  const systemMessages = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean);
  const conversation = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role,
      content: message.content
    }));

  return {
    model: modelId,
    max_tokens: options?.maxTokens || 2048,
    ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(systemMessages.length > 0 ? { system: systemMessages.join('\n\n') } : {}),
    messages: conversation.length > 0
      ? conversation
      : [{ role: 'user', content: 'Continue.' }]
  };
}

export async function invokePlatformCloudModel(
  modelId: string,
  messages: PlatformChatMessage[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<PlatformCloudInvocationResult> {
  const startedAt = Date.now();
  const url = buildPlatformCloudUrl();

  try {
    if (PLATFORM_API_CONFIG.protocol === 'anthropic-compatible') {
      const response = await axios.post(
        url,
        buildAnthropicPayload(modelId, messages, options),
        {
          headers: {
            ...PLATFORM_API_CONFIG.defaultHeaders,
            'x-api-key': PLATFORM_API_CONFIG.apiKey,
            'anthropic-version': '2023-06-01'
          },
          timeout: PLATFORM_API_CONFIG.timeout
        }
      );

      const requestId = extractRequestId(response.data, response.headers as Record<string, any>);
      return {
        content: response.data?.content?.[0]?.text || '',
        latency: Date.now() - startedAt,
        usage: response.data?.usage || null,
        raw: response.data,
        diagnostics: buildDiagnostics(response.status, requestId)
      };
    }

    const response = await axios.post(
      url,
      {
        model: modelId,
        messages,
        max_tokens: options?.maxTokens || 2048,
        temperature: options?.temperature ?? 0.2
      },
      {
        headers: {
          ...PLATFORM_API_CONFIG.defaultHeaders,
          Authorization: `Bearer ${PLATFORM_API_CONFIG.apiKey}`
        },
        timeout: PLATFORM_API_CONFIG.timeout
      }
    );

    const requestId = extractRequestId(response.data, response.headers as Record<string, any>);
    return {
      content: response.data?.choices?.[0]?.message?.content || '',
      latency: Date.now() - startedAt,
      usage: response.data?.usage || null,
      raw: response.data,
      diagnostics: buildDiagnostics(response.status, requestId)
    };
  } catch (error: any) {
    const requestId = extractRequestId(error.response?.data, error.response?.headers as Record<string, any>);
    throw new PlatformCloudInvocationError(
      error.response?.data?.error?.message || error.message || 'Platform cloud invocation failed',
      buildDiagnostics(error.response?.status, requestId),
      error.response?.data
    );
  }
}
