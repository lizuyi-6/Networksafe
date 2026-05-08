#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import { installCommand } from './commands/install';
import { startCommand } from './commands/start';
import { stopCommand } from './commands/stop';
import { restartCommand } from './commands/restart';
import { statusCommand } from './commands/status';
import { logsCommand } from './commands/logs';
import { updateCommand } from './commands/update';
import { uninstallCommand } from './commands/uninstall';
import { agentCommand } from './commands/agent';

program
  .name('aetherguard')
  .description('AetherGuard - 智能服务器安全防御平台 CLI')
  .version('1.0.0');

program
  .command('install')
  .description('一键安装 AetherGuard 生产环境')
  .option('-d, --dir <dir>', '安装目录', '/opt/aetherguard')
  .option('-p, --port <port>', 'HTTP 端口', '80')
  .option('-b, --backend-port <port>', '后端端口', '3005')
  .option('--skip-deps', '跳过依赖安装')
  .option('--skip-build', '跳过前后端构建')
  .action(async (options) => {
    await installCommand({
      dir: options.dir,
      port: parseInt(options.port, 10),
      backendPort: parseInt(options.backendPort, 10),
      skipDeps: options.skipDeps,
      skipBuild: options.skipBuild,
    });
  });

program
  .command('start')
  .description('启动 AetherGuard 服务')
  .action(startCommand);

program
  .command('stop')
  .description('停止 AetherGuard 服务')
  .action(stopCommand);

program
  .command('restart')
  .description('重启 AetherGuard 服务')
  .action(restartCommand);

program
  .command('status')
  .description('查看服务运行状态')
  .action(statusCommand);

program
  .command('logs')
  .description('查看服务日志')
  .option('-s, --service <service>', '指定服务 (backend|nginx|all)', 'all')
  .option('-n, --lines <lines>', '显示行数', '100')
  .option('-f, --follow', '持续跟踪日志', false)
  .action(async (options) => {
    await logsCommand({
      service: options.service,
      lines: parseInt(options.lines, 10),
      follow: options.follow,
    });
  });

program
  .command('update')
  .description('更新到最新版本')
  .action(updateCommand);

program
  .command('uninstall')
  .description('卸载 AetherGuard（会删除所有数据）')
  .action(uninstallCommand);

program
  .command('agent')
  .description('安装/管理 AetherGuard Agent')
  .option('-s, --server <url>', '控制面板地址')
  .option('-c, --onboarding-code <code>', '注册码')
  .option('-h, --hostname <name>', '主机名')
  .option('-d, --install-dir <dir>', '安装目录', '/opt/aetherguard-agent')
  .action(async (options) => {
    await agentCommand({
      server: options.server,
      onboardingCode: options.onboardingCode,
      hostname: options.hostname,
      installDir: options.installDir,
    });
  });

// Custom help
program.on('--help', () => {
  console.log('');
  console.log(chalk.cyan('示例:'));
  console.log('  $ aetherguard install              # 交互式安装');
  console.log('  $ aetherguard install --dir /opt/ag --port 8080');
  console.log('  $ aetherguard start                # 启动服务');
  console.log('  $ aetherguard status               # 查看状态');
  console.log('  $ aetherguard logs -f              # 实时查看日志');
  console.log('  $ aetherguard agent -s http://server:3005 -c ABC123');
  console.log('');
});

program.parse();
