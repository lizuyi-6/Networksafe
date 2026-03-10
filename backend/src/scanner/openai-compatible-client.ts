import axios from 'axios';
import { getPlatformCloudBaseUrl } from '../utils/model-access';

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAICompatibleClient {
  private apiKey: string;
  private baseURL: string;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(config: OpenAICompatibleConfig) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.model = config.model;
    this.maxTokens = config.maxTokens || 4000;
    this.temperature = config.temperature ?? 0.2;
  }

  async generateCompletion(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: ChatMessage[] = [];
    
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    try {
      const response = await axios.post<ChatCompletionResponse>(
        `${this.baseURL}/chat/completions`,
        {
          model: this.model,
          messages,
          max_tokens: this.maxTokens,
          temperature: this.temperature
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 120000
        }
      );

      if (response.data?.choices?.[0]?.message?.content) {
        return response.data.choices[0].message.content;
      }

      throw new Error('Invalid response format from API');
    } catch (error: any) {
      console.error('OpenAI Compatible API error:', error.response?.data || error.message);
      throw error;
    }
  }

  async chatCompletion(messages: ChatMessage[]): Promise<string> {
    try {
      const response = await axios.post<ChatCompletionResponse>(
        `${this.baseURL}/chat/completions`,
        {
          model: this.model,
          messages,
          max_tokens: this.maxTokens,
          temperature: this.temperature
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 120000
        }
      );

      return response.data.choices[0].message.content;
    } catch (error: any) {
      console.error('Chat completion error:', error.response?.data || error.message);
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.generateCompletion('Hello, respond with "OK"');
      return !!response;
    } catch {
      return false;
    }
  }
}

export function createDashScopeClient(
  apiKey: string,
  model: string = 'qwen3-coder-480b-a35b-instruct',
  baseURL: string = getPlatformCloudBaseUrl()
): OpenAICompatibleClient {
  return new OpenAICompatibleClient({
    apiKey,
    baseURL,
    model,
    temperature: 0.2,
    maxTokens: 4000
  });
}

export async function testDashScope(apiKey: string): Promise<{
  success: boolean;
  message: string;
  latency?: number;
}> {
  const startTime = Date.now();

  try {
    const client = createDashScopeClient(apiKey);
    const response = await client.generateCompletion('Hello, respond with OK');

    const latency = Date.now() - startTime;

    return {
      success: true,
      message: 'backend.dashscope_connection_successful',
      latency
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Connection failed'
    };
  }
}
