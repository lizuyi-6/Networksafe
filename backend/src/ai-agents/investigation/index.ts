/**
 * Bug Investigation Agent Team - Main Entry Point
 *
 * Provides a comprehensive multi-agent system for investigating complex bugs.
 * Coordinates specialized agents to analyze logs, traces, code, and generate solutions.
 */

import { InvestigationCoordinator } from './coordinator';
import {
  BugReport,
  InvestigationContext,
  InvestigationResult,
  InvestigationAgentType
} from './types';

export class BugInvestigationTeam {
  private static instance: BugInvestigationTeam;
  private coordinator: InvestigationCoordinator;

  private constructor() {
    this.coordinator = new InvestigationCoordinator();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): BugInvestigationTeam {
    if (!BugInvestigationTeam.instance) {
      BugInvestigationTeam.instance = new BugInvestigationTeam();
    }
    return BugInvestigationTeam.instance;
  }

  /**
   * Start a bug investigation
   */
  public async investigate(bugReport: BugReport, context: InvestigationContext): Promise<InvestigationResult> {
    const investigationId = await this.coordinator.startInvestigation(bugReport, context);

    // Wait for investigation to complete
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.coordinator.cancelInvestigation(investigationId);
        cleanup();
        reject(new Error('Investigation timeout'));
      }, 300000); // 5 minute timeout

      const cleanup = () => {
        clearTimeout(timeout);
        this.coordinator.off('investigation:completed', onCompleted);
        this.coordinator.off('investigation:failed', onFailed);
        this.coordinator.off('investigation:cancelled', onCancelled);
      };

      const onCompleted = (data: any) => {
        if (data.investigationId === investigationId) {
          cleanup();
          resolve(data.result);
        }
      };

      const onFailed = (data: any) => {
        if (data.investigationId === investigationId) {
          cleanup();
          reject(data.error);
        }
      };

      const onCancelled = (data: any) => {
        if (data.investigationId === investigationId) {
          cleanup();
          reject(new Error('Investigation cancelled'));
        }
      };

      this.coordinator.on('investigation:completed', onCompleted);
      this.coordinator.on('investigation:failed', onFailed);
      this.coordinator.on('investigation:cancelled', onCancelled);
    });
  }

  /**
   * Get investigation status
   */
  public getInvestigationStatus(investigationId: string): any {
    return this.coordinator.getInvestigationStatus(investigationId);
  }

  /**
   * Get active investigations
   */
  public getActiveInvestigations(): any[] {
    return this.coordinator.getActiveInvestigations();
  }

  public cancelInvestigation(investigationId: string): ReturnType<InvestigationCoordinator['cancelInvestigation']> {
    return this.coordinator.cancelInvestigation(investigationId);
  }

  /**
   * Get agent capabilities
   */
  public getAgentCapabilities(): any[] {
    return this.coordinator.getAgentCapabilities();
  }

  /**
   * Create investigation context from raw data
   */
  public static createContext(data: {
    bugReport: any;
    logs?: any[];
    traces?: any[];
    metrics?: any;
    codeContext?: any;
  }): InvestigationContext {
    return {
      bugReport: data.bugReport,
      systemState: {
        logs: data.logs || [],
        traces: data.traces || [],
        metrics: data.metrics,
        codeContext: data.codeContext
      }
    };
  }

  /**
   * Create bug report from API request
   */
  public static createBugReport(data: {
    id?: string;
    title: string;
    description: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    category: 'security' | 'performance' | 'functional' | 'crash' | 'memory' | 'concurrency';
    reproductionSteps?: string[];
    environment?: any;
    reporter?: string;
  }): BugReport {
    return {
      id: data.id || `bug-${Date.now()}`,
      title: data.title,
      description: data.description,
      severity: data.severity,
      category: data.category,
      reproductionSteps: data.reproductionSteps,
      environment: data.environment || {
        os: 'unknown',
        runtime: 'unknown',
        version: 'unknown'
      },
      reporter: data.reporter || 'unknown',
      timestamp: new Date()
    };
  }
}

// Export for use in routes
export * from './types';
export * from './coordinator';
export * from './agents/base-investigation.agent';
export * from './agents/log-analysis.agent';
export * from './agents/trace-analysis.agent';
export * from './agents/code-analysis.agent';
export * from './agents/bug-reproduction.agent';
export * from './agents/root-cause.agent';
export * from './agents/solution.agent';
