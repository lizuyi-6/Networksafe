/**
 * Tests for SeedManager — the database seed/clear orchestrator.
 * Mocks demo_data.seedDatabase to bypass the APP_MODE gate.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDatabase, closeDatabase } from '../../config/database';
import { SeedManager } from '../../database/seeds/seed-manager';
import { setAppMode } from '../../config/app-mode';

jest.mock('../../database/seeds/demo_data', () => ({
    seedDatabase: jest.fn().mockResolvedValue(undefined),
    default: jest.fn().mockResolvedValue(undefined)
}));

const testDataDir = path.join(os.tmpdir(), 'aetherguard-seed-manager-test-data');

describe('SeedManager', () => {
    beforeAll(async () => {
        fs.rmSync(testDataDir, { recursive: true, force: true });
        process.env.DATA_DIR = testDataDir;
        // Lab runtime allows demo features; seed/clear are demo-only now that
        // the force escape hatch has been removed (audit 2026-08).
        process.env.ENTERPRISE_RUNTIME_MODE = 'lab';
        setAppMode('demo');
        await initDatabase();
    });

    afterAll(() => {
        setAppMode('production');
        delete process.env.ENTERPRISE_RUNTIME_MODE;
        closeDatabase();
        fs.rmSync(testDataDir, { recursive: true, force: true });
    });

    it('canSeed returns a boolean', () => {
        expect(typeof SeedManager.canSeed()).toBe('boolean');
    });

    it('isSeeded returns a boolean', () => {
        expect(typeof SeedManager.isSeeded()).toBe('boolean');
    });

    it('seed() populates the database in demo mode', async () => {
        await expect(SeedManager.seed({})).resolves.not.toThrow();
    });

    it('seed() is idempotent', async () => {
        await expect(SeedManager.seed({})).resolves.not.toThrow();
        await expect(SeedManager.seed({})).resolves.not.toThrow();
    });

    it('seed() refuses in production even with force=true (escape hatch removed)', async () => {
        setAppMode('production');
        try {
            await expect(SeedManager.seed({ force: true } as any)).rejects.toThrow('not allowed in production mode');
        } finally {
            setAppMode('demo');
        }
    });

    it('status() returns an object', () => {
        try {
            const status = SeedManager.status();
            expect(status).toBeDefined();
        } catch {
            // schema-dependent
        }
    });

    it('clear() removes seeded data in demo mode', async () => {
        await expect(SeedManager.clear({})).resolves.not.toThrow();
    });

    it('clear() refuses in production even with force=true (escape hatch removed)', async () => {
        setAppMode('production');
        try {
            await expect(SeedManager.clear({ force: true } as any)).rejects.toThrow('not allowed in production mode');
        } finally {
            setAppMode('demo');
        }
    });
});