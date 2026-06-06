import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { sendError, sendSuccess } from '../../core/http/api-response';
import { PLATFORM_TENANT_ID, resolveRequestTenantContext } from '../../core/tenant/tenant-context';
import auditLogger from '../../security/audit-logger.service';
import { tenantOversightService } from '../../services/tenant-oversight.service';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';
import { auditSegmentService } from '../../services/audit-segment.service';
import { benchmarkService } from '../../services/benchmark.service';
import { deviceControlService } from '../../services/device-control.service';
import { commandDispatcherService } from '../../services/command-dispatcher.service';
import { getDeviceById } from '../../services/device-registry.service';
import {
    deleteAdminApiKey,
    getAdminUserById,
    getLoginHistory,
    listAdminApiKeys,
    listAdminUsers,
    saveAdminApiKey,
    updateAdminUserField
} from '../../modules/admin/admin.repository';

const router = Router();

function resolveTenantOrPlatform(req: AuthenticatedRequest): string {
    return resolveRequestTenantContext(req, {
        allowAdminPlatformFallback: req.user?.role === 'admin'
    })?.tenantId || PLATFORM_TENANT_ID;
}

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

router.get('/audit/segments', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const tenantId = req.query.tenantId ? String(req.query.tenantId) : undefined;
        const limit = req.query.limit ? Number(req.query.limit) : 50;
        const segments = await auditSegmentService.listSegments({ tenantId, limit });
        await logAdminOversight(req, 'oversight_view_audit_segments', {
            tenantId: tenantId || null,
            resultCount: segments.length,
            limit
        }, tenantId);
        res.json({ success: true, segments });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_get_audit_segments' });
    }
});

router.post('/audit/archive', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const tenantId = req.body?.tenantId ? String(req.body.tenantId) : undefined;
        const before = req.body?.before ? String(req.body.before) : undefined;
        const maxSegments = req.body?.maxSegments ? Number(req.body.maxSegments) : undefined;
        const maxLogsPerSegment = req.body?.maxLogsPerSegment ? Number(req.body.maxLogsPerSegment) : undefined;
        const result = await auditSegmentService.archivePending({
            tenantId,
            before,
            maxSegments,
            maxLogsPerSegment
        });
        await logAdminOversight(req, 'oversight_archive_audit_segments', {
            tenantId: tenantId || null,
            before: before || null,
            archivedCount: result.archivedCount,
            maxSegments: maxSegments || null,
            maxLogsPerSegment: maxLogsPerSegment || null
        }, tenantId);
        res.json({ success: true, data: result });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_archive_audit_segments' });
    }
});

router.post('/audit/segments/:segmentId/verify', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const result = await auditSegmentService.verifySegment(req.params.segmentId);
        await logAdminOversight(req, 'oversight_verify_audit_segment', {
            segmentId: req.params.segmentId,
            valid: result.valid,
            chainValid: result.chainValid,
            contentValid: result.contentValid,
            linkageValid: result.linkageValid,
            objectLockValid: result.objectLockValid
        }, result.segment?.tenantId);
        res.json({ success: true, data: result });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error?.message || 'backend.failed_to_verify_audit_segment' });
    }
});

router.post('/benchmarks/run', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const tenantId = resolveTenantOrPlatform(req);
        const scenario = req.body?.scenario ? String(req.body.scenario) : 'full-suite';
        const profile = req.body?.profile ? String(req.body.profile) : 'dev-smoke';
        const run = await benchmarkService.runScenario(tenantId, scenario, profile);
        await logAdminOversight(req, 'oversight_run_benchmark', {
            benchmarkId: run.id,
            scenario: run.scenario,
            profile: run.profile
        }, tenantId);
        return sendSuccess(res, run, { legacy: { run } });
    } catch (error: any) {
        return sendError(res, 500, { code: 'BENCHMARK_RUN_FAILED', message: error?.message || 'backend.failed_to_run_benchmark' });
    }
});

router.get('/benchmarks/history', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const tenantId = resolveTenantOrPlatform(req);
        const limit = req.query.limit ? Number(req.query.limit) : 20;
        const runs = await benchmarkService.listHistory(tenantId, limit);
        return sendSuccess(res, runs, { legacy: { runs, count: runs.length } });
    } catch (error: any) {
        return sendError(res, 500, { code: 'BENCHMARK_LIST_FAILED', message: error?.message || 'backend.failed_to_list_benchmarks' });
    }
});

router.get('/benchmarks/:id/report', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const tenantId = resolveTenantOrPlatform(req);
        const run = await benchmarkService.getRun(tenantId, req.params.id);
        if (!run) {
            return sendError(res, 404, { code: 'BENCHMARK_NOT_FOUND', message: 'backend.benchmark_not_found' });
        }
        return sendSuccess(res, run, { legacy: { run } });
    } catch (error: any) {
        return sendError(res, 500, { code: 'BENCHMARK_REPORT_FAILED', message: error?.message || 'backend.failed_to_get_benchmark_report' });
    }
});

router.post('/devices/firmware', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const tenantId = resolveTenantOrPlatform(req);
        const fileName = String(req.body?.fileName || '').trim();
        const version = String(req.body?.version || '').trim();
        const channel = String(req.body?.channel || 'stable').trim();
        const contentBase64 = String(req.body?.contentBase64 || '').trim();
        const notes = req.body?.notes ? String(req.body.notes) : undefined;

        if (!fileName || !version || !contentBase64) {
            return sendError(res, 400, { code: 'INVALID_FIRMWARE_PAYLOAD', message: 'backend.invalid_firmware_payload' });
        }

        const firmware = await deviceControlService.uploadFirmware({
            tenantId,
            fileName,
            version,
            channel,
            contentBase64,
            notes,
            actorId: req.user?.userId || 'unknown',
            actorEmail: req.user?.email,
            actorIp: req.ip
        });

        return sendSuccess(res, firmware, { legacy: { firmware } });
    } catch (error: any) {
        return sendError(res, 500, { code: 'FIRMWARE_UPLOAD_FAILED', message: error?.message || 'backend.failed_to_upload_firmware' });
    }
});

router.post('/devices/:id/ota', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const device = getDeviceById(req.params.id);
        if (!device) {
            return sendError(res, 404, { code: 'DEVICE_NOT_FOUND', message: 'backend.device_not_found' });
        }

        const firmwareId = String(req.body?.firmwareId || '').trim();
        if (!firmwareId) {
            return sendError(res, 400, { code: 'FIRMWARE_ID_REQUIRED', message: 'backend.firmware_id_required' });
        }

        const firmware = deviceControlService.getFirmware(firmwareId);
        if (!firmware) {
            return sendError(res, 404, { code: 'FIRMWARE_NOT_FOUND', message: 'backend.firmware_not_found' });
        }

        const result = await commandDispatcherService.dispatchDeviceCommand({
            deviceId: req.params.id,
            commandType: 'ota_update',
            payload: {
                firmwareId: firmware.id,
                version: firmware.version,
                channel: firmware.channel,
                artifactRef: firmware.artifactRef,
                artifactLocation: firmware.artifactLocation,
                fileName: firmware.fileName
            },
            actor: {
                tenantId: resolveTenantOrPlatform(req),
                userId: req.user?.userId || 'unknown',
                email: req.user?.email,
                ip: req.ip
            }
        });

        if (!result.success && result.status === 'failed') {
            return sendError(res, result.reason === 'hardware_gate_unavailable' ? 503 : 400, {
                code: result.reason === 'hardware_gate_unavailable' ? 'HARDWARE_GATE_UNAVAILABLE' : 'OTA_TRIGGER_FAILED',
                message: result.message
            }, {
                legacy: { actionId: result.actionId, status: result.status, confirmationSessionId: result.confirmationSessionId || null }
            });
        }

        return sendSuccess(res, result, { legacy: { actionId: result.actionId, status: result.status, message: result.message } });
    } catch (error: any) {
        return sendError(res, 500, { code: 'OTA_TRIGGER_FAILED', message: error?.message || 'backend.failed_to_trigger_ota' });
    }
});

router.post('/devices/:id/confirm-required-action', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const device = getDeviceById(req.params.id);
        if (!device) {
            return sendError(res, 404, { code: 'DEVICE_NOT_FOUND', message: 'backend.device_not_found' });
        }

        const commandType = String(req.body?.commandType || 'reboot').trim();
        const result = await commandDispatcherService.dispatchDeviceCommand({
            deviceId: req.params.id,
            commandType,
            payload: req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {},
            actor: {
                tenantId: resolveTenantOrPlatform(req),
                userId: req.user?.userId || 'unknown',
                email: req.user?.email,
                ip: req.ip
            }
        });

        const statusCode = result.success ? 200 : result.reason === 'device_not_available' ? 404 : result.reason === 'hardware_gate_unavailable' ? 503 : 400;
        if (!result.success) {
            return sendError(res, statusCode, {
                code: String(result.reason || 'CONFIRMATION_SESSION_FAILED').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase(),
                message: result.message
            }, {
                legacy: { actionId: result.actionId, status: result.status, confirmationSessionId: result.confirmationSessionId || null }
            });
        }

        return sendSuccess(res, result, {
            legacy: {
                actionId: result.actionId,
                status: result.status,
                confirmationSessionId: result.confirmationSessionId || null,
                message: result.message
            }
        });
    } catch (error: any) {
        return sendError(res, 500, { code: 'CONFIRMATION_SESSION_FAILED', message: error?.message || 'backend.failed_to_create_confirmation_session' });
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
        const rows = await listAdminApiKeys();

        const keys = (rows || []).map((row: any) => ({
            id: row.id,
            name: row.name,
            prefix: `fgk_${String(row.id).slice(0, 6)}`,
            created: row.created_at,
            lastUsed: row.last_used || 'never'
        }));

        return sendSuccess(res, keys, { legacy: { keys } });
    } catch (error: any) {
        return sendError(res, 500, {
            code: 'FG-ADMIN-KEYS-LIST-500',
            message: error?.message || 'Failed to list API keys'
        });
    }
});

router.post('/api-keys', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const userId = req.user?.userId;
        const tenantId = req.user?.tenantId || null;
        const name = String(req.body?.name || 'API Key').trim();

        if (!userId) {
            return sendError(res, 401, {
                code: 'FG-AUTH-401',
                message: 'backend.unauthorized'
            });
        }

        const id = uuidv4();
        const plaintext = `fgk_${crypto.randomBytes(24).toString('hex')}`;
        const keyHash = await bcrypt.hash(plaintext, 10);
        const createdAt = new Date().toISOString();

        await saveAdminApiKey({
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

        return sendSuccess(res, {
            id,
            name,
            prefix: plaintext.slice(0, 12),
            apiKey: plaintext,
            warning: 'The plaintext key is shown only once.'
        }, undefined, 201);
    } catch (error: any) {
        return sendError(res, 500, {
            code: 'FG-ADMIN-KEYS-CREATE-500',
            message: error?.message || 'Failed to create API key'
        });
    }
});

router.delete('/api-keys/:id', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;
        await deleteAdminApiKey(id);
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
        return sendSuccess(res, { deleted: true }, { legacy: { status: 'ok' } });
    } catch (error: any) {
        return sendError(res, 500, {
            code: 'FG-ADMIN-KEYS-DELETE-500',
            message: error?.message || 'Failed to delete API key'
        });
    }
});

router.get('/users', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const rows = await listAdminUsers();
        return sendSuccess(res, rows, { legacy: { users: rows } });
    } catch (error: any) {
        return sendError(res, 500, { code: 'USER_LIST_FAILED', message: 'backend.failed_to_list_users' });
    }
});

router.put('/users/:id/plan', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;
        const { plan } = req.body;

        if (!['starter', 'pro', 'ultra'].includes(plan)) {
            return sendError(res, 400, { code: 'INVALID_PLAN', message: 'backend.invalid_plan' });
        }

        const user = await getAdminUserById(id);
        if (!user) {
            return sendError(res, 404, { code: 'USER_NOT_FOUND', message: 'backend.user_not_found' });
        }
        await updateAdminUserField(id, 'plan', plan);
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

        return sendSuccess(res, { userId: id, plan }, { legacy: { message: 'backend.plan_updated' } });
    } catch (error: any) {
        return sendError(res, 500, { code: 'USER_PLAN_UPDATE_FAILED', message: 'backend.failed_to_update_user_plan' });
    }
});

router.put('/users/:id/role', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!['admin', 'tenant', 'viewer'].includes(role)) {
            return sendError(res, 400, { code: 'INVALID_ROLE', message: 'backend.invalid_role' });
        }

        // SECURITY: Prevent admin from demoting themselves
        if (id === req.user?.userId) {
            return sendError(res, 403, { code: 'CANNOT_MODIFY_SELF_ROLE', message: 'backend.cannot_modify_self_role' });
        }

        const user = await getAdminUserById(id);
        if (!user) {
            return sendError(res, 404, { code: 'USER_NOT_FOUND', message: 'backend.user_not_found' });
        }

        // SECURITY: Prevent demoting the last admin
        if (user.role === 'admin' && role !== 'admin') {
            const allUsers = await listAdminUsers();
            const adminCount = allUsers.filter((u: any) => u.role === 'admin').length;
            if (adminCount <= 1) {
                return sendError(res, 403, { code: 'CANNOT_REMOVE_LAST_ADMIN', message: 'backend.cannot_remove_last_admin' });
            }
        }

        await updateAdminUserField(id, 'role', role);
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

        return sendSuccess(res, { userId: id, role }, { legacy: { message: 'backend.role_updated' } });
    } catch (error: any) {
        return sendError(res, 500, { code: 'USER_ROLE_UPDATE_FAILED', message: 'backend.failed_to_update_user_role' });
    }
});

router.put('/users/:id/status', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['active', 'suspended', 'pending'].includes(status)) {
            return sendError(res, 400, { code: 'INVALID_STATUS', message: 'backend.invalid_status' });
        }

        // SECURITY: Prevent admin from suspending themselves
        if (id === req.user?.userId) {
            return sendError(res, 403, { code: 'CANNOT_SUSPEND_SELF', message: 'backend.cannot_suspend_self' });
        }

        const user = await getAdminUserById(id);
        if (!user) {
            return sendError(res, 404, { code: 'USER_NOT_FOUND', message: 'backend.user_not_found' });
        }

        // SECURITY: Prevent suspending the last admin
        if (user.role === 'admin' && status === 'suspended') {
            const allUsers = await listAdminUsers();
            const activeAdminCount = allUsers.filter((u: any) => u.role === 'admin' && u.status === 'active').length;
            if (activeAdminCount <= 1) {
                return sendError(res, 403, { code: 'CANNOT_SUSPEND_LAST_ADMIN', message: 'backend.cannot_suspend_last_admin' });
            }
        }

        await updateAdminUserField(id, 'status', status);
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

        return sendSuccess(res, { userId: id, status }, { legacy: { message: 'backend.status_updated' } });
    } catch (error: any) {
        return sendError(res, 500, { code: 'USER_STATUS_UPDATE_FAILED', message: 'backend.failed_to_update_user_status' });
    }
});

// ============================================================
// Batch Operations
// ============================================================

router.post('/users/batch', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { userIds, action, value } = req.body;

        if (!Array.isArray(userIds) || userIds.length === 0) {
            return sendError(res, 400, { code: 'INVALID_USER_IDS', message: 'backend.invalid_user_ids' });
        }

        const validActions = ['suspend', 'activate', 'setPlan', 'setRole'];
        if (!validActions.includes(action)) {
            return sendError(res, 400, { code: 'INVALID_ACTION', message: 'backend.invalid_action' });
        }

        // SECURITY: Cannot batch operate on self
        if (userIds.includes(req.user?.userId)) {
            return sendError(res, 403, { code: 'CANNOT_BATCH_SELF', message: 'backend.cannot_batch_self' });
        }

        // Get all target users
        const allUsers = await listAdminUsers();
        const targetUsers = allUsers.filter((u: any) => userIds.includes(u.id));

        if (targetUsers.length === 0) {
            return sendError(res, 404, { code: 'USERS_NOT_FOUND', message: 'backend.users_not_found' });
        }

        // SECURITY: Cannot batch operate on admins
        const hasAdmin = targetUsers.some((u: any) => u.role === 'admin');
        if (hasAdmin) {
            return sendError(res, 403, { code: 'CANNOT_BATCH_ADMINS', message: 'backend.cannot_batch_admins' });
        }

        // Perform batch operation
        let updateField = '';
        let updateValue: any = value;

        switch (action) {
            case 'suspend':
                updateField = 'status';
                updateValue = 'suspended';
                break;
            case 'activate':
                updateField = 'status';
                updateValue = 'active';
                break;
            case 'setPlan':
                if (!['starter', 'pro', 'ultra'].includes(value)) {
                    return sendError(res, 400, { code: 'INVALID_PLAN', message: 'backend.invalid_plan' });
                }
                updateField = 'plan';
                break;
            case 'setRole':
                if (!['tenant', 'viewer'].includes(value)) {
                    return sendError(res, 400, { code: 'INVALID_ROLE', message: 'backend.invalid_role' });
                }
                updateField = 'role';
                break;
        }

        for (const user of targetUsers) {
            await updateAdminUserField(user.id, updateField as 'plan' | 'role' | 'status', updateValue);
        }

        await auditLogger.log({
            tenantId: undefined,
            eventType: 'users_batch_updated',
            category: 'system',
            severity: 'critical',
            actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: req.ip },
            action: 'batch_update_users',
            details: { action, value: updateValue, count: targetUsers.length, userIds },
            status: 'success'
        });

        return sendSuccess(res, { updated: targetUsers.length, action, value: updateValue });
    } catch (error: any) {
        return sendError(res, 500, { code: 'BATCH_UPDATE_FAILED', message: error?.message || 'backend.batch_update_failed' });
    }
});

// ============================================================
// User Detail & Login History
// ============================================================

router.get('/users/:id', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;
        const user = await getAdminUserById(id);
        if (!user) {
            return sendError(res, 404, { code: 'USER_NOT_FOUND', message: 'backend.user_not_found' });
        }
        return sendSuccess(res, user);
    } catch (error: any) {
        return sendError(res, 500, { code: 'USER_GET_FAILED', message: error?.message || 'backend.failed_to_get_user' });
    }
});

router.get('/users/:id/login-history', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;
        const limit = req.query.limit ? Number(req.query.limit) : 50;

        const history = await getLoginHistory(id, limit);

        return sendSuccess(res, history || []);
    } catch (error: any) {
        return sendError(res, 500, { code: 'LOGIN_HISTORY_FAILED', message: error?.message || 'backend.failed_to_get_login_history' });
    }
});

router.post('/users/:id/reset-password', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;

        // SECURITY: Cannot reset own password this way
        if (id === req.user?.userId) {
            return sendError(res, 403, { code: 'CANNOT_RESET_SELF', message: 'backend.cannot_reset_self_password' });
        }

        const user = await getAdminUserById(id);
        if (!user) {
            return sendError(res, 404, { code: 'USER_NOT_FOUND', message: 'backend.user_not_found' });
        }

        // Generate temporary password
        const tempPassword = crypto.randomBytes(12).toString('base64').slice(0, 16);
        const passwordHash = await bcrypt.hash(tempPassword, 10);

        // Update password
        await updateAdminUserField(id, 'password_hash', passwordHash);

        await auditLogger.log({
            tenantId: user?.tenant_id || undefined,
            eventType: 'user_password_reset',
            category: 'system',
            severity: 'critical',
            actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: req.ip },
            target: { type: 'user', id },
            action: 'reset_user_password',
            details: { email: user?.email || null },
            status: 'success'
        });

        return sendSuccess(res, { tempPassword, message: 'backend.password_reset_success' });
    } catch (error: any) {
        return sendError(res, 500, { code: 'PASSWORD_RESET_FAILED', message: error?.message || 'backend.failed_to_reset_password' });
    }
});

export default router;
