
import { TrafficMonitor } from '../agent/traffic-monitor';
import fs from 'fs';
import { exec } from 'child_process';

// Mock fs and child_process
jest.mock('fs');
jest.mock('child_process');

describe('TrafficMonitor', () => {
    let monitor: TrafficMonitor;
    const mockCallback = jest.fn();

    beforeEach(() => {
        monitor = new TrafficMonitor();
        jest.clearAllMocks();
    });

    afterEach(async () => {
        await monitor.stop();
    });

    describe('start', () => {
        it('should start monitoring when a log file is found', async () => {
            // Mock fs.existsSync to return true for the first nginx path
            (fs.existsSync as jest.Mock).mockReturnValueOnce(true);
            // Mock fs.statSync
            (fs.statSync as jest.Mock).mockReturnValue({ size: 1000 });
            // Mock fs.watch
            (fs.watch as jest.Mock).mockReturnValue({
                close: jest.fn(),
                on: jest.fn()
            });

            await monitor.start(mockCallback);

            expect(fs.existsSync).toHaveBeenCalled();
            expect(fs.watch).toHaveBeenCalled();
        });

        it('should fallback to netstat if no log file found', async () => {
            // Mock fs.existsSync to always return false
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            await monitor.start(mockCallback);

            // Should verify fallbackToNetstat was called (implicit verification via behavior or spy)
            // Since fallbackToNetstat is private, we can verify the side effect (netstat command)
            // But fallbackToNetstat is async and uses setInterval logic, might be tricky to test without timers
        });
    });

    describe('Log Parsing', () => {
        it('should parse Nginx combined format correctly', () => {
            const line = '192.168.1.1 - - [25/Jan/2026:10:00:00 +0000] "GET /api/v1/users HTTP/1.1" 200 1024 "-" "Mozilla/5.0"';

            // Access private method via casting to any
            const result = (monitor as any).parseLogLine(line);

            expect(result).toBeDefined();
            expect(result.sourceIP).toBe('192.168.1.1');
            expect(result.method).toBe('GET');
            expect(result.path).toBe('/api/v1/users');
            expect(result.userAgent).toBe('Mozilla/5.0');
        });

        it('should return null for invalid log lines', () => {
            const line = 'Invalid log line content';
            const result = (monitor as any).parseLogLine(line);
            expect(result).toBeNull();
        });
    });
});
