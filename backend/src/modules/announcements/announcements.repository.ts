import { getDatabase } from '../../config/database';
import logger from '../../utils/logger';

export interface AnnouncementRow {
  id: string;
  title: string;
  content: string;
  type: string;
  status: string;
  expires_at?: string | null;
  published_at?: string | null;
  created_by?: string | null;
  created_by_email?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export function ensureAnnouncementsSchema(): void {
  try {
    const db = getDatabase();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS announcements (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT DEFAULT 'info',
        status TEXT DEFAULT 'draft',
        expires_at TEXT,
        published_at TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run();
  } catch (error: any) {
    logger.warn('Failed to create announcements table', { error: error?.message });
  }
}

export function listPublishedAnnouncements(): AnnouncementRow[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT id, title, content, type, published_at, expires_at
    FROM announcements
    WHERE status = 'published'
    ORDER BY published_at DESC
  `).all() as AnnouncementRow[];
}

export function listAllAnnouncements(): AnnouncementRow[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT a.*, u.email as created_by_email
    FROM announcements a
    LEFT JOIN users u ON a.created_by = u.id
    ORDER BY a.created_at DESC
  `).all() as AnnouncementRow[];
}

export function getAnnouncementById(id: string): AnnouncementRow | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as AnnouncementRow | undefined;
}

export function createAnnouncement(params: {
  id: string; title: string; content: string; type: string;
  expiresAt: string | null; createdBy: string | null;
}): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO announcements (id, title, content, type, status, expires_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, datetime('now'), datetime('now'))
  `).run(params.id, params.title, params.content, params.type, params.expiresAt, params.createdBy);
}

export function updateAnnouncement(id: string, params: {
  title: string; content: string; type: string; expiresAt: string | null;
}): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE announcements
    SET title = ?, content = ?, type = ?, expires_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(params.title, params.content, params.type, params.expiresAt, id);
}

export function deleteAnnouncement(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
}

export function publishAnnouncement(id: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE announcements
    SET status = 'published', published_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
}

export function archiveAnnouncement(id: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE announcements
    SET status = 'archived', updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
}
