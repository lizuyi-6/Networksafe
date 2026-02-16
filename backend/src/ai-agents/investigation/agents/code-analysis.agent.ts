/**
 * Code Analysis Agent
 *
 * Specializes in analyzing code to identify bugs, vulnerabilities, and code quality issues.
 */

import { BaseInvestigationAgent } from './base-investigation.agent';
import { InvestigationContext, InvestigationAgentType, Finding } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';

export class CodeAnalysisAgent extends BaseInvestigationAgent {
  private projectRoot: string;

  constructor(coordinator: any) {
    super(InvestigationAgentType.CODE_ANALYSIS, [
      'static_analysis',
      'code_review',
      'bug_detection',
      'vulnerability_scanning',
      'code_smell_detection',
      'dependency_analysis'
    ]);
    this.projectRoot = path.resolve(process.cwd(), '../..');
  }

  /**
   * Analyze code for issues
   */
  public async analyze(context: InvestigationContext): Promise<any> {
    console.log('[CodeAnalysisAgent] Starting code analysis...');

    const findings: Finding[] = [];

    // Get code context if available
    const codeContext = context.systemState.codeContext;
    if (codeContext) {
      const fileAnalysis = await this.analyzeFile(codeContext);
      findings.push(...fileAnalysis);
    }

    // Analyze related files if bug category suggests code issues
    if (context.bugReport.category === 'security' ||
        context.bugReport.category === 'functional' ||
        context.bugReport.category === 'crash') {
      const relatedIssues = await this.analyzeRelatedCode(context);
      findings.push(...relatedIssues);
    }

    // AI-powered code analysis
    let aiAnalysis: any = {};
    if (codeContext || context.bugReport.category === 'security') {
      const codeContextForAI = codeContext ?
        await this.readCodeFile(codeContext.filePath) :
        'No specific file identified';

      aiAnalysis = await this.analyzeWithAI(
        'Analyze this code for bugs, vulnerabilities, and code quality issues.',
        {
          bugReport: context.bugReport,
          codeContext: codeContextForAI,
          codePath: codeContext?.filePath
        }
      );

      if (aiAnalysis.findings) {
        findings.push(...aiAnalysis.findings);
      }
    }

    return {
      findings,
      codeIssues: findings,
      aiAnalysis,
      summary: this.generateSummary(findings)
    };
  }

  /**
   * Analyze specific file
   */
  private async analyzeFile(codeContext: any): Promise<Finding[]> {
    const findings: Finding[] = [];

    try {
      const code = await this.readCodeFile(codeContext.filePath);
      const lines = code.split('\n');

      // Basic static analysis
      const issues = this.performStaticAnalysis(codeContext.filePath, code, lines);

      findings.push(...issues);
    } catch (error) {
      console.error(`[CodeAnalysisAgent] Failed to analyze file ${codeContext.filePath}:`, error);
      findings.push({
        type: 'error',
        severity: 'low',
        description: `Could not analyze file ${codeContext.filePath}: ${error}`,
        location: codeContext.filePath,
        evidence: [],
        relatedFindings: []
      });
    }

    return findings;
  }

  /**
   * Perform static code analysis
   */
  private performStaticAnalysis(filePath: string, code: string, lines: string[]): Finding[] {
    const findings: Finding[] = [];

    // Check for common issues
    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      // Check for TODO/FIXME comments
      if (line.includes('TODO') || line.includes('FIXME')) {
        findings.push({
          type: 'code',
          severity: 'low',
          description: `Found incomplete code marker at line ${lineNumber}`,
          location: `${filePath}:${lineNumber}`,
          evidence: [line.trim()],
          relatedFindings: []
        });
      }

      // Check for console.log in production code
      if (line.includes('console.log') && !line.includes('//')) {
        findings.push({
          type: 'code',
          severity: 'low',
          description: `Found console.log statement at line ${lineNumber}`,
          location: `${filePath}:${lineNumber}`,
          evidence: [line.trim()],
          relatedFindings: []
        });
      }

      // Check for hardcoded credentials (basic check)
      if (line.match(/password\s*=\s*['"][^'"]+['"]/i) ||
          line.match(/api_?key\s*=\s*['"][^'"]+['"]/i)) {
        findings.push({
          type: 'security',
          severity: 'high',
          description: `Possible hardcoded credential at line ${lineNumber}`,
          location: `${filePath}:${lineNumber}`,
          evidence: [line.trim()],
          relatedFindings: []
        });
      }

      // Check for SQL injection patterns
      if (line.match(/query\s*=\s*['"].*\$\{.*\}/) ||
          line.match(/execute\(['"].*\+.*['"]\)/)) {
        findings.push({
          type: 'security',
          severity: 'critical',
          description: `Possible SQL injection vulnerability at line ${lineNumber}`,
          location: `${filePath}:${lineNumber}`,
          evidence: [line.trim()],
          relatedFindings: []
        });
      }

      // Check for eval usage
      if (line.includes('eval(')) {
        findings.push({
          type: 'security',
          severity: 'high',
          description: `Use of eval() at line ${lineNumber} (security risk)`,
          location: `${filePath}:${lineNumber}`,
          evidence: [line.trim()],
          relatedFindings: []
        });
      }
    });

    // Check for complex functions (cyclomatic complexity)
    const functionComplexity = this.analyzeComplexity(filePath, code);
    findings.push(...functionComplexity);

    return findings;
  }

  /**
   * Analyze code complexity
   */
  private analyzeComplexity(filePath: string, code: string): Finding[] {
    const findings: Finding[] = [];

    // Simple complexity check: count branches in functions
    const functionPattern = /(?:function|const\s+\w+\s*=\s*(?:async\s*)?\(|=>\s*{)/g;
    const functions = code.match(functionPattern) || [];

    if (functions.length > 0) {
      // This is a simplified check - real complexity analysis would be more sophisticated
      const avgComplexity = code.split(/\b(if\b|else\b|for\b|while\b|case\b|catch\b)/g).length / functions.length;

      if (avgComplexity > 20) {
        findings.push({
          type: 'code',
          severity: 'medium',
          description: `File ${filePath} has high average cyclomatic complexity: ${avgComplexity.toFixed(2)}`,
          location: filePath,
          evidence: [`Average complexity: ${avgComplexity.toFixed(2)}`],
          relatedFindings: []
        });
      }
    }

    return findings;
  }

  /**
   * Analyze related code based on bug category
   */
  private async analyzeRelatedCode(context: InvestigationContext): Promise<Finding[]> {
    const findings: Finding[] = [];

    try {
      // Look for files related to the bug
      const searchPaths = this.getSearchPaths(context);

      for (const searchPath of searchPaths) {
        const fullPath = path.join(this.projectRoot, searchPath);

        try {
          const files = await this.findRelevantFiles(fullPath);
          const issues = await this.analyzeFiles(files, context);
          findings.push(...issues);
        } catch (error) {
          // File or directory may not exist, continue
          console.debug(`[CodeAnalysisAgent] Path not found: ${fullPath}`);
        }
      }
    } catch (error) {
      console.error('[CodeAnalysisAgent] Error analyzing related code:', error);
    }

    return findings;
  }

  /**
   * Get search paths based on bug category
   */
  private getSearchPaths(context: InvestigationContext): string[] {
    const category = context.bugReport.category;
    const paths: string[] = [];

    switch (category) {
      case 'security':
        paths.push(
          'backend/src/security',
          'backend/src/middleware',
          'backend/src/auth'
        );
        break;
      case 'performance':
        paths.push(
          'backend/src/services',
          'backend/src/database',
          'backend/src/cache'
        );
        break;
      case 'functional':
        paths.push(
          'backend/src/api',
          'backend/src/controllers'
        );
        break;
      case 'crash':
        paths.push(
          'backend/src/index.ts',
          'backend/src/server.ts',
          'backend/src/app.ts'
        );
        break;
      default:
        paths.push('backend/src');
    }

    return paths;
  }

  /**
   * Find relevant files
   */
  private async findRelevantFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          const subFiles = await this.findRelevantFiles(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Directory may not exist
    }

    return files.slice(0, 20); // Limit to 20 files
  }

  /**
   * Analyze multiple files
   */
  private async analyzeFiles(filePaths: string[], context: InvestigationContext): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const filePath of filePaths) {
      try {
        const code = await this.readCodeFile(filePath);
        const lines = code.split('\n');
        const issues = this.performStaticAnalysis(filePath, code, lines);
        findings.push(...issues);
      } catch (error) {
        console.error(`[CodeAnalysisAgent] Failed to analyze ${filePath}:`, error);
      }
    }

    return findings;
  }

  /**
   * Read code file
   */
  private async readCodeFile(filePath: string): Promise<string> {
    const fullPath = path.isAbsolute(filePath) ?
      filePath :
      path.join(this.projectRoot, filePath);

    try {
      return await fs.readFile(fullPath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read file ${fullPath}: ${error}`);
    }
  }

  /**
   * Generate analysis summary
   */
  private generateSummary(findings: Finding[]): string {
    const critical = findings.filter(f => f.severity === 'critical').length;
    const high = findings.filter(f => f.severity === 'high').length;
    const medium = findings.filter(f => f.severity === 'medium').length;

    return `Code analysis complete: ${findings.length} issues found ` +
      `(${critical} critical, ${high} high, ${medium} medium).`;
  }
}
