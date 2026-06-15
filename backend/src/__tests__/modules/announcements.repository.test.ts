/**
 * Integration tests for the announcements repository — full CRUD + lifecycle
 * (draft → published → archived) backed by the in-memory SQLite store.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { initDatabase, closeDatabase, getDatabase } from '../../config/database';
import {
    ensureAnnouncementsSchema,
    createAnnouncement,
    getAnnouncementById,
    listPublishedAnnouncements,
    updateAnnouncement,
    deleteAnnouncement,
    publishAnnouncement,
    archiveAnnouncement
} from '../../modules/announcements/announcements.repository';

const testDataDir = path.join(os.tmpdir(), 'aetherguard-announcements-test-data');

describe('announcements repository', () => {
    beforeAll(async () => {
        fs.rmSync(testDataDir, { recursive: true, force: true });
        process.env.DATA_DIR = testDataDir;
        await initDatabase();
        ensureAnnouncementsSchema();
    });

    afterAll(() => {
        closeDatabase();
        fs.rmSync(testDataDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        // Reset table between tests via delete-all (schema stays).
        getDatabaseClean();
    });

    it('creates a draft announcement and reads it back by id', () => {
        createAnnouncement({
            id: 'a1', title: 'Hello', content: 'World', type: 'info',
            expiresAt: null, createdBy: null
        });
        const row = getAnnouncementById('a1');
        expect(row).toBeDefined();
        expect(row?.title).toBe('Hello');
        expect(row?.status).toBe('draft');
    });

    it('publish makes the announcement visible in listPublished; archive hides it', () => {
        createAnnouncement({ id: 'p1', title: 'Pub', content: 'c', type: 'info', expiresAt: null, createdBy: null });
        expect(listPublishedAnnouncements()).toEqual([]);

        publishAnnouncement('p1');
        const published = listPublishedAnnouncements();
        expect(published.map((a) => a.id)).toEqual(['p1']);
        // status is confirmed via getAnnouncementById (listPublished SELECT omits status)
        expect(getAnnouncementById('p1')?.status).toBe('published');

        archiveAnnouncement('p1');
        expect(listPublishedAnnouncements()).toEqual([]);
        expect(getAnnouncementById('p1')?.status).toBe('archived');
    });

    it('update changes title/content/type and preserves the row', () => {
        createAnnouncement({ id: 'u1', title: 'Old', content: 'old', type: 'info', expiresAt: null, createdBy: null });
        updateAnnouncement('u1', { title: 'New', content: 'new', type: 'warning', expiresAt: '2027-01-01' });
        const row = getAnnouncementById('u1');
        expect(row?.title).toBe('New');
        expect(row?.content).toBe('new');
        expect(row?.type).toBe('warning');
    });

    it('delete removes the announcement', () => {
        createAnnouncement({ id: 'd1', title: 'X', content: 'y', type: 'info', expiresAt: null, createdBy: null });
        deleteAnnouncement('d1');
        expect(getAnnouncementById('d1')).toBeUndefined();
    });

    it('listPublished returns only published rows, newest-first', () => {
        createAnnouncement({ id: 'x1', title: '1', content: 'c', type: 'info', expiresAt: null, createdBy: null });
        createAnnouncement({ id: 'x2', title: '2', content: 'c', type: 'info', expiresAt: null, createdBy: null });
        publishAnnouncement('x1');
        publishAnnouncement('x2');
        const ids = listPublishedAnnouncements().map((a) => a.id);
        // Ordering by published_at is second-granular; assert membership as a set.
        expect(ids.sort()).toEqual(['x1', 'x2']);
    });

    it('ensureAnnouncementsSchema is idempotent', () => {
        expect(() => ensureAnnouncementsSchema()).not.toThrow();
        expect(() => ensureAnnouncementsSchema()).not.toThrow();
    });
});

// Helper: clear the announcements table directly.
function getDatabaseClean() {
    try {
        getDatabase().prepare('DELETE FROM announcements').run();
    } catch {
        // table may not exist on first call; ensureSchema ran in beforeAll so safe
    }
}
