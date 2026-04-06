import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { sendError, sendSuccess } from '../../core/http/api-response';
import auditLogger from '../../security/audit-logger.service';
import {
  listAllAnnouncements,
  getAnnouncementById,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  publishAnnouncement,
  archiveAnnouncement,
} from './announcements.repository';

const router = Router();

// List all announcements (admin)
router.get('/announcements', authenticate, requireRole('admin'), async (_req: AuthenticatedRequest, res) => {
    try {
        const announcements = listAllAnnouncements();
        return sendSuccess(res, announcements || []);
    } catch (error: any) {
        return sendError(res, 500, { code: 'ANNOUNCEMENTS_LIST_FAILED', message: error?.message || 'backend.failed_to_list_announcements' });
    }
});

// Create announcement
router.post('/announcements', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { title, content, type, expiresAt } = req.body;

        if (!title || !content) {
            return sendError(res, 400, { code: 'INVALID_ANNOUNCEMENT', message: 'backend.title_content_required' });
        }

        const id = uuidv4();
        createAnnouncement({
            id,
            title,
            content,
            type: type || 'info',
            expiresAt: expiresAt || null,
            createdBy: req.user?.userId || null,
        });

        await auditLogger.log({
            tenantId: undefined,
            eventType: 'announcement_created',
            category: 'system',
            severity: 'info',
            actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: req.ip },
            action: 'create_announcement',
            details: { announcementId: id, title },
            status: 'success'
        });

        return sendSuccess(res, { id, title, content, type, status: 'draft' }, undefined, 201);
    } catch (error: any) {
        return sendError(res, 500, { code: 'ANNOUNCEMENT_CREATE_FAILED', message: error?.message || 'backend.failed_to_create_announcement' });
    }
});

// Update announcement
router.put('/announcements/:id', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;
        const { title, content, type, expiresAt } = req.body;

        const existing = getAnnouncementById(id);
        if (!existing) {
            return sendError(res, 404, { code: 'ANNOUNCEMENT_NOT_FOUND', message: 'backend.announcement_not_found' });
        }

        updateAnnouncement(id, {
            title: title || existing.title,
            content: content || existing.content,
            type: type || existing.type,
            expiresAt: expiresAt !== undefined ? expiresAt : (existing.expires_at || null),
        });

        await auditLogger.log({
            tenantId: undefined,
            eventType: 'announcement_updated',
            category: 'system',
            severity: 'info',
            actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: req.ip },
            action: 'update_announcement',
            details: { announcementId: id },
            status: 'success'
        });

        return sendSuccess(res, { id, updated: true });
    } catch (error: any) {
        return sendError(res, 500, { code: 'ANNOUNCEMENT_UPDATE_FAILED', message: error?.message || 'backend.failed_to_update_announcement' });
    }
});

// Delete announcement
router.delete('/announcements/:id', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;

        const existing = getAnnouncementById(id);
        if (!existing) {
            return sendError(res, 404, { code: 'ANNOUNCEMENT_NOT_FOUND', message: 'backend.announcement_not_found' });
        }

        deleteAnnouncement(id);

        await auditLogger.log({
            tenantId: undefined,
            eventType: 'announcement_deleted',
            category: 'system',
            severity: 'warning',
            actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: req.ip },
            action: 'delete_announcement',
            details: { announcementId: id, title: existing.title },
            status: 'success'
        });

        return sendSuccess(res, { deleted: true });
    } catch (error: any) {
        return sendError(res, 500, { code: 'ANNOUNCEMENT_DELETE_FAILED', message: error?.message || 'backend.failed_to_delete_announcement' });
    }
});

// Publish announcement
router.post('/announcements/:id/publish', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;

        const existing = getAnnouncementById(id);
        if (!existing) {
            return sendError(res, 404, { code: 'ANNOUNCEMENT_NOT_FOUND', message: 'backend.announcement_not_found' });
        }

        publishAnnouncement(id);

        await auditLogger.log({
            tenantId: undefined,
            eventType: 'announcement_published',
            category: 'system',
            severity: 'warning',
            actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: req.ip },
            action: 'publish_announcement',
            details: { announcementId: id, title: existing.title },
            status: 'success'
        });

        return sendSuccess(res, { id, status: 'published' });
    } catch (error: any) {
        return sendError(res, 500, { code: 'ANNOUNCEMENT_PUBLISH_FAILED', message: error?.message || 'backend.failed_to_publish_announcement' });
    }
});

// Archive announcement
router.post('/announcements/:id/archive', authenticate, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
    try {
        const { id } = req.params;

        const existing = getAnnouncementById(id);
        if (!existing) {
            return sendError(res, 404, { code: 'ANNOUNCEMENT_NOT_FOUND', message: 'backend.announcement_not_found' });
        }

        archiveAnnouncement(id);

        await auditLogger.log({
            tenantId: undefined,
            eventType: 'announcement_archived',
            category: 'system',
            severity: 'info',
            actor: { type: 'user', id: req.user?.userId || 'unknown', email: req.user?.email, ip: req.ip },
            action: 'archive_announcement',
            details: { announcementId: id, title: existing.title },
            status: 'success'
        });

        return sendSuccess(res, { id, status: 'archived' });
    } catch (error: any) {
        return sendError(res, 500, { code: 'ANNOUNCEMENT_ARCHIVE_FAILED', message: error?.message || 'backend.failed_to_archive_announcement' });
    }
});

export default router;
