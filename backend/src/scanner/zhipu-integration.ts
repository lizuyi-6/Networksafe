import { AIEngine, AIProvider } from './ai-engine';
import { SmartFixer } from './smart-fixer';
import logger from '../utils/logger';

/**
 * Smart Fixer with Zhipu AI (BigModel) Integration
 */

export interface SmartFixerOptionsZhipu {
  maxAttempts?: number;
  enableAI?: boolean;
  aiProvider?: {
    name: 'openai' | 'anthropic' | 'ollama' | 'zhipu';
    apiKey?: string;
    baseURL?: string;
    model: string;
  };
  executionTimeout?: number;
  enableRealTimeMonitoring?: boolean;
}

/**
 * Create Smart Fixer optimized for Zhipu AI
 */
export function createZhipuSmartFixer(apiKey: string, model: string = 'glm-4'): any {


  return new SmartFixer({
    enableAI: true,
    aiProvider: {
      name: 'zhipu',
      apiKey: apiKey,
      baseURL: 'https://open.bigmodel.cn/api/anthropic',
      model: model
    },
    maxAttempts: 3,
    executionTimeout: 60000,
    enableRealTimeMonitoring: true
  });
}

/**
 * Example: Quick fix using Zhipu AI
 * SECURITY FIX CVE-2026-003: Removed hardcoded API key
 */
export async function quickFixWithZhipu(
  problem: {
    title: string;
    description: string;
    category: string;
    priority: string;
    action: string;
  },
  context?: any
) {
  // SECURITY FIX CVE-2026-003: API key must come from environment variable
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    throw new Error('ZHIPU_API_KEY environment variable is required');
  }

  const fixer = createZhipuSmartFixer(
    apiKey,
    process.env.ZHIPU_MODEL || 'glm-4'
  );

  const result = await fixer.fixProblem(problem, context);

  return result;
}

// Export for convenience
export { SmartFixer } from './smart-fixer';
