/**
 * Data Pipeline API Routes
 *
 * Provides endpoints for health checks and data pipeline verification.
 * Ensures all components are working correctly.
 */

import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { sendError, sendSuccess } from '../../core/http/api-response';
import { pipelineDiagnosticsService } from '../../modules/pipeline/pipeline-diagnostics.service';
import logger from '../../utils/logger';

const router = Router();

// All pipeline routes require authentication
router.use(authenticate);

/**
 * GET /api/pipeline/health
 * Get health status of all pipeline components
 */
router.get('/health', (req: AuthenticatedRequest, res: Response) => {
  try {
    return sendSuccess(res, pipelineDiagnosticsService.getHealthStatus());
  } catch (error: any) {
    logger.error('Failed to check pipeline health', { error: error.message });
    return sendError(res, 500, {
      code: 'INTERNAL_ERROR',
      message: 'backend.internal_server_error'
    });
  }
});

/**
 * GET /api/pipeline/verify
 * Verify data pipeline integrity
 */
router.get('/verify', (req: AuthenticatedRequest, res: Response) => {
  try {
    const verifications = pipelineDiagnosticsService.verifyDataPipeline();

    // Calculate overall status
    const hasFail = verifications.some(v => v.status === 'fail');
    const allSkip = verifications.every(v => v.status === 'skip');

    let overallStatus: 'pass' | 'fail' | 'skip' = 'pass';
    if (hasFail) {
      overallStatus = 'fail';
    } else if (allSkip) {
      overallStatus = 'skip';
    }

    return sendSuccess(res, {
      overall: overallStatus,
      verifications,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error('Failed to verify data pipeline', { error: error.message });
    return sendError(res, 500, {
      code: 'INTERNAL_ERROR',
      message: 'backend.internal_server_error'
    });
  }
});

export default router;
