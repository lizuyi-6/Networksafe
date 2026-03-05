/**
 * Solution Agent
 *
 * Specializes in generating solutions and remediation strategies based on root cause analysis.
 * Provides multiple solution options with risk assessment and implementation guidance.
 */

import { BaseInvestigationAgent } from './base-investigation.agent';
import { InvestigationContext, InvestigationAgentType, Solution, CodeChange } from '../types';
import { AgentConfig, MessageBus } from '../../core';

export class SolutionAgent extends BaseInvestigationAgent {
  constructor(config: AgentConfig, messageBus: MessageBus) {
    super(config, messageBus, InvestigationAgentType.SOLUTION, [
      'solution_generation',
      'remediation_planning',
      'risk_assessment',
      'implementation_guidance',
      'workaround_identification',
      'best_practices_recommendation'
    ]);
  }

  /**
   * Get system prompt for AI model
   */
  public getSystemPrompt(): string {
    return `You are a Solution Agent specializing in:
- Generating comprehensive remediation strategies
- Risk assessment for proposed solutions
- Implementation guidance and best practices
- Workaround identification when hotfixes aren't possible
- Solution prioritization based on impact and effort

Your goal is to provide actionable solutions with clear risk assessment.`;
  }

  /**
   * Generate solutions based on investigation context
   */
  public async analyzeInvestigation(context: InvestigationContext): Promise<any> {
    console.log('[SolutionAgent] Starting solution generation...');

    // Get preliminary root cause if available
    const preliminaryRootCause = (context as any).preliminaryRootCause;

    if (!preliminaryRootCause) {
      return {
        solutions: [],
        summary: 'Cannot generate solutions without root cause identification'
      };
    }

    // Generate solutions
    const solutions = await this.generateSolutions(context, preliminaryRootCause);

    // Prioritize solutions
    const prioritizedSolutions = this.prioritizeSolutions(solutions);

    // AI-powered solution generation
    const aiAnalysis = await this.analyzeWithAI(
      'Generate comprehensive solutions for this bug. Include hotfixes, refactoring suggestions, configuration changes, and workarounds. Assess risks and implementation effort.',
      {
        bugReport: context.bugReport,
        rootCause: preliminaryRootCause,
        existingSolutions: solutions
      }
    );

    // Merge AI solutions with generated solutions
    if (aiAnalysis.solutions && Array.isArray(aiAnalysis.solutions)) {
      prioritizedSolutions.push(...aiAnalysis.solutions);
    }

    return {
      solutions: prioritizedSolutions,
      aiAnalysis,
      summary: this.generateSummary(prioritizedSolutions)
    };
  }

  /**
   * Generate solutions based on root cause
   */
  private async generateSolutions(context: InvestigationContext, rootCause: any): Promise<Solution[]> {
    const solutions: Solution[] = [];

    switch (rootCause.category) {
      case 'code':
        solutions.push(...this.generateCodeSolutions(context, rootCause));
        break;
      case 'configuration':
        solutions.push(...this.generateConfigurationSolutions(context, rootCause));
        break;
      case 'environment':
        solutions.push(...this.generateEnvironmentSolutions(context, rootCause));
        break;
      case 'dependency':
        solutions.push(...this.generateDependencySolutions(context, rootCause));
        break;
      case 'design':
        solutions.push(...this.generateDesignSolutions(context, rootCause));
        break;
      case 'external':
        solutions.push(...this.generateExternalSolutions(context, rootCause));
        break;
    }

    // Always add a workaround if available
    const workaround = this.generateWorkaround(context, rootCause);
    if (workaround) {
      solutions.push(workaround);
    }

    return solutions;
  }

  /**
   * Generate code-level solutions
   */
  private generateCodeSolutions(context: InvestigationContext, rootCause: any): Solution[] {
    const solutions: Solution[] = [];

    // Hotfix solution
    solutions.push({
      type: 'hotfix',
      priority: 'immediate',
      description: `Fix ${rootCause.description} in ${rootCause.location.file || rootCause.location.service}`,
      implementation: this.generateHotfixImplementation(rootCause),
      estimatedEffort: '2-4 hours',
      risk: 'low',
      sideEffects: ['Requires testing', 'May need rollback plan'],
      codeChanges: this.generateCodeChanges(rootCause)
    });

    // Refactor solution
    solutions.push({
      type: 'refactor',
      priority: 'normal',
      description: `Refactor ${rootCause.location.file || rootCause.location.service} to improve code quality and prevent similar issues`,
      implementation: '1. Review current implementation\n2. Design improved structure\n3. Implement with proper error handling\n4. Add unit tests\n5. Update documentation',
      estimatedEffort: '1-2 days',
      risk: 'medium',
      sideEffects: ['Requires thorough testing', 'May affect dependent code', 'Needs code review']
    });

    return solutions;
  }

  /**
   * Generate configuration solutions
   */
  private generateConfigurationSolutions(context: InvestigationContext, rootCause: any): Solution[] {
    const solutions: Solution[] = [];

    solutions.push({
      type: 'configuration',
      priority: 'urgent',
      description: 'Update configuration to resolve issue',
      implementation: '1. Identify configuration parameters\n2. Update configuration values\n3. Restart affected services\n4. Verify resolution',
      estimatedEffort: '30 minutes - 1 hour',
      risk: 'low',
      sideEffects: ['Service restart required', 'May need to update other environments']
    });

    return solutions;
  }

  /**
   * Generate environment solutions
   */
  private generateEnvironmentSolutions(context: InvestigationContext, rootCause: any): Solution[] {
    const solutions: Solution[] = [];

    solutions.push({
      type: 'upgrade',
      priority: 'normal',
      description: 'Update environment to meet requirements',
      implementation: '1. Update runtime version\n2. Update dependencies\n3. Rebuild and redeploy\n4. Verify compatibility',
      estimatedEffort: '2-4 hours',
      risk: 'medium',
      sideEffects: ['Compatibility testing required', 'May require other updates']
    });

    return solutions;
  }

  /**
   * Generate dependency solutions
   */
  private generateDependencySolutions(context: InvestigationContext, rootCause: any): Solution[] {
    const solutions: Solution[] = [];

    solutions.push({
      type: 'upgrade',
      priority: 'urgent',
      description: 'Update or replace problematic dependency',
      implementation: '1. Identify problematic dependency version\n2. Find compatible replacement or update\n3. Update package.json\n4. Test thoroughly\n5. Deploy',
      estimatedEffort: '4-8 hours',
      risk: 'medium',
      sideEffects: ['Breaking changes possible', 'Requires regression testing', 'May need code adjustments']
    });

    return solutions;
  }

  /**
   * Generate design solutions
   */
  private generateDesignSolutions(context: InvestigationContext, rootCause: any): Solution[] {
    const solutions: Solution[] = [];

    solutions.push({
      type: 'refactor',
      priority: 'normal',
      description: 'Redesign system architecture to address design flaw',
      implementation: '1. Create design document\n2. Review with team\n3. Implement new design\n4. Migrate existing data/code\n5. Test and deploy',
      estimatedEffort: '3-5 days',
      risk: 'high',
      sideEffects: ['Major code changes', 'Data migration may be needed', 'Extensive testing required']
    });

    return solutions;
  }

  /**
   * Generate external solutions
   */
  private generateExternalSolutions(context: InvestigationContext, rootCause: any): Solution[] {
    const solutions: Solution[] = [];

    solutions.push({
      type: 'workaround',
      priority: 'immediate',
      description: 'Implement workaround until external issue is resolved',
      implementation: '1. Add retry logic\n2. Implement fallback mechanism\n3. Add monitoring for external service\n4. Escalate to external provider',
      estimatedEffort: '2-4 hours',
      risk: 'low' as const,
      sideEffects: ['May degrade performance', 'Requires monitoring']
    });

    return solutions;
  }

  /**
   * Generate workaround solution
   */
  private generateWorkaround(context: InvestigationContext, rootCause: any): Solution | null {
    const workaround = {
      type: 'workaround' as const,
      priority: 'urgent' as const,
      description: 'Temporary workaround while proper fix is implemented',
      implementation: '1. Implement temporary fix\n2. Add monitoring\n3. Document workaround\n4. Schedule proper fix',
      estimatedEffort: '1-2 hours',
      risk: 'low' as const,
      sideEffects: ['Not a permanent solution', 'Should be replaced with proper fix']
    };

    return workaround;
  }

  /**
   * Generate hotfix implementation steps
   */
  private generateHotfixImplementation(rootCause: any): string {
    const steps = [
      '1. Identify exact location of issue',
      '2. Create bugfix branch',
      '3. Implement minimal fix',
      '4. Add unit tests',
      '5. Test locally',
      '6. Create pull request',
      '7. Code review',
      '8. Merge to main',
      '9. Deploy to staging',
      '10. Verify fix',
      '11. Deploy to production'
    ];

    return steps.join('\n');
  }

  /**
   * Generate code changes
   */
  private generateCodeChanges(rootCause: any): CodeChange[] {
    const changes: CodeChange[] = [];

    if (rootCause.location.file) {
      changes.push({
        filePath: rootCause.location.file,
        newCode: '// Fixed code based on root cause analysis\n' +
                 '// TODO: Add proper error handling and validation',
        lineNumber: rootCause.location.line,
        description: `Fix ${rootCause.description}`
      });
    }

    return changes;
  }

  /**
   * Prioritize solutions
   */
  private prioritizeSolutions(solutions: Solution[]): Solution[] {
    // Sort by priority and effort
    const priorityOrder = { 'immediate': 0, 'urgent': 1, 'normal': 2, 'low': 3 };

    return solutions.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Within same priority, prefer lower risk
      const riskOrder = { 'low': 0, 'medium': 1, 'high': 2 };
      return riskOrder[a.risk] - riskOrder[b.risk];
    });
  }

  /**
   * Generate summary
   */
  private generateSummary(solutions: Solution[]): string {
    const immediate = solutions.filter(s => s.priority === 'immediate').length;
    const urgent = solutions.filter(s => s.priority === 'urgent').length;
    const total = solutions.length;

    return `Generated ${total} solutions (${immediate} immediate, ${urgent} urgent). ` +
      `Recommended approach: Start with immediate priority, low-risk solutions.`;
  }
}

