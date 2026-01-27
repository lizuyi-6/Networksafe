import { Router, Request, Response } from 'express';
import { getDatabase } from '../../config/database';
import logger from '../../utils/logger';

const router = Router();

/**
 * GET /api/sites
 * Get all sites
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDatabase().getDb();
    const sites = db.prepare('SELECT * FROM sites ORDER BY createdAt DESC').all();

    // Convert integer booleans
    const formattedSites = sites.map((site: any) => ({
      ...site,
      sslEnabled: Boolean(site.sslEnabled),
      antiBotEnabled: Boolean(site.antiBotEnabled),
      rateLimitEnabled: Boolean(site.rateLimitEnabled),
      concurrencyEnabled: Boolean(site.concurrencyEnabled)
    }));

    res.json({ success: true, data: formattedSites });
  } catch (error: any) {
    logger.error('Failed to get sites', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sites/:id
 * Get site by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDatabase().getDb();
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.id);

    if (!site) {
      return res.status(404).json({ success: false, error: 'Site not found' });
    }

    res.json({ success: true, data: site });
  } catch (error: any) {
    logger.error('Failed to get site', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/sites
 * Create new site
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { domain, target, sslEnabled = true, security } = req.body;

    if (!domain || !target) {
      return res.status(400).json({ success: false, error: 'domain and target are required' });
    }

    const db = getDatabase().getDb();

    const stmt = db.prepare(`
      INSERT INTO sites (
        domain, target, sslEnabled,
        antiBotEnabled, rateLimitEnabled, concurrencyEnabled,
        rateLimitRequests, concurrencyMax
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      domain,
      target,
      sslEnabled ? 1 : 0,
      security?.antiBot ? 1 : 0,
      security?.rateLimit?.enabled ? 1 : 0,
      security?.concurrency?.enabled ? 1 : 0,
      security?.rateLimit?.requestsPerMinute || 60,
      security?.concurrency?.maxConcurrent || 5
    );

    logger.info(`Site created: ${domain} -> ${target}`);

    res.json({
      success: true,
      data: { id: result.lastInsertRowid, domain, target }
    });
  } catch (error: any) {
    logger.error('Failed to create site', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/sites/:id
 * Update site
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { domain, target, sslEnabled, security } = req.body;

    const db = getDatabase().getDb();

    const stmt = db.prepare(`
      UPDATE sites SET
        domain = COALESCE(?, domain),
        target = COALESCE(?, target),
        sslEnabled = COALESCE(?, sslEnabled),
        antiBotEnabled = COALESCE(?, antiBotEnabled),
        rateLimitEnabled = COALESCE(?, rateLimitEnabled),
        concurrencyEnabled = COALESCE(?, concurrencyEnabled),
        rateLimitRequests = COALESCE(?, rateLimitRequests),
        concurrencyMax = COALESCE(?, concurrencyMax),
        updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(
      domain,
      target,
      sslEnabled !== undefined ? (sslEnabled ? 1 : 0) : null,
      security?.antiBot !== undefined ? (security.antiBot ? 1 : 0) : null,
      security?.rateLimit?.enabled !== undefined ? (security.rateLimit.enabled ? 1 : 0) : null,
      security?.concurrency?.enabled !== undefined ? (security.concurrency.enabled ? 1 : 0) : null,
      security?.rateLimit?.requestsPerMinute || null,
      security?.concurrency?.maxConcurrent || null,
      req.params.id
    );

    logger.info(`Site updated: ${req.params.id}`);

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to update site', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/sites/:id
 * Delete site
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDatabase().getDb();
    db.prepare('DELETE FROM sites WHERE id = ?').run(req.params.id);

    logger.info(`Site deleted: ${req.params.id}`);

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to delete site', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
