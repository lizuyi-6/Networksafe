import { Router } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { getDatabase } from '../../config/database';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';
import auditLogger from '../../security/audit-logger.service';

const router = Router();

function defaults() {
    return {
        antiBot: {
            enabled: true,
            requestThreshold: 100,
            fastRequestThreshold: 10,
            blockDuration: 3600,
        },
        rateLimit: {
            requestsPerMinute: 60,
            windowSeconds: 60,
        },
    };
}

function tenantOf(req: AuthenticatedRequest): string {
    return req.user?.tenantId || 'global';
}

function ensureSchema(): void {
    const db = getDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_config (
        tenant_id TEXT PRIMARY KEY,
        anti_bot_enabled INTEGER NOT NULL DEFAULT 1,
        anti_bot_request_threshold INTEGER NOT NULL DEFAULT 100,
        anti_bot_fast_request_threshold INTEGER NOT NULL DEFAULT 10,
        anti_bot_block_duration INTEGER NOT NULL DEFAULT 3600,
        rate_limit_requests_per_minute INTEGER NOT NULL DEFAULT 60,
        rate_limit_window_seconds INTEGER NOT NULL DEFAULT 60,
        updated_by TEXT,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
}

router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
    try {
        ensureSchema();
        const tenantId = tenantOf(req);
        const row = postgresShadowStoreService.canServeReads()
            ? await postgresShadowStoreService.queryOne<any>(`
                SELECT *
                FROM platform_config
                WHERE tenant_id = $1
                LIMIT 1
            `, [tenantId])
            : getDatabase().prepare(`
                SELECT *
                FROM platform_config
                WHERE tenant_id = ?
                LIMIT 1
            `).get(tenantId) as any;

        if (!row) {
            return res.json(defaults());
        }

        res.json({
            antiBot: {
                enabled: Boolean(row.anti_bot_enabled),
                requestThreshold: Number(row.anti_bot_request_threshold || 100),
                fastRequestThreshold: Number(row.anti_bot_fast_request_threshold || 10),
                blockDuration: Number(row.anti_bot_block_duration || 3600),
            },
            rateLimit: {
                requestsPerMinute: Number(row.rate_limit_requests_per_minute || 60),
                windowSeconds: Number(row.rate_limit_window_seconds || 60),
            },
        });
    } catch (error: any) {
        res.status(500).json({ error: error?.message || 'backend.failed_to_load_configuration' });
    }
});

router.post('/', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        ensureSchema();
        const tenantId = tenantOf(req);
        const antiBot = req.body?.antiBot || {};
        const rateLimit = req.body?.rateLimit || {};
        const payload = {
            tenant_id: tenantId,
            anti_bot_enabled: antiBot.enabled ? 1 : 0,
            anti_bot_request_threshold: Number(antiBot.requestThreshold || 100),
            anti_bot_fast_request_threshold: Number(antiBot.fastRequestThreshold || 10),
            anti_bot_block_duration: Number(antiBot.blockDuration || 3600),
            rate_limit_requests_per_minute: Number(rateLimit.requestsPerMinute || 60),
            rate_limit_window_seconds: Number(rateLimit.windowSeconds || 60),
            updated_by: req.user?.userId || 'unknown',
            updated_at: new Date().toISOString(),
            created_at: new Date().toISOString()
        };

        if (postgresShadowStoreService.canServeReads()) {
            await postgresShadowStoreService.execute(`
              INSERT INTO platform_config (
                tenant_id, anti_bot_enabled, anti_bot_request_threshold, anti_bot_fast_request_threshold,
                anti_bot_block_duration, rate_limit_requests_per_minute, rate_limit_window_seconds,
                updated_by, updated_at, created_at
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
              ON CONFLICT (tenant_id)
              DO UPDATE SET
                anti_bot_enabled = EXCLUDED.anti_bot_enabled,
                anti_bot_request_threshold = EXCLUDED.anti_bot_request_threshold,
                anti_bot_fast_request_threshold = EXCLUDED.anti_bot_fast_request_threshold,
                anti_bot_block_duration = EXCLUDED.anti_bot_block_duration,
                rate_limit_requests_per_minute = EXCLUDED.rate_limit_requests_per_minute,
                rate_limit_window_seconds = EXCLUDED.rate_limit_window_seconds,
                updated_by = EXCLUDED.updated_by,
                updated_at = EXCLUDED.updated_at
            `, [
                payload.tenant_id,
                payload.anti_bot_enabled,
                payload.anti_bot_request_threshold,
                payload.anti_bot_fast_request_threshold,
                payload.anti_bot_block_duration,
                payload.rate_limit_requests_per_minute,
                payload.rate_limit_window_seconds,
                payload.updated_by,
                payload.updated_at,
                payload.created_at
            ]);
        }

        getDatabase().prepare(`
          INSERT INTO platform_config (
            tenant_id, anti_bot_enabled, anti_bot_request_threshold, anti_bot_fast_request_threshold,
            anti_bot_block_duration, rate_limit_requests_per_minute, rate_limit_window_seconds,
            updated_by, updated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(tenant_id) DO UPDATE SET
            anti_bot_enabled = excluded.anti_bot_enabled,
            anti_bot_request_threshold = excluded.anti_bot_request_threshold,
            anti_bot_fast_request_threshold = excluded.anti_bot_fast_request_threshold,
            anti_bot_block_duration = excluded.anti_bot_block_duration,
            rate_limit_requests_per_minute = excluded.rate_limit_requests_per_minute,
            rate_limit_window_seconds = excluded.rate_limit_window_seconds,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
        `).run(
            payload.tenant_id,
            payload.anti_bot_enabled,
            payload.anti_bot_request_threshold,
            payload.anti_bot_fast_request_threshold,
            payload.anti_bot_block_duration,
            payload.rate_limit_requests_per_minute,
            payload.rate_limit_window_seconds,
            payload.updated_by,
            payload.updated_at,
            payload.created_at
        );

        if (!postgresShadowStoreService.canServeReads()) {
            void postgresShadowStoreService.upsert('platform_config', payload);
        }

        await auditLogger.log({
            tenantId,
            eventType: 'platform_config_updated',
            category: 'system',
            severity: 'warning',
            actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: req.ip },
            action: 'update_platform_config',
            target: { type: 'tenant', id: tenantId },
            details: {
                antiBotEnabled: Boolean(payload.anti_bot_enabled),
                rateLimitRequestsPerMinute: payload.rate_limit_requests_per_minute
            },
            status: 'success'
        });

        res.json({ success: true, message: 'backend.configuration_saved' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_save_configuration' });
    }
});

export default router;
