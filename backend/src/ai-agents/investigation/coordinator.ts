/**
 * Investigation Coordinator
 *
 * Orchestrates the bug investigation process by coordinating multiple specialized agents.
 * Implements the investigation workflow and manages agent communication.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
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

export class InvestigationCoordinator extends EventEmitter {
  private agents: Map<string, any>;
  private activeInvestigations: Map<string, InvestigationContext>;
  private taskQueue: AgentTask[];
  private completedTasks: Map<string, AgentTask>;
  private messageBus: MessageBus;

  constructor(messageBus?: MessageBus) {
    super();
    this.agents = new Map();
    this.activeInvestigations = new Map();
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

    console.log(`[InvestigationCoordinator] Starting investigation ${investigationId} for bug ${bugReport.id}`);
    this.emit('investigation:started', { investigationId, bugReport });

    // Execute investigation workflow
    try {
      const result = await this.executeInvestigationWorkflow(investigationId, context);
      this.emit('investigation:completed', { investigationId, result });
      return investigationId;
    } catch (error) {
      console.error(`[InvestigationCoordinator] Investigation ${investigationId} failed:`, error);
      this.emit('investigation:failed', { investigationId, error });
      throw error;
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
    task.status = 'in_progress';
    task.startedAt = new Date();

    const agent = this.agents.get(task.assignedTo);
    if (!agent) {
      throw new Error(`Agent ${task.assignedTo} not found`);
    }

    try {
      const result = await agent.analyze(task.input.context);
      task.output = result;
      task.status = 'completed';
      task.completedAt = new Date();
      task.duration = task.completedAt.getTime() - task.startedAt.getTime();

      this.completedTasks.set(task.taskId, task);
      return task;
    } catch (error) {
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

  /**
   * Get investigation status
   */
  public getInvestigationStatus(investigationId: string): any {
    const context = this.activeInvestigations.get(investigationId);
    if (!context) {
      return { status: 'not_found' };
    }

    const tasks = Array.from(this.completedTasks.values())
      .filter(t => t.input.investigationId === investigationId);

    return {
      investigationId,
      bugReport: context.bugReport,
      tasksCompleted: tasks.length,
      tasksTotal: this.agents.size,
      status: tasks.length === this.agents.size ? 'completed' : 'in_progress',
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
