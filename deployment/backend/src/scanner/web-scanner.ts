import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import logger from '../utils/logger';
import { Recommendation } from '../database/models/scan-result';

const execAsync = promisify(exec);

/**
 * Web Server Scanner
 * Scans Nginx/Apache configuration
 */
export class WebScanner {
  /**
   * Scan web server configuration
   */
  async scanWebServer(): Promise<{ server: string | null; recommendations: Recommendation[] }> {
    const recommendations: Recommendation[] = [];
    let server: string | null = null;

    // Check for Nginx
    const nginxRecs = await this.checkNginx();
    if (nginxRecs) {
      server = 'nginx';
      recommendations.push(...nginxRecs);
    }

    // Check for Apache
    const apacheRecs = await this.checkApache();
    if (apacheRecs) {
      server = server === null ? 'apache' : 'both';
      recommendations.push(...apacheRecs);
    }

    logger.info(`Web server scan complete. Detected: ${server || 'none'}`);

    return { server, recommendations };
  }

  /**
   * Check Nginx configuration
   */
  private async checkNginx(): Promise<Recommendation[] | null> {
    const recommendations: Recommendation[] = [];

    try {
      // Check if Nginx is installed
      await execAsync('which nginx');
    } catch (error) {
      return null; // Nginx not installed
    }

    try {
      // Check Nginx version
      const { stdout: versionOutput } = await execAsync('nginx -v 2>&1');
      const version = versionOutput.match(/nginx\/(\d+\.\d+\.\d+)/)?.[1];

      // Check if running
      try {
        await execAsync('pgrep nginx');
      } catch (error) {
        recommendations.push({
          category: 'reliability',
          priority: 'high',
          title: 'Nginx is Not Running',
          description: 'Nginx is installed but not running',
          action: 'sudo systemctl start nginx',
          autoApplicable: true,
          risk: 'Web server is not serving content'
        });
        return recommendations;
      }

      // Test configuration
      try {
        await execAsync('nginx -t');
      } catch (error: any) {
        recommendations.push({
          category: 'reliability',
          priority: 'critical',
          title: 'Nginx Configuration Error',
          description: 'Nginx configuration test failed',
          action: 'Check nginx -t output and fix configuration',
          autoApplicable: false,
          risk: 'Nginx may fail to reload'
        });
      }

      // Check if gzip is enabled
      const { stdout: config } = await execAsync('cat /etc/nginx/nginx.conf');
      if (!config.includes('gzip on')) {
        recommendations.push({
          category: 'performance',
          priority: 'medium',
          title: 'Gzip Compression Not Enabled',
          description: 'Enabling gzip can significantly reduce bandwidth',
          action: 'Add "gzip on;" to nginx.conf',
          autoApplicable: true,
          risk: 'Increased bandwidth usage'
        });
      }

      // Check if HTTP/2 is enabled
      if (!config.includes('http2')) {
        recommendations.push({
          category: 'performance',
          priority: 'low',
          title: 'HTTP/2 Not Enabled',
          description: 'HTTP/2 improves performance for modern browsers',
          action: 'Add "http2" to listen directive',
          autoApplicable: false,
          risk: 'Suboptimal performance'
        });
      }

      // Check worker processes
      const workerMatch = config.match(/worker_processes\s+(\d+|auto);/);
      if (workerMatch) {
        const workers = workerMatch[1];
        if (workers !== 'auto' && parseInt(workers) < 4) {
          recommendations.push({
            category: 'performance',
            priority: 'low',
            title: 'Nginx Worker Processes',
            description: `Current: ${workers}, Recommended: auto`,
            action: 'Set "worker_processes auto;" in nginx.conf',
            autoApplicable: true,
            risk: 'Suboptimal performance'
          });
        }
      }

      // Check client body size limit
      if (!config.includes('client_max_body_size')) {
        recommendations.push({
          category: 'performance',
          priority: 'low',
          title: 'Missing Client Body Size Limit',
          description: 'No limit on upload file size',
          action: 'Add "client_max_body_size 100M;" to http block',
          autoApplicable: true,
          risk: 'Potential disk space exhaustion from large uploads'
        });
      }

      // Check keepalive timeout
      const keepaliveMatch = config.match(/keepalive_timeout\s+(\d+);/);
      if (keepaliveMatch) {
        const timeout = parseInt(keepaliveMatch[1]);
        if (timeout > 75) {
          recommendations.push({
            category: 'performance',
            priority: 'low',
            title: 'Keepalive Timeout Too High',
            description: `Current: ${timeout}s, Recommended: 65s`,
            action: 'Set "keepalive_timeout 65;"',
            autoApplicable: true,
            risk: 'Connections may stay open too long'
          });
        }
      }

    } catch (error: any) {
      logger.error('Error checking Nginx', { error });
    }

    return recommendations;
  }

  /**
   * Check Apache configuration
   */
  private async checkApache(): Promise<Recommendation[] | null> {
    const recommendations: Recommendation[] = [];

    try {
      // Check if Apache is installed
      await execAsync('which apachectl || which apache2');
    } catch (error) {
      return null; // Apache not installed
    }

    try {
      // Check Apache version
      const { stdout: versionOutput } = await execAsync('apachectl -v 2>/dev/null || apache2 -v 2>/dev/null');
      const version = versionOutput.match(/Apache\/(\d+\.\d+\.\d+)/)?.[1];

      // Check if running
      try {
        await execAsync('pgrep apache');
      } catch (error) {
        try {
          await execAsync('pgrep httpd');
        } catch (error2) {
          recommendations.push({
            category: 'reliability',
            priority: 'high',
            title: 'Apache is Not Running',
            description: 'Apache is installed but not running',
            action: 'sudo systemctl start apache2 || sudo systemctl start httpd',
            autoApplicable: true,
            risk: 'Web server is not serving content'
          });
          return recommendations;
        }
      }

      // Test configuration
      try {
        await execAsync('apachectl configtest 2>/dev/null || apache2ctl configtest 2>/dev/null');
      } catch (error: any) {
        recommendations.push({
          category: 'reliability',
          priority: 'critical',
          title: 'Apache Configuration Error',
          description: 'Apache configuration test failed',
          action: 'Check configtest output and fix configuration',
          autoApplicable: false,
          risk: 'Apache may fail to reload'
        });
      }

      // Check for mod_deflate (compression)
      try {
        await execAsync('apachectl -M 2>/dev/null | grep deflate || apache2ctl -M 2>/dev/null | grep deflate');
      } catch (error) {
        recommendations.push({
          category: 'performance',
          priority: 'medium',
          title: 'Mod Deflate Not Enabled',
          description: 'Compression module not enabled',
          action: 'sudo a2enmod deflate && sudo systemctl restart apache',
          autoApplicable: true,
          risk: 'Increased bandwidth usage'
        });
      }

      // Check for mod_http2
      try {
        await execAsync('apachectl -M 2>/dev/null | grep http2 || apache2ctl -M 2>/dev/null | grep http2');
      } catch (error) {
        recommendations.push({
          category: 'performance',
          priority: 'low',
          title: 'HTTP/2 Not Enabled',
          description: 'HTTP/2 module not enabled',
          action: 'sudo a2enmod http2 && sudo systemctl restart apache',
          autoApplicable: true,
          risk: 'Suboptimal performance for modern browsers'
        });
      }

      // Check for mod_security
      try {
        await execAsync('apachectl -M 2>/dev/null | grep security || apache2ctl -M 2>/dev/null | grep security');
      } catch (error) {
        recommendations.push({
          category: 'security',
          priority: 'medium',
          title: 'Mod Security Not Installed',
          description: 'Web Application Firewall (WAF) not enabled',
          action: 'sudo a2enmod security2 && sudo systemctl restart apache',
          autoApplicable: true,
          risk: 'Increased vulnerability to web attacks'
        });
      }

    } catch (error: any) {
      logger.error('Error checking Apache', { error });
    }

    return recommendations;
  }

  /**
   * Get Nginx configuration
   */
  async getNginxConfig(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('cat /etc/nginx/nginx.conf');
      return stdout;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get Apache configuration
   */
  async getApacheConfig(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('cat /etc/apache2/apache2.conf 2>/dev/null || cat /etc/httpd/conf/httpd.conf 2>/dev/null');
      return stdout;
    } catch (error) {
      return null;
    }
  }
}
