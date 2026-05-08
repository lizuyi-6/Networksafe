import { execQuiet } from '../utils/exec';
import { success, warn, header, spinner } from '../utils/logger';

const PM2_NAME = 'AetherGuard-backend';

export async function stopCommand(): Promise<void> {
  header('停止 AetherGuard 服务');

  const s1 = spinner('停止后端 (PM2)...');
  const pm2Stopped = await execQuiet('pm2', ['stop', PM2_NAME]);
  if (pm2Stopped) {
    s1.succeed('后端服务已停止');
  } else {
    s1.warn('后端服务未运行或已停止');
  }

  const s2 = spinner('停止 Nginx...');
  const nginxStopped = await execQuiet('systemctl', ['stop', 'nginx']);
  if (nginxStopped) {
    s2.succeed('Nginx 已停止');
  } else {
    s2.warn('Nginx 未运行或已停止');
  }

  success('AetherGuard 服务已停止');
}
