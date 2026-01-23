import express, { Express, Request, Response } from 'express';
import http from 'http';
import https from 'https';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { URL } from 'url';
import { AntiBotMiddleware } from '../security/anti-bot.middleware';
import { rateLimitMiddleware } from '../security/ratelimit.middleware';
import { concurrencyLimit } from '../security/concurrency.middleware';
import { performanceMonitor } from '../security/concurrency.middleware';
import logger from '../utils/logger';
import { HttpsManager } from './https-manager';
import { SiteConfig } from '../database/models/site';

/**
 * Main Proxy Server
 * Handles HTTP/HTTPS proxying with security middleware
 */
export class ProxyServer {
  private app: Express;
  private httpServer: http.Server | null = null;
  private httpsServer: https.Server | null = null;
  private httpsManager: HttpsManager;
  private siteProxies = new Map<string, any>();

  constructor() {
    this.app = express();
    this.httpsManager = new HttpsManager();
    this.setupMiddleware();
  }

  /**
   * Setup core middleware
   */
  private setupMiddleware(): void {
    // Body parsing
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Performance monitoring (first)
    this.app.use(performanceMonitor);

    // Security middleware
    this.app.use('/api', this.apiMiddleware.bind(this));

    // Concurrency control
    this.app.use(concurrencyLimit);

    logger.info('Core middleware configured');
  }

  /**
   * API middleware - protects admin API
   */
  private apiMiddleware(req: Request, res: Response, next: any): void {
    // API authentication would go here
    // For now, just allow localhost
    const clientIp = req.ip || req.connection.remoteAddress || '';
    if (clientIp !== '127.0.0.1' && clientIp !== '::1') {
      // Check for API key
      const apiKey = req.headers['x-api-key'];
      if (!apiKey) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }
    next();
  }

  /**
   * Add a site to the proxy
   */
  public async addSite(siteConfig: SiteConfig): Promise<void> {
    const { domain, target, security } = siteConfig;

    logger.info(`Adding site: ${domain} -> ${target}`);

    // Remove existing proxy if any
    if (this.siteProxies.has(domain)) {
      logger.warn(`Site ${domain} already exists, replacing`);
      this.removeSite(domain);
    }

    // Create proxy configuration
    const proxyOptions = {
      target,
      changeOrigin: true,
      ws: true, // WebSocket support
      pathRewrite: {} as Record<string, string>,
      onProxyReq: (proxyReq: any, req: Request) => {
        // Add forwarded headers
        proxyReq.setHeader('X-Forwarded-For', req.ip);
        proxyReq.setHeader('X-Forwarded-Host', req.get('host'));
        proxyReq.setHeader('X-Forwarded-Proto', req.secure ? 'https' : 'http');
      },
      onError: (err: Error, req: Request, res: Response) => {
        logger.error('Proxy error', { error: err.message, url: req.url });
        res.status(502).json({
          error: 'Bad Gateway',
          message: 'Unable to reach backend server'
        });
      }
    };

    // Create proxy middleware
    const proxyMiddleware = createProxyMiddleware(proxyOptions);

    // Create route handler with security middleware
    const routeHandler = async (req: Request, res: Response, next: any) => {
      try {
        // Apply security middleware based on site config
        if (security?.antiBot) {
          const antiBot = new AntiBotMiddleware();
          await new Promise((resolve, reject) => {
            antiBot.protect(req, res, (err: any) => {
              if (err) reject(err);
              else resolve(undefined);
            });
          });
        }

        // Apply rate limiting if configured
        if (security?.rateLimit) {
          await new Promise((resolve, reject) => {
            rateLimitMiddleware(req, res, (err: any) => {
              if (err) reject(err);
              else resolve(undefined);
            });
          });
        }

        // Pass to proxy
        proxyMiddleware(req, res, next);
      } catch (error: any) {
        logger.error('Security middleware error', { error });
        // Continue to proxy anyway (fail open)
        proxyMiddleware(req, res, next);
      }
    };

    // Register route
    this.app.use(`/${domain}`, routeHandler);
    this.siteProxies.set(domain, { middleware: routeHandler, config: siteConfig });

    logger.info(`Site ${domain} added successfully`);
  }

  /**
   * Remove a site from the proxy
   */
  public removeSite(domain: string): void {
    if (this.siteProxies.has(domain)) {
      this.siteProxies.delete(domain);
      logger.info(`Site ${domain} removed`);
    }
  }

  /**
   * Get all sites
   */
  public getSites(): Map<string, any> {
    return this.siteProxies;
  }

  /**
   * Start HTTP server
   */
  public async startHttpServer(port: number = 80): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.httpServer = this.app.listen(port, () => {
          logger.info(`HTTP server listening on port ${port}`);
          resolve();
        });

        this.httpServer.on('error', (error: Error) => {
          logger.error('HTTP server error', { error });
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Start HTTPS server
   */
  public async startHttpsServer(port: number = 443): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Get all domains that need HTTPS
        const domains = Array.from(this.siteProxies.keys());

        if (domains.length === 0) {
          logger.warn('No sites configured, HTTPS server not started');
          resolve();
          return;
        }

        // Get or create SSL certificates
        this.httpsManager.getCertificates(domains)
          .then((certs) => {
            const httpsOptions = {
              key: certs.key,
              cert: certs.cert,
              ca: certs.ca
            };

            this.httpsServer = https.createServer(httpsOptions, this.app);

            this.httpsServer.listen(port, () => {
              logger.info(`HTTPS server listening on port ${port}`);
              resolve();
            });

            this.httpsServer.on('error', (error: Error) => {
              logger.error('HTTPS server error', { error });
              reject(error);
            });
          })
          .catch((error) => {
            logger.error('Failed to get SSL certificates', { error });
            reject(error);
          });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop all servers
   */
  public async stop(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    if (this.httpServer) {
      stopPromises.push(
        new Promise((resolve) => {
          this.httpServer!.close(() => {
            logger.info('HTTP server stopped');
            resolve();
          });
        })
      );
    }

    if (this.httpsServer) {
      stopPromises.push(
        new Promise((resolve) => {
          this.httpsServer!.close(() => {
            logger.info('HTTPS server stopped');
            resolve();
          });
        })
      );
    }

    await Promise.all(stopPromises);
    logger.info('All servers stopped');
  }

  /**
   * Get Express app (for mounting API routes)
   */
  public getApp(): Express {
    return this.app;
  }

  /**
   * Get HTTP server instance (for Socket.IO)
   */
  public getHttpServer(): http.Server | null {
    return this.httpServer;
  }
}
