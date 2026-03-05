import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AIEngine } from './ai-engine';

/**
 * SECURITY FIX CVE-2026-034: Safe command parsing
 * Parse command string into command and arguments array safely
 */
function parseCommand(command: string): { cmd: string; args: string[] } {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuote) {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    parts.push(current);
  }

  const [cmd, ...args] = parts;
  return { cmd: cmd || '', args };
}

/**
 * SECURITY FIX CVE-2026-034: Validate command before execution
 */
function isCommandSafe(command: string): boolean {
  // Check for dangerous shell metacharacters
  const dangerousPatterns = /[;&|`$(){}[\]<>!#%^*?\n\r\\]/;

  // Allow quotes for proper argument parsing
  const commandWithoutQuotes = command.replace(/["']/g, '');

  if (dangerousPatterns.test(commandWithoutQuotes)) {
    return false;
  }

  return true;
}

/**
 * Execution Monitor
 * Real-time monitoring of command execution with AI-powered analysis
 */

export interface ExecutionOptions {
  timeout?: number; // milliseconds
  env?: Record<string, string>;
  cwd?: string;
  aiEngine?: AIEngine;
  enableAIMonitoring?: boolean;
}

export interface ExecutionResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  duration: number;
  success: boolean;
  aiAnalysis?: any;
}

export interface ExecutionEvent {
  type: 'start' | 'stdout' | 'stderr' | 'ai-analysis' | 'complete' | 'error' | 'timeout';
  timestamp: number;
  data: any;
}

export class ExecutionMonitor extends EventEmitter {
  private currentProcess: ChildProcess | null = null;
  private startTime: number = 0;
  private stdoutBuffer: string[] = [];
  private stderrBuffer: string[] = [];
  private aiAnalysisInterval: NodeJS.Timeout | null = null;
  private executionId: string;

  constructor() {
    super();
    this.executionId = `exec-${Date.now()}`;
  }

  /**
   * Execute command with real-time monitoring
   */
  async execute(command: string, options: ExecutionOptions = {}): Promise<ExecutionResult> {
    const {
      timeout = 300000, // 5 minutes default
      env = process.env,
      cwd = process.cwd(),
      aiEngine,
      enableAIMonitoring = false
    } = options;

    return new Promise((resolve, reject) => {
      this.startTime = Date.now();
      this.stdoutBuffer = [];
      this.stderrBuffer = [];

      // Emit start event
      this.emitEvent('start', { command, executionId: this.executionId });

      // SECURITY FIX CVE-2026-034: Validate command before execution
      if (!isCommandSafe(command)) {
        const error = new Error('Command contains dangerous characters');
        this.emitEvent('error', { error: error.message });
        reject({
          command,
          exitCode: 1,
          stdout: '',
          stderr: 'Command rejected: contains dangerous shell metacharacters',
          duration: 0,
          success: false
        });
        return;
      }

      // SECURITY FIX CVE-2026-034: Use safe command parsing
      const { cmd, args } = parseCommand(command);
      this.currentProcess = spawn(cmd, args, {
        env,
        cwd,
        timeout
      });

      // Setup AI monitoring if enabled
      if (enableAIMonitoring && aiEngine) {
        this.startAIMonitoring(command, aiEngine);
      }

      // Collect stdout
      this.currentProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        this.stdoutBuffer.push(output);
        this.emitEvent('stdout', { output: output.trim() });

        // Real-time AI analysis on suspicious output
        if (enableAIMonitoring && aiEngine) {
          this.analyzeOutputInRealTime(command, output, aiEngine);
        }
      });

      // Collect stderr
      this.currentProcess.stderr?.on('data', (data) => {
        const error = data.toString();
        this.stderrBuffer.push(error);
        this.emitEvent('stderr', { error: error.trim() });

        // AI analysis on errors
        if (enableAIMonitoring && aiEngine) {
          this.analyzeErrorInRealTime(command, error, aiEngine);
        }
      });

      // Handle process exit
      this.currentProcess.on('close', async (code) => {
        this.stopAIMonitoring();

        const duration = Date.now() - this.startTime;
        const stdout = this.stdoutBuffer.join('\n');
        const stderr = this.stderrBuffer.join('\n');

        const result: ExecutionResult = {
          command,
          exitCode: code,
          stdout,
          stderr,
          duration,
          success: code === 0
        };

        // Final AI analysis if enabled
        if (enableAIMonitoring && aiEngine && !result.success) {
          try {
            result.aiAnalysis = await this.analyzeFailure(command, result, aiEngine);
          } catch (error) {
            console.error('Final AI analysis failed:', error);
          }
        }

        this.emitEvent('complete', result);

        if (result.success) {
          resolve(result);
        } else {
          reject(result);
        }
      });

      // Handle error
      this.currentProcess.on('error', (error) => {
        this.stopAIMonitoring();
        this.emitEvent('error', { error: error.message });
        reject({
          command,
          exitCode: null,
          stdout: this.stdoutBuffer.join('\n'),
          stderr: this.stderrBuffer.join('\n'),
          duration: Date.now() - this.startTime,
          success: false,
          error: error.message
        });
      });

      // Handle timeout
      if (timeout) {
        setTimeout(() => {
          if (this.currentProcess && !this.currentProcess.killed) {
            this.currentProcess.kill('SIGTERM');
            this.emitEvent('timeout', { timeout });
            this.stopAIMonitoring();
          }
        }, timeout);
      }
    });
  }

  /**
   * Start periodic AI monitoring
   */
  private startAIMonitoring(command: string, aiEngine: AIEngine): void {
    // Analyze execution every 10 seconds
    this.aiAnalysisInterval = setInterval(async () => {
      const currentOutput = this.stdoutBuffer.join('\n');
      const currentError = this.stderrBuffer.join('\n');

      if (currentOutput || currentError) {
        try {
          const analysis = await aiEngine.analyzeExecutionOutput(
            command,
            currentOutput + '\n' + currentError,
            false // Not complete yet
          );

          this.emitEvent('ai-analysis', analysis);

          // Abort if AI recommends it
          if (analysis.shouldAbort) {
            console.warn('AI recommends aborting execution:', analysis.message);
            this.abortExecution();
          }
        } catch (error) {
          console.error('Real-time AI analysis failed:', error);
        }
      }
    }, 10000);
  }

  /**
   * Stop AI monitoring
   */
  private stopAIMonitoring(): void {
    if (this.aiAnalysisInterval) {
      clearInterval(this.aiAnalysisInterval);
      this.aiAnalysisInterval = null;
    }
  }

  /**
   * Real-time analysis of output
   */
  private async analyzeOutputInRealTime(command: string, output: string, aiEngine: AIEngine): Promise<void> {
    try {
      const analysis = await aiEngine.analyzeExecutionOutput(command, output, false);

      if (analysis.status === 'warning' || analysis.status === 'error') {
        this.emitEvent('ai-analysis', {
          type: 'warning',
          message: analysis.message,
          suggestions: analysis.suggestions
        });
      }
    } catch (error) {
      // Silently fail for real-time analysis
      console.debug('Real-time output analysis failed:', error);
    }
  }

  /**
   * Real-time analysis of errors
   */
  private async analyzeErrorInRealTime(command: string, error: string, aiEngine: AIEngine): Promise<void> {
    try {
      // Check if error looks critical
      const criticalPatterns = [
        'permission denied',
        'access denied',
        'no space left',
        'segmentation fault',
        'killed'
      ];

      const isCritical = criticalPatterns.some(pattern =>
        error.toLowerCase().includes(pattern)
      );

      if (isCritical) {
        this.emitEvent('ai-analysis', {
          type: 'critical-error',
          message: 'backend.critical_error_detected',
          error: error.trim(),
          shouldAbort: true
        });

        // Optionally abort on critical errors
        // this.abortExecution();
      }
    } catch (error) {
      console.debug('Real-time error analysis failed:', error);
    }
  }

  /**
   * Analyze failure after execution completes
   */
  private async analyzeFailure(command: string, result: ExecutionResult, aiEngine: AIEngine): Promise<any> {
    try {
      return await aiEngine.diagnoseFailure(
        { command },
        command,
        result.stdout,
        result.stderr
      );
    } catch (error) {
      console.error('Failure analysis failed:', error);
      return null;
    }
  }

  /**
   * Abort current execution
   */
  abortExecution(): void {
    if (this.currentProcess && !this.currentProcess.killed) {
      this.currentProcess.kill('SIGKILL');
      this.emitEvent('error', { message: 'backend.execution_aborted' });
    }
  }

  /**
   * Get execution ID
   */
  getExecutionId(): string {
    return this.executionId;
  }

  /**
   * Check if process is running
   */
  isRunning(): boolean {
    return this.currentProcess !== null && !this.currentProcess.killed;
  }

  /**
   * Get current output
   */
  getCurrentOutput(): { stdout: string; stderr: string } {
    return {
      stdout: this.stdoutBuffer.join('\n'),
      stderr: this.stderrBuffer.join('\n')
    };
  }

  /**
   * Emit event
   */
  private emitEvent(type: string, data: any): void {
    this.emit('execution-event', {
      type,
      timestamp: Date.now(),
      executionId: this.executionId,
      ...data
    } as ExecutionEvent);
  }
}
