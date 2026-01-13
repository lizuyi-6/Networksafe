import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import logger from '../utils/logger';
import { Recommendation } from '../database/models/scan-result';

const execAsync = promisify(exec);

/**
 * System Scanner
 * Scans system configuration and vulnerabilities
 */
export class SystemScanner {
  /**
   * Scan system information
   */
  async scanSystem(): Promise<{ info: any; recommendations: Recommendation[] }> {
    const recommendations: Recommendation[] = [];
    const info: any = {};

    try {
      // Get OS information
      info.platform = os.platform();
      info.arch = os.arch();
      info.release = os.release();
      info.cpus = os.cpus().length;
      info.totalMemory = `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`;
      info.uptime = `${Math.round(os.uptime() / 3600)}h`;

      // Check system updates
      const updateRecommendations = await this.checkSystemUpdates();
      recommendations.push(...updateRecommendations);

      // Check system limits
      const limitRecommendations = await this.checkSystemLimits();
      recommendations.push(...limitRecommendations);

      // Check disk space
      const diskRecommendations = await this.checkDiskSpace();
      recommendations.push(...diskRecommendations);

      // Check firewall status
      const firewallRecommendations = await this.checkFirewall();
      recommendations.push(...firewallRecommendations);

      logger.info('System scan complete');
    } catch (error: any) {
      logger.error('System scan failed', { error });
    }

    return { info, recommendations };
  }

  /**
   * Check for system updates
   */
  private async checkSystemUpdates(): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    try {
      if (os.platform() === 'linux') {
        // Check for Debian/Ubuntu updates
        try {
          const { stdout } = await execAsync('apt list --upgradable 2>/dev/null | grep -c "upgradable" || echo "0"');
          const updateCount = parseInt(stdout.trim());

          if (updateCount > 0) {
            recommendations.push({
              category: 'security',
              priority: 'high',
              title: `${updateCount} System Updates Available`,
              description: 'Your system has pending security updates',
              action: 'sudo apt update && sudo apt upgrade -y',
              autoApplicable: true,
              risk: 'Security vulnerabilities may be exposed'
            });
          }
        } catch (error) {
          // apt not available, might be different distro
        }

        // Check for RHEL/CentOS updates
        try {
          const { stdout } = await execAsync('yum check-update 2>/dev/null | grep -c "^" || echo "0"');
          const updateCount = parseInt(stdout.trim());

          if (updateCount > 10) {
            recommendations.push({
              category: 'security',
              priority: 'high',
              title: 'System Updates Available',
              description: 'Your system has pending updates',
              action: 'sudo yum update -y',
              autoApplicable: true,
              risk: 'Security vulnerabilities may be exposed'
            });
          }
        } catch (error) {
          // yum not available
        }
      }
    } catch (error: any) {
      logger.error('Failed to check system updates', { error });
    }

    return recommendations;
  }

  /**
   * Check system limits
   */
  private async checkSystemLimits(): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    try {
      // Check file descriptor limit
      const { stdout: ulimitOutput } = await execAsync('ulimit -n');
      const fileDescriptorLimit = parseInt(ulimitOutput.trim());

      if (fileDescriptorLimit < 65535) {
        recommendations.push({
          category: 'performance',
          priority: 'medium',
          title: 'File Descriptor Limit Too Low',
          description: `Current limit: ${fileDescriptorLimit}, Recommended: 65535`,
          action: 'ulimit -n 65535 (add to /etc/security/limits.conf for permanent)',
          autoApplicable: false,
          risk: 'May hit "too many open files" error under high load'
        });
      }

      // Check max user processes
      const { stdout: uLimitOutput } = await execAsync('ulimit -u');
      const maxProcesses = parseInt(uLimitOutput.trim());

      if (maxProcesses < 4096) {
        recommendations.push({
          category: 'performance',
          priority: 'low',
          title: 'Max User Processes Limit',
          description: `Current limit: ${maxProcesses}, Recommended: 4096+`,
          action: 'ulimit -u 4096',
          autoApplicable: false,
          risk: 'May prevent spawning new processes under load'
        });
      }
    } catch (error: any) {
      logger.error('Failed to check system limits', { error });
    }

    return recommendations;
  }

  /**
   * Check disk space
   */
  private async checkDiskSpace(): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    try {
      const { stdout } = await execAsync('df -h / | tail -1');

      const parts = stdout.split(/\s+/);
      const usedPercent = parseInt(parts[4].replace('%', ''));

      if (usedPercent > 80) {
        recommendations.push({
          category: 'reliability',
          priority: 'critical',
          title: 'Disk Space Almost Full',
          description: `Root partition is ${usedPercent}% full`,
          action: 'Clean up logs, remove old backups, or expand disk',
          autoApplicable: false,
          risk: 'System may crash when disk is full'
        });
      } else if (usedPercent > 60) {
        recommendations.push({
          category: 'reliability',
          priority: 'medium',
          title: 'Disk Space Warning',
          description: `Root partition is ${usedPercent}% full`,
          action: 'Monitor disk usage and plan cleanup',
          autoApplicable: false,
          risk: 'System may run out of disk space soon'
        });
      }
    } catch (error: any) {
      logger.error('Failed to check disk space', { error });
    }

    return recommendations;
  }

  /**
   * Check firewall status
   */
  private async checkFirewall(): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    try {
      // Check if UFW is installed (Ubuntu/Debian)
      try {
        const { stdout } = await execAsync('ufw status');
        if (stdout.includes('inactive')) {
          recommendations.push({
            category: 'security',
            priority: 'high',
            title: 'Firewall is Inactive',
            description: 'UFW firewall is not enabled',
            action: 'sudo ufw enable',
            autoApplicable: true,
            risk: 'Server is exposed to all incoming connections'
          });
        }
      } catch (error) {
        // UFW not installed
        recommendations.push({
          category: 'security',
          priority: 'high',
          title: 'No Firewall Detected',
          description: 'Consider installing and configuring a firewall',
          action: 'sudo apt install ufw && sudo ufw enable',
          autoApplicable: true,
          risk: 'Server is exposed to all incoming connections'
        });
      }

      // Check if firewalld is running (RHEL/CentOS)
      try {
        await execAsync('firewall-cmd --state 2>/dev/null');
        // firewalld is active, good
      } catch (error) {
        // firewalld not active
      }
    } catch (error: any) {
      logger.error('Failed to check firewall', { error });
    }

    return recommendations;
  }

  /**
   * Get installed software packages
   */
  async getInstalledPackages(): Promise<string[]> {
    const packages: string[] = [];

    try {
      if (os.platform() === 'linux') {
        // Try dpkg (Debian/Ubuntu)
        try {
          const { stdout } = await execAsync("dpkg -l | grep '^ii' | awk '{print $2}'");
          packages.push(...stdout.split('\n').filter(p => p.trim()));
        } catch (error) {
          // Try rpm (RHEL/CentOS)
          try {
            const { stdout } = await execAsync('rpm -qa');
            packages.push(...stdout.split('\n').filter(p => p.trim()));
          } catch (error) {
            // Neither dpkg nor rpm available
          }
        }
      }
    } catch (error: any) {
      logger.error('Failed to get installed packages', { error });
    }

    return packages;
  }
}
