import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth.middleware';
import { getDatabase } from '../../config/database';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const router = Router();

// SECURITY FIX: All admin routes now require authentication and admin role
router.get('/errors', authenticate, requireRole('admin'), AdminController.getErrors);
router.get('/performance', authenticate, requireRole('admin'), AdminController.getPerformance);
router.post('/logs', authenticate, requireRole('admin'), AdminController.submitLogs);

router.get('/api-keys', authenticate, requireRole('admin'), (req: AuthenticatedRequest, res) => {
    try {
        const db = getDatabase();
        const rows = db.prepare(`
            SELECT id, name, created_at, last_used
            FROM api_keys
            ORDER BY created_at DESC
            LIMIT 200
        `).all();

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
        const db = getDatabase();
        const userId = req.user?.userId;
        const tenantId = req.user?.tenantId || null;
        const name = String(req.body?.name || 'API Key').trim();

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'FG-AUTH-401',
                    message: 'Unauthorized',
                    timestamp: new Date().toISOString()
                }
            });
        }

        const id = uuidv4();
        const plaintext = `fgk_${crypto.randomBytes(24).toString('hex')}`;
        const keyHash = await bcrypt.hash(plaintext, 10);

        db.prepare(`
            INSERT INTO api_keys (id, name, key_hash, user_id, tenant_id, permissions, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(id, name, keyHash, userId, tenantId, '["read","write"]');

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

router.delete('/api-keys/:id', authenticate, requireRole('admin'), (req: AuthenticatedRequest, res) => {
    try {
        const db = getDatabase();
        const { id } = req.params;
        db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
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

export default router;
