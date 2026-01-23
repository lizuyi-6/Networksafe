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
  const fixer = createZhipuSmartFixer(
    'APIff70dd7b1491414a8e242f36c597f431.CaJ0eB1U2h19GFjA',
    'glm-4'
  );

  const result = await fixer.fixProblem(problem, context);

  return result;
}

// Export for convenience
export { SmartFixer } from './smart-fixer';
