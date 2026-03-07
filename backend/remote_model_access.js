"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATFORM_MODELS = exports.PLATFORM_API_CONFIG = void 0;
exports.normalizePlan = normalizePlan;
exports.getModelsForTier = getModelsForTier;
exports.canUseModel = canUseModel;
exports.canUseCustomEndpoint = canUseCustomEndpoint;
exports.getDefaultModel = getDefaultModel;
exports.PLATFORM_API_CONFIG = {
    baseURL: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    apiKey: 'sk-sp-be54ade951c84a19a2be9c94b559bd5d',
    protocol: 'openai-compatible',
    timeout: 120000,
};
exports.PLATFORM_MODELS = [
    {
        id: 'qwen3.5-plus',
        name: 'Qwen 3.5 Plus',
        description: '通义千问 3.5 增强版，适合日常对话与文本处理',
        category: 'general',
        minTier: 'pro',
        maxTokens: 4000,
    },
    {
        id: 'glm-4.7',
        name: 'GLM 4.7',
        description: '智谱 GLM 4.7，强推理能力的通用模型',
        category: 'reasoning',
        minTier: 'ultra',
        maxTokens: 4000,
    },
    {
        id: 'kimi-k2.5',
        name: 'Kimi K2.5',
        description: 'Moonshot Kimi K2.5，擅长长文本理解与知识问答',
        category: 'general',
        minTier: 'ultra',
        maxTokens: 8000,
    },
    {
        id: 'qwen3-max-2026-01-23',
        name: 'Qwen 3 Max',
        description: '通义千问 3 旗舰版，最强综合推理能力',
        category: 'reasoning',
        minTier: 'starter',
        maxTokens: 8000,
        isDefault: true,
    },
    {
        id: 'qwen3-coder-next',
        name: 'Qwen 3 Coder Next',
        description: '通义千问编程专家 Next，下一代代码生成与审计',
        category: 'coding',
        minTier: 'pro',
        maxTokens: 8000,
    },
    {
        id: 'qwen3-coder-plus',
        name: 'Qwen 3 Coder Plus',
        description: '通义千问编程增强版，高效代码辅助与安全扫描',
        category: 'coding',
        minTier: 'pro',
        maxTokens: 4000,
    },
];
const TIER_WEIGHT = {
    starter: 0,
    pro: 1,
    ultra: 2,
};
function normalizePlan(plan) {
    if (!plan)
        return 'starter';
    const lower = plan.toLowerCase();
    if (lower === 'ultra' || lower === 'enterprise')
        return 'ultra';
    if (lower === 'pro' || lower === 'professional')
        return 'pro';
    return 'starter';
}
function getModelsForTier(plan) {
    const weight = TIER_WEIGHT[plan];
    return exports.PLATFORM_MODELS.filter(m => TIER_WEIGHT[m.minTier] <= weight);
}
function canUseModel(plan, modelId) {
    const model = exports.PLATFORM_MODELS.find(m => m.id === modelId);
    if (!model)
        return false;
    return TIER_WEIGHT[plan] >= TIER_WEIGHT[model.minTier];
}
function canUseCustomEndpoint(plan) {
    return plan === 'ultra';
}
function getDefaultModel(plan) {
    const available = getModelsForTier(plan);
    return available.find(m => m.isDefault) || available[0];
}
//# sourceMappingURL=model-access.js.map