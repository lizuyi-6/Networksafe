/**
 * Root Cause Agent
 *
 * Specializes in identifying the root cause of bugs by analyzing all available evidence
 * from other agents and correlating findings.
 */

import { BaseInvestigationAgent } from './base-investigation.agent';
import { InvestigationContext, InvestigationAgentType, Finding, RootCause } from '../types';

export class RootCauseAgent extends BaseInvestigationAgent {
  constructor(coordinator: any) {
    super(InvestigationAgentType.ROOT_CAUSE, [
      'root_cause_analysis',
      'correlation_analysis',
      'causal_inference',
      'pattern_recognition',
      'evidence_synthesis',
      'contributing_factor_identification'
    ]);
  }

  /**
   * Analyze evidence to determine root cause
   */
  public async analyze(context: InvestigationContext): Promise<any> {
    console.log('[RootCauseAgent] Starting root cause analysis...');

    const findings: Finding[] = [];

    // Gather evidence from context
    const evidence = this.gatherEvidence(context);

    // Analyze correlations
    const correlations = this.analyzeCorrelations(context);

    // Identify potential root causes
    const potentialRootCauses = await this.identifyRootCauses(context, evidence);

    // Validate root causes
    const validatedRootCauses = await this.validateRootCauses(potentialRootCauses, context);

    // Identify contributing factors
    const contributingFactors = this.identifyContributingFactors(context);

    // AI-powered root cause analysis
    const aiAnalysis = await this.analyzeWithAI(
      'Perform comprehensive root cause analysis. Correlate findings from logs, traces, code analysis, and bug reproduction to identify the most likely root cause.',
      {
        bugReport: context.bugReport,
        evidence,
        correlations,
        potentialRootCauses
      }
    );

    // Determine final root cause
    const rootCause = this.determineRootCause(validatedRootCauses, aiAnalysis, correlations);

    findings.push({
      type: rootCause.category === 'code' ? 'code' : 'configuration',
      severity: context.bugReport.severity,
      description: `Root cause identified: ${rootCause.description}`,
      location: rootCause.location.file ?
        `${rootCause.location.file}:${rootCause.location.line || ''}` :
        rootCause.location.service || 'unknown',
      evidence: rootCause.explanation.split('. ').filter((s: string) => s.length > 0),
      relatedFindings: []
    });

    return {
      findings,
      rootCause,
      contributingFactors,
      correlations,
      evidence,
      aiAnalysis,
      confidence: this.calculateConfidence(evidence, correlations),
      summary: this.generateSummary(rootCause, contributingFactors)
    };
  }

  /**
   * Gather evidence from context
   */
  private gatherEvidence(context: InvestigationContext): any {
    return {
      logs: {
        errorCount: context.systemState.logs.filter(l => l.level === 'error' || l.level === 'fatal').length,
        warningCount: context.systemState.logs.filter(l => l.level === 'warn').length,
        servicesAffected: new Set(context.systemState.logs.map(l => l.service)).size
      },
      traces: {
        errorCount: context.systemState.traces.filter(t => t.status === 'error').length,
        avgDuration: context.systemState.traces.reduce((sum, t) => sum + t.duration, 0) / context.systemState.traces.length,
        servicesAffected: new Set(context.systemState.traces.map(t => t.service)).size
      },
      codeContext: context.systemState.codeContext,
      bugCategory: context.bugReport.category,
      severity: context.bugReport.severity
    };
  }

  /**
   * Analyze correlations between different data sources
   */
  private analyzeCorrelations(context: InvestigationContext): any[] {
    const correlations: any[] = [];

    // Check if error logs correlate with trace errors
    const errorLogs = context.systemState.logs.filter(l => l.level === 'error' || l.level === 'fatal');
    const errorTraces = context.systemState.traces.filter(t => t.status === 'error');

    // Find services with both log errors and trace errors
    const logErrorServices = new Set(errorLogs.map(l => l.service));
    const traceErrorServices = new Set(errorTraces.map(t => t.service));

    logErrorServices.forEach(service => {
      if (traceErrorServices.has(service)) {
        correlations.push({
          type: 'service_failure',
          service,
          strength: 'high',
          description: `Service ${service} has both log errors and trace failures`,
          evidence: {
            logErrors: errorLogs.filter(l => l.service === service).length,
            traceErrors: errorTraces.filter(t => t.service === service).length
          }
        });
      }
    });

    // Check for time correlations
    const errorTimes = errorLogs.map(l => l.timestamp.getTime());
    if (errorTimes.length > 1) {
      const timeDiff = Math.max(...errorTimes) - Math.min(...errorTimes);
      if (timeDiff < 60000) { // Within 1 minute
        correlations.push({
          type: 'temporal_cluster',
          strength: timeDiff < 10000 ? 'high' : 'medium',
          description: `Errors occurred within ${timeDiff / 1000} seconds`,
          evidence: { timeWindow: timeDiff, errorCount: errorTimes.length }
        });
      }
    }

    // Check for code context correlations
    if (context.systemState.codeContext) {
      const codeFile = context.systemState.codeContext.filePath;
      const codeRelatedErrors = errorLogs.filter(l =>
        l.message.includes(codeFile) ||
        l.metadata?.file === codeFile
      );

      if (codeRelatedErrors.length > 0) {
        correlations.push({
          type: 'code_error_correlation',
          strength: 'high',
          description: `${codeRelatedErrors.length} errors related to code file ${codeFile}`,
          evidence: { file: codeFile, errorCount: codeRelatedErrors.length }
        });
      }
    }

    return correlations;
  }

  /**
   * Identify potential root causes
   */
  private async identifyRootCauses(context: InvestigationContext, evidence: any): Promise<RootCause[]> {
    const rootCauses: RootCause[] = [];

    // Analyze based on bug category
    const category = context.bugReport.category;

    switch (category) {
      case 'security':
        rootCauses.push(...this.analyzeSecurityRootCauses(context, evidence));
        break;
      case 'performance':
        rootCauses.push(...this.analyzePerformanceRootCauses(context, evidence));
        break;
      case 'functional':
        rootCauses.push(...this.analyzeFunctionalRootCauses(context, evidence));
        break;
      case 'crash':
        rootCauses.push(...this.analyzeCrashRootCauses(context, evidence));
        break;
      case 'memory':
        rootCauses.push(...this.analyzeMemoryRootCauses(context, evidence));
        break;
      case 'concurrency':
        rootCauses.push(...this.analyzeConcurrencyRootCauses(context, evidence));
        break;
      default:
        rootCauses.push(...this.analyzeGenericRootCauses(context, evidence));
    }

    return rootCauses;
  }

  /**
   * Analyze security root causes
   */
  private analyzeSecurityRootCauses(context: InvestigationContext, evidence: any): RootCause[] {
    const rootCauses: RootCause[] = [];

    // Check for input validation issues
    const inputValidationErrors = context.systemState.logs.filter(l =>
      l.message.includes('validation') || l.message.includes('unauthorized')
    );

    if (inputValidationErrors.length > 0) {
      rootCauses.push({
        category: 'code',
        description: 'Insufficient input validation or authorization checks',
        location: {
          service: inputValidationErrors[0].service
        },
        explanation: 'Security-related errors indicate potential issues with input validation or authorization logic.',
        contributingFactors: ['Missing authentication checks', 'Inadequate input sanitization']
      });
    }

    // Check for authentication failures
    const authErrors = context.systemState.logs.filter(l =>
      l.message.includes('auth') || l.message.includes('token')
    );

    if (authErrors.length > 0) {
      rootCauses.push({
        category: 'code',
        description: 'Authentication/authorization mechanism failure',
        location: {
          service: authErrors[0].service
        },
        explanation: 'Authentication system failures may indicate token handling issues or permission logic errors.',
        contributingFactors: ['Token expiration handling', 'Permission verification logic']
      });
    }

    return rootCauses;
  }

  /**
   * Analyze performance root causes
   */
  private analyzePerformanceRootCauses(context: InvestigationContext, evidence: any): RootCause[] {
    const rootCauses: RootCause[] = [];

    const slowTraces = context.systemState.traces.filter(t => t.duration > 1000);

    if (slowTraces.length > 0) {
      const slowService = slowTraces[0].service;
      rootCauses.push({
        category: 'code',
        description: 'Performance bottleneck in service or database operations',
        location: {
          service: slowService
        },
        explanation: `Service ${slowService} shows slow response times indicating inefficient operations or resource constraints.`,
        contributingFactors: ['Unoptimized queries', 'Missing caching', 'High resource utilization']
      });
    }

    return rootCauses;
  }

  /**
   * Analyze functional root causes
   */
  private analyzeFunctionalRootCauses(context: InvestigationContext, evidence: any): RootCause[] {
    const rootCauses: RootCause[] = [];

    if (context.systemState.codeContext) {
      rootCauses.push({
        category: 'code',
        description: 'Logic error in business logic or data processing',
        location: {
          file: context.systemState.codeContext.filePath,
          line: context.systemState.codeContext.lineNumber,
          function: context.systemState.codeContext.function
        },
        explanation: 'Functional bugs often stem from incorrect logic implementation or edge case handling.',
        contributingFactors: ['Incomplete requirement analysis', 'Missing edge case handling']
      });
    }

    return rootCauses;
  }

  /**
   * Analyze crash root causes
   */
  private analyzeCrashRootCauses(context: InvestigationContext, evidence: any): RootCause[] {
    const rootCauses: RootCause[] = [];

    const fatalLogs = context.systemState.logs.filter(l => l.level === 'fatal');

    if (fatalLogs.length > 0) {
      rootCauses.push({
        category: 'code',
        description: 'Unhandled exception or fatal error causing system crash',
        location: {
          service: fatalLogs[0].service
        },
        explanation: 'Fatal errors indicate unhandled exceptions or critical system failures.',
        contributingFactors: ['Missing error handling', 'Null/undefined reference', 'Resource exhaustion']
      });
    }

    return rootCauses;
  }

  /**
   * Analyze memory root causes
   */
  private analyzeMemoryRootCauses(context: InvestigationContext, evidence: any): RootCause[] {
    const rootCauses: RootCause[] = [];

    if (evidence.logs && evidence.logs.errorCount > 0) {
      rootCauses.push({
        category: 'code',
        description: 'Memory leak or inefficient memory usage',
        location: {
          service: 'unknown'
        },
        explanation: 'Memory issues often result from resource leaks or inefficient data structures.',
        contributingFactors: ['Unclosed connections', 'Large object retention', 'Cache bloat']
      });
    }

    return rootCauses;
  }

  /**
   * Analyze concurrency root causes
   */
  private analyzeConcurrencyRootCauses(context: InvestigationContext, evidence: any): RootCause[] {
    const rootCauses: RootCause[] = [];

    rootCauses.push({
      category: 'code',
      description: 'Race condition or deadlock in concurrent operations',
      location: {
        service: 'unknown'
      },
      explanation: 'Concurrency issues arise from shared state access without proper synchronization.',
      contributingFactors: ['Missing locks/mutexes', 'Improper transaction isolation', 'Shared mutable state']
    });

    return rootCauses;
  }

  /**
   * Analyze generic root causes
   */
  private analyzeGenericRootCauses(context: InvestigationContext, evidence: any): RootCause[] {
    const rootCauses: RootCause[] = [];

    // Default to code issue
    rootCauses.push({
      category: 'code',
      description: 'Code logic error or implementation issue',
      location: {
        service: context.systemState.logs[0]?.service || 'unknown'
      },
      explanation: 'Generic bug requiring code-level investigation.',
      contributingFactors: ['Logic error', 'Edge case', 'Configuration issue']
    });

    return rootCauses;
  }

  /**
   * Validate root causes
   */
  private async validateRootCauses(rootCauses: RootCause[], context: InvestigationContext): Promise<RootCause[]> {
    return rootCauses.filter(rc => {
      // Validate based on evidence
      let isValid = true;

      // Check if location is specified
      if (!rc.location.service && !rc.location.file) {
        isValid = false;
      }

      return isValid;
    });
  }

  /**
   * Identify contributing factors
   */
  private identifyContributingFactors(context: InvestigationContext): string[] {
    const factors: string[] = [];

    // Check environmental factors
    if (context.bugReport.environment.version === 'unknown') {
      factors.push('Unknown version - compatibility issues possible');
    }

    // Check system load factors
    if (context.systemState.metrics) {
      const cpuUsage = context.systemState.metrics.cpu?.usage || 0;
      const memoryUsage = context.systemState.metrics.memory?.percentage || 0;

      if (cpuUsage > 80) {
        factors.push('High CPU utilization during issue');
      }

      if (memoryUsage > 80) {
        factors.push('High memory utilization during issue');
      }
    }

    return factors;
  }

  /**
   * Determine final root cause
   */
  private determineRootCause(
    validatedRootCauses: RootCause[],
    aiAnalysis: any,
    correlations: any[]
  ): RootCause {
    // If AI analysis suggests a root cause, use it
    if (aiAnalysis.rootCause) {
      return aiAnalysis.rootCause;
    }

    // Otherwise, use the highest confidence validated root cause
    if (validatedRootCauses.length > 0) {
      return validatedRootCauses[0];
    }

    // Fallback: create generic root cause from correlations
    if (correlations.length > 0) {
      return {
        category: 'code',
        description: correlations[0].description,
        location: correlations[0].service ?
          { service: correlations[0].service } :
          { service: 'unknown' },
        explanation: 'Root cause inferred from correlation analysis',
        contributingFactors: []
      };
    }

    // Ultimate fallback
    return {
      category: 'code',
      description: 'Unable to determine specific root cause - requires manual investigation',
      location: { service: 'unknown' },
      explanation: 'Insufficient evidence to determine root cause',
      contributingFactors: []
    };
  }

  /**
   * Calculate confidence in root cause
   */
  private calculateConfidence(evidence: any, correlations: any[]): number {
    let confidence = 0.3; // Base confidence

    if (evidence.logs.errorCount > 0) confidence += 0.15;
    if (evidence.traces.errorCount > 0) confidence += 0.15;
    if (evidence.codeContext) confidence += 0.2;
    if (correlations.length > 0) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  /**
   * Generate summary
   */
  private generateSummary(rootCause: RootCause, contributingFactors: string[]): string {
    return `Root cause: ${rootCause.description}. ` +
      `Contributing factors: ${contributingFactors.length} identified.`;
  }
}
