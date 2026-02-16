/**
 * Log Analysis Agent
 *
 * Specializes in analyzing logs to identify patterns, errors, and anomalies.
 */

import { BaseInvestigationAgent } from './base-investigation.agent';
import { InvestigationContext, InvestigationAgentType, Finding } from '../types';

export class LogAnalysisAgent extends BaseInvestigationAgent {
  constructor(coordinator: any) {
    super(InvestigationAgentType.LOG_ANALYSIS, [
      'log_pattern_recognition',
      'error_detection',
      'anomaly_detection',
      'log_correlation',
      'severity_analysis',
      'service_health_monitoring'
    ]);
  }

  /**
   * Analyze logs for patterns and issues
   */
  public async analyze(context: InvestigationContext): Promise<any> {
    console.log('[LogAnalysisAgent] Starting log analysis...');

    const preprocessedContext = this.preprocessContext(context);
    const logs = preprocessedContext.systemState.logs;

    if (!logs || logs.length === 0) {
      return {
        findings: [],
        analyzedLogs: [],
        summary: 'No logs available for analysis'
      };
    }

    // Extract different categories of logs
    const errorLogs = this.extractRelevantLogs(logs, ['error', 'fatal']);
    const warningLogs = this.extractRelevantLogs(logs, ['warn']);
    const criticalLogs = errorLogs.filter(log =>
      log.message.includes('exception') ||
      log.message.includes('timeout') ||
      log.message.includes('connection')
    );

    const findings: Finding[] = [];

    // Analyze error patterns
    const errorPatterns = await this.analyzeErrorPatterns(errorLogs);
    findings.push(...errorPatterns);

    // Analyze service health
    const serviceHealth = this.analyzeServiceHealth(logs);
    findings.push(...serviceHealth);

    // Detect anomalies
    const anomalies = await this.detectAnomalies(logs);
    findings.push(...anomalies);

    // Correlate logs by trace ID
    const correlatedLogs = this.correlateLogsByTrace(logs);

    // Time-based analysis
    const timePatterns = this.calculateTimeCorrelation(
      logs.map(log => log.timestamp)
    );

    // AI-powered analysis for complex patterns
    let aiAnalysis: any = {};
    if (errorLogs.length > 0) {
      aiAnalysis = await this.analyzeWithAI(
        'Analyze these error logs and identify patterns, root causes, and correlations.',
        { errorLogs: errorLogs.slice(0, 50), warningLogs: warningLogs.slice(0, 20) }
      );
    }

    return {
      findings,
      analyzedLogs: logs,
      errorPatterns,
      serviceHealth,
      anomalies,
      correlatedLogs,
      timePatterns,
      aiAnalysis,
      summary: this.generateSummary(findings, logs)
    };
  }

  /**
   * Analyze error patterns
   */
  private async analyzeErrorPatterns(errorLogs: any[]): Promise<Finding[]> {
    const findings: Finding[] = [];

    if (errorLogs.length === 0) {
      return findings;
    }

    // Group errors by service
    const errorsByService = new Map<string, any[]>();
    errorLogs.forEach(log => {
      const service = log.service || 'unknown';
      if (!errorsByService.has(service)) {
        errorsByService.set(service, []);
      }
      errorsByService.get(service)!.push(log);
    });

    // Identify services with high error rates
    errorsByService.forEach((errors, service) => {
      const errorCount = errors.length;
      const uniqueMessages = new Set(errors.map(e => e.message)).size;

      if (errorCount > 10) {
        findings.push({
          type: 'error',
          severity: errorCount > 50 ? 'critical' : 'high',
          description: `Service ${service} has ${errorCount} errors with ${uniqueMessages} unique error messages`,
          location: service,
          evidence: errors.slice(0, 5).map(e => e.message),
          relatedFindings: []
        });
      }
    });

    // Detect common error patterns
    const commonErrors = this.findCommonPatterns(errorLogs.map(e => e.message));
    commonErrors.forEach(pattern => {
      if (pattern.count > 5) {
        findings.push({
          type: 'error',
          severity: 'medium',
          description: `Common error pattern: "${pattern.pattern}" occurred ${pattern.count} times`,
          evidence: [pattern.pattern],
          relatedFindings: []
        });
      }
    });

    return findings;
  }

  /**
   * Analyze service health
   */
  private analyzeServiceHealth(logs: any[]): Finding[] {
    const findings: Finding[] = [];

    // Group logs by service
    const logsByService = new Map<string, any[]>();
    logs.forEach(log => {
      const service = log.service || 'unknown';
      if (!logsByService.has(service)) {
        logsByService.set(service, []);
      }
      logsByService.get(service)!.push(log);
    });

    // Check for services with error storms
    logsByService.forEach((serviceLogs, service) => {
      const errorCount = serviceLogs.filter(l =>
        l.level === 'error' || l.level === 'fatal'
      ).length;
      const totalLogs = serviceLogs.length;
      const errorRate = totalLogs > 0 ? errorCount / totalLogs : 0;

      if (errorRate > 0.1) {
        findings.push({
          type: 'anomaly',
          severity: 'high',
          description: `Service ${service} has high error rate: ${(errorRate * 100).toFixed(2)}%`,
          location: service,
          evidence: [`Errors: ${errorCount}/${totalLogs}`],
          relatedFindings: []
        });
      }

      // Check for missing logs (service might be down)
      if (totalLogs === 0 && errorCount === 0) {
        findings.push({
          type: 'anomaly',
          severity: 'medium',
          description: `Service ${service} has no log entries - may be down or not logging`,
          location: service,
          evidence: ['No log entries found'],
          relatedFindings: []
        });
      }
    });

    return findings;
  }

  /**
   * Detect anomalies in logs
   */
  private async detectAnomalies(logs: any[]): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Detect sudden spikes in errors
    const errorCountsByMinute = new Map<string, number>();
    logs.forEach(log => {
      if (log.level === 'error' || log.level === 'fatal') {
        const minute = new Date(log.timestamp);
        minute.setSeconds(0, 0);
        const key = minute.toISOString();
        errorCountsByMinute.set(key, (errorCountsByMinute.get(key) || 0) + 1);
      }
    });

    const avgErrorsPerMinute = Array.from(errorCountsByMinute.values())
      .reduce((a, b) => a + b, 0) / errorCountsByMinute.size;

    errorCountsByMinute.forEach((count, minute) => {
      if (count > avgErrorsPerMinute * 3) {
        findings.push({
          type: 'anomaly',
          severity: 'high',
          description: `Error spike detected at ${minute}: ${count} errors (avg: ${avgErrorsPerMinute.toFixed(2)})`,
          evidence: [`Error count: ${count}`],
          relatedFindings: []
        });
      }
    });

    return findings;
  }

  /**
   * Correlate logs by trace ID
   */
  private correlateLogsByTrace(logs: any[]): Map<string, any[]> {
    const correlated = new Map<string, any[]>();

    logs.forEach(log => {
      if (log.traceId) {
        if (!correlated.has(log.traceId)) {
          correlated.set(log.traceId, []);
        }
        correlated.get(log.traceId)!.push(log);
      }
    });

    return correlated;
  }

  /**
   * Find common patterns in messages
   */
  private findCommonPatterns(messages: string[]): Array<{ pattern: string; count: number }> {
    const patterns = new Map<string, number>();

    messages.forEach(msg => {
      // Remove dynamic parts (numbers, timestamps, IDs)
      const pattern = msg
        .replace(/\d+/g, 'N')
        .replace(/[a-f0-9-]{36}/g, 'UUID')
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, 'TIMESTAMP');

      patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
    });

    return Array.from(patterns.entries())
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * Generate analysis summary
   */
  private generateSummary(findings: Finding[], logs: any[]): string {
    const errorCount = logs.filter(l => l.level === 'error' || l.level === 'fatal').length;
    const warningCount = logs.filter(l => l.level === 'warn').length;
    const criticalFindings = findings.filter(f => f.severity === 'critical').length;

    return `Analyzed ${logs.length} logs: ${errorCount} errors, ${warningCount} warnings. ` +
      `Found ${findings.length} issues (${criticalFindings} critical).`;
  }
}
