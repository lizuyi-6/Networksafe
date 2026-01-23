import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { ProxyServer } from './proxy/proxy-server';
import { getDatabase } from './config/database';
import logger from './utils/logger';
import sitesRouter from './api/routes/sites';
import scannerRouter from './api/routes/scanner';

/**
 * NewSecurity Backend - Main Entry Point
 */

// Initialize services
const proxyServer = new ProxyServer();
const app = proxyServer.getApp(); // Use the Proxy's express app
const db = getDatabase();

let io: SocketIOServer; // Defer initialization

// Middleware
// Middleware
app.use(helmet());
app.use(compression());
app.use(cors());
// Note: express.json/urlencoded are already added by ProxyServer

// API Routes
const apiRouter = express.Router();

// Health check
apiRouter.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Mount API routes
apiRouter.use('/sites', sitesRouter);
apiRouter.use('/scanner', scannerRouter);

app.use('/api', apiRouter);

// WebSocket logic moved to start()


// Function to emit real-time events
export function emitEvent(event: string, data: any) {
  if (io) io.emit(event, data);
}

// Load sites from database and start proxy
async function initializeProxy() {
  try {
    const sites = db.getDb().prepare('SELECT * FROM sites').all();

    logger.info(`Loading ${sites.length} sites into proxy...`);

    for (const site of sites) {
      const siteConfig = {
        id: site.id,
        domain: site.domain,
        target: site.target,
        sslEnabled: Boolean(site.sslEnabled),
        security: {
          antiBot: Boolean(site.antiBotEnabled),
          rateLimit: {
            enabled: Boolean(site.rateLimitEnabled),
            requestsPerMinute: site.rateLimitRequests || 60
          },
          concurrency: {
            enabled: Boolean(site.concurrencyEnabled),
            maxConcurrent: site.concurrencyMax || 5
          }
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await proxyServer.addSite(siteConfig);
    }

    logger.info('Proxy initialized successfully');
  } catch (error: any) {
    logger.error('Failed to initialize proxy', { error });
  }
}

// Start servers
async function start() {
  const HTTP_PORT = process.env.HTTP_PORT || 8080;
  const HTTPS_PORT = process.env.HTTPS_PORT || 8443;

  try {
    // Initialize proxy with existing sites
    await initializeProxy();

    // Start HTTP server
    await proxyServer.startHttpServer(Number(HTTP_PORT));
    logger.info(`HTTP server listening on port ${HTTP_PORT}`);

    // Initialize Socket.IO with the running HTTP server
    const httpServer = proxyServer.getHttpServer();
    if (httpServer) {
      io = new SocketIOServer(httpServer, {
        cors: {
          origin: '*',
          methods: ['GET', 'POST']
        }
      });

      io.on('connection', (socket: any) => {
        logger.info(`Client connected: ${socket.id}`);
        socket.on('disconnect', () => {
          logger.info(`Client disconnected: ${socket.id}`);
        });
      });
      logger.info('Socket.IO initialized');
    }

    // Start HTTPS server if sites have SSL enabled
    await proxyServer.startHttpsServer(Number(HTTPS_PORT));

    logger.info('NewSecurity started successfully');
    logger.info('API available at: http://localhost:' + HTTP_PORT + '/api');
  } catch (error: any) {
    logger.error('Failed to start servers', { error });
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down...');

  try {
    await proxyServer.stop();
    await db.close();
    logger.info('Shutdown complete');
  } catch (error: any) {
    logger.error('Error during shutdown', { error });
  }

  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the application
start().catch((error) => {
  logger.error('Fatal error', { error });
  process.exit(1);
});

// Export app for testing
export default app;
