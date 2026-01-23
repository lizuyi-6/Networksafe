import greenlock from 'greenlock-express';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger';

/**
 * HTTPS Manager
 * Handles automatic Let's Encrypt SSL certificates
 */
export class HttpsManager {
  private le: any = null;
  private certsDir: string;

  constructor() {
    this.certsDir = process.env.CERTS_DIR || path.join(process.cwd(), 'certs');
    this.ensureCertsDir();
  }

  /**
   * Ensure certificates directory exists
   */
  private ensureCertsDir(): void {
    if (!fs.existsSync(this.certsDir)) {
      fs.mkdirSync(this.certsDir, { recursive: true });
      logger.info(`Created certificates directory: ${this.certsDir}`);
    }
  }

  /**
   * Initialize Greenlock
   */
  private async initGreenlock(): Promise<void> {
    if (this.le) {
      return; // Already initialized
    }

    const maintainerEmail = process.env.SSL_EMAIL || 'admin@example.com';

    this.le = greenlock.create({
      maintainerEmail,
      packageAgent: 'newsecurity/1.0.0',
      packageRoot: this.certsDir,
      configDir: path.join(this.certsDir, 'etc'),
      staging: process.env.NODE_ENV !== 'production',
      approveDomains: this.approveDomains.bind(this),
      notify: this.notify.bind(this)
    });

    logger.info('Greenlock initialized');
  }

  /**
   * Approve domains for certificates
   */
  private async approveDomains(opts: any): Promise<any> {
    const { domain, email } = opts;

    logger.info(`Approving domain: ${domain}`);

    // In production, you would validate domain ownership here
    // For now, auto-approve all domains
    return {
      domain,
      email,
      agreeTos: true,
      clusterize: false
    };
  }

  /**
   * Greenlock notification handler
   */
  private notify(event: string, details: any): void {
    if (event === 'certificate') {
      logger.info('Certificate obtained', {
        domain: details.domain,
        expiresAt: details.expiresAt
      });
    } else if (event === 'error') {
      logger.error('Greenlock error', { error: details });
    }
  }

  /**
   * Get or create SSL certificates for domains
   */
  public async getCertificates(domains: string[]): Promise<{
    key: string;
    cert: string;
    ca: string;
  }> {
    await this.initGreenlock();

    try {
      // Request certificates for all domains
      const results = await this.le.tlsOptions.fetch({
        domains
      });

      logger.info(`SSL certificates obtained for ${domains.length} domain(s)`);

      return {
        key: results.key,
        cert: results.cert,
        ca: results.ca || ''
      };
    } catch (error: any) {
      logger.error('Failed to obtain SSL certificates', { error });

      // In development, generate self-signed certificate
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('Using self-signed certificate for development');
        return this.generateSelfSignedCert(domains[0]);
      }

      throw error;
    }
  }

  /**
   * Generate self-signed certificate (for development)
   */
  private generateSelfSignedCert(domain: string): {
    key: string;
    cert: string;
    ca: string;
  } {
    const selfsigned = require('selfsigned');

    const attrs = [{ name: 'commonName', value: domain }];
    const pems = selfsigned.generate(attrs, { days: 365 });

    return {
      key: pems.private,
      cert: pems.cert,
      ca: pems.cert
    };
  }

  /**
   * Renew certificates
   */
  public async renewCertificates(domains: string[]): Promise<void> {
    await this.initGreenlock();

    try {
      await this.le.renew({
        domains,
        renewWithin: 15 * 24 * 60 * 60 * 1000 // 15 days before expiry
      });

      logger.info(`Certificates renewed for ${domains.length} domain(s)`);
    } catch (error: any) {
      logger.error('Failed to renew certificates', { error, domains });
      throw error;
    }
  }

  /**
   * Check if certificate exists for domain
   */
  public certificateExists(domain: string): boolean {
    const certPath = path.join(this.certsDir, 'etc', 'live', domain);
    return fs.existsSync(certPath);
  }
}
