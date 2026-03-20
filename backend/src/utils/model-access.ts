/**
 * Platform AI model catalog and built-in cloud provider configuration.
 * This file is backend-only and must not be exposed directly to the client.
 */

export type PlatformProvider = 'dashscope' | 'tencent-lkeap' | 'custom';
export type PlatformProtocol = 'openai-compatible' | 'anthropic-compatible';
export type PlanTier = 'starter' | 'pro' | 'ultra';

export interface PlatformApiConfig {
  provider: PlatformProvider;
  providerId: string;
  protocol: PlatformProtocol;
  baseURL: string;
  apiKey: string;
  timeout: number;
  paths: {
    openaiChatCompletions: string;
    anthropicMessages: string;
  };
  defaultHeaders: Record<string, string>;
}

export interface PlatformModel {
  id: string;
  name: string;
  description: string;
  category: 'tencent' | 'partner';
  minTier: PlanTier;
  maxTokens: number;
  isDefault?: boolean;
}

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');
const normalizePath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

const DEFAULT_BASE_URLS: Record<PlatformProtocol, string> = {
  'openai-compatible': 'https://coding.dashscope.aliyuncs.com/v1',
  'anthropic-compatible': 'https://api.lkeap.cloud.tencent.com/coding/anthropic'
};

const DEFAULT_PATHS: Record<PlatformProtocol, string> = {
  'openai-compatible': '/chat/completions',
  'anthropic-compatible': '/v1/messages'
};

const platformProtocol = String(process.env.PLATFORM_API_PROTOCOL || 'openai-compatible').toLowerCase() === 'anthropic-compatible'
  ? 'anthropic-compatible'
  : 'openai-compatible';

function inferProviderIdentity(baseURL: string): { provider: PlatformProvider; providerId: string } {
  try {
    const hostname = new URL(baseURL).hostname.toLowerCase();
    if (hostname.includes('lkeap.cloud.tencent.com')) {
      return {
        provider: 'tencent-lkeap',
        providerId: 'tencent-lkeap-coding'
      };
    }
    if (hostname.includes('dashscope.aliyuncs.com')) {
      return {
        provider: 'dashscope',
        providerId: 'dashscope-coding-plan'
      };
    }
    return {
      provider: 'custom',
      providerId: hostname || 'custom-cloud-endpoint'
    };
  } catch {
    return {
      provider: 'custom',
      providerId: 'custom-cloud-endpoint'
    };
  }
}

const configuredBaseURL = normalizeBaseUrl(process.env.PLATFORM_API_BASE_URL || DEFAULT_BASE_URLS[platformProtocol]);
const providerIdentity = inferProviderIdentity(configuredBaseURL);

export const PLATFORM_API_CONFIG: PlatformApiConfig = {
  provider: providerIdentity.provider,
  providerId: process.env.PLATFORM_API_PROVIDER_ID || providerIdentity.providerId,
  protocol: platformProtocol,
  baseURL: configuredBaseURL,
  apiKey: process.env.PLATFORM_API_KEY || '',
  timeout: Number(process.env.PLATFORM_API_TIMEOUT || 120000),
  paths: {
    openaiChatCompletions: normalizePath(process.env.PLATFORM_API_CHAT_PATH || DEFAULT_PATHS['openai-compatible']),
    anthropicMessages: normalizePath(process.env.PLATFORM_API_MESSAGES_PATH || DEFAULT_PATHS['anthropic-compatible'])
  },
  defaultHeaders: {
    'Content-Type': 'application/json'
  }
};

export const PLATFORM_MODELS: PlatformModel[] = [
  {
    id: 'hunyuan-2.0-instruct',
    name: 'Tencent HY 2.0 Instruct',
    description: 'Tencent Hunyuan 2.0 instruction-tuned model for general cloud analysis.',
    category: 'tencent',
    minTier: 'starter',
    maxTokens: 4096
  },
  {
    id: 'hunyuan-2.0-thinking',
    name: 'Tencent HY 2.0 Think',
    description: 'Tencent Hunyuan 2.0 reasoning model for multi-step security analysis.',
    category: 'tencent',
    minTier: 'starter',
    maxTokens: 8192
  },
  {
    id: 'minimax-m2.5',
    name: 'MiniMax-M2.5',
    description: 'Partner model optimized for broad instruction following and long-form synthesis.',
    category: 'partner',
    minTier: 'starter',
    maxTokens: 4096
  },
  {
    id: 'kimi-k2.5',
    name: 'Kimi-K2.5',
    description: 'Partner long-context model for knowledge-heavy reasoning and incident analysis.',
    category: 'partner',
    minTier: 'starter',
    maxTokens: 8192
  },
  {
    id: 'glm-5',
    name: 'GLM-5',
    description: 'Balanced flagship partner model used as the default built-in cloud route.',
    category: 'partner',
    minTier: 'starter',
    maxTokens: 8192,
    isDefault: true
  },
  {
    id: 'hunyuan-t1',
    name: 'Hunyuan-T1',
    description: 'Tencent Hunyuan T1 reasoning model for deeper investigations and adjudication.',
    category: 'tencent',
    minTier: 'starter',
    maxTokens: 8192
  },
  {
    id: 'hunyuan-turbos',
    name: 'Hunyuan-TurboS',
    description: 'Tencent Hunyuan TurboS model for lower-latency cloud verification and routing fallback.',
    category: 'tencent',
    minTier: 'starter',
    maxTokens: 4096
  }
];

const TIER_WEIGHT: Record<PlanTier, number> = {
  starter: 0,
  pro: 1,
  ultra: 2
};

export function normalizePlan(plan?: string): PlanTier {
  if (!plan) return 'starter';
  const lower = plan.toLowerCase();
  if (lower === 'ultra' || lower === 'enterprise') return 'ultra';
  if (lower === 'pro' || lower === 'professional') return 'pro';
  return 'starter';
}

export function getModelsForTier(plan: PlanTier): PlatformModel[] {
  const weight = TIER_WEIGHT[plan];
  return PLATFORM_MODELS.filter((model) => TIER_WEIGHT[model.minTier] <= weight);
}

export function canUseModel(plan: PlanTier, modelId: string): boolean {
  const model = PLATFORM_MODELS.find((item) => item.id === modelId);
  if (!model) return false;
  return TIER_WEIGHT[plan] >= TIER_WEIGHT[model.minTier];
}

export function canUseCustomEndpoint(plan: PlanTier): boolean {
  return plan === 'ultra';
}

export function getDefaultModel(plan: PlanTier): PlatformModel {
  const available = getModelsForTier(plan);
  return available.find((model) => model.isDefault) || available[0];
}

export function getPlatformCloudBaseUrl(): string {
  return PLATFORM_API_CONFIG.baseURL;
}

export function getPlatformChatPath(): string {
  return PLATFORM_API_CONFIG.protocol === 'anthropic-compatible'
    ? PLATFORM_API_CONFIG.paths.anthropicMessages
    : PLATFORM_API_CONFIG.paths.openaiChatCompletions;
}

export function buildPlatformCloudUrl(path?: string): string {
  return `${PLATFORM_API_CONFIG.baseURL}${path || getPlatformChatPath()}`;
}
