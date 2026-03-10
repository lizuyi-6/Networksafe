/**
 * Platform AI model catalog and built-in cloud provider configuration.
 * This file is backend-only and must not be exposed directly to the client.
 */

export type PlatformProvider = 'dashscope';
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
  category: 'qwen' | 'third-party';
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
  'anthropic-compatible': 'https://coding.dashscope.aliyuncs.com/apps/anthropic/v1'
};

const platformProtocol = String(process.env.PLATFORM_API_PROTOCOL || 'openai-compatible').toLowerCase() === 'anthropic-compatible'
  ? 'anthropic-compatible'
  : 'openai-compatible';

export const PLATFORM_API_CONFIG: PlatformApiConfig = {
  provider: 'dashscope',
  providerId: 'dashscope-coding-plan',
  protocol: platformProtocol,
  baseURL: normalizeBaseUrl(process.env.PLATFORM_API_BASE_URL || DEFAULT_BASE_URLS[platformProtocol]),
  apiKey: process.env.PLATFORM_API_KEY || 'sk-sp-be54ade951c84a19a2be9c94b559bd5d',
  timeout: Number(process.env.PLATFORM_API_TIMEOUT || 120000),
  paths: {
    openaiChatCompletions: normalizePath(process.env.PLATFORM_API_CHAT_PATH || '/chat/completions'),
    anthropicMessages: normalizePath(process.env.PLATFORM_API_MESSAGES_PATH || '/messages')
  },
  defaultHeaders: {
    'Content-Type': 'application/json'
  }
};

export const PLATFORM_MODELS: PlatformModel[] = [
  {
    id: 'qwen3.5-plus',
    name: 'Qwen 3.5 Plus',
    description: 'Enhanced general-purpose Qwen model for day-to-day conversations.',
    category: 'qwen',
    minTier: 'pro',
    maxTokens: 4000
  },
  {
    id: 'glm-4.7',
    name: 'GLM 4.7',
    description: 'General-purpose GLM model with stronger reasoning behavior.',
    category: 'third-party',
    minTier: 'ultra',
    maxTokens: 4000
  },
  {
    id: 'kimi-k2.5',
    name: 'Kimi K2.5',
    description: 'Long-context Moonshot model for knowledge-heavy analysis.',
    category: 'third-party',
    minTier: 'ultra',
    maxTokens: 8000
  },
  {
    id: 'qwen3-max-2026-01-23',
    name: 'Qwen 3 Max',
    description: 'Flagship Qwen model used as the default built-in cloud route.',
    category: 'qwen',
    minTier: 'starter',
    maxTokens: 8000,
    isDefault: true
  },
  {
    id: 'qwen3-coder-next',
    name: 'Qwen 3 Coder Next',
    description: 'Next-generation coding-focused Qwen model for audit and generation.',
    category: 'qwen',
    minTier: 'pro',
    maxTokens: 8000
  },
  {
    id: 'qwen3-coder-plus',
    name: 'Qwen 3 Coder Plus',
    description: 'Lower-latency coding-focused Qwen model for security workflows.',
    category: 'qwen',
    minTier: 'pro',
    maxTokens: 4000
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
