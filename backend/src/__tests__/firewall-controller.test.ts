/**
 * 防火墙控制器单元测试
 */

import { FirewallController } from '../agent/firewall-controller';

describe('FirewallController', () => {
    let controller: FirewallController;
    let detectBackendSpy: jest.SpyInstance;

    beforeEach(() => {
        detectBackendSpy = jest
            .spyOn(FirewallController.prototype as any, 'detectBackend')
            .mockResolvedValue(undefined);
        controller = new FirewallController();
        // Keep unit tests deterministic and avoid touching host firewall.
        (controller as any).backend = 'none';
    });

    afterEach(async () => {
        await controller.clearAll();
        detectBackendSpy.mockRestore();
    });

    describe('IP Validation', () => {
        it('should reject invalid IP addresses', async () => {
            const result = await controller.blockIP('not-an-ip');
            expect(result).toBe(false);
        });

        it('should reject local IP addresses', async () => {
            const result127 = await controller.blockIP('127.0.0.1');
            const result192 = await controller.blockIP('192.168.1.1');

            expect(result127).toBe(false);
            expect(result192).toBe(false);
        });

        it('should accept valid public IP', async () => {
            // 注意：这个测试会尝试真正执行防火墙命令
            // 在没有防火墙后端的情况下仍会返回 true（记录到内存）
            const result = await controller.blockIP('203.15.44.12');
            expect(result).toBe(true);
        });
    });

    describe('Block List Management', () => {
        it('should track blocked IPs', async () => {
            await controller.blockIP('8.8.8.8', 3600, 'Test');

            expect(controller.isBlocked('8.8.8.8')).toBe(true);
            expect(controller.isBlocked('8.8.4.4')).toBe(false);
        });

        it('should return blocked IP list', async () => {
            await controller.blockIP('1.1.1.1');
            await controller.blockIP('2.2.2.2');

            const blocked = controller.getBlockedIPs();

            expect(blocked.length).toBe(2);
            expect(blocked.some(b => b.ip === '1.1.1.1')).toBe(true);
            expect(blocked.some(b => b.ip === '2.2.2.2')).toBe(true);
        });

        it('should unblock IP', async () => {
            await controller.blockIP('3.3.3.3');
            expect(controller.isBlocked('3.3.3.3')).toBe(true);

            await controller.unblockIP('3.3.3.3');
            expect(controller.isBlocked('3.3.3.3')).toBe(false);
        });

        it('should not block same IP twice', async () => {
            await controller.blockIP('4.4.4.4');
            await controller.blockIP('4.4.4.4');

            const blocked = controller.getBlockedIPs().filter(b => b.ip === '4.4.4.4');
            expect(blocked.length).toBe(1);
        });
    });

    describe('Block Duration', () => {
        it('should store expiry time for timed blocks', async () => {
            await controller.blockIP('5.5.5.5', 3600);

            const blocked = controller.getBlockedIPs().find(b => b.ip === '5.5.5.5');

            expect(blocked).toBeDefined();
            expect(blocked?.expiresAt).toBeDefined();
            expect(blocked?.expiresAt!.getTime()).toBeGreaterThan(Date.now());
        });

        it('should not have expiry for permanent blocks', async () => {
            await controller.blockIP('6.6.6.6', 0); // 0 = permanent

            const blocked = controller.getBlockedIPs().find(b => b.ip === '6.6.6.6');

            expect(blocked?.expiresAt).toBeUndefined();
        });
    });

    describe('Clear All', () => {
        it('should clear all blocked IPs', async () => {
            await controller.blockIP('7.7.7.7');
            await controller.blockIP('8.8.8.8');

            expect(controller.getBlockedIPs().length).toBe(2);

            await controller.clearAll();

            expect(controller.getBlockedIPs().length).toBe(0);
        });
    });

    describe('Backend Detection', () => {
        it('waits for backend detection before applying a block', async () => {
            let releaseDetection: () => void = () => undefined;
            const detectionGate = new Promise<void>((resolve) => {
                releaseDetection = resolve;
            });
            detectBackendSpy.mockImplementationOnce(async function (this: FirewallController) {
                await detectionGate;
                (this as any).backend = 'none';
            });

            const gatedController = new FirewallController();
            let settled = false;
            const blockResult = gatedController.blockIP('9.9.9.9', 0).then((result) => {
                settled = true;
                return result;
            });

            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(settled).toBe(false);

            releaseDetection();
            await expect(blockResult).resolves.toBe(true);
            await gatedController.clearAll();
        });

        it('should report backend type', () => {
            const backend = controller.getBackend();

            // 在 Windows 上应该是 netsh，在 Linux 上可能是 iptables/ufw/firewalld
            expect(['iptables', 'firewalld', 'ufw', 'netsh', 'none']).toContain(backend);
        });
    });
});
