/**
 * Seed Data API Routes
 *
 * Provides endpoints for managing seed data in demo mode.
 * All operations are restricted to demo mode for safety.
 */

import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { SeedManager, SeedOptions, SeedStatus } from '../../database/seeds/seed-manager';
import logger from '../../utils/logger';

const router = Router();

// All seed routes require authentication and admin role
router.use(authenticate);
router.use(requireRole('admin'));

/**
 * GET /api/seed/status
 * Get current seed status
 */
router.get('/status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status: SeedStatus = SeedManager.status();

    res.json({
      success: true,
      data: status
    });
  } catch (error: any) {
    logger.error('Failed to get seed status', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'backend.internal_server_error'
    });
  }
});

/**
 * POST /api/seed/execute
 * Execute database seeding
 *
 * Request body:
 * - clearExisting: boolean - Clear existing data before seeding
 * - verbose: boolean - Enable verbose logging
 * - force: boolean - Force seeding in production mode (DANGEROUS)
 */
router.post('/execute', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { clearExisting = false, verbose = true, force = false } = req.body;

    const options: SeedOptions = {
      clearExisting,
      verbose,
      force
    };

    // Check if seeding is allowed
    if (!SeedManager.canSeed() && !force) {
      return res.status(403).json({
        success: false,
        error: 'backend.seeding_not_allowed_in_production_mode',
        message: 'Seeding is not allowed in production mode. Set APP_MODE=demo or use force=true.'
      });
    }

    // Execute seeding
    await SeedManager.seed(options);

    logger.info('Database seeding completed', {
      userId: req.user?.userId,
      options
    });

    res.json({
      success: true,
      message: 'backend.seeding_completed_successfully'
    });
  } catch (error: any) {
    logger.error('Failed to execute seeding', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'backend.seeding_failed',
      message: error.message
    });
  }
});

/**
 * DELETE /api/seed/clear
 * Clear all seed data
 *
 * Request body:
 * - force: boolean - Force clearing in production mode (DANGEROUS)
 * - verbose: boolean - Enable verbose logging
 */
router.delete('/clear', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { force = false, verbose = true } = req.body;

    const options: SeedOptions = {
      force,
      verbose
    };

    // Check if clearing is allowed
    if (!SeedManager.canSeed() && !force) {
      return res.status(403).json({
        success: false,
        error: 'backend.clearing_not_allowed_in_production_mode',
        message: 'Clearing is not allowed in production mode. Set APP_MODE=demo or use force=true.'
      });
    }

    // Execute clearing
    await SeedManager.clear(options);

    logger.info('Seed data cleared', {
      userId: req.user?.userId,
      options
    });

    res.json({
      success: true,
      message: 'backend.seed_data_cleared_successfully'
    });
  } catch (error: any) {
    logger.error('Failed to clear seed data', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'backend.clearing_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/seed/check
 * Check if database has been seeded
 */
router.get('/check', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const isSeeded = SeedManager.isSeeded();

    res.json({
      success: true,
      data: {
        isSeeded,
        canSeed: SeedManager.canSeed()
      }
    });
  } catch (error: any) {
    logger.error('Failed to check seed status', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'backend.internal_server_error'
    });
  }
});

export default router;
