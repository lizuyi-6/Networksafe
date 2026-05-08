import { exec, execQuiet } from '../utils/exec';
import { info, success, error, header, spinner } from '../utils/logger';

const PM2_NAME = 'AetherGuard-backend';

export async function startCommand(): Promise<void> {
  header('启动 AetherGuard 服务');

  const s1 = spinner('启动后端 (PM2)...');
  const pm2Started = await execQuiet('pm2', ['restart', PM2_NAME]).catch(() =>
    execQuiet('pm2', ['start', 'index.js', '--name', PM2_NAME])
  );
  if (pm2Started) {
    s1.succeed('后端服务已启动');
  } else {
    s1.fail('后端服务启动失败');
    error('请检查 PM2 是否安装: npm install -g pm2');
    process.exit(1);
  }

  const s2 = spinner('启动 Nginx...');
  const nginxStarted = await execQuiet('systemctl', ['start', 'nginx']);
  if (nginxStarted) {
    s2.succeed('Nginx 已启动');
  } else {
    s2.fail('Nginx 启动失败');
    error('请检查 Nginx 是否安装');
  }

  success('AetherGuard 服务启动完成');
}
