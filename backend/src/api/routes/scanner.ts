import { Router, Request, Response } from 'express';
import { OptimizationEngine } from '../../scanner/optimization-engine';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import logger from '../../utils/logger';

const router = Router();
const optimizationEngine = new OptimizationEngine();

/**
 * POST /api/scanner/run
 * Run server scan - SECURITY FIX: Requires admin authentication
 */
router.post('/run', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const options = req.body.options || {};

    logger.info('Starting server scan...');

    const result = await optimizationEngine.runFullScan(options);

    // Save scan result to database
    const db = require('../../config/database').getDatabase();
    const stmt = db.getDb().prepare(`
      INSERT INTO scan_results (siteId, scanType, result, recommendations, status)
      VALUES (NULL, 'all', ?, ?, 'completed')
    `);

    const resultId = stmt.run(
      JSON.stringify(result.systemInfo),
      JSON.stringify(result.recommendations)
    ).lastInsertRowid;

    res.json({
      success: true,
      data: {
        id: resultId,
        ...result
      }
    });
  } catch (error: any) {
    logger.error('Scan failed', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/scanner/apply
 * Apply an optimization - SECURITY FIX: Requires admin authentication
 */
router.post('/apply', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { recommendation } = req.body;

    if (!recommendation) {
      return res.status(400).json({ success: false, error: 'recommendation is required' });
    }

    logger.info(`Applying optimization: ${recommendation.title}`);

    const result = await optimizationEngine.applyOptimization(recommendation);

    res.json(result);
  } catch (error: any) {
    logger.error('Failed to apply optimization', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/scanner/results/:id
 * Get scan result by ID - SECURITY FIX: Requires authentication
 */
router.get('/results/:id', authenticate, async (req: Request, res: Response) => {
  try {
    // SECURITY FIX: Validate ID parameter
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid ID format' });
    }

    const db = require('../../config/database').getDatabase();
    const result = db.getDb().prepare('SELECT * FROM scan_results WHERE id = ?').get(id);

    if (!result) {
      return res.status(404).json({ success: false, error: 'Scan result not found' });
    }

    res.json({
      success: true,
      data: {
        ...result,
        result: JSON.parse(result.result),
        recommendations: JSON.parse(result.recommendations)
      }
    });
  } catch (error: any) {
    logger.error('Failed to get scan result', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/scanner/report/:id
 * Generate scan report - SECURITY FIX: Requires authentication
 */
router.get('/report/:id', authenticate, async (req: Request, res: Response) => {
  try {
    // SECURITY FIX: Validate ID parameter
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid ID format' });
    }

    const db = require('../../config/database').getDatabase();
    const result = db.getDb().prepare('SELECT * FROM scan_results WHERE id = ?').get(id);

    if (!result) {
      return res.status(404).json({ success: false, error: 'Scan result not found' });
    }

    const systemInfo = JSON.parse(result.result);
    const recommendations = JSON.parse(result.recommendations);

    const report = optimizationEngine.generateReport(systemInfo, recommendations);

    res.set('Content-Type', 'text/plain');
    res.send(report);
  } catch (error: any) {
    logger.error('Failed to generate report', { error });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
