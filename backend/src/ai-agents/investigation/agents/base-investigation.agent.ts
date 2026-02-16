/**
 * Base Investigation Agent
 *
 * Abstract base class for all investigation agents.
 * Extends the existing BaseAgent pattern with investigation-specific capabilities.
 */

import { InvestigationContext, InvestigationAgentType } from '../types';
import { BaseAgent, AgentMessage } from '../../core/base-agent';

export abstract class BaseInvestigationAgent extends BaseAgent {
  protected agentType: InvestigationAgentType;
  protected expertise: string[];

  constructor(agentType: InvestigationAgentType, expertise: string[]) {
    super();
    this.agentType = agentType;
    this.expertise = expertise;
  }

  /**
   * Main analysis method - must be implemented by subclasses
   */
  public abstract analyze(context: InvestigationContext): Promise<any>;

  /**
   * Get agent capabilities
   */
  public getCapabilities(): string[] {
    return this.expertise;
  }

  /**
   * Get agent type
   */
  public getAgentType(): InvestigationAgentType {
    return this.agentType;
  }

  /**
   * Preprocess context before analysis
   */
  protected preprocessContext(context: InvestigationContext): InvestigationContext {
    // Common preprocessing logic
    // Filter logs by timestamp range if bug report has occurrence time
    if (context.bugReport.timestamp) {
      const timeWindow = 3600000; // 1 hour window
      context.systemState.logs = context.systemState.logs.filter(log => {
        const timeDiff = Math.abs(log.timestamp.getTime() - context.bugReport.timestamp.getTime());
        return timeDiff <= timeWindow;
      });
    }

    return context;
  }

  /**
   * Extract relevant logs based on severity and service
   */
  protected extractRelevantLogs(
    logs: any[],
    severity?: string[],
    services?: string[]
  ): any[] {
    let filtered = logs;

    if (severity && severity.length > 0) {
      filtered = filtered.filter(log => severity.includes(log.level));
    }

    if (services && services.length > 0) {
      filtered = filtered.filter(log => services.includes(log.service));
    }

    return filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Extract error traces
   */
  protected extractErrorTraces(traces: any[]): any[] {
    return traces.filter(trace => trace.status === 'error');
  }

  /**
   * Call AI model for analysis
   */
  protected async analyzeWithAI(
    prompt: string,
    contextData: any
  ): Promise<any> {
    try {
      const analysisPrompt = this.buildAnalysisPrompt(prompt, contextData);
      const response = await this.callModel(analysisPrompt);

      return this.parseModelResponse(response);
    } catch (error) {
      console.error(`[${this.agentType}] AI analysis failed:`, error);
      return this.fallbackAnalysis(contextData);
    }
  }

  /**
   * Build analysis prompt for AI model
   */
  protected buildAnalysisPrompt(prompt: string, contextData: any): string {
    return `
You are a specialized investigation agent for ${this.agentType}.

Your expertise includes: ${this.expertise.join(', ')}

Task: ${prompt}

Context:
${JSON.stringify(contextData, null, 2)}

Please analyze the provided context and provide:
1. Key findings
2. Potential issues or anomalies
3. Recommendations for further investigation
4. Confidence level in your analysis

Format your response as JSON.
`;
  }

  /**
   * Parse model response
   */
  protected parseModelResponse(response: string): any {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      // If no JSON, return as text
      return { analysis: response };
    } catch (error) {
      console.error(`[${this.agentType}] Failed to parse model response:`, error);
      return { analysis: response, error: 'Failed to parse response' };
    }
  }

  /**
   * Fallback analysis when AI model fails
   */
  protected fallbackAnalysis(contextData: any): any {
    return {
      findings: [],
      analysis: 'AI model unavailable, using rule-based analysis',
      confidence: 0.3,
      error: 'AI model unavailable'
    };
  }

  /**
   * Calculate time-based correlation
   */
  protected calculateTimeCorrelation(timestamps: Date[]): any {
    if (timestamps.length < 2) {
      return { pattern: 'insufficient_data' };
    }

    const sorted = timestamps.sort((a, b) => a.getTime() - b.getTime());
    const intervals: number[] = [];

    for (let i = 1; i < sorted.length; i++) {
      intervals.push(sorted[i].getTime() - sorted[i - 1].getTime());
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    return {
      totalEvents: timestamps.length,
      avgInterval,
      minInterval: Math.min(...intervals),
      maxInterval: Math.max(...intervals),
      pattern: this.detectTimePattern(intervals)
    };
  }

  /**
   * Detect time patterns in intervals
   */
  private detectTimePattern(intervals: number[]): string {
    // Check for regular intervals
    const variance = this.calculateVariance(intervals);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const coefficientOfVariation = Math.sqrt(variance) / avg;

    if (coefficientOfVariation < 0.2) {
      return 'regular';
    } else if (coefficientOfVariation < 0.5) {
      return 'semi_regular';
    } else {
      return 'irregular';
    }
  }

  /**
   * Calculate variance
   */
  private calculateVariance(values: number[]): number {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
  }
}
