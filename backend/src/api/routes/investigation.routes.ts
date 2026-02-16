/**
 * Investigation Routes
 *
 * API endpoints for bug investigation agent team.
 */

import { Router } from 'express';
import { InvestigationController } from '../controllers/investigation.controller';
import { authenticateAgent } from '../../middleware/auth.middleware';
import { validateRequest } from '../../middleware/validation.middleware';

const router = Router();
const controller = new InvestigationController();

// All investigation routes require agent authentication
router.use(authenticateAgent);

/**
 * POST /api/investigation/start
 * Start a new bug investigation
 */
router.post(
  '/start',
  validateRequest({
    body: {
      type: 'object',
      required: ['title', 'description', 'severity', 'category'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        category: { type: 'string', enum: ['security', 'performance', 'functional', 'crash', 'memory', 'concurrency'] },
        reproductionSteps: { type: 'array', items: { type: 'string' } },
        environment: {
          type: 'object',
          properties: {
            os: { type: 'string' },
            runtime: { type: 'string' },
            version: { type: 'string' },
            region: { type: 'string' }
          }
        },
        reporter: { type: 'string' },
        logs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'string', format: 'date-time' },
              level: { type: 'string', enum: ['debug', 'info', 'warn', 'error', 'fatal'] },
              service: { type: 'string' },
              message: { type: 'string' },
              metadata: { type: 'object' },
              traceId: { type: 'string' }
            }
          }
        },
        traces: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              traceId: { type: 'string' },
              spanId: { type: 'string' },
              parentSpanId: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              duration: { type: 'number' },
              service: { type: 'string' },
              operation: { type: 'string' },
              tags: { type: 'object' },
              status: { type: 'string', enum: ['ok', 'error'] },
              error: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  stackTrace: { type: 'string' }
                }
              }
            }
          }
        },
        metrics: {
          type: 'object',
          properties: {
            cpu: {
              type: 'object',
              properties: {
                usage: { type: 'number' },
                loadAverage: { type: 'array', items: { type: 'number' } }
              }
            },
            memory: {
              type: 'object',
              properties: {
                used: { type: 'number' },
                total: { type: 'number' },
                percentage: { type: 'number' }
              }
            }
          }
        },
        codeContext: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
            lineNumber: { type: 'number' },
            function: { type: 'string' },
            codeSnippet: { type: 'string' }
          }
        }
      }
    }
  }),
  controller.startInvestigation
);

/**
 * GET /api/investigation/:investigationId/status
 * Get investigation status
 */
router.get(
  '/:investigationId/status',
  controller.getInvestigationStatus
);

/**
 * GET /api/investigation/:investigationId/result
 * Get investigation result
 */
router.get(
  '/:investigationId/result',
  controller.getInvestigationResult
);

/**
 * GET /api/investigation/active
 * Get all active investigations
 */
router.get(
  '/active',
  controller.getActiveInvestigations
);

/**
 * GET /api/investigation/capabilities
 * Get agent team capabilities
 */
router.get(
  '/capabilities',
  controller.getCapabilities
);

/**
 * POST /api/investigation/:investigationId/cancel
 * Cancel an investigation
 */
router.post(
  '/:investigationId/cancel',
  controller.cancelInvestigation
);

/**
 * GET /api/investigation/history
 * Get investigation history
 */
router.get(
  '/history',
  controller.getInvestigationHistory
);

export default router;
