/**
 * FluxGuard Agent CLI - 命令行启动入口
 * 
 * 用法:
 *   npm run agent                    # 使用默认服务器地址
 *   npm run agent -- --server=http://your-server:8080
 */

import { startAgent } from './agent';
import logger from './utils/logger';

// 解析命令行参数
function parseArgs(): { serverUrl: string } {
    const args = process.argv.slice(2);
    let serverUrl = process.env.FLUXGUARD_SERVER || 'http://localhost:8080';

    for (const arg of args) {
        if (arg.startsWith('--server=')) {
            serverUrl = arg.replace('--server=', '');
        }
    }

    return { serverUrl };
}

// 打印启动横幅
function printBanner(): void {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   ███████╗██╗     ██╗   ██╗██╗  ██╗ ██████╗ ██╗   ██╗     ║
║   ██╔════╝██║     ██║   ██║╚██╗██╔╝██╔════╝ ██║   ██║     ║
║   █████╗  ██║     ██║   ██║ ╚███╔╝ ██║  ███╗██║   ██║     ║
║   ██╔══╝  ██║     ██║   ██║ ██╔██╗ ██║   ██║██║   ██║     ║
║   ██║     ███████╗╚██████╔╝██╔╝ ██╗╚██████╔╝╚██████╔╝     ║
║   ╚═╝     ╚══════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚═════╝      ║
║                                                           ║
║                Security Agent v2.0                        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
}

// 主函数
async function main(): Promise<void> {
    printBanner();

    const { serverUrl } = parseArgs();

    console.log(`[启动] 正在连接到管控平台: ${serverUrl}`);
    console.log('[提示] 按 Ctrl+C 停止 Agent\n');

    try {
        const agent = await startAgent(serverUrl);

        // 优雅关闭
        process.on('SIGINT', async () => {
            console.log('\n[停止] 正在关闭 Agent...');
            await agent.stop();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log('\n[停止] 正在关闭 Agent...');
            await agent.stop();
            process.exit(0);
        });

    } catch (error: any) {
        logger.error('Agent 启动失败', { error: error.message });
        console.error(`[错误] Agent 启动失败: ${error.message}`);
        process.exit(1);
    }
}

// 运行
main();
