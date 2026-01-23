/**
 * AI Engine - LLM Integration
 * Integrates with various LLM providers for intelligent problem analysis and fixing
 */

export interface AIProvider {
  name: 'openai' | 'anthropic' | 'ollama' | 'zhipu' | 'custom';
  apiKey?: string;
  baseURL?: string;
  model: string;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIAnalysisRequest {
  problem: {
    title: string;
    description: string;
    category: string;
    priority: string;
  };
  context: {
    systemInfo: any;
    logs: string[];
    configFiles: Record<string, string>;
    commandOutput?: string;
    errorOutput?: string;
  };
  previousAttempts?: Array<{
    solution: string;
    output: string;
    error: string;
  }>;
}

export interface AIAnalysisResponse {
  diagnosis: {
    rootCause: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    confidence: number; // 0-1
  };
  solutions: Array<{
    command: string;
    explanation: string;
    riskLevel: 'low' | 'medium' | 'high';
    estimatedSuccess: number; // 0-100
    prerequisites?: string[]; // Commands to run first
  }>;
  alternativeApproaches?: string[];
  warnings?: string[];
}

export class AIEngine {
  private provider: AIProvider;

  constructor(provider: AIProvider) {
    this.provider = provider;
  }

  /**
   * Analyze a problem and suggest solutions using AI
   */
  async analyzeProblem(request: AIAnalysisRequest): Promise<AIAnalysisResponse> {
    const prompt = this.buildAnalysisPrompt(request);

    try {
      const response = await this.callLLM(prompt);

      return this.parseResponse(response);
    } catch (error: any) {
      console.error('AI analysis failed:', error);

      // Fallback to rule-based analysis
      return this.fallbackAnalysis(request);
    }
  }

  /**
   * Get AI suggestion when a command fails
   */
  async diagnoseFailure(
    originalProblem: any,
    attemptedSolution: string,
    commandOutput: string,
    errorOutput: string
  ): Promise<{
    diagnosis: string;
    alternativeSolution: string;
    explanation: string;
  }> {
    const prompt = `
Original Problem:
${JSON.stringify(originalProblem, null, 2)}

Attempted Solution:
${attemptedSolution}

Command Output:
${commandOutput}

Error Output:
${errorOutput}

The command failed. Please:
1. Diagnose why it failed
2. Suggest an alternative approach
3. Explain what went wrong

Provide your response in JSON format:
{
  "diagnosis": "why it failed",
  "alternativeSolution": "alternative command or approach",
  "explanation": "detailed explanation"
}
`;

    try {
      const response = await this.callLLM(prompt);
      return JSON.parse(response);
    } catch (error: any) {
      console.error('AI diagnosis failed:', error);

      return {
        diagnosis: 'Command failed with unknown error',
        alternativeSolution: 'Check system logs for more details',
        explanation: 'AI analysis unavailable, manual intervention required'
      };
    }
  }

  /**
   * Monitor execution and provide real-time suggestions
   */
  async analyzeExecutionOutput(
    command: string,
    output: string,
    isComplete: boolean
  ): Promise<{
    status: 'normal' | 'warning' | 'error' | 'success';
    message: string;
    suggestions?: string[];
    shouldAbort?: boolean;
  }> {
    const prompt = `
Command Being Executed:
${command}

Current Output:
${output}

Execution Status: ${isComplete ? 'Complete' : 'In Progress'}

Analyze the output and provide:
1. Status assessment (normal/warning/error/success)
2. Brief message explaining what's happening
3. Suggestions if there are issues
4. Whether to abort if critical error detected

Response in JSON format:
{
  "status": "normal|warning|error|success",
  "message": "what's happening",
  "suggestions": ["suggestion1", "suggestion2"],
  "shouldAbort": false
}
`;

    try {
      const response = await this.callLLM(prompt);
      return JSON.parse(response);
    } catch (error: any) {
      // Simple fallback analysis
      if (output.toLowerCase().includes('error')) {
        return {
          status: 'error',
          message: 'Error detected in output',
          suggestions: ['Check error messages', 'Review logs']
        };
      }

      return {
        status: 'normal',
        message: isComplete ? 'Command completed' : 'Command running...'
      };
    }
  }

  /**
   * Build prompt for AI analysis
   */
  private buildAnalysisPrompt(request: AIAnalysisRequest): string {
    const { problem, context, previousAttempts } = request;

    let prompt = `You are an expert Linux system administrator and DevOps engineer. Analyze this problem and suggest solutions.

PROBLEM:
Title: ${problem.title}
Description: ${problem.description}
Category: ${problem.category}
Priority: ${problem.priority}

SYSTEM CONTEXT:
`;

    // Add system info
    if (context.systemInfo) {
      prompt += `
OS: ${context.systemInfo.platform} ${context.systemInfo.release}
CPUs: ${context.systemInfo.cpus}
Memory: ${context.systemInfo.totalMemory}
Uptime: ${context.systemInfo.uptime}
`;
    }

    // Add previous attempts
    if (previousAttempts && previousAttempts.length > 0) {
      prompt += `
PREVIOUS ATTEMPTS (all failed):
`;
      previousAttempts.forEach((attempt, i) => {
        prompt += `
Attempt ${i + 1}:
Solution: ${attempt.solution}
Output: ${attempt.output}
Error: ${attempt.error}
`;
      });
    }

    // Add relevant logs
    if (context.logs && context.logs.length > 0) {
      prompt += `
RELEVANT LOGS:
${context.logs.join('\n')}
`;
    }

    // Add command output if available
    if (context.commandOutput) {
      prompt += `
COMMAND OUTPUT:
${context.commandOutput}
`;
    }

    if (context.errorOutput) {
      prompt += `
ERROR OUTPUT:
${context.errorOutput}
`;
    }

    prompt += `
Please analyze and provide:
1. Root cause diagnosis
2. Severity assessment
3. Multiple solutions (from safest to most aggressive)
4. Risk level for each solution
5. Estimated success rate
6. Any warnings

Response in JSON format:
{
  "diagnosis": {
    "rootCause": "primary cause",
    "severity": "low|medium|high|critical",
    "confidence": 0.85
  },
  "solutions": [
    {
      "command": "exact command to execute",
      "explanation": "why this will work",
      "riskLevel": "low|medium|high",
      "estimatedSuccess": 85,
      "prerequisites": ["commands to run first"]
    }
  ],
  "alternativeApproaches": ["alternative 1", "alternative 2"],
  "warnings": ["warning 1", "warning 2"]
}
`;

    return prompt;
  }

  /**
   * Call LLM API
   */
  private async callLLM(prompt: string): Promise<string> {
    const { name, apiKey, baseURL, model } = this.provider;

    switch (name) {
      case 'openai':
        return this.callOpenAI(prompt, model, apiKey);
      case 'anthropic':
        return this.callAnthropic(prompt, model, apiKey);
      case 'ollama':
case 'zhipu':        return this.callZhipu(prompt, model, apiKey, baseURL);
        return this.callOllama(prompt, model, baseURL);
      default:
        throw new Error(`Unsupported AI provider: ${name}`);
    }
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAI(prompt: string, model: string, apiKey?: string): Promise<string> {
    const axios = require('axios');

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: model || 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are an expert Linux system administrator. Always respond with valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey || process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.choices[0].message.content;
  }

  /**
   * Call Anthropic Claude API
   */
  private async callAnthropic(prompt: string, model: string, apiKey?: string): Promise<string> {
    const axios = require('axios');

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: model || 'claude-3-sonnet-20240229',
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
          'x-api-key': apiKey || process.env.ANTHROPIC_API_KEY,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        }
      }
    );

    return response.data.content[0].text;
  }

  /**
   * Call Ollama (local LLM)
   */
  private async callOllama(prompt: string, model: string, baseURL?: string): Promise<string> {
    const axios = require('axios');

    const response = await axios.post(
      `${baseURL || 'http://localhost:11434'}/api/generate`,
      {
        model: model || 'llama2',
        prompt: prompt,
        stream: false
      }
    );

    return response.data.response;
  }

  /**
   * Parse AI response
   */
  private parseResponse(response: string): AIAnalysisResponse {
    try {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
                       response.match(/```\s*([\s\S]*?)\s*```/);

      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }

      // Try parsing directly
      return JSON.parse(response);
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      throw new Error('Invalid JSON response from AI');
    }
  }

  /**
   * Fallback analysis when AI is unavailable
   */
  private fallbackAnalysis(request: AIAnalysisRequest): AIAnalysisResponse {
    const { problem } = request;

    // Simple rule-based analysis
    const solutions: Array<{
      command: string;
      explanation: string;
      riskLevel: 'low' | 'medium' | 'high';
      estimatedSuccess: number;
    }> = [];

    // Add common solutions based on problem category
    if (problem.category === 'security') {
      if (problem.title.toLowerCase().includes('firewall')) {
        solutions.push({
          command: 'sudo ufw enable',
          explanation: 'Enable UFW firewall',
          riskLevel: 'low',
          estimatedSuccess: 90
        });
      }
    }

    if (problem.category === 'performance') {
      if (problem.title.toLowerCase().includes('file descriptor')) {
        solutions.push({
          command: 'ulimit -n 65535',
          explanation: 'Increase file descriptor limit',
          riskLevel: 'low',
          estimatedSuccess: 85
        });
      }
    }

    return {
      diagnosis: {
        rootCause: 'Unable to determine without AI',
        severity: problem.priority === 'critical' ? 'critical' : 'medium',
        confidence: 0.5
      },
      solutions: solutions.length > 0 ? solutions : [{
        command: '# Manual intervention required',
        explanation: 'AI analysis unavailable, please review logs',
        riskLevel: 'medium',
        estimatedSuccess: 50
      }],
      warnings: ['AI analysis unavailable, using rule-based fallback']
    };
  }
/**   * Call Zhipu AI (BigModel) API   */  private async callZhipu(prompt: string, model: string, apiKey?: string, baseURL?: string): Promise<string> {    const { ZhipuClient } = require("./zhipu-client");    const client = new ZhipuClient(      apiKey || process.env.ZHIPU_API_KEY || "",      baseURL || "https://open.bigmodel.cn/api/anthropic"    );    return await client.generateCompletion(prompt, model);  }
}

// Singleton instances for different providers
export const createAIEngine = (provider: AIProvider): AIEngine => {
  return new AIEngine(provider);
};
