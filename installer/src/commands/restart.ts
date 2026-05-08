import { execQuiet } from '../utils/exec';
import { success, warn, header, spinner } from '../utils/logger';

const PM2_NAME = 'AetherGuard-backend';

export async function restartCommand(): Promise<void> {
  header('重启 AetherGuard 服务');

  const s1 = spinner('重启后端 (PM2)...');
  const pm2Restarted = await execQuiet('pm2', ['restart', PM2_NAME]);
  if (pm2Restarted) {
    s1.succeed('后端服务已重启');
  } else {
    s1.warn('后端服务重启失败，尝试启动...');
    const started = await execQuiet('pm2', ['start', 'index.js', '--name', PM2_NAME]);
    if (started) {
      s1.succeed('后端服务已启动');
    } else {
      s1.fail('后端服务操作失败');
    }
  }

  const s2 = spinner('重启 Nginx...');
  const nginxRestarted = await execQuiet('systemctl', ['restart', 'nginx']);
  if (nginxRestarted) {
    s2.succeed('Nginx 已重启');
  } else {
    s2.warn('Nginx 重启失败');
  }

  success('AetherGuard 服务重启完成');
}
