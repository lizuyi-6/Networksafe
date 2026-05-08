import * as fs from 'fs';
import inquirer from 'inquirer';
import { exec, execQuiet } from '../utils/exec';
import { info, success, error, warn, header, spinner } from '../utils/logger';

const PM2_NAME = 'AetherGuard-backend';

export async function uninstallCommand(): Promise<void> {
  header('卸载 AetherGuard');

  warn('⚠ 此操作将停止所有服务并删除 AetherGuard 相关文件');

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: '确定要卸载 AetherGuard 吗?',
      default: false,
    },
  ]);

  if (!confirm) {
    info('已取消卸载');
    return;
  }

  const { confirmAgain } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmAgain',
      message: '再次确认: 所有数据将被删除，此操作不可恢复!',
      default: false,
    },
  ]);

  if (!confirmAgain) {
    info('已取消卸载');
    return;
  }

  // Stop services
  const s1 = spinner('停止服务...');
  await execQuiet('pm2', ['delete', PM2_NAME]);
  await execQuiet('systemctl', ['stop', 'nginx']);
  s1.succeed('服务已停止');

  // Remove directories
  const s2 = spinner('删除文件...');
  const dirs = ['/opt/aetherguard', '/var/www/aetherguard'];
  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // Remove nginx config
  const nginxConf = '/etc/nginx/conf.d/aetherguard.conf';
  if (fs.existsSync(nginxConf)) {
    fs.unlinkSync(nginxConf);
  }
  s2.succeed('文件已删除');

  // Reload nginx
  const s3 = spinner('清理 Nginx 配置...');
  await execQuiet('nginx', ['-t']);
  await execQuiet('systemctl', ['reload', 'nginx']);
  s3.succeed('Nginx 配置已清理');

  success('AetherGuard 已卸载');
  info('如需重新安装，请运行: aetherguard install');
}
