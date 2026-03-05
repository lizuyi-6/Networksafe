import { PortScanner } from './port-scanner';
import { SystemScanner } from './system-scanner';
import { WebScanner } from './web-scanner';
import { Recommendation, ScanOptions } from '../database/models/scan-result';
import logger from '../utils/logger';
import { spawn } from 'child_process';

/**
 * SECURITY FIX CVE-2026-036: Allowed commands whitelist
 * Only these commands can be executed automatically
 */
const ALLOWED_COMMANDS: Set<string> = new Set([
  // System management
  'systemctl',
  'service',
  // Firewall
  'ufw',
  'firewall-cmd',
  'iptables',
  // Package management
  'apt',
  'apt-get',
  'yum',
  'dnf',
  // Web servers
  'nginx',
  'apache2',
  'apachectl',
  // Permissions
  'chmod',
  'chown',
  // Network
  'sysctl',
]);

/**
 * SECURITY FIX CVE-2026-036: Validate command against whitelist
 */
function isCommandAllowed(command: string): boolean {
  const parts = command.trim().split(/\s+/);
  const baseCommand = parts[0];

  // Check for shell metacharacters that could lead to injection
  const dangerousChars = /[;&|`$(){}[\]<>'"!#%^*?\n\r\\]/;
  if (dangerousChars.test(command)) {
    logger.warn('Command contains dangerous characters', { command });
    return false;
  }

  // Check if base command is in whitelist
  if (!ALLOWED_COMMANDS.has(baseCommand)) {
    logger.warn('Command not in whitelist', { baseCommand, command });
    return false;
  }

  return true;
}

/**
 * SECURITY FIX CVE-2026-036: Safe command execution using spawn
 */
async function safeExecCommand(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    const proc = spawn(cmd, args, {
      timeout: 60000,
      env: { ...process.env, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

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
   * SECURITY FIX CVE-2026-036: Use command whitelist and safe execution
   */
  async applyOptimization(recommendation: Recommendation): Promise<{ success: boolean; output?: string; error?: string }> {
    if (!recommendation.autoApplicable) {
      return {
        success: false,
        error: 'backend.this_recommendation_cannot_be_automatically_applied'
      };
    }

    logger.info(`Applying optimization: ${recommendation.title}`);

    // SECURITY FIX CVE-2026-036: Validate command against whitelist
    if (!isCommandAllowed(recommendation.action)) {
      logger.error(`Command not allowed: ${recommendation.action}`);
      return {
        success: false,
        error: 'backend.command_not_in_allowed_list_or_contains_dangerous_characters'
      };
    }

    try {
      // SECURITY FIX CVE-2026-036: Use safe command execution with spawn
      const { stdout, stderr } = await safeExecCommand(recommendation.action);

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
