import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { getDatabase } from '../../config/database';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import auditLogger from '../../security/audit-logger.service';
import { tenantOversightService } from '../../services/tenant-oversight.service';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';

const router = Router();

const logAdminOversight = async (
    req: AuthenticatedRequest,
    action: string,
    details: Record<string, any>,
    tenantId?: string | null
) => {
    await auditLogger.log({
        tenantId: tenantId || undefined,
        eventType: action,
        category: 'system',
        severity: 'info',
        actor: {
            type: 'user',
            id: req.user?.userId || 'unknown',
            email: req.user?.email,
            ip: req.ip
        },
        action,
        details,
        status: 'success'
    });
};

const getAuditLogsForView = async (filter: Parameters<typeof auditLogger.getLogs>[0]) => {
    const auditLoggerWithViews = auditLogger as typeof auditLogger & {
        getLogsView?: (filter: Parameters<typeof auditLogger.getLogs>[0]) => Promise<ReturnType<typeof auditLogger.getLogs>>;
    };
    if (typeof auditLoggerWithViews.getLogsView === 'function') {
        return await auditLoggerWithViews.getLogsView(filter);
    }
    return auditLogger.getLogs(filter);
};

const verifyAuditLogForView = async (logId: string) => {
    const auditLoggerWithViews = auditLogger as typeof auditLogger & {
        verifyIntegrityView?: (logId: string) => Promise<boolean>;
    };
    if (typeof auditLoggerWithViews.verifyIntegrityView === 'function') {
        return await auditLoggerWithViews.verifyIntegrityView(logId);
    }
    return auditLogger.verifyIntegrity(logId);
};

const oversightViews = tenantOversightService as typeof tenantOversightService & {
    listTenantsView?: () => Promise<any[]>;
    getTenantSummaryView?: (tenantId: string, userId?: string) => Promise<any>;
    listTimelineView?: (filters: any) => Promise<any[]>;
    listEvidenceView?: (filters: any) => Promise<any[]>;
    getEventDetailView?: (tenantId: string, eventId: string) => Promise<any>;
    getUserTimelineView?: (userId: string, extra?: any) => Promise<any[]>;
    createExportView?: (input: any) => Promise<any>;
    listExportsView?: (tenantId: string) => Promise<any[]>;
    getExportView?: (exportId: string) => Promise<any>;
};

const listApiKeysView = async () => {
    if (postgresShadowStoreService.canServeReads()) {
        return await postgresShadowStoreService.queryAll<any>(`
            SELECT id, name, created_at, last_used
            FROM api_keys
            ORDER BY created_at DESC
            LIMIT 200
        `);
    }
    return getDatabase().prepare(`
        SELECT id, name, created_at, last_used
        FROM api_keys
        ORDER BY created_at DESC
        LIMIT 200
    `).all() as any[];
};

const persistApiKey = async (row: Record<string, any>) => {
    if (postgresShadowStoreService.canServeReads()) {
        await postgresShadowStoreService.execute(`
            INSERT INTO api_keys (id, name, key_hash, user_id, tenant_id, permissions, last_used, expires_at, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (id)
            DO UPDATE SET
              name = EXCLUDED.name,
              key_hash = EXCLUDED.key_hash,
              user_id = EXCLUDED.user_id,
              tenant_id = EXCLUDED.tenant_id,
              permissions = EXCLUDED.permissions,
              last_used = EXCLUDED.last_used,
              expires_at = EXCLUDED.expires_at,
              created_at = EXCLUDED.created_at
        `, [
            row.id, row.name, row.key_hash, row.user_id, row.tenant_id, row.permissions,
            row.last_used || null, row.expires_at || null, row.created_at
        ]);
    }

    getDatabase().prepare(`
        INSERT OR REPLACE INTO api_keys (id, name, key_hash, user_id, tenant_id, permissions, last_used, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        row.id, row.name, row.key_hash, row.user_id, row.tenant_id, row.permissions,
        row.last_used || null, row.expires_at || null, row.created_at
    );

    if (!postgresShadowStoreService.canServeReads()) {
        void postgresShadowStoreService.upsert('api_keys', row);
    }
};

const deleteApiKeyRecord = async (id: string) => {
    if (postgresShadowStoreService.canServeReads()) {
        await postgresShadowStoreService.execute('DELETE FROM api_keys WHERE id = $1', [id]);
    }
    getDatabase().prepare('DELETE FROM api_keys WHERE id = ?').run(id);
};

const listUsersView = async () => {
    if (postgresShadowStoreService.canServeReads()) {
        return await postgresShadowStoreService.queryAll<any>(`
            SELECT id, email, username, role, plan, tenant_id, status, last_login, created_at
            FROM users
            ORDER BY created_at DESC
        `);
    }
    return getDatabase().prepare(`
        SELECT id, email, username, role, plan, tenant_id, status, last_login, created_at
        FROM users
        ORDER BY created_at DESC
    `).all() as any[];
};

const getUserForAdminView = async (id: string) => {
    if (postgresShadowStoreService.canServeReads()) {
        return await postgresShadowStoreService.queryOne<any>(`
            SELECT id, email, username, role, plan, tenant_id, status, last_login, created_at, updated_at
            FROM users
            WHERE id = $1
            LIMIT 1
        `, [id]);
    }
    return getDatabase().prepare(`
        SELECT id, email, username, role, plan, tenant_id, status, last_login, created_at, updated_at
        FROM users
        WHERE id = ?
        LIMIT 1
    `).get(id) as any;
};

const updateUserAdminField = async (id: string, field: 'plan' | 'role' | 'status', value: string) => {
    if (postgresShadowStoreService.canServeReads()) {
        await postgresShadowStoreService.execute(`
            UPDATE users
            SET "${field}" = $1, updated_at = $2
            WHERE id = $3
        `, [value, new Date().toISOString(), id]);
    }
    getDatabase().prepare(`UPDATE users SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`).run(value, id);
};

// SECURITY FIX: All admin routes now require authentication and admin role
router.get('/errors', authenticate, requireRole('admin'), AdminController.getErrors);
router.get('/performance', authenticate, requireRole('admin'), AdminController.getPerformance);
router.post('/logs', authenticate, requireRole('admin'), AdminController.submitLogs);

router.get('/audit/logs', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { tenantId, category, actorId, targetId, status, from, to, page, limit } = req.query;
        const filter = {
            tenantId: tenantId ? String(tenantId) : undefined,
            category: category ? String(category) : undefined,
            actorId: actorId ? String(actorId) : undefined,
            targetId: targetId ? String(targetId) : undefined,
            status: status ? String(status) : undefined,
            from: from ? String(from) : undefined,
            to: to ? String(to) : undefined,
            page: page ? Number(page) : 1,
            limit: limit ? Number(limit) : 100
        };
        const logs = await getAuditLogsForView(filter);
        await logAdminOversight(req, 'oversight_view_audit_logs', {
            resultCount: logs.length,
            filters: filter
        }, tenantId ? String(tenantId) : undefined);
        res.json({ success: true, logs });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_get_audit_logs' });
    }
});

router.get('/audit/verify/:logId', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const valid = await verifyAuditLogForView(req.params.logId);
        await logAdminOversight(req, 'oversight_verify_audit_log', {
            logId: req.params.logId,
            valid
        });
        res.json({ success: true, valid });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_verify_audit_log' });
    }
});

router.get('/tenant-oversight/tenants', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const tenants = typeof oversightViews.listTenantsView === 'function'
            ? await oversightViews.listTenantsView()
            : tenantOversightService.listTenants();
        await logAdminOversight(req, 'oversight_list_tenants', { resultCount: tenants.length });
        res.json({ success: true, tenants });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_list_tenants' });
    }
});

router.get('/tenant-oversight/tenants/:tenantId/summary', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const userId = req.query.userId ? String(req.query.userId) : undefined;
        const data = typeof oversightViews.getTenantSummaryView === 'function'
            ? await oversightViews.getTenantSummaryView(req.params.tenantId, userId)
            : tenantOversightService.getTenantSummary(req.params.tenantId, userId);
        await logAdminOversight(req, 'oversight_view_summary', {
            tenantId: req.params.tenantId,
            userId: req.query.userId || null
        }, req.params.tenantId);
        res.json({ success: true, data });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_get_tenant_summary' });
    }
});

router.get('/tenant-oversight/tenants/:tenantId/timeline', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const filters = {
            tenantId: req.params.tenantId,
            userId: req.query.userId ? String(req.query.userId) : undefined,
            category: req.query.category ? String(req.query.category) : undefined,
            from: req.query.from ? String(req.query.from) : undefined,
            to: req.query.to ? String(req.query.to) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : 100
        };
        const data = typeof oversightViews.listTimelineView === 'function'
            ? await oversightViews.listTimelineView(filters)
            : tenantOversightService.listTimeline(filters);
        await logAdminOversight(req, 'oversight_view_timeline', {
            tenantId: req.params.tenantId,
            filters,
            resultCount: data.length
        }, req.params.tenantId);
        res.json({ success: true, data });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_get_tenant_timeline' });
    }
});

router.get('/tenant-oversight/tenants/:tenantId/evidence', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const filters = {
            tenantId: req.params.tenantId,
            userId: req.query.userId ? String(req.query.userId) : undefined,
            category: req.query.category ? String(req.query.category) : undefined,
            from: req.query.from ? String(req.query.from) : undefined,
            to: req.query.to ? String(req.query.to) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : 100
        };
        const data = typeof oversightViews.listEvidenceView === 'function'
            ? await oversightViews.listEvidenceView(filters)
            : tenantOversightService.listEvidence(filters);
        await logAdminOversight(req, 'oversight_view_evidence', {
            tenantId: req.params.tenantId,
            filters,
            resultCount: data.length
        }, req.params.tenantId);
        res.json({ success: true, data });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_get_tenant_evidence' });
    }
});

router.get('/tenant-oversight/tenants/:tenantId/events/:eventId', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const data = typeof oversightViews.getEventDetailView === 'function'
            ? await oversightViews.getEventDetailView(req.params.tenantId, req.params.eventId)
            : tenantOversightService.getEventDetail(req.params.tenantId, req.params.eventId);
        if (!data) {
            return res.status(404).json({ success: false, error: 'backend.event_not_found' });
        }
        await logAdminOversight(req, 'oversight_view_event_detail', {
            tenantId: req.params.tenantId,
            eventId: req.params.eventId
        }, req.params.tenantId);
        res.json({ success: true, data });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_get_event_detail' });
    }
});

router.get('/tenant-oversight/users/:userId/timeline', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const extra = {
            category: req.query.category ? String(req.query.category) : undefined,
            from: req.query.from ? String(req.query.from) : undefined,
            to: req.query.to ? String(req.query.to) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : 100
        };
        const data = typeof oversightViews.getUserTimelineView === 'function'
            ? await oversightViews.getUserTimelineView(req.params.userId, extra)
            : tenantOversightService.getUserTimeline(req.params.userId, extra);
        await logAdminOversight(req, 'oversight_view_user_timeline', {
            userId: req.params.userId,
            filters: extra,
            resultCount: data.length
        });
        res.json({ success: true, data });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_get_user_timeline' });
    }
});

router.post('/tenant-oversight/exports', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const tenantId = String(req.body?.tenantId || '');
        if (!tenantId) {
            return res.status(400).json({ success: false, error: 'backend.tenant_id_required' });
        }
        const payload = {
            tenantId,
            requestedBy: req.user?.email || req.user?.userId || 'unknown',
            filters: req.body?.filters || {}
        };
        const record = typeof oversightViews.createExportView === 'function'
            ? await oversightViews.createExportView(payload)
            : tenantOversightService.createExport(payload);
        await logAdminOversight(req, 'oversight_export_created', {
            tenantId,
            exportId: record?.id || null,
            filters: req.body?.filters || {}
        }, tenantId);
        res.status(201).json({ success: true, data: record });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_create_export' });
    }
});

router.get('/tenant-oversight/tenants/:tenantId/exports', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const data = typeof oversightViews.listExportsView === 'function'
            ? await oversightViews.listExportsView(req.params.tenantId)
            : tenantOversightService.listExports(req.params.tenantId);
        await logAdminOversight(req, 'oversight_list_exports', {
            tenantId: req.params.tenantId,
            resultCount: data.length
        }, req.params.tenantId);
        res.json({ success: true, data });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_list_exports' });
    }
});

router.get('/tenant-oversight/exports/:exportId', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const record = typeof oversightViews.getExportView === 'function'
            ? await oversightViews.getExportView(req.params.exportId)
            : tenantOversightService.getExport(req.params.exportId);
        if (!record) {
            return res.status(404).json({ success: false, error: 'backend.export_not_found' });
        }
        await logAdminOversight(req, 'oversight_view_export', {
            tenantId: record.tenantId,
            exportId: record.id
        }, record.tenantId);
        res.json({ success: true, data: record });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_get_export' });
    }
});

router.get('/api-keys', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const rows = await listApiKeysView();

        const keys = (rows || []).map((row: any) => ({
            id: row.id,
            name: row.name,
            prefix: `fgk_${String(row.id).slice(0, 6)}`,
            created: row.created_at,
            lastUsed: row.last_used || 'never'
        }));

        res.json({ success: true, keys });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: {
                code: 'FG-ADMIN-KEYS-LIST-500',
                message: error?.message || 'Failed to list API keys',
                timestamp: new Date().toISOString()
            }
        });
    }
});

router.post('/api-keys', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const userId = req.user?.userId;
        const tenantId = req.user?.tenantId || null;
        const name = String(req.body?.name || 'API Key').trim();

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'FG-AUTH-401',
                    message: 'backend.unauthorized',
                    timestamp: new Date().toISOString()
                }
            });
        }

        const id = uuidv4();
        const plaintext = `fgk_${crypto.randomBytes(24).toString('hex')}`;
        const keyHash = await bcrypt.hash(plaintext, 10);
        const createdAt = new Date().toISOString();

        await persistApiKey({
            id,
            name,
            key_hash: keyHash,
            user_id: userId,
            tenant_id: tenantId,
            permissions: '["read","write"]',
            last_used: null,
            expires_at: null,
            created_at: createdAt
        });

        await auditLogger.log({
            tenantId: tenantId || undefined,
            eventType: 'admin_api_key_created',
            category: 'system',
            severity: 'warning',
            actor: { type: 'user', id: userId, email: req.user?.email, ip: req.ip },
            action: 'create_admin_api_key',
            target: { type: 'user', id },
            details: { name, keyPrefix: plaintext.slice(0, 12) },
            status: 'success'
        });

        res.status(201).json({
            success: true,
            data: {
                id,
                name,
                prefix: plaintext.slice(0, 12),
                apiKey: plaintext,
                warning: 'The plaintext key is shown only once.'
            }
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: {
                code: 'FG-ADMIN-KEYS-CREATE-500',
                message: error?.message || 'Failed to create API key',
                timestamp: new Date().toISOString()
            }
        });
    }
});

router.delete('/api-keys/:id', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;
        await deleteApiKeyRecord(id);
        await auditLogger.log({
            tenantId: req.user?.tenantId,
            eventType: 'admin_api_key_deleted',
            category: 'system',
            severity: 'warning',
            actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: req.ip },
            action: 'delete_admin_api_key',
            target: { type: 'user', id },
            details: {},
            status: 'success'
        });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: {
                code: 'FG-ADMIN-KEYS-DELETE-500',
                message: error?.message || 'Failed to delete API key',
                timestamp: new Date().toISOString()
            }
        });
    }
});

router.get('/users', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const rows = await listUsersView();

        res.json({ success: true, users: rows });
    } catch (error: any) {
        res.status(500).json({ success: false, error: 'backend.failed_to_list_users' });
    }
});

router.put('/users/:id/plan', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;
        const { plan } = req.body;

        if (!['starter', 'pro', 'ultra'].includes(plan)) {
            return res.status(400).json({ success: false, error: 'backend.invalid_plan' });
        }

        const user = await getUserForAdminView(id);
        if (!user) {
            return res.status(404).json({ success: false, error: 'backend.user_not_found' });
        }
        await updateUserAdminField(id, 'plan', plan);
        await auditLogger.log({
            tenantId: user?.tenant_id || undefined,
            eventType: 'user_plan_updated',
            category: 'system',
            severity: 'warning',
            actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: req.ip },
            target: { type: 'user', id },
            action: 'update_user_plan',
            details: { plan, email: user?.email || null },
            status: 'success'
        });

        res.json({ success: true, message: 'backend.plan_updated' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: 'backend.failed_to_update_user_plan' });
    }
});

router.put('/users/:id/role', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!['admin', 'tenant', 'viewer'].includes(role)) {
            return res.status(400).json({ success: false, error: 'backend.invalid_role' });
        }

        const user = await getUserForAdminView(id);
        if (!user) {
            return res.status(404).json({ success: false, error: 'backend.user_not_found' });
        }
        await updateUserAdminField(id, 'role', role);
        await auditLogger.log({
            tenantId: user?.tenant_id || undefined,
            eventType: 'user_role_updated',
            category: 'system',
            severity: 'critical',
            actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: req.ip },
            target: { type: 'user', id },
            action: 'update_user_role',
            details: { role, email: user?.email || null },
            status: 'success'
        });

        res.json({ success: true, message: 'backend.role_updated' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: 'backend.failed_to_update_user_role' });
    }
});

router.put('/users/:id/status', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['active', 'suspended', 'pending'].includes(status)) {
            return res.status(400).json({ success: false, error: 'backend.invalid_status' });
        }

        const user = await getUserForAdminView(id);
        if (!user) {
            return res.status(404).json({ success: false, error: 'backend.user_not_found' });
        }
        await updateUserAdminField(id, 'status', status);
        await auditLogger.log({
            tenantId: user?.tenant_id || undefined,
            eventType: 'user_status_updated',
            category: 'system',
            severity: status === 'suspended' ? 'critical' : 'warning',
            actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: req.ip },
            target: { type: 'user', id },
            action: 'update_user_status',
            details: { status, email: user?.email || null },
            status: 'success'
        });

        res.json({ success: true, message: 'backend.status_updated' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: 'backend.failed_to_update_user_status' });
    }
});

export default router;
