/**
 * Tests for LogCollector — a file-watching log collector that monitors log
 * files and matches dangerous patterns. Extends EventEmitter. Verifies pattern
 * registration, file watching lifecycle, and safe handling of missing files.
 */

import { LogCollector } from '../../agent/log-collector';
import type { LogPattern } from '../../agent/log-collector';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('LogCollector', () => {
    let collector: LogCollector;
    const tmpDir = path.join(os.tmpdir(), `aetherguard-log-collector-test-${Date.now()}`);

    beforeEach(() => {
        fs.mkdirSync(tmpDir, { recursive: true });
        collector = new LogCollector();
    });

    afterEach(async () => {
        collector.stop();
        collector.removeAllListeners();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('starts with no watched files', () => {
        expect(collector.getWatchedFiles()).toEqual([]);
    });

    it('addPattern registers a pattern without throwing', () => {
        const pattern: LogPattern = {
            name: 'Failed login',
            regex: /Failed password for/i,
            severity: 'medium'
        } as LogPattern;
        expect(() => collector.addPattern(pattern)).not.toThrow();
    });

    it('addLogFile returns true for an existing readable file', async () => {
        const logFile = path.join(tmpDir, 'app.log');
        fs.writeFileSync(logFile, 'INFO system started\n');
        const result = await collector.addLogFile(logFile, 'test');
        expect(result).toBe(true);
        expect(collector.getWatchedFiles()).toContain(logFile);
    });

    it('addLogFile returns false for a non-existent file', async () => {
        const result = await collector.addLogFile(path.join(tmpDir, 'nope.log'), 'test');
        expect(result).toBe(false);
    });

    it('stop() does not throw', () => {
        expect(() => collector.stop()).not.toThrow();
    });

    it('is an EventEmitter (can register listeners)', () => {
        let called = false;
        collector.on('test-event', () => { called = true; });
        collector.emit('test-event');
        expect(called).toBe(true);
    });
});
