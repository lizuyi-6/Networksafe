/**
 * Trace Analysis Agent
 *
 * Specializes in analyzing distributed traces to identify performance bottlenecks,
 * failure points, and service dependencies.
 */

import { BaseInvestigationAgent } from './base-investigation.agent';
import { InvestigationContext, InvestigationAgentType, Finding } from '../types';

export class TraceAnalysisAgent extends BaseInvestigationAgent {
  constructor(coordinator: any) {
    super(InvestigationAgentType.TRACE_ANALYSIS, [
      'performance_analysis',
      'bottleneck_detection',
      'failure_analysis',
      'dependency_mapping',
      'latency_analysis',
      'trace_correlation'
    ]);
  }

  /**
   * Analyze traces for performance and failure issues
   */
  public async analyze(context: InvestigationContext): Promise<any> {
    console.log('[TraceAnalysisAgent] Starting trace analysis...');

    const traces = context.systemState.traces;

    if (!traces || traces.length === 0) {
      return {
        findings: [],
        analyzedTraces: [],
        summary: 'No traces available for analysis'
      };
    }

    const findings: Finding[] = [];

    // Extract error traces
    const errorTraces = this.extractErrorTraces(traces);

    // Analyze performance
    const performanceIssues = await this.analyzePerformance(traces);
    findings.push(...performanceIssues);

    // Analyze failures
    const failurePatterns = this.analyzeFailures(errorTraces);
    findings.push(...failurePatterns);

    // Build dependency map
    const dependencyMap = this.buildDependencyMap(traces);

    // Detect anomalies
    const anomalies = this.detectAnomalies(traces);
    findings.push(...anomalies);

    // Correlate traces
    const traceChains = this.buildTraceChains(traces);

    // AI-powered analysis
    let aiAnalysis: any = {};
    if (errorTraces.length > 0 || performanceIssues.length > 0) {
      aiAnalysis = await this.analyzeWithAI(
        'Analyze these traces to identify performance bottlenecks, failure patterns, and service dependencies.',
        { traces: traces.slice(0, 100), errorTraces: errorTraces.slice(0, 20) }
      );
    }

    return {
      findings,
      analyzedTraces: traces,
      errorTraces,
      performanceIssues,
      failurePatterns,
      dependencyMap,
      anomalies,
      traceChains,
      aiAnalysis,
      summary: this.generateSummary(findings, traces)
    };
  }

  /**
   * Analyze performance issues
   */
  private async analyzePerformance(traces: any[]): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Group traces by operation
    const operations = new Map<string, any[]>();
    traces.forEach(trace => {
      const key = `${trace.service}:${trace.operation}`;
      if (!operations.has(key)) {
        operations.set(key, []);
      }
      operations.get(key)!.push(trace);
    });

    // Find slow operations
    operations.forEach((opTraces, operation) => {
      const durations = opTraces.map(t => t.duration);
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const maxDuration = Math.max(...durations);
      const p95Duration = this.percentile(durations, 95);

      if (avgDuration > 1000) {
        findings.push({
          type: 'performance',
          severity: avgDuration > 5000 ? 'critical' : 'medium',
          description: `Operation ${operation} has high latency: avg ${avgDuration.toFixed(2)}ms, p95 ${p95Duration.toFixed(2)}ms, max ${maxDuration}ms`,
          location: operation,
          evidence: [
            `Average: ${avgDuration.toFixed(2)}ms`,
            `P95: ${p95Duration.toFixed(2)}ms`,
            `Max: ${maxDuration}ms`,
            `Samples: ${durations.length}`
          ],
          relatedFindings: []
        });
      }

      // Detect outliers
      const outliers = durations.filter(d => d > p95Duration * 2);
      if (outliers.length > 0 && outliers.length < durations.length * 0.1) {
        findings.push({
          type: 'performance',
          severity: 'medium',
          description: `Operation ${operation} has ${outliers.length} outlier traces (>2x P95)`,
          location: operation,
          evidence: [`Outliers: ${outliers.length}/${durations.length}`],
          relatedFindings: []
        });
      }
    });

    return findings;
  }

  /**
   * Analyze failure patterns
   */
  private analyzeFailures(errorTraces: any[]): Finding[] {
    const findings: Finding[] = [];

    if (errorTraces.length === 0) {
      return findings;
    }

    // Group errors by service
    const errorsByService = new Map<string, any[]>();
    errorTraces.forEach(trace => {
      const service = trace.service || 'unknown';
      if (!errorsByService.has(service)) {
        errorsByService.set(service, []);
      }
      errorsByService.get(service)!.push(trace);
    });

    // Identify services with high failure rates
    errorsByService.forEach((errors, service) => {
      const errorCount = errors.length;
      const uniqueOperations = new Set(errors.map(e => e.operation)).size;

      findings.push({
        type: 'error',
        severity: errorCount > 10 ? 'critical' : 'high',
        description: `Service ${service} has ${errorCount} failed traces across ${uniqueOperations} operations`,
        location: service,
        evidence: errors.slice(0, 5).map(e =>
          `${e.operation}: ${e.error?.message || 'Unknown error'}`
        ),
        relatedFindings: []
      });
    });

    // Identify common failure patterns
    const errorMessages = new Map<string, number>();
    errorTraces.forEach(trace => {
      const msg = trace.error?.message || 'Unknown error';
      errorMessages.set(msg, (errorMessages.get(msg) || 0) + 1);
    });

    errorMessages.forEach((count, message) => {
      if (count > 3) {
        findings.push({
          type: 'error',
          severity: 'high',
          description: `Common error pattern: "${message}" occurred ${count} times`,
          evidence: [message],
          relatedFindings: []
        });
      }
    });

    return findings;
  }

  /**
   * Build service dependency map
   */
  private buildDependencyMap(traces: any[]): Map<string, Set<string>> {
    const dependencies = new Map<string, Set<string>>();

    traces.forEach(trace => {
      const service = trace.service;

      if (trace.parentSpanId) {
        // Find parent service
        const parentTrace = traces.find(t => t.spanId === trace.parentSpanId);
        if (parentTrace) {
          const parentService = parentTrace.service;

          if (!dependencies.has(parentService)) {
            dependencies.set(parentService, new Set());
          }
          dependencies.get(parentService)!.add(service);
        }
      }
    });

    return dependencies;
  }

  /**
   * Detect anomalies in traces
   */
  private detectAnomalies(traces: any[]): Finding[] {
    const findings: Finding[] = [];

    // Check for orphan traces (no parent but should have one)
    const potentialOrphans = traces.filter(t =>
      t.parentSpanId &&
      !traces.find(pt => pt.spanId === t.parentSpanId)
    );

    if (potentialOrphans.length > 5) {
      findings.push({
        type: 'anomaly',
        severity: 'medium',
        description: `Found ${potentialOrphans.length} orphan traces (missing parent spans)`,
        evidence: [`Orphan count: ${potentialOrphans.length}`],
        relatedFindings: []
      });
    }

    // Check for very long trace chains
    const traceChains = this.buildTraceChains(traces);
    traceChains.forEach(chain => {
      if (chain.length > 20) {
        findings.push({
          type: 'performance',
          severity: 'low',
          description: `Long trace chain detected: ${chain.length} spans`,
          evidence: [`Chain length: ${chain.length}`],
          relatedFindings: []
        });
      }
    });

    return findings;
  }

  /**
   * Build trace chains (complete request paths)
   */
  private buildTraceChains(traces: any[]): any[][] {
    const chains: any[][] = [];
    const processed = new Set<string>();

    traces.forEach(trace => {
      if (processed.has(trace.spanId)) {
        return;
      }

      const chain = this.buildChain(trace, traces, processed);
      if (chain.length > 0) {
        chains.push(chain);
      }
    });

    return chains;
  }

  /**
   * Recursively build trace chain
   */
  private buildChain(trace: any, allTraces: any[], processed: Set<string>): any[] {
    const chain: any[] = [];
    let current = trace;

    while (current) {
      chain.push(current);
      processed.add(current.spanId);

      // Find children
      const children = allTraces.filter(t => t.parentSpanId === current.spanId);
      if (children.length > 0) {
        // Process first child
        current = children[0];
      } else {
        break;
      }
    }

    return chain;
  }

  /**
   * Calculate percentile
   */
  private percentile(values: number[], p: number): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[index] || 0;
  }

  /**
   * Generate analysis summary
   */
  private generateSummary(findings: Finding[], traces: any[]): string {
    const errorCount = traces.filter(t => t.status === 'error').length;
    const avgDuration = traces.reduce((sum, t) => sum + t.duration, 0) / traces.length;

    return `Analyzed ${traces.length} traces: ${errorCount} errors, avg duration ${avgDuration.toFixed(2)}ms. ` +
      `Found ${findings.length} issues.`;
  }
}
