/**
 * Seed Data API Routes
 *
 * Provides endpoints for managing seed data in demo mode.
 * All operations are restricted to demo mode for safety.
 */

import { Router, Response } from 'express';
import crypto from 'crypto';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { SeedManager, SeedOptions, SeedStatus } from '../../database/seeds/seed-manager';
import logger from '../../utils/logger';

/**
 * In-memory store for pending seed force confirmations.
 * Each entry holds the expiry timestamp, the requesting user's ID, and their IP address.
 * TTL is 60 seconds (enforced at lookup time).
 */
const pendingConfirmations = new Map<string, { expiresAt: number; userId: string; ip: string }>();

/**
 * Generate a cryptographically random confirmation token.
 * Returns a 32-character hex string (16 random bytes).
 */
function generateConfirmToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

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
 *
 * SECURITY FIX (audit 2026-08): the force escape hatch is removed — this
 * endpoint refuses in production mode unconditionally (demo mode only).
 */
router.post('/execute', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { clearExisting = false, verbose = true } = req.body;

    const options: SeedOptions = {
      clearExisting,
      verbose
    };

    // Check if seeding is allowed — no force override.
    if (!SeedManager.canSeed()) {
      return res.status(403).json({
        success: false,
        error: 'backend.seeding_not_allowed_in_production_mode',
        message: 'Seeding is not allowed in production mode. Set APP_MODE=demo.'
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
 * POST /api/seed/clear-confirm
 * Issue a single-use confirmation token for DELETE /api/seed/clear.
 * Token is valid for 60 seconds and bound to the requesting user.
 *
 * SECURITY FIX (audit 2026-08): clearing used to be gated only by the admin
 * role plus a force flag that bypassed the production check entirely. It now
 * requires a fresh confirmation token in addition to demo mode.
 */
router.post('/clear-confirm', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!SeedManager.canSeed()) {
      return res.status(403).json({
        success: false,
        error: 'backend.clearing_not_allowed_in_production_mode',
        message: 'Clearing is not allowed in production mode.'
      });
    }

    const token = generateConfirmToken();
    const userId = req.user?.userId || 'unknown';
    const ip = req.ip || 'unknown';
    pendingConfirmations.set(token, {
      expiresAt: Date.now() + 60_000,
      userId,
      ip
    });

    // Opportunistic cleanup of expired tokens.
    const now = Date.now();
    for (const [key, entry] of pendingConfirmations) {
      if (now > entry.expiresAt) {
        pendingConfirmations.delete(key);
      }
    }

    res.status(201).json({
      success: true,
      data: { confirmationToken: token, expiresIn: 60 }
    });
  } catch (error: any) {
    logger.error('Failed to issue clear confirmation', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'backend.clear_confirmation_failed',
      message: error.message
    });
  }
});

/**
 * DELETE /api/seed/clear
 * Clear all seed data.
 *
 * Request body:
 * - confirmationToken: string - REQUIRED single-use token from
 *   POST /api/seed/clear-confirm (60s TTL, bound to the requesting user)
 * - verbose: boolean - Enable verbose logging
 *
 * SECURITY FIX (audit 2026-08): production mode always refuses (the force
 * escape hatch is removed) and even demo mode requires the confirmation
 * token above.
 */
router.delete('/clear', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { confirmationToken, verbose = true } = req.body;

    // Single-use confirmation token, bound to the requesting user.
    const token = typeof confirmationToken === 'string' ? confirmationToken.trim() : '';
    const pending = token ? pendingConfirmations.get(token) : undefined;
    if (!pending || Date.now() > pending.expiresAt || pending.userId !== (req.user?.userId || 'unknown')) {
      if (pending) {
        pendingConfirmations.delete(token);
      }
      return res.status(403).json({
        success: false,
        error: 'backend.clear_confirmation_required',
        message: 'Clearing requires a fresh confirmation token from POST /api/seed/clear-confirm.'
      });
    }
    pendingConfirmations.delete(token); // consume — single use

    // No force override: production always refuses.
    if (!SeedManager.canSeed()) {
      return res.status(403).json({
        success: false,
        error: 'backend.clearing_not_allowed_in_production_mode',
        message: 'Clearing is not allowed in production mode.'
      });
    }

    // Execute clearing
    await SeedManager.clear({ verbose });

    logger.info('Seed data cleared', {
      userId: req.user?.userId
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
