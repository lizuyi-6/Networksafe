import { PortScanner } from './port-scanner';
import { SystemScanner } from './system-scanner';
import { WebScanner } from './web-scanner';
import { Recommendation, ScanOptions } from '../database/models/scan-result';
import logger from '../utils/logger';

/**
 * Optimization Engine
 * Orchestrates all scanners and generates comprehensive optimization recommendations
 */
export class OptimizationEngine {
  private portScanner: PortScanner;
  private systemScanner: SystemScanner;
  private webScanner: WebScanner;

  constructor() {
    this.portScanner = new PortScanner();
    this.systemScanner = new SystemScanner();
    this.webScanner = new WebScanner();
  }

  /**
   * Run full server scan
   */
  async runFullScan(options: ScanOptions = {}): Promise<{
    systemInfo: any;
    recommendations: Recommendation[];
    summary: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
  }> {
    const allRecommendations: Recommendation[] = [];
    const systemInfo: any = {};

    logger.info('Starting full server scan...');

    // 1. Port scanning
    if (options.scanPorts !== false) {
      logger.info('Running port scan...');
      const portRecs = await this.portScanner.scanCommonPorts();
      allRecommendations.push(...portRecs);
    }

    // 2. System scanning
    if (options.scanSystem !== false) {
      logger.info('Running system scan...');
      const { info, recommendations } = await this.systemScanner.scanSystem();
      Object.assign(systemInfo, info);
      allRecommendations.push(...recommendations);
    }

    // 3. Web server scanning
    if (options.scanWebServer !== false) {
      logger.info('Running web server scan...');
      const { server, recommendations } = await this.webScanner.scanWebServer();
      systemInfo.webServer = server;
      allRecommendations.push(...recommendations);
    }

    // Sort recommendations by priority
    const sortedRecs = this.sortRecommendations(allRecommendations);

    // Generate summary
    const summary = this.generateSummary(sortedRecs);

    logger.info('Full server scan complete', { summary });

    return {
      systemInfo,
      recommendations: sortedRecs,
      summary
    };
  }

  /**
   * Apply an optimization
   */
  async applyOptimization(recommendation: Recommendation): Promise<{ success: boolean; output?: string; error?: string }> {
    if (!recommendation.autoApplicable) {
      return {
        success: false,
        error: 'This recommendation cannot be automatically applied'
      };
    }

    logger.info(`Applying optimization: ${recommendation.title}`);

    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      // Execute the action
      const { stdout, stderr } = await execAsync(recommendation.action);

      logger.info(`Optimization applied successfully`, { output: stdout });

      return {
        success: true,
        output: stdout || stderr
      };
    } catch (error: any) {
      logger.error(`Failed to apply optimization`, { error });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Sort recommendations by priority
   */
  private sortRecommendations(recommendations: Recommendation[]): Recommendation[] {
    const priorityOrder = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3
    };

    return recommendations.sort((a, b) => {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Generate summary statistics
   */
  private generateSummary(recommendations: Recommendation[]): {
    critical: number;
    high: number;
    medium: number;
    low: number;
  } {
    return {
      critical: recommendations.filter(r => r.priority === 'critical').length,
      high: recommendations.filter(r => r.priority === 'high').length,
      medium: recommendations.filter(r => r.priority === 'medium').length,
      low: recommendations.filter(r => r.priority === 'low').length
    };
  }

  /**
   * Get optimization preview (what would be done)
   */
  async previewOptimizations(recommendations: Recommendation[]): Promise<{
    autoApplicable: Recommendation[];
    manual: Recommendation[];
  }> {
    const autoApplicable = recommendations.filter(r => r.autoApplicable);
    const manual = recommendations.filter(r => !r.autoApplicable);

    return { autoApplicable, manual };
  }

  /**
   * Export recommendations as report
   */
  generateReport(systemInfo: any, recommendations: Recommendation[]): string {
    let report = '# NewSecurity Server Optimization Report\n\n';
    report += `Generated: ${new Date().toISOString()}\n\n`;

    report += '## System Information\n\n';
    report += `- Platform: ${systemInfo.platform} ${systemInfo.release}\n`;
    report += `- Architecture: ${systemInfo.arch}\n`;
    report += `- CPUs: ${systemInfo.cpus}\n`;
    report += `- Total Memory: ${systemInfo.totalMemory}\n`;
    report += `- Uptime: ${systemInfo.uptime}\n`;
    if (systemInfo.webServer) {
      report += `- Web Server: ${systemInfo.webServer}\n`;
    }
    report += '\n';

    report += '## Recommendations\n\n';

    const byPriority = recommendations.reduce((acc, rec) => {
      if (!acc[rec.priority]) acc[rec.priority] = [];
      acc[rec.priority].push(rec);
      return acc;
    }, {} as Record<string, Recommendation[]>);

    const priorities = ['critical', 'high', 'medium', 'low'];

    for (const priority of priorities) {
      if (byPriority[priority] && byPriority[priority].length > 0) {
        report += `### ${priority.toUpperCase()} Priority (${byPriority[priority].length})\n\n`;

        for (const rec of byPriority[priority]) {
          report += `#### ${rec.title}\n`;
          report += `- **Category**: ${rec.category}\n`;
          report += `- **Description**: ${rec.description}\n`;
          report += `- **Action**: \`${rec.action}\`\n`;
          report += `- **Risk**: ${rec.risk}\n`;
          report += `- **Auto-Applicable**: ${rec.autoApplicable ? 'Yes' : 'No'}\n\n`;
        }
      }
    }

    report += '\n---\n';
    report += 'Generated by NewSecurity v1.0.0\n';

    return report;
  }
}
