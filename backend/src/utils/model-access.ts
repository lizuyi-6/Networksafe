/**
 * AI Model Access Control
 * 基于订阅层级的模型权限管控服务
 * 
 * API 凭据仅在后端使用，前端完全不可见
 */

// ========================
// 平台 AI 调用通道配置（仅后端可见）
// ========================
export const PLATFORM_API_CONFIG = {
    baseURL: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    apiKey: 'sk-sp-be54ade951c84a19a2be9c94b559bd5d',
    protocol: 'openai-compatible' as const,
    timeout: 120000,
};

// ========================
// 订阅层级枚举
// ========================
export type PlanTier = 'starter' | 'pro' | 'ultra';

// ========================
// 模型注册表
// ========================
export interface PlatformModel {
    id: string;
    name: string;
    description: string;
    category: 'qwen' | 'third-party';
    minTier: PlanTier;       // 允许使用的最低订阅等级
    maxTokens: number;
    isDefault?: boolean;
}

/**
 * 全量平台模型注册表
 * minTier 决定了最低需要什么订阅等级才能使用
 */
export const PLATFORM_MODELS: PlatformModel[] = [
    {
        id: 'qwen3.5-plus',
        name: 'Qwen 3.5 Plus',
        description: '通义千问 3.5 增强版，适合日常对话与文本处理',
        category: 'qwen',
        minTier: 'pro',
        maxTokens: 4000,
    },
    {
        id: 'glm-4.7',
        name: 'GLM 4.7',
        description: '智谱 GLM 4.7，强推理能力的通用模型',
        category: 'third-party',
        minTier: 'ultra',
        maxTokens: 4000,
    },
    {
        id: 'kimi-k2.5',
        name: 'Kimi K2.5',
        description: 'Moonshot Kimi K2.5，擅长长文本理解与知识问答',
        category: 'third-party',
        minTier: 'ultra',
        maxTokens: 8000,
    },
    {
        id: 'qwen3-max-2026-01-23',
        name: 'Qwen 3 Max',
        description: '通义千问 3 旗舰版，最强综合推理能力',
        category: 'qwen',
        minTier: 'starter',
        maxTokens: 8000,
        isDefault: true,
    },
    {
        id: 'qwen3-coder-next',
        name: 'Qwen 3 Coder Next',
        description: '通义千问编程专家 Next，下一代代码生成与审计',
        category: 'qwen',
        minTier: 'pro',
        maxTokens: 8000,
    },
    {
        id: 'qwen3-coder-plus',
        name: 'Qwen 3 Coder Plus',
        description: '通义千问编程增强版，高效代码辅助与安全扫描',
        category: 'qwen',
        minTier: 'pro',
        maxTokens: 4000,
    },
];

// ========================
// 层级权重（用于比较）
// ========================
const TIER_WEIGHT: Record<PlanTier, number> = {
    starter: 0,
    pro: 1,
    ultra: 2,
};

/**
 * 将后端存储的 plan 字段标准化为 PlanTier 枚举
 */
export function normalizePlan(plan?: string): PlanTier {
    if (!plan) return 'starter';
    const lower = plan.toLowerCase();
    if (lower === 'ultra' || lower === 'enterprise') return 'ultra';
    if (lower === 'pro' || lower === 'professional') return 'pro';
    return 'starter';
}

/**
 * 获取指定层级可用的模型列表
 */
export function getModelsForTier(plan: PlanTier): PlatformModel[] {
    const weight = TIER_WEIGHT[plan];
    return PLATFORM_MODELS.filter(m => TIER_WEIGHT[m.minTier] <= weight);
}

/**
 * 校验用户是否有权使用指定模型
 */
export function canUseModel(plan: PlanTier, modelId: string): boolean {
    const model = PLATFORM_MODELS.find(m => m.id === modelId);
    if (!model) return false; // 未知模型不允许
    return TIER_WEIGHT[plan] >= TIER_WEIGHT[model.minTier];
}

/**
 * 判断用户是否可以添加自定义模型端点
 */
export function canUseCustomEndpoint(plan: PlanTier): boolean {
    return plan === 'ultra';
}

/**
 * 获取指定层级的默认模型
 */
export function getDefaultModel(plan: PlanTier): PlatformModel {
    const available = getModelsForTier(plan);
    return available.find(m => m.isDefault) || available[0];
}
