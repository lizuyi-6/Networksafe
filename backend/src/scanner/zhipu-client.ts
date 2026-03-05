import axios from 'axios';

/**
 * Zhipu AI (BigModel) Client
 * GLM-4 series models
 */

export class ZhipuClient {
  private apiKey: string;
  private baseURL: string;

  constructor(apiKey: string, baseURL: string = 'https://open.bigmodel.cn/api/anthropic') {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
  }

  /**
   * Generate completion using GLM model
   */
  async generateCompletion(prompt: string, model: string = 'glm-4'): Promise<string> {
    try {
      const response = await axios.post(
        `${this.baseURL}/v1/messages`,
        {
          model: model,
          max_tokens: 2000,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 60 seconds timeout
        }
      );

      // Extract response text
      if (response.data && response.data.content && response.data.content[0]) {
        return response.data.content[0].text;
      }

      throw new Error('Invalid response format from Zhipu AI');
    } catch (error: any) {
      console.error('Zhipu AI API error:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Chat completion with conversation history
   */
  async chatCompletion(
    messages: Array<{ role: string; content: string }>,
    model: string = 'glm-4'
  ): Promise<string> {
    try {
      const response = await axios.post(
        `${this.baseURL}/v1/messages`,
        {
          model: model,
          max_tokens: 2000,
          messages: messages
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );

      return response.data.content[0].text;
    } catch (error: any) {
      console.error('Zhipu AI chat error:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.generateCompletion('Hello', 'glm-4');
      return !!response;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get available models
   */
  getAvailableModels(): string[] {
    return [
      'glm-4',           // Latest GLM-4 model
      'glm-4-flash',     // Faster version
      'glm-4-air',       // Lightweight version
      'glm-4-plus',      // Enhanced version
      'glm-3-turbo'      // Previous generation
    ];
  }
}

/**
 * Quick test function
 */
export async function testZhipuAI(apiKey: string): Promise<{
  success: boolean;
  message: string;
  latency?: number;
}> {
  const startTime = Date.now();

  try {
    const client = new ZhipuClient(apiKey);
    const response = await client.generateCompletion('你好，请简单介绍一下自己。');

    const latency = Date.now() - startTime;

    return {
      success: true,
      message: 'backend.zhipu_ai_connection_successful',
      latency
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Connection failed'
    };
  }
}
