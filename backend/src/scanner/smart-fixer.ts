import { AIEngine, AIAnalysisRequest, AIAnalysisResponse } from './ai-engine';
import { ExecutionMonitor, ExecutionOptions, ExecutionResult } from './execution-monitor';
import { Recommendation } from '../database/models/scan-result';
import logger from '../utils/logger';

/**
 * SECURITY FIX CVE-2026-017: Command whitelist for safe execution
 */
const ALLOWED_COMMANDS: Set<string> = new Set([
  // System management
  'systemctl', 'service',
  // Firewall
  'ufw', 'firewall-cmd', 'iptables',
  // Package management
  'apt', 'apt-get', 'yum', 'dnf',
  // Web servers
  'nginx', 'apache2', 'apachectl',
  // Permissions
  'chmod', 'chown',
  // Network
  'sysctl',
]);

/**
 * SECURITY FIX CVE-2026-017: Validate command against whitelist
 */
function isCommandAllowed(command: string): boolean {
  const parts = command.trim().split(/\s+/);
  const baseCommand = parts[0];

  // Check for shell metacharacters that could lead to injection
  const dangerousChars = /[;&|`$(){}[\]<>'"!#%^*?\n\r\\]/;
  if (dangerousChars.test(command)) {
    logger.warn('SmartFixer: Command contains dangerous characters', { command });
    return false;
  }

  // Check if base command is in whitelist
  if (!ALLOWED_COMMANDS.has(baseCommand)) {
    logger.warn('SmartFixer: Command not in whitelist', { baseCommand, command });
    return false;
  }

  return true;
}

/**
 * Smart Fixer
 * AI-powered intelligent problem fixing with automatic retry and adaptation
 */

export interface FixAttempt {
  attemptNumber: number;
  solution: any;
  executionResult: ExecutionResult;
  aiDiagnosis?: any;
  timestamp: number;
}

export interface FixResult {
  success: boolean;
  recommendation: Recommendation;
  attempts: FixAttempt[];
  finalSolution?: string;
  totalTime: number;
  aiInsights?: {
    originalDiagnosis: any;
    adaptations: string[];
    lessonsLearned: string[];
  };
}

export interface SmartFixerOptions {
  maxAttempts?: number;
  enableAI?: boolean;
  aiProvider?: {
    name: 'openai' | 'anthropic' | 'ollama' | 'zhipu' | 'custom';
    apiKey?: string;
    baseURL?: string;
    model: string;
  };
  executionTimeout?: number;
  enableRealTimeMonitoring?: boolean;
}

export class SmartFixer {
  private aiEngine: AIEngine | null = null;
  private options: Required<SmartFixerOptions>;

  constructor(options: SmartFixerOptions = {}) {
    this.options = {
      maxAttempts: options.maxAttempts || 3,
      enableAI: options.enableAI !== false,
      aiProvider: options.aiProvider || {
        name: 'ollama',
        model: 'llama2'
      },
      executionTimeout: options.executionTimeout || 60000,
      enableRealTimeMonitoring: options.enableRealTimeMonitoring !== false
    };

    if (this.options.enableAI) {
      this.aiEngine = new AIEngine(this.options.aiProvider);
    }
  }

  /**
   * Fix a problem intelligently with AI guidance
   */
  async fixProblem(
    recommendation: Recommendation,
    context: any = {}
  ): Promise<FixResult> {
    const startTime = Date.now();
    const attempts: FixAttempt[] = [];
    const aiInsights: any = {
      originalDiagnosis: null,
      adaptations: [],
      lessonsLearned: []
    };

    logger.info(`Starting smart fix for: ${recommendation.title}`);

    try {
      // Step 1: AI Analysis (if enabled)
      let aiAnalysis: AIAnalysisResponse | null = null;

      if (this.aiEngine) {
        logger.info('Running AI analysis...');

        const analysisRequest: AIAnalysisRequest = {
          problem: {
            title: recommendation.title,
            description: recommendation.description,
            category: recommendation.category,
            priority: recommendation.priority
          },
          context: {
            systemInfo: context.systemInfo,
            logs: context.logs || [],
            configFiles: context.configFiles || {}
          }
        };

        aiAnalysis = await this.aiEngine.analyzeProblem(analysisRequest);
        aiInsights.originalDiagnosis = aiAnalysis.diagnosis;

        logger.info('AI Analysis complete', {
          rootCause: aiAnalysis.diagnosis.rootCause,
          severity: aiAnalysis.diagnosis.severity,
          confidence: aiAnalysis.diagnosis.confidence
        });
      }

      // Step 2: Try solutions with AI guidance
      let success = false;
      let attemptNumber = 0;

      while (!success && attemptNumber < this.options.maxAttempts) {
        attemptNumber++;

        // Get solution to try
        const solution = this.selectSolution(attemptNumber, recommendation, aiAnalysis, attempts);
        logger.info(`Attempt ${attemptNumber}: ${solution.explanation}`);

        // Execute with monitoring
        const executionResult = await this.executeSolution(solution, attempts);

        const fixAttempt: FixAttempt = {
          attemptNumber,
          solution,
          executionResult,
          timestamp: Date.now()
        };

        attempts.push(fixAttempt);

        // Check if successful
        if (executionResult.success) {
          success = true;
          logger.info(`✅ Fix successful on attempt ${attemptNumber}`);

          aiInsights.lessonsLearned.push(
            `Solution "${solution.explanation}" successfully fixed the problem`
          );

          break;
        }

        // If failed and AI is enabled, get diagnosis
        if (!success && this.aiEngine && attemptNumber < this.options.maxAttempts) {
          logger.info('Attempt failed, requesting AI diagnosis...');

          try {
            const diagnosis = await this.aiEngine.diagnoseFailure(
              recommendation,
              solution.command,
              executionResult.stdout,
              executionResult.stderr
            );

            fixAttempt.aiDiagnosis = diagnosis;

            logger.info('AI Diagnosis:', {
              diagnosis: diagnosis.diagnosis,
              alternative: diagnosis.alternativeSolution
            });

            aiInsights.adaptations.push(
              `Attempt ${attemptNumber} failed: ${diagnosis.diagnosis}. ` +
              `Trying alternative: ${diagnosis.alternativeSolution}`
            );

            // Add adaptive solution for next attempt
            if (attemptNumber < this.options.maxAttempts) {
              // Store the alternative for next attempt
              aiAnalysis = {
                ...aiAnalysis!,
                solutions: [
                  {
                    command: diagnosis.alternativeSolution,
                    explanation: diagnosis.explanation,
                    riskLevel: 'medium',
                    estimatedSuccess: 70,
                    prerequisites: []
                  }
                ]
              };
            }
          } catch (error) {
            logger.error('AI diagnosis failed:', { error });
          }
        }

        // Wait before retry (exponential backoff)
        if (attemptNumber < this.options.maxAttempts) {
          const waitTime = Math.pow(2, attemptNumber) * 1000;
          logger.info(`Waiting ${waitTime}ms before retry...`);
          await this.sleep(waitTime);
        }
      }

      // Prepare result
      const result: FixResult = {
        success,
        recommendation,
        attempts,
        finalSolution: success ? attempts[attempts.length - 1].solution.command : undefined,
        totalTime: Date.now() - startTime
      };

      if (this.options.enableAI) {
        result.aiInsights = aiInsights;
      }

      return result;

    } catch (error: any) {
      logger.error('Smart fix failed with error:', error);

      return {
        success: false,
        recommendation,
        attempts,
        totalTime: Date.now() - startTime,
        aiInsights
      };
    }
  }

  /**
   * Select solution for current attempt
   */
  private selectSolution(
    attemptNumber: number,
    recommendation: Recommendation,
    aiAnalysis: AIAnalysisResponse | null,
    previousAttempts: FixAttempt[]
  ): any {
    // If AI analysis available and has solutions, use AI's solutions
    if (aiAnalysis && aiAnalysis.solutions && aiAnalysis.solutions.length > 0) {
      const solutionIndex = Math.min(attemptNumber - 1, aiAnalysis.solutions.length - 1);
      return aiAnalysis.solutions[solutionIndex];
    }

    // Fallback to original recommendation
    return {
      command: recommendation.action,
      explanation: recommendation.description,
      riskLevel: recommendation.priority === 'critical' ? 'high' : 'medium',
      estimatedSuccess: 70
    };
  }

  /**
   * Execute a solution with monitoring
   * SECURITY FIX CVE-2026-017: Validate commands before execution
   */
  private async executeSolution(
    solution: any,
    previousAttempts: FixAttempt[]
  ): Promise<ExecutionResult> {
    // SECURITY FIX CVE-2026-017: Validate command against whitelist
    if (!isCommandAllowed(solution.command)) {
      logger.error('SmartFixer: Command rejected by security policy', { command: solution.command });
      return {
        command: solution.command,
        exitCode: 1,
        stdout: '',
        stderr: 'Command rejected: not in allowed list or contains dangerous characters',
        duration: 0,
        success: false
      };
    }

    const monitor = new ExecutionMonitor();

    // Setup event listeners for real-time monitoring
    if (this.options.enableRealTimeMonitoring) {
      monitor.on('execution-event', (event) => {
        logger.debug('Execution event:', event);

        // Send to WebSocket if available
        this.emitToWebSocket('execution-event', event);
      });
    }

    const options: ExecutionOptions = {
      timeout: this.options.executionTimeout,
      aiEngine: this.aiEngine || undefined,
      enableAIMonitoring: this.options.enableRealTimeMonitoring && !!this.aiEngine
    };

    try {
      // Execute prerequisites first
      if (solution.prerequisites && solution.prerequisites.length > 0) {
        logger.info('Running prerequisites...');

        for (const prereq of solution.prerequisites) {
          await monitor.execute(prereq, options);
        }
      }

      // Execute main command
      const result = await monitor.execute(solution.command, options);

      return result;
    } catch (error: any) {
      // Execution failed (error is the ExecutionResult)
      return error as ExecutionResult;
    }
  }

  /**
   * Emit event to WebSocket clients
   */
  private emitToWebSocket(event: string, data: any): void {
    // This would be connected to the WebSocket server in index.ts
    // For now, just log
    logger.debug(`WebSocket event [${event}]:`, data);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Batch fix multiple problems
   */
  async batchFix(
    recommendations: Recommendation[],
    context: any = {}
  ): Promise<FixResult[]> {
    logger.info(`Batch fixing ${recommendations.length} problems...`);

    const results: FixResult[] = [];

    // Sort by priority
    const sorted = [...recommendations].sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    for (const rec of sorted) {
      logger.info(`Fixing: ${rec.title}`);

      const result = await this.fixProblem(rec, context);
      results.push(result);

      // Wait between fixes to avoid overwhelming the system
      await this.sleep(2000);
    }

    return results;
  }

  /**
   * Dry run - simulate fixing without executing
   */
  async dryFix(
    recommendation: Recommendation,
    context: any = {}
  ): Promise<{
    aiAnalysis: AIAnalysisResponse | null;
    plannedAttempts: any[];
    estimatedTime: number;
    risks: string[];
  }> {
    logger.info(`Dry run for: ${recommendation.title}`);

    const aiAnalysis = this.aiEngine ?
      await this.aiEngine.analyzeProblem({
        problem: {
          title: recommendation.title,
          description: recommendation.description,
          category: recommendation.category,
          priority: recommendation.priority
        },
        context: {
          systemInfo: context.systemInfo,
          logs: context.logs || [],
          configFiles: context.configFiles || {}
        }
      }) :
      null;

    const plannedAttempts = aiAnalysis ?
      aiAnalysis.solutions.map((sol, idx) => ({
        attemptNumber: idx + 1,
        solution: sol,
        estimatedSuccess: sol.estimatedSuccess
      })) :
      [{
        attemptNumber: 1,
        solution: {
          command: recommendation.action,
          explanation: recommendation.description
        },
        estimatedSuccess: 70
      }];

    const risks: string[] = [];

    if (aiAnalysis && aiAnalysis.warnings) {
      risks.push(...aiAnalysis.warnings);
    }

    const estimatedTime = plannedAttempts.length * 30000; // 30s per attempt

    return {
      aiAnalysis,
      plannedAttempts,
      estimatedTime,
      risks
    };
  }
}
