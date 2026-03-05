/**
 * Agent Management API Routes
 * SECURE FIX: Admin API for registering and managing agents
 */

import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import agentAuthService from '../../security/agent-auth.service';
import auditLogger from '../../security/audit-logger.service';
import logger from '../../utils/logger';

const router = Router();

/**
 * GET /api/admin/agents
 * List all registered agents
 * SECURITY: Admin only
 */
router.get('/', authenticate, requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const agents = agentAuthService.listAgents();

    auditLogger.log({
      eventType: 'agents_listed',
      category: 'agent',
      severity: 'info',
      actor: { type: 'user', id: req.user!.userId },
      action: 'list_agents',
      details: { count: agents.length },
      status: 'success'
    });

    res.json({
      success: true,
      agents
    });
  } catch (error: any) {
    logger.error('Failed to list agents', { error });
    res.status(500).json({
      success: false,
      error: 'backend.failed_to_list_agents'
    });
  }
});

/**
 * POST /api/admin/agents/register
 * Register a new agent (server generates credentials)
 * SECURITY: Admin only
 */
router.post('/register', authenticate, requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { hostname, platform, mac, tenantId } = req.body;

    // Validate input
    if (!hostname || !platform) {
      return res.status(400).json({
        success: false,
        error: 'backend.hostname_and_platform_are_required'
      });
    }

    // Register agent (server generates unique ID and credentials)
    const registration = agentAuthService.registerAgent({
      hostname,
      platform,
      mac,
      tenantId
    });

    auditLogger.log({
      eventType: 'agent_registered',
      category: 'agent',
      severity: 'info',
      actor: { type: 'user', id: req.user!.userId },
      action: 'register_agent',
      target: { type: 'agent', id: registration.agentId },
      details: { hostname, platform },
      status: 'success'
    });

    logger.info(`Agent registered by ${req.user!.email}`, {
      agentId: registration.agentId,
      hostname
    });

    res.status(201).json({
      success: true,
      agent: {
        agentId: registration.agentId,
        hostname: registration.hostname,
        platform: registration.platform,
        status: registration.status,
        createdAt: registration.createdAt
      },
      credentials: {
        apiKey: registration.apiKey,
        secretKey: registration.secretKey
      },
      // IMPORTANT: These credentials are only shown once!
      warning: 'Save these credentials securely. They will not be shown again.'
    });
  } catch (error: any) {
    logger.error('Failed to register agent', { error });
    res.status(500).json({
      success: false,
      error: 'backend.failed_to_register_agent'
    });
  }
});

/**
 * DELETE /api/admin/agents/:agentId
 * Revoke an agent's credentials
 * SECURITY: Admin only
 */
router.delete('/:agentId', authenticate, requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;

    const success = agentAuthService.revokeAgent(agentId);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'backend.agent_not_found'
      });
    }

    auditLogger.log({
      eventType: 'agent_revoked',
      category: 'agent',
      severity: 'warning',
      actor: { type: 'user', id: req.user!.userId },
      action: 'revoke_agent',
      target: { type: 'agent', id: agentId },
      details: {},
      status: 'success'
    });

    logger.warn(`Agent revoked by ${req.user!.email}`, { agentId });

    res.json({
      success: true,
      message: 'backend.agent_revoked_successfully'
    });
  } catch (error: any) {
    logger.error('Failed to revoke agent', { error });
    res.status(500).json({
      success: false,
      error: 'backend.failed_to_revoke_agent'
    });
  }
});

/**
 * GET /api/admin/audit/logs
 * Get audit logs
 * SECURITY: Admin only
 */
router.get('/audit/logs', authenticate, requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { category, actorId, targetId, limit } = req.query;

    const logs = auditLogger.getLogs({
      category: category as string,
      actorId: actorId as string,
      targetId: targetId as string,
      limit: limit ? parseInt(limit as string) : 100
    });

    res.json({
      success: true,
      logs
    });
  } catch (error: any) {
    logger.error('Failed to get audit logs', { error });
    res.status(500).json({
      success: false,
      error: 'backend.failed_to_get_audit_logs'
    });
  }
});

/**
 * GET /api/admin/audit/verify/:logId
 * Verify audit log integrity
 * SECURITY: Admin only
 */
router.get('/audit/verify/:logId', authenticate, requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { logId } = req.params;
    const isValid = auditLogger.verifyIntegrity(logId);

    res.json({
      success: true,
      valid: isValid
    });
  } catch (error: any) {
    logger.error('Failed to verify audit log', { error });
    res.status(500).json({
      success: false,
      error: 'backend.failed_to_verify_audit_log'
    });
  }
});

export default router;
