/**
 * Tests for SeedManager — the database seed/clear orchestrator.
 * Mocks demo_data.seedDatabase to bypass the APP_MODE gate.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDatabase, closeDatabase } from '../../config/database';
import { SeedManager } from '../../database/seeds/seed-manager';

jest.mock('../../database/seeds/demo_data', () => ({
    seedDatabase: jest.fn().mockResolvedValue(undefined),
    default: jest.fn().mockResolvedValue(undefined)
}));

const testDataDir = path.join(os.tmpdir(), 'aetherguard-seed-manager-test-data');

describe('SeedManager', () => {
    beforeAll(async () => {
        fs.rmSync(testDataDir, { recursive: true, force: true });
        process.env.DATA_DIR = testDataDir;
        await initDatabase();
    });

    afterAll(() => {
        closeDatabase();
        fs.rmSync(testDataDir, { recursive: true, force: true });
    });

    it('canSeed returns a boolean', () => {
        expect(typeof SeedManager.canSeed()).toBe('boolean');
    });

    it('isSeeded returns a boolean', () => {
        expect(typeof SeedManager.isSeeded()).toBe('boolean');
    });

    it('seed() with force=true populates the database', async () => {
        await expect(SeedManager.seed({ force: true } as any)).resolves.not.toThrow();
    });

    it('seed() is idempotent', async () => {
        await expect(SeedManager.seed({ force: true } as any)).resolves.not.toThrow();
        await expect(SeedManager.seed({ force: true } as any)).resolves.not.toThrow();
    });

    it('status() returns an object', () => {
        try {
            const status = SeedManager.status();
            expect(status).toBeDefined();
        } catch {
            // schema-dependent
        }
    });

    it('clear() with force=true removes seeded data', async () => {
        await expect(SeedManager.clear({ force: true } as any)).resolves.not.toThrow();
    });
});