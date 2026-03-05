import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';

export const PLAN_LIMITS = {
    starter: { sites: 1, agents: 1 },
    pro: { sites: 5, agents: 5 },
    ultra: { sites: -1, agents: -1 } // -1 means unlimited
};

type PlanType = keyof typeof PLAN_LIMITS;

export function requirePlanQuota(resourceType: 'site' | 'agent') {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ error: 'backend.authentication_required' });
            return;
        }

        // Admins automatically bypass plan constraints
        if (req.user.role === 'admin') {
            next();
            return;
        }

        const plan = (req.user.plan || 'starter') as PlanType;
        const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;

        // Unlimited threshold
        if (resourceType === 'site' && limits.sites === -1) {
            next();
            return;
        }
        if (resourceType === 'agent' && limits.agents === -1) {
            next();
            return;
        }

        try {
            const db = getDatabase();
            const tenantId = req.user.tenantId;

            if (resourceType === 'site') {
                const row = db.prepare('SELECT COUNT(*) as count FROM sites WHERE tenant_id = ?').get(tenantId) as { count: number };
                if (row.count >= limits.sites) {
                    res.status(403).json({
                        error: `Plan quota exceeded. Your ${plan} plan allows up to ${limits.sites} site(s). Please upgrade to add more.`,
                        code: 'PLAN_QUOTA_EXCEEDED',
                        plan
                    });
                    return;
                }
            } else if (resourceType === 'agent') {
                // Count how many codes have been issued (active + used) to prevent hoarding constraints
                const row = db.prepare(`
                    SELECT COUNT(*) as count FROM agent_onboarding_codes 
                    WHERE tenant_id = ? AND status IN ('active', 'used')
                `).get(tenantId) as { count: number };

                if (row.count >= limits.agents) {
                    res.status(403).json({
                        error: `Plan quota exceeded. Your ${plan} plan allows up to ${limits.agents} agent(s). Please upgrade to add more.`,
                        code: 'PLAN_QUOTA_EXCEEDED',
                        plan
                    });
                    return;
                }
            }

            next();
        } catch (error: any) {
            logger.error('Quota checking failed', { error: error.message });
            res.status(500).json({ error: 'backend.failed_to_verify_plan_quotas', code: 'INTERNAL_ERROR' });
        }
    };
}
