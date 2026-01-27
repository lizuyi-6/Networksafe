import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../utils/logger';
import { Recommendation } from '../database/models/scan-result';

const execAsync = promisify(exec);

/**
 * Port Scanner
 * Scans for open ports and services
 */
export class PortScanner {
  /**
   * Scan common ports
   */
  async scanCommonPorts(): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    try {
      // Common ports to scan
      const commonPorts = [21, 22, 23, 25, 53, 80, 110, 143, 443, 993, 995, 3306, 3389, 5432, 6379, 8000, 8080, 27017];

      logger.info('Scanning common ports...');

      // Use netstat to check listening ports
      const { stdout } = await execAsync('netstat -tulpn 2>/dev/null || ss -tulpn 2>/dev/null || lsof -i -P -n | grep LISTEN');

      const openPorts = this.parseOpenPorts(stdout);

      // Check for security issues
      for (const port of commonPorts) {
        if (openPorts.includes(port)) {
          const recommendation = this.analyzePort(port);
          if (recommendation) {
            recommendations.push(recommendation);
          }
        }
      }

      logger.info(`Port scan complete. Found ${openPorts.length} open ports`);
    } catch (error: any) {
      logger.error('Port scan failed', { error });
    }

    return recommendations;
  }

  /**
   * Parse open ports from netstat output
   */
  private parseOpenPorts(output: string): number[] {
    const ports: number[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Match port numbers in the output
      const match = line.match(/:(\d+)\s/);
      if (match) {
        const port = parseInt(match[1]);
        if (!ports.includes(port)) {
          ports.push(port);
        }
      }
    }

    return ports;
  }

  /**
   * Analyze a specific port and generate recommendation
   */
  private analyzePort(port: number): Recommendation | null {
    const securityRisks: Record<number, Recommendation> = {
      21: {
        category: 'security',
        priority: 'medium',
        title: 'FTP Port (21) is Open',
        description: 'FTP transmits data in plain text and can be a security risk',
        action: 'Consider using SFTP (port 22) or FTPS instead',
        autoApplicable: false,
        risk: 'Credentials and data can be intercepted'
      },
      23: {
        category: 'security',
        priority: 'high',
        title: 'Telnet Port (23) is Open',
        description: 'Telnet is insecure and transmits data in plain text',
        action: 'Disable Telnet and use SSH instead',
        autoApplicable: false,
        risk: 'Credentials can be easily intercepted'
      },
      3306: {
        category: 'security',
        priority: 'high',
        title: 'MySQL Port (3306) Exposed',
        description: 'MySQL database port is accessible from external network',
        action: 'Bind MySQL to localhost (127.0.0.1) or configure firewall',
        autoApplicable: false,
        risk: 'Database can be attacked from external network'
      },
      5432: {
        category: 'security',
        priority: 'high',
        title: 'PostgreSQL Port (5432) Exposed',
        description: 'PostgreSQL database port is accessible from external network',
        action: 'Bind PostgreSQL to localhost or configure firewall',
        autoApplicable: false,
        risk: 'Database can be attacked from external network'
      },
      6379: {
        category: 'security',
        priority: 'critical',
        title: 'Redis Port (6379) Exposed',
        description: 'Redis has no authentication by default and is exposed',
        action: 'Bind Redis to localhost, enable authentication, and configure firewall',
        autoApplicable: false,
        risk: 'Anyone can access and modify your data'
      },
      27017: {
        category: 'security',
        priority: 'high',
        title: 'MongoDB Port (27017) Exposed',
        description: 'MongoDB port is accessible from external network',
        action: 'Bind MongoDB to localhost or enable authentication',
        autoApplicable: false,
        risk: 'Database can be accessed without proper authentication'
      }
    };

    return securityRisks[port] || null;
  }

  /**
   * Scan for specific port
   */
  async isPortOpen(port: number): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`netstat -tulpn 2>/dev/null | grep :${port} || ss -tulpn 2>/dev/null | grep :${port}`);
      return stdout.trim().length > 0;
    } catch (error) {
      return false;
    }
  }
}
