/**
 * Bug Reproduction Agent
 *
 * Specializes in reproducing bugs by analyzing user reports, system state, and test scenarios.
 */

import { BaseInvestigationAgent } from './base-investigation.agent';
import { InvestigationContext, InvestigationAgentType, Finding, ReproductionGuide } from '../types';
import { AgentConfig, MessageBus } from '../../core';

export class BugReproductionAgent extends BaseInvestigationAgent {
  constructor(config: AgentConfig, messageBus: MessageBus) {
    super(config, messageBus, InvestigationAgentType.BUG_REPRODUCTION, [
      'test_case_generation',
      'scenario_analysis',
      'reproduction_step_identification',
      'environment_analysis',
      'prerequisite_detection',
      'behavior_verification'
    ]);
  }

  /**
   * Get system prompt for AI model
   */
  public getSystemPrompt(): string {
    return `You are a Bug Reproduction Agent specializing in:
- Analyzing bug reports and user feedback
- Generating detailed reproduction steps
- Identifying prerequisites and environment requirements
- Validating bugs against system state
- Creating test scenarios

Your goal is to help developers reproduce bugs quickly and accurately.`;
  }

  /**
   * Analyze bug and attempt to generate reproduction steps
   */
  public async analyzeInvestigation(context: InvestigationContext): Promise<any> {
    console.log('[BugReproductionAgent] Starting bug reproduction analysis...');

    const findings: Finding[] = [];

    // Analyze bug report
    const reportAnalysis = this.analyzeBugReport(context.bugReport);
    findings.push(...reportAnalysis);

    // Check system environment
    const environmentCheck = this.checkEnvironment(context);
    findings.push(...environmentCheck);

    // Analyze reproduction steps if provided
    const reproductionAnalysis = await this.analyzeReproductionSteps(context);
    findings.push(...reproductionAnalysis.findings);

    // Generate reproduction guide
    const reproductionGuide = await this.generateReproductionGuide(context);

    // Validate against system state
    const validation = this.validateAgainstSystemState(context);

    // AI-powered reproduction analysis
    const aiAnalysis = await this.analyzeWithAI(
      'Analyze this bug report and generate detailed reproduction steps. Identify prerequisites, environment requirements, and expected vs actual behavior.',
      {
        bugReport: context.bugReport,
        systemState: context.systemState,
        existingSteps: context.bugReport.reproductionSteps
      }
    );

    return {
      findings,
      reproductionGuide,
      validation,
      reportAnalysis,
      aiAnalysis,
      summary: this.generateSummary(reproductionGuide, validation)
    };
  }

  /**
   * Analyze bug report
   */
  private analyzeBugReport(bugReport: any): Finding[] {
    const findings: Finding[] = [];

    // Check if reproduction steps are provided
    if (!bugReport.reproductionSteps || bugReport.reproductionSteps.length === 0) {
      findings.push({
        type: 'configuration',
        severity: 'high',
        description: 'Bug report lacks reproduction steps - makes investigation difficult',
        location: 'bug_report',
        evidence: ['No reproduction steps provided'],
        relatedFindings: []
      });
    }

    // Check severity level
    if (bugReport.severity === 'critical' && !bugReport.environment) {
      findings.push({
        type: 'configuration',
        severity: 'medium',
        description: 'Critical bug missing environment information',
        location: 'bug_report',
        evidence: ['No environment data'],
        relatedFindings: []
      });
    }

    // Check bug category
    if (bugReport.category === 'security' || bugReport.category === 'crash') {
      findings.push({
        type: bugReport.category,
        severity: 'high',
        description: `Bug categorized as ${bugReport.category} - requires immediate attention`,
        location: 'bug_report',
        evidence: [bugReport.category],
        relatedFindings: []
      });
    }

    return findings;
  }

  /**
   * Check environment configuration
   */
  private checkEnvironment(context: InvestigationContext): Finding[] {
    const findings: Finding[] = [];
    const env = context.bugReport.environment;

    if (!env) {
      findings.push({
        type: 'configuration',
        severity: 'medium',
        description: 'No environment information provided',
        location: 'environment',
        evidence: ['Environment data missing'],
        relatedFindings: []
      });
      return findings;
    }

    // Check OS version
    if (!env.os || env.os === 'unknown') {
      findings.push({
        type: 'configuration',
        severity: 'low',
        description: 'OS version not specified',
        location: 'environment',
        evidence: ['Missing OS version'],
        relatedFindings: []
      });
    }

    // Check runtime version
    if (!env.runtime || env.runtime === 'unknown') {
      findings.push({
        type: 'configuration',
        severity: 'low',
        description: 'Runtime version not specified',
        location: 'environment',
        evidence: ['Missing runtime version'],
        relatedFindings: []
      });
    }

    // Check for known problematic versions
    const knownIssues = this.checkKnownIssues(env);
    findings.push(...knownIssues);

    return findings;
  }

  /**
   * Check for known issues with environment
   */
  private checkKnownIssues(environment: any): Finding[] {
    const findings: Finding[] = [];

    // Add known issue checks here
    // Example: specific Node.js versions with known bugs
    if (environment.runtime && environment.runtime.includes('v14')) {
      findings.push({
        type: 'configuration',
        severity: 'medium',
        description: 'Node.js v14 has known issues - consider upgrading',
        location: 'environment',
        evidence: [environment.runtime],
        relatedFindings: []
      });
    }

    return findings;
  }

  /**
   * Analyze reproduction steps
   */
  private async analyzeReproductionSteps(context: InvestigationContext): Promise<any> {
    const findings: Finding[] = [];
    const steps = context.bugReport.reproductionSteps || [];

    if (steps.length === 0) {
      return { findings, stepAnalysis: null };
    }

    // Analyze step clarity
    steps.forEach((step, index) => {
      if (step.length < 10) {
        findings.push({
          type: 'configuration',
          severity: 'low',
          description: `Reproduction step ${index + 1} is too vague: "${step}"`,
          location: `reproduction_steps[${index}]`,
          evidence: [step],
          relatedFindings: []
        });
      }

      if (!step.includes('click') && !step.includes('open') && !step.includes('navigate') && !step.includes('select')) {
        findings.push({
          type: 'configuration',
          severity: 'low',
          description: `Reproduction step ${index + 1} may lack clear action: "${step}"`,
          location: `reproduction_steps[${index}]`,
          evidence: [step],
          relatedFindings: []
        });
      }
    });

    const stepAnalysis = {
      totalSteps: steps.length,
      clearSteps: steps.filter(s => s.length >= 10).length,
      vagueSteps: findings.length,
      complexity: this.assessComplexity(steps)
    };

    return { findings, stepAnalysis };
  }

  /**
   * Assess complexity of reproduction steps
   */
  private assessComplexity(steps: string[]): 'simple' | 'moderate' | 'complex' {
    if (steps.length <= 2) return 'simple';
    if (steps.length <= 5) return 'moderate';
    return 'complex';
  }

  /**
   * Generate reproduction guide
   */
  private async generateReproductionGuide(context: InvestigationContext): Promise<ReproductionGuide> {
    const bugReport = context.bugReport;
    const existingSteps = bugReport.reproductionSteps || [];

    // Build guide
    const guide: ReproductionGuide = {
      steps: existingSteps,
      prerequisites: this.identifyPrerequisites(context),
      expectedBehavior: 'System should function normally without errors',
      actualBehavior: bugReport.description,
      successRate: existingSteps.length > 0 ? 0.8 : 0.3
    };

    // Enhance with AI analysis if available
    const aiSteps = await this.analyzeWithAI(
      'Generate detailed, step-by-step reproduction instructions. Include prerequisites, environment setup, and clear expected vs actual behavior.',
      { bugReport, context }
    );

    if (aiSteps.steps) {
      guide.steps = aiSteps.steps;
      guide.prerequisites = aiSteps.prerequisites || guide.prerequisites;
      guide.expectedBehavior = aiSteps.expectedBehavior || guide.expectedBehavior;
      guide.actualBehavior = aiSteps.actualBehavior || guide.actualBehavior;
      guide.successRate = 0.9;
    }

    return guide;
  }

  /**
   * Identify prerequisites for reproduction
   */
  private identifyPrerequisites(context: InvestigationContext): string[] {
    const prerequisites: string[] = [];
    const category = context.bugReport.category;

    // General prerequisites
    prerequisites.push('Valid user account');
    prerequisites.push('Network connectivity');

    // Category-specific prerequisites
    switch (category) {
      case 'security':
        prerequisites.push('Appropriate permissions/roles');
        prerequisites.push('Security testing environment');
        break;
      case 'performance':
        prerequisites.push('Load testing tools');
        prerequisites.push('Performance monitoring enabled');
        break;
      case 'functional':
        prerequisites.push('Test data prepared');
        prerequisites.push('Feature access enabled');
        break;
      case 'memory':
        prerequisites.push('Memory profiling tools');
        prerequisites.push('High load environment');
        break;
      case 'concurrency':
        prerequisites.push('Multiple concurrent users');
        prerequisites.push('Concurrency testing setup');
        break;
    }

    return prerequisites;
  }

  /**
   * Validate against system state
   */
  private validateAgainstSystemState(context: InvestigationContext): any {
    const validation = {
      hasLogs: context.systemState.logs.length > 0,
      hasTraces: context.systemState.traces.length > 0,
      hasMetrics: !!context.systemState.metrics,
      hasCodeContext: !!context.systemState.codeContext,
      reproducibilityScore: 0
    };

    // Calculate reproducibility score
    let score = 0;
    if (context.bugReport.reproductionSteps && context.bugReport.reproductionSteps.length > 0) score += 0.3;
    if (validation.hasLogs) score += 0.2;
    if (validation.hasTraces) score += 0.2;
    if (validation.hasCodeContext) score += 0.2;
    if (context.bugReport.environment) score += 0.1;

    validation.reproducibilityScore = score;

    return validation;
  }

  /**
   * Generate summary
   */
  private generateSummary(guide: ReproductionGuide, validation: any): string {
    return `Bug reproduction analysis: ${guide.steps.length} steps identified, ` +
      `reproducibility score: ${(validation.reproducibilityScore * 100).toFixed(0)}%.`;
  }
}

