/**
 * Investigation Coordinator
 *
 * Orchestrates the bug investigation process by coordinating multiple specialized agents.
 * Implements the investigation workflow and manages agent communication.
 */

import { EventEmitter } from 'events';
import { uuidv4 } from '../../utils/uuid';
import {
  BugReport,
  InvestigationContext,
  InvestigationResult,
  AgentTask,
  InvestigationAgentType,
  InvestigationSummary
} from './types';
import { AgentConfig, MessageBus } from '../core';
import { BugReproductionAgent } from './agents/bug-reproduction.agent';
import { CodeAnalysisAgent } from './agents/code-analysis.agent';
import { LogAnalysisAgent } from './agents/log-analysis.agent';
import { TraceAnalysisAgent } from './agents/trace-analysis.agent';
import { RootCauseAgent } from './agents/root-cause.agent';
import { SolutionAgent } from './agents/solution.agent';

type InvestigationStatus = 'in_progress' | 'completed' | 'failed' | 'cancelled';

interface InvestigationState {
  investigationId: string;
  context: InvestigationContext;
  status: InvestigationStatus;
  startedAt: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  error?: string;
  result?: InvestigationResult;
}

export class InvestigationCoordinator extends EventEmitter {
  private agents: Map<string, any>;
  private activeInvestigations: Map<string, InvestigationContext>;
  private investigationStates: Map<string, InvestigationState>;
  private taskQueue: AgentTask[];
  private completedTasks: Map<string, AgentTask>;
  private messageBus: MessageBus;

  constructor(messageBus?: MessageBus) {
    super();
    this.agents = new Map();
    this.activeInvestigations = new Map();
    this.investigationStates = new Map();
    this.taskQueue = [];
    this.completedTasks = new Map();
    this.messageBus = messageBus || new MessageBus();
    this.initializeAgents();
  }

  private initializeAgents(): void {
    // Create base agent config for investigation agents
    const baseConfig: AgentConfig = {
      identity: {
        id: 'investigation-coordinator',
        role: 'orchestrator',
        team: 'analyst',
        name: 'Investigation Coordinator',
        description: 'Coordinates bug investigation across multiple specialized agents',
        capabilities: ['coordination', 'task_distribution', 'result_aggregation']
      },
      modelConfig: {
        provider: 'ollama',
        model: 'llama3:8b',
        temperature: 0.3,
        maxTokens: 2000
      },
      timeout: 30000,
      maxRetries: 2
    };

    // Initialize specialized investigation agents
    this.agents.set(InvestigationAgentType.BUG_REPRODUCTION, new BugReproductionAgent(baseConfig, this.messageBus));
    this.agents.set(InvestigationAgentType.CODE_ANALYSIS, new CodeAnalysisAgent(baseConfig, this.messageBus));
    this.agents.set(InvestigationAgentType.LOG_ANALYSIS, new LogAnalysisAgent(baseConfig, this.messageBus));
    this.agents.set(InvestigationAgentType.TRACE_ANALYSIS, new TraceAnalysisAgent(baseConfig, this.messageBus));
    this.agents.set(InvestigationAgentType.ROOT_CAUSE, new RootCauseAgent(baseConfig, this.messageBus));
    this.agents.set(InvestigationAgentType.SOLUTION, new SolutionAgent(baseConfig, this.messageBus));

    console.log('[InvestigationCoordinator] All investigation agents initialized');
  }

  /**
   * Start a new bug investigation
   */
  public async startInvestigation(bugReport: BugReport, context: InvestigationContext): Promise<string> {
    const investigationId = uuidv4();
    context.bugReport = bugReport;

    this.activeInvestigations.set(investigationId, context);
    this.investigationStates.set(investigationId, {
      investigationId,
      context,
      status: 'in_progress',
      startedAt: new Date()
    });

    console.log(`[InvestigationCoordinator] Starting investigation ${investigationId} for bug ${bugReport.id}`);
    this.emit('investigation:started', { investigationId, bugReport });

    setImmediate(() => {
      void this.runInvestigation(investigationId, context);
    });

    return investigationId;
  }

  private async runInvestigation(investigationId: string, context: InvestigationContext): Promise<void> {
    try {
      const result = await this.executeInvestigationWorkflow(investigationId, context);
      const state = this.investigationStates.get(investigationId);
      if (!state || state.status === 'cancelled') {
        return;
      }

      state.status = 'completed';
      state.result = result;
      state.completedAt = new Date();
      this.activeInvestigations.delete(investigationId);

      this.emit('investigation:completed', { investigationId, result });
    } catch (error) {
      const state = this.investigationStates.get(investigationId);
      if (state?.status === 'cancelled') {
        return;
      }

      if (state) {
        state.status = 'failed';
        state.error = error instanceof Error ? error.message : String(error);
        state.completedAt = new Date();
      }
      this.activeInvestigations.delete(investigationId);

      console.error(`[InvestigationCoordinator] Investigation ${investigationId} failed:`, error);
      this.emit('investigation:failed', { investigationId, error });
    }
  }

  /**
   * Execute the investigation workflow
   */
  private async executeInvestigationWorkflow(
    investigationId: string,
    context: InvestigationContext
  ): Promise<InvestigationResult> {
    const workflow: InvestigationAgentType[] = [
      InvestigationAgentType.LOG_ANALYSIS,
      InvestigationAgentType.TRACE_ANALYSIS,
      InvestigationAgentType.BUG_REPRODUCTION,
      InvestigationAgentType.CODE_ANALYSIS,
      InvestigationAgentType.ROOT_CAUSE,
      InvestigationAgentType.SOLUTION
    ];

    const investigators: string[] = [];
    const allFindings: any[] = [];

    // Execute workflow stages
    for (const agentType of workflow) {
      if (this.isInvestigationCancelled(investigationId)) {
        break;
      }

      const agent = this.agents.get(agentType);
      if (!agent) {
        console.warn(`[InvestigationCoordinator] Agent ${agentType} not found, skipping`);
        continue;
      }

      console.log(`[InvestigationCoordinator] Executing stage: ${agentType}`);
      this.emit('stage:started', { investigationId, stage: agentType });

      try {
        const task = await this.createTask(investigationId, agentType, context);
        const result = await this.executeTask(task);

        if (result.status === 'cancelled' || this.isInvestigationCancelled(investigationId)) {
          break;
        }

        if (result.output) {
          // Accumulate findings from each stage
          if (result.output.findings) {
            allFindings.push(...result.output.findings);
          }
          // Update context with results
          this.updateContext(context, agentType, result.output);
        }

        investigators.push(agentType);
        this.emit('stage:completed', { investigationId, stage: agentType, result });
      } catch (error) {
        console.error(`[InvestigationCoordinator] Stage ${agentType} failed:`, error);
        this.emit('stage:failed', { investigationId, stage: agentType, error });
        // Continue workflow even if one stage fails
      }
    }

    // Compile final investigation result
    return this.compileInvestigationResult(investigationId, context, investigators, allFindings);
  }

  /**
   * Create a task for an agent
   */
  private async createTask(
    investigationId: string,
    agentType: InvestigationAgentType,
    context: InvestigationContext
  ): Promise<AgentTask> {
    const task: AgentTask = {
      taskId: uuidv4(),
      assignedTo: agentType,
      taskType: agentType,
      description: `${agentType} investigation for bug ${context.bugReport.id}`,
      status: 'pending',
      priority: context.bugReport.severity,
      input: {
        investigationId,
        context
      }
    };

    this.taskQueue.push(task);
    return task;
  }

  /**
   * Execute a task on an agent
   */
  private async executeTask(task: AgentTask): Promise<AgentTask> {
    const investigationId = task.input?.investigationId;
    if (this.isInvestigationCancelled(investigationId)) {
      task.status = 'cancelled';
      task.completedAt = new Date();
      this.completedTasks.set(task.taskId, task);
      return task;
    }

    task.status = 'in_progress';
    task.startedAt = new Date();

    const agent = this.agents.get(task.assignedTo);
    if (!agent) {
      throw new Error(`Agent ${task.assignedTo} not found`);
    }

    try {
      const result = await agent.analyze(task.input.context);

      if (this.isInvestigationCancelled(investigationId)) {
        task.status = 'cancelled';
        task.completedAt = new Date();
        task.duration = task.completedAt.getTime() - task.startedAt.getTime();
        this.completedTasks.set(task.taskId, task);
        return task;
      }

      task.output = result;
      task.status = 'completed';
      task.completedAt = new Date();
      task.duration = task.completedAt.getTime() - task.startedAt.getTime();

      this.completedTasks.set(task.taskId, task);
      return task;
    } catch (error) {
      if (this.isInvestigationCancelled(investigationId)) {
        task.status = 'cancelled';
        task.completedAt = new Date();
        task.duration = task.startedAt ? task.completedAt.getTime() - task.startedAt.getTime() : 0;
        this.completedTasks.set(task.taskId, task);
        return task;
      }

      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      task.completedAt = new Date();
      throw error;
    }
  }

  /**
   * Update investigation context with agent results
   */
  private updateContext(
    context: InvestigationContext,
    agentType: InvestigationAgentType,
    output: any
  ): void {
    // Each agent type may update different parts of the context
    switch (agentType) {
      case InvestigationAgentType.LOG_ANALYSIS:
        context.systemState.logs = output.analyzedLogs || context.systemState.logs;
        break;
      case InvestigationAgentType.TRACE_ANALYSIS:
        context.systemState.traces = output.analyzedTraces || context.systemState.traces;
        break;
      case InvestigationAgentType.BUG_REPRODUCTION:
        // Add reproduction information
        if (output.reproductionInfo) {
          (context as any).reproductionInfo = output.reproductionInfo;
        }
        break;
      case InvestigationAgentType.CODE_ANALYSIS:
        // Add code analysis results
        if (output.codeIssues) {
          (context as any).codeIssues = output.codeIssues;
        }
        break;
      case InvestigationAgentType.ROOT_CAUSE:
        // Root cause will be in the final result
        if (output.rootCause) {
          (context as any).preliminaryRootCause = output.rootCause;
        }
        break;
      case InvestigationAgentType.SOLUTION:
        // Solutions will be in the final result
        break;
    }
  }

  /**
   * Compile final investigation result
   */
  private compileInvestigationResult(
    investigationId: string,
    context: InvestigationContext,
    investigators: string[],
    allFindings: any[]
  ): InvestigationResult {
    const preliminaryRootCause = (context as any).preliminaryRootCause;
    const solutions = (context as any).solutions || [];

    return {
      investigationId,
      bugReportId: context.bugReport.id,
      findings: allFindings,
      rootCause: preliminaryRootCause,
      recommendedSolutions: solutions,
      confidence: this.calculateConfidence(allFindings, investigators),
      evidence: this.collectEvidence(context),
      timestamp: new Date(),
      investigators
    };
  }

  /**
   * Calculate investigation confidence score
   */
  private calculateConfidence(findings: any[], investigators: string[]): number {
    let confidence = 0.5; // Base confidence

    // More investigators = higher confidence
    confidence += Math.min(investigators.length * 0.05, 0.2);

    // More findings = higher confidence
    confidence += Math.min(findings.length * 0.03, 0.15);

    // Critical findings increase confidence
    const criticalFindings = findings.filter(f => f.severity === 'critical').length;
    confidence += Math.min(criticalFindings * 0.05, 0.1);

    return Math.min(confidence, 1.0);
  }

  /**
   * Collect evidence from context
   */
  private collectEvidence(context: InvestigationContext): any[] {
    const evidence: any[] = [];

    // Add log evidence
    context.systemState.logs.forEach(log => {
      evidence.push({
        type: 'log',
        description: `Log from ${log.service}`,
        source: log.service,
        timestamp: log.timestamp,
        data: log
      });
    });

    // Add trace evidence
    context.systemState.traces.forEach(trace => {
      evidence.push({
        type: 'trace',
        description: `Trace: ${trace.operation}`,
        source: trace.service,
        timestamp: trace.timestamp,
        data: trace
      });
    });

    return evidence;
  }

  private isInvestigationCancelled(investigationId: string | undefined): boolean {
    if (!investigationId) {
      return false;
    }
    return this.investigationStates.get(investigationId)?.status === 'cancelled';
  }

  public cancelInvestigation(investigationId: string): {
    cancelled: boolean;
    status: 'cancelled' | 'not_found' | 'already_completed' | 'already_failed' | 'already_cancelled';
    investigationId: string;
    message: string;
  } {
    const state = this.investigationStates.get(investigationId);
    if (!state) {
      return {
        cancelled: false,
        status: 'not_found',
        investigationId,
        message: 'backend.investigation_not_found'
      };
    }

    if (state.status === 'completed') {
      return {
        cancelled: false,
        status: 'already_completed',
        investigationId,
        message: 'backend.investigation_already_completed'
      };
    }

    if (state.status === 'failed') {
      return {
        cancelled: false,
        status: 'already_failed',
        investigationId,
        message: 'backend.investigation_already_failed'
      };
    }

    if (state.status === 'cancelled') {
      return {
        cancelled: false,
        status: 'already_cancelled',
        investigationId,
        message: 'backend.investigation_already_cancelled'
      };
    }

    state.status = 'cancelled';
    state.cancelledAt = new Date();
    state.completedAt = state.cancelledAt;
    this.activeInvestigations.delete(investigationId);

    for (const task of this.taskQueue) {
      if (
        task.input?.investigationId === investigationId &&
        (task.status === 'pending' || task.status === 'in_progress')
      ) {
        task.status = 'cancelled';
        task.completedAt = state.cancelledAt;
        if (task.startedAt) {
          task.duration = state.cancelledAt.getTime() - task.startedAt.getTime();
        }
        this.completedTasks.set(task.taskId, task);
      }
    }

    this.emit('investigation:cancelled', { investigationId });

    return {
      cancelled: true,
      status: 'cancelled',
      investigationId,
      message: 'backend.investigation_cancelled'
    };
  }

  /**
   * Get investigation status
   */
  public getInvestigationStatus(investigationId: string): any {
    const state = this.investigationStates.get(investigationId);
    if (!state) {
      return { status: 'not_found' };
    }

    const tasks = Array.from(this.completedTasks.values())
      .filter(t => t.input.investigationId === investigationId);

    return {
      investigationId,
      bugReport: state.context.bugReport,
      tasksCompleted: tasks.length,
      tasksTotal: this.agents.size,
      status: state.status,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      cancelledAt: state.cancelledAt,
      error: state.error,
      result: state.result,
      tasks: tasks.map(t => ({
        type: t.assignedTo,
        status: t.status,
        duration: t.duration
      }))
    };
  }

  /**
   * Get active investigations
   */
  public getActiveInvestigations(): InvestigationSummary[] {
    return Array.from(this.activeInvestigations.entries()).map(([id, context]) => ({
      investigationId: id,
      date: context.bugReport.timestamp,
      outcome: 'investigating',
      summary: context.bugReport.description
    }));
  }

  /**
   * Get agent capabilities
   */
  public getAgentCapabilities(): any[] {
    return Array.from(this.agents.entries()).map(([type, agent]) => ({
      agentType: type,
      capabilities: agent.getCapabilities?.() || [],
      status: 'active'
    }));
  }
}
